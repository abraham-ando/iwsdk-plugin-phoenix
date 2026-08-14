# Architecture

How a hand moving in a headset becomes a hand moving on someone else's screen,
and why each layer is shaped the way it is.

## The frame budget is the whole design constraint

A Quest renders at 90 FPS. That is **11.1 ms** per frame for simulation,
culling, and two eye passes. Anything that blocks the main thread for even a
couple of milliseconds shows up as a dropped frame, and dropped frames in VR are
not a polish issue — they are a comfort issue.

Every structural decision below follows from that number.

## Data flow

```
    RENDER THREAD                          NETWORK WORKER              SERVER (BEAM)
 ┌────────────────────┐                 ┌──────────────────┐      ┌──────────────────┐
 │ NetworkLODSystem   │  publish rate   │                  │      │  RoomChannel     │
 │        ↓           │                 │  PhoenixConnect. │      │        ↓         │
 │ ClientPrediction   │  ──── SEND ───► │  Socket/Channel  │ ───► │  Room.Handler    │
 │        ↓           │   (transfer)    │  heartbeats      │      │        ↓         │
 │ PhoenixNetwork     │                 │  reconnect       │      │  Room.State      │
 │   drain + publish  │ ◄── SAB ring ── │  Presence        │ ◄─── │  Physics backend │
 │        ↓           │   (zero-copy)   │                  │      │  SpatialGrid AoI │
 │ NetworkInterp.     │                 └──────────────────┘      └──────────────────┘
 └────────────────────┘
```

## Client

### Why a dedicated worker

A Phoenix socket does more than carry bytes: heartbeats, reconnect backoff,
channel bookkeeping and Presence diffs all run on timers. On the main thread a
reconnect storm or a burst of channel messages competes directly with rendering.
Moving all of it into a worker means the render thread's only networking work is
draining a buffer.

### Why a `SharedArrayBuffer` ring rather than `postMessage`

`postMessage` with a transferable is already zero-copy for the *payload*, but it
allocates a message object per frame and delivers it as a task on the main
thread's event loop. At 30 Hz across dozens of entities that is thousands of
tasks per second plus the GC churn they create — exactly the profile that
produces micro-stutter.

`RingBuffer` is a lock-free single-producer/single-consumer byte ring. The
worker writes, the render thread drains once per frame. With exactly one writer
and one reader, `readPos` and `writePos` each have a single owner, so a pair of
atomic loads and stores is sufficient — no locks, and critically no
`Atomics.wait`, which is forbidden on the main thread and would defeat the
purpose anyway.

When the ring is full it **drops** rather than applying back-pressure. For a
stream of transforms that is correct: a stale snapshot has no value once a newer
one exists, and blocking would only add latency to the frames that still matter.

`SharedArrayBuffer` requires cross-origin isolation (COOP + COEP). When the page
is not isolated, `PhoenixAdapter` transparently falls back to transferable
`postMessage`; systems never learn which path is active.

### Why an adapter interface

`INetworkAdapter` is the surface proposed to Meta as `@iwsdk/network` (see
`docs/rfc/0001-iwsdk-network.md`). Three implementations ship, and they exist to
do real work rather than to demonstrate an abstraction:

- **`PhoenixAdapter`** — production; drives the worker.
- **`OfflineAdapter`** — single-player. Modelling offline as an adapter rather
  than as a flag is what makes the specification's "offline must not alter
  behaviour" guarantee real: the systems run their normal code path and publish
  into a sink. There is no `if (offline)` anywhere in the update loop to fall
  out of sync.
- **`LoopbackAdapter`** — in-memory, with simulated latency and packet loss. The
  latency simulation is the point: interpolation and reconciliation bugs only
  appear under delay and reordering.

### System order

Order within a frame is deliberate, expressed as priorities in `plugin.ts`:

| Priority | System | Why here |
|---|---|---|
| 90 | `NetworkLODSystem` | Decide publish rates before anything publishes. |
| 100 | `ClientPredictionSystem` | Move the local player first, so its motion is in this frame's outbound data rather than one frame stale. |
| 110 | `PhoenixNetworkSystem` | Drain inbound, then publish outbound. |
| 120 | `NetworkInterpolationSystem` | Runs last, so remote entities are posed from samples that landed *this* frame. |

### Interpolation renders in the past

Lerping toward the newest sample is always extrapolation, because the newest
sample *is* the present — so arrival jitter becomes motion jitter.

Instead entities render at `now − interpolationDelayMs` (100 ms by default,
about 1.5 server ticks). Render time then sits *between* two samples already
held, so playback is genuine interpolation and jitter is absorbed by the buffer.
The cost is fixed, predictable presentation lag on *other people's* avatars,
which is far less objectionable than stutter.

When a packet is late, dead reckoning continues along the last known velocity —
capped at `maxExtrapolationMs` (250 ms), after which the entity holds position.
Uncapped extrapolation sends avatars sliding through walls. Rotation is held
rather than extrapolated: angular error compounds quickly, and a slightly stale
head reads much better than one that keeps turning past where the player
stopped.

## Server

### A process per room

A BEAM process costs a few hundred bytes and is pre-emptively scheduled. "One
lightweight process per room" therefore scales to numbers a shared event loop
cannot approach, and — just as importantly — a crash in one room cannot take
down another. The supervisor restarts it; every other room never notices.

`Room.Server` re-arms its tick with `Process.send_after/3` against a monotonic
deadline rather than using `:timer.send_interval/2`. Fixed-interval timers drift:
if a tick runs long, messages queue and the room spirals. Re-arming against a
deadline lets a slow tick shorten the next sleep, and skip outright if already
late.

### Layering, and why the channel is thin

```
RoomChannel      thin Phoenix shim, no logic          (needs Phoenix)
    ↓
RoomSupervisor   one room process per room id         (no dependencies)
    ↓
Room.Server      the room process, and the tick loop  (no dependencies)
    ↓
Room.Handler     per-frame decisions, pure functions  (no dependencies)
    ↓
Room.State       membership, ids, AoI, authority      (no dependencies)
    ↓
Physics.*        pluggable authority backend          (no dependencies)
```

`RoomSupervisor` is the load-bearing step, and its absence was a real bug: the
channel originally kept a `Room.State` in each socket's assigns, which gave every
connection a private copy of the room. Every peer was allocated network id 1,
nobody appeared in anybody else's roster, and ownership was arbitrated twice
against two different views — all silently. A room is one process, resolved
through a registry, started by whoever joins first and reaped with its last
occupant.

Only `RoomChannel` touches Phoenix, and it is conditionally compiled via
`Code.ensure_loaded?(Phoenix.Channel)`. Everything below it is dependency-free
and therefore testable without a socket, an endpoint, or a running application —
`IWSDK_CORE_ONLY=1 mix test` runs the entire suite with no package registry
access at all.

This is not only an aesthetic preference. It is what let the whole server be
built and verified in an environment where `repo.hex.pm` was unreachable, and it
is why the untestable surface is a few dozen lines of tuple translation rather
than the room logic itself.

### Two authority modes

**`:host_relayed`** — the server peeks at one byte and forwards the payload
untouched. No decoding, no allocation beyond the PubSub fan-out. The cheapest
possible path, appropriate for cooperative and social experiences.

**`:server_authoritative`** — input frames are decoded, validated and
re-simulated. Clients may not assert their own transforms at all; a
`TRANSFORM_UPDATE` from a client is rejected with `:client_authority_denied`
rather than ignored, so a misconfigured client is obvious instead of silently
desynced.

### Sectors — a world that keeps going without you

A room is a sector: `SpatialGrid` divides the space *inside* one, so there is
no separate layer above it. A sector opted into with `persistent: true` at
join time keeps its world — time of day, weather — across the departure of
every player.

It does that by **stopping and fast-forwarding**, not by idling. When the last
peer leaves, the sector writes a timestamped snapshot to a supervised ETS
table and stops. The next start loads it, computes how long it slept, and
advances the world in one step.

The alternative — keep the process alive at a reduced tick — was rejected on
arithmetic. At the scale this design targets, 30M concurrent in instances of
80 is roughly 375,000 sectors; a 0.5 Hz idle tick across them is **187,500
messages per second** for worlds nobody is watching. Fast-forward costs
nothing.

What that buys is a constraint, and a healthy one: **everything evolving
without players must be a pure function of elapsed time.** Weather satisfies
it by seeding its transitions from world time and sector id, so replaying an
interval reproduces exactly what would have happened rather than inventing
something new — `advance(state, 60min)` equals twelve `advance(state, 5min)`,
and a test asserts precisely that. An event can only happen while someone is
present, so there is never an event that fast-forward fails to reproduce.

Two guards matter. Server time is monotonic, so its origin changes when the
node restarts; a snapshot from a different `Clock.epoch()` is restored
**without** advancing rather than leaping by an arbitrary span. And `advance`
is capped at one day cycle: past it, only the waking time matters, not the
sleep duration.

The day/night cycle is not in the snapshot at all. It is a pure function of
world time that both sides compute, so it costs zero bytes and a client
reconnecting after three days is correct immediately. Weather does travel —
as a Cardinal component, which is what that layer was built for.

### Cardinal — one schema, both runtimes

The section below describes parity for one hand-written formula. Cardinal
generalizes that idea to all replicated component data: `cardinal/components.mjs`
declares each component once, and `scripts/generate-cardinal.mjs` emits the
client's ECS definitions, the server's structs, both binary codecs, and the
golden vectors proving the two produce identical bytes.

The client keeps its `elics` ECS and the server keeps idiomatic Elixir —
only the *data* is defined once; systems stay hand-written on each side. What
the generator buys is that parity stops being something a developer must
remember: adding a component creates its proof, and the drift tripwire in
`pnpm test` makes an unregenerated schema a failing build.

See `docs/superpowers/specs/2026-08-14-cardinal-runtime-design.md`.

### Parity through a shared formula, not a shared binary

The original design proposed running the same Havok WASM binary on the server
for 1:1 parity. That does not work as stated — see `docs/FEASIBILITY.md` for the
Emscripten ABI analysis.

The goal behind it is still met, by a route that does work: client and server
share the same *movement integration formula*, and
`fixtures/protocol_vectors.tsv` pins the two implementations together with
golden vectors that both test suites verify.

The consequence is what matters. An honest client's prediction matches the
server exactly, so its reconciliation error is zero and the player never sees a
correction. Divergence therefore means genuine packet loss or a lying client —
precisely the signal an anti-cheat check wants, and much cleaner than
thresholding against an approximation.

### Area of interest

Broadcasting everything to everyone is `O(players × entities)` per tick: at 100
players and 1000 entities, 100k transform copies at 30 Hz.

`SpatialGrid` dices the world into cubic cells. A viewer subscribes to the cells
within its interest radius; the cost becomes proportional to local density and
stays flat as the world grows. Cell size should be at least the interest radius,
so a single ring of neighbours covers the bubble — the default is 50 m for both.

`transition/4` returns the subscription *delta* rather than the full set, so
walking across a boundary changes 3 of 9 subscriptions (flat mode) instead of
resubscribing wholesale.

One subtlety worth stating because getting it wrong is silent: cell assignment
uses **flooring** division, not Elixir's `div/2`, which truncates toward zero
and would fold the negative half of the world onto the positive half.

## Testing strategy

The client suite runs against the **real `elics` runtime** through a small shim
(`test/mocks/iwsdk-core.ts`) that swaps out only the renderer-bound
`@iwsdk/core`. Component storage, queries and system scheduling therefore behave
exactly as they do in IWSDK. Meanwhile `tsc` still typechecks `src` against the
genuine `@iwsdk/core`, so API drift is caught even though tests never load it.

One constraint discovered the hard way and worth recording: **elics stores
`component.data` on the component singleton**, so registering the same component
in a second `World` re-points both worlds at the same typed arrays. Two isolated
worlds cannot coexist in one process. Inbound-replication tests therefore use a
single world fed by a bare peer, which is a cleaner test anyway.
