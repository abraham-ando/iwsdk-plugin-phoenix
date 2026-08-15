# Per-peer rate limiting — design

Approved 2026-08-15, brainstormed section by section. Bounds what a single
peer can cost a room, for a public VR MMO RPG deployment where the peers are
strangers and some of them are hostile.

## Context

The server validates what a peer *claims* but not how often it claims it.
`IwsdkPhoenix.Physics.Kinematic` rejects speed hacks, the diagonal exploit,
oversized timesteps and replayed input; `Protocol` caps a signalling payload at
16 KiB (`protocol.ex:54`). Nothing bounds **message frequency**. The client's
`NetworkLODSystem` throttles publishing, but that is cooperative — it is code
the attacker controls.

Three facts from the code shape everything below.

**Frames reach the room through a synchronous call.**
`RoomChannel.handle_in/3` (`room_channel.ex:216`) calls
`Room.Server.handle_frame/3`, which is a `GenServer.call`
(`room/server.ex:71`). Every frame from all 80 peers is serialised through one
process, and the caller blocks until it returns. A flood therefore does not
merely fill a mailbox: it serialises, and it expires the calls of *other*
peers under the default 5 s timeout. One attacker degrades the other 79. That
amplification is the specific thing this design removes.

**A legitimate peer sends far more than 30 Hz.** `ClientPredictionSystem`
sends an `INPUT_UPDATE` every frame, unthrottled
(`ClientPredictionSystem.ts:138`) — 90 to 120 messages per second on a Quest,
all honest. `sendRateHz` (default 30, `plugin.ts:217`) governs transforms only,
and a peer holding two grabbed objects publishes three transform streams. Any
budget calibrated on 30 Hz would drop every honest player in
`:server_authoritative`.

**Counters, not a telemetry dependency.** `Persistence.Buffer` exposes
"lifetime counters, for telemetry" (`persistence/buffer.ex:143`) and lets the
application wire them up. This design follows that precedent exactly; no
`:telemetry` dependency is added.

## The approach, and the ones rejected

**A weighted token bucket per peer, held in the socket's assigns, checked
before the frame reaches the room.**

Three decisions, each with a rejected alternative.

**Weighted rather than uniform.** Opcodes differ by more than an order of
magnitude in what they cost the server: a `TRANSFORM_UPDATE` is relayed
without being decoded, an `OWNERSHIP_REQUEST` arbitrates and then
`broadcast_all`s to 80 peers, a `SIGNAL` may carry 16 KiB. A uniform
messages-per-second budget must be calibrated for the most expensive opcode,
which throttles legitimate movement to protect against ownership spam. Against
an attacker offering ~1,000 frames/s, a uniform 256/s budget slows an ownership
flood by 4×; the same headline number with weighting slows it by 40×, and
neither touches an honest peer.

Per-class budgets — a separate bucket for movement, actions and signalling —
were also rejected. They give real isolation, but N structures and N constants
per peer, and an attacker can saturate every compartment simultaneously up to
each limit.

**Silent drop rather than a rejection frame.** The frame is discarded, a
counter increments, nothing is sent back. An honest peer should never reach
the limit, so there is nothing to tell it; an attacker learns nothing about
where the limit sits. Replying with a `RATE_LIMITED` opcode was rejected twice
over: it would add an opcode to the wire — a new golden vector, regenerated
fixtures, both runtimes updated — and it would hand the attacker an oracle for
calibrating a flood to sit just under the threshold. **This design changes no
bytes on the wire and requires no Cardinal regeneration.**

**Applied at the socket, decided in a pure module.** Each Phoenix socket is
its own process; the room is shared by all 80. Deciding inside
`Room.Handler` would keep everything in the dependency-free layer and cover
every transport, but the flood would already have crossed the room's mailbox
and consumed a `call` slot before being discarded — which is precisely the
failure this design exists to prevent. So the *decision* is a dependency-free
module and the *application point* is the channel: testable without Phoenix,
one bucket per socket, zero contention, and the flood absorbed in the
attacker's own process.

Defence in depth at both layers was rejected as two states to keep in step and
two sets of constants to reconcile, for a threat the socket layer already
stops.

## Section 1 — The pure limiter

`IwsdkPhoenix.RateLimiter`, dependency-free, no process, no timer.

```elixir
defstruct tokens: 0.0, capacity: 0.0, refill_per_ms: 0.0, last_ms: 0, dropped: 0

@spec new(keyword()) :: t()
@spec take(t(), cost :: number(), now_ms :: integer()) :: {:ok, t()} | {:drop, t()}
@spec counters(t()) :: %{dropped: non_neg_integer(), tokens: float()}
```

Time is an argument, never an internal clock read — the same shape as
`Kinematic.integrate/8` and `DayNight.sun_angle/1`. That is what makes the
tests deterministic and free of `Process.sleep`.

Refill is **lazy**: `take/3` credits the tokens earned since `last_ms` at the
moment a message arrives. Nothing runs while a peer is silent. A bucket is
five machine words and no process, which is the only viable shape at 375,000
sectors × 80 peers.

Two guards:

- A drop does **not** consume tokens. Charging for rejected frames would let a
  sustained flood hold the bucket at zero and deny the peer its recovery.
- `now_ms` going backwards clamps elapsed time to zero rather than minting
  negative tokens. Monotonic time is monotonic per node, but a bucket must not
  corrupt its own state if that assumption ever fails.

## Section 2 — Costs and calibration

Cost is computed from the opcode and the frame length alone:

```
cost = base(opcode) + div(byte_size(frame), bytes_per_token(opcode))
```

No decoding. `peek_opcode/1` already reads one byte, and `byte_size/1` on an
Erlang binary is O(1) — the size lives in the header, so the length component
is free rather than requiring the entity count to be parsed out of a snapshot.

| Opcode | Base | Bytes/token | Rationale |
|---|---|---|---|
| `INPUT_UPDATE` | 1 | — | 22 fixed bytes, re-simulated; up to 120/s legitimately |
| `TRANSFORM_UPDATE` | 1 | — | 33 fixed bytes, relayed undecoded |
| `PING` | 1 | — | trivial, but spammable |
| `SNAPSHOT` | 1 | 128 | 32-byte records, so this bills ~n/4 without parsing n |
| `COMPONENT_UPDATE` | 5 | — | mutates state, then fans out |
| `OWNERSHIP_REQUEST` | 10 | — | arbitrates, writes, `broadcast_all` to 80 peers |
| `SIGNAL` | 1 | 1024 | up to 17 for a 16 KiB payload |
| unknown / malformed | 10 | — | see below |

An unrecognised opcode is billed at 10, not 1. The limiter runs *before*
dispatch, so an unknown opcode has not yet been rejected by the protocol —
and when it is, `handle_frame` returns `{:error, reason}`, which costs a
`Logger.debug` and a reply frame (`room_channel.ex:245`). Billing malformed
traffic at the same rate as a transform would leave the cheapest flood to
build being the one made of garbage bytes.

The same reasoning covers every other way into the channel. `handle_in` has
**three** clauses, and a limiter on only one of them is a limiter with two
doors left open:

| Clause | Traffic | Charge |
|---|---|---|
| `room_channel.ex:196` | `PING`, matched on the literal opcode `7` | 1, via the normal table |
| `room_channel.ex:216` | all other binary frames | per the table |
| `room_channel.ex:252` | JSON on the binary event | 10, malformed |

The ping clause matters more than its cost suggests: it is the clock-sync
path, and it performs two `Clock.now_ms/0` reads, a decode and an encode. It
is cheap per call and unbounded per second, which is exactly the profile the
bucket exists to bound.

Defaults: **256 tokens/s sustained, capacity 768** (three seconds of reserve,
to absorb a join or teleport burst).

What that yields:

| Peer | Cost | Verdict |
|---|---|---|
| Honest, authoritative, 120 Hz + 2 held objects | 180/s | under budget, with margin |
| `OWNERSHIP_REQUEST` flood | capped at 25/s | ~40× reduction |
| 16 KiB `SIGNAL` flood | capped at ~240 KB/s | ~65× reduction |

The weighting does the work without tightening anything on normal traffic,
which is the property being bought: invisible to an honest peer, brutal to
abuse.

## Section 3 — Integration and telemetry

Insertion is at `room_channel.ex:216`, wrapping the existing body rather than
altering it:

```elixir
def handle_in(@frame_event, {:binary, frame}, socket) do
  case check(socket.assigns.rate_limiter, frame, Clock.now_ms()) do
    {:drop, limiter} ->
      # Nothing reaches the room. Silent: no reply, no oracle.
      Logger.debug("iwsdk_phoenix rate limited a frame")
      {:noreply, assign(socket, :rate_limiter, limiter)}

    {:ok, limiter} ->
      socket = assign(socket, :rate_limiter, limiter)
      # ... existing body, unchanged
  end
end
```

The bucket is built in `join/3` (`room_channel.ex:89`) with three levels of
precedence, general to specific:

1. module defaults — 256 tokens/s, capacity 768;
2. `Application.get_env(:iwsdk_phoenix, :rate_limit, [])` — the deployment's setting;
3. `socket.assigns[:rate_limit]`, set by the application in `connect/2`.

Level 3 is what a persistent-world deployment needs: a per-account budget,
wider for a trusted character, tighter for one already flagged — without this
package holding any opinion about accounts, reputation or moderation.

One constraint on the implementation: `RoomChannel`'s body is generated inside
a `quote`, compiled only when Phoenix is loaded. A function call is not allowed
in a pattern there — which is why the ping clause matches the literal `7`
(`room_channel.ex:194`). All limiter calls therefore happen in clause *bodies*,
never in heads, and the cost table lives in its own ordinary module where
module attributes can hold `Protocol.op_*()` values.

Telemetry follows `Persistence.Buffer`: the bucket carries its own lifetime
counters, `counters/1` exposes them, and the application publishes them
wherever it already publishes metrics. The `Logger.debug` matches the existing
treatment of rejected frames at `room_channel.ex:245`.

## Section 4 — Verification

1. **Pure, without Phoenix** (`test/rate_limiter_test.exs`, runs under
   `IWSDK_CORE_ONLY=1`). Time is injected, so no `Process.sleep` anywhere:
   exact refill over a known interval, exhaustion then recovery, tokens never
   exceeding capacity, a drop leaving the token count untouched, a backwards
   `now_ms` minting nothing, and each opcode's cost including the
   length-derived component.

2. **The regression that matters most.** A peer in `:server_authoritative` at
   120 Hz, holding two objects publishing at 30 Hz, over ten simulated
   seconds, is **never dropped once**. This is the test that stops a future
   tightening of the constants from silently breaking legitimate players —
   the most expensive failure mode here, and the hardest to diagnose in
   production because it looks exactly like packet loss.

3. **No bypass.** A flood of unrecognised opcodes, and a flood of JSON on the
   binary event, are each billed and each exhaust the bucket — asserted at the
   channel, since the non-binary clause has no equivalent below it. Without
   these two, the cheapest attack on the room would be the one this design
   never looked at.

4. **End to end** (`apps/demo_server`, a real Phoenix socket). A flooding peer
   has its frames disappear, **and a second peer in the same room continues to
   be served normally**. That second assertion is the one proving the
   amplification is cut; without it the test would pass on a design that
   simply broke the room for everyone.

## Out of scope

- **Aggregate room capacity.** This design bounds what *one* peer costs. It
  does not bound 80 honest peers at 120 Hz — roughly 9,600 serialised
  `GenServer.call`s per second against a single process. That is a capacity
  problem, not an adversary problem, and no per-peer limit can address it: the
  traffic is legitimate. It is being investigated separately, starting with a
  measurement spike, because the remedies — `cast`, per-tick batching, room
  sharding, moving relay off the process — differ radically depending on
  whether the wall is at 2,000 or 50,000 messages per second.
- **Reputation, banning and moderation.** The counters are exposed so an
  operator can act out of band. Deciding what a repeated offender deserves is
  the application's call, not this package's.
- **Rate limiting other transports.** `Room.Handler` stays untouched, so the
  Loopback and Offline adapters are unaffected. If a non-Phoenix transport
  ever carries hostile traffic, it applies the same pure module at its own
  boundary.
- **Bandwidth accounting for outbound fan-out.** Bounding inbound traffic
  bounds the fan-out it triggers, by a factor of the room size. Metering
  egress directly is a separate concern.
