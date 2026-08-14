# Clock synchronization — design

Approved 2026-08-14, brainstormed section by section. This is the foundation
block of the plugin's evolution plan: the adaptive interpolation buffer and any
future lag-compensation work both consume the interface defined here.

## Problem

A client can measure round-trip time today, but never the *offset* between its
clock and the server's: `reply_pong` (`packages/server/lib/iwsdk_phoenix/room/handler.ex`)
echoes only the client's own timestamp. Without a shared time base, snapshot
timestamps are meaningless to the receiver, the interpolation delay cannot be
measured (only guessed), and server-side timing validation has nothing to
anchor to.

## Section 1 — Frame format

NTP's four-timestamp exchange, transposed onto the existing PING/PONG opcodes.
All multi-byte fields little-endian, per the protocol's standing convention.

```
PING (client → server), 9 bytes — unchanged:
  u8   op = 7
  f64  t0     client send time

PONG (server → client), 29 bytes — extended from 9:
  u8   op = 8
  f64  t0     echo of the client's send time (existing anti-replay check)
  f64  t1     server receive time
  f64  t2     server send time
  u32  epoch  node boot identifier
```

`t3` — the PONG's arrival — is measured locally by the client and never
travels. From one exchange:

```
offset = ((t1 − t0) + (t2 − t3)) / 2        rtt = (t3 − t0) − (t2 − t1)
```

**Why `epoch` exists.** The server stamps with `System.monotonic_time/1`,
whose origin is arbitrary per node and changes on every restart. Without an
epoch, a server restart (or, later, a handoff to another node) would make the
estimator converge on a nonsense offset with full confidence. `epoch` is a
random u32 drawn at node boot: when it changes, the client discards its
estimate and reconverges from zero. Two nodes have two epochs, so a cross-node
handoff announces itself — this is the frame's "single-node now, multi-node
without a dead-end" clause.

**Compatibility.** Opcodes unchanged, and there is no version negotiation to
lean on — compatibility rests on the client decoder's existing length
tolerance (`BinaryProtocol.ts` rejects a PONG *shorter* than 9 bytes but
accepts a longer one, reading only its prefix). So an old client reads the
first 9 bytes of a 29-byte PONG and keeps its RTT display; a new client
receiving a 9-byte PONG from an old server detects the short frame and runs
RTT-only, with no offset estimate — degraded, never wrong.

## Section 2 — Client estimator

One sample `{offset, rtt}` per PONG, flowing through:

```
PONG received → sample → window of 8 → best (min-RTT) sample → target → slew
```

1. **Measure in the network worker, not the main thread.** `t0` and `t3` are
   stamped where the socket lives. A main-thread render hitch must not inflate
   a sample. The estimate therefore maps server time ↔ the *worker's* clock;
   main-thread consumers convert through the constant `performance.timeOrigin`
   difference (worker and page origins differ — a known trap).
2. **Best-of-window at minimum RTT, no averaging.** A sample's error is
   bounded by rtt/2, and network noise is asymmetric — queues only ever add
   delay. The lowest-RTT sample in the window of the last 8 is the least
   contaminated. This is NTP's own choice.
3. **Cadence: burst at join, cruise after.** Four PINGs 250 ms apart on
   connect (usable offset in ~1 s), then one every 2 s. The window then spans
   ~16 s, far below real clock drift. Cost: 29 bytes every 2 s.
4. **Slew, never snap.** The applied offset moves toward the target at a
   bounded rate (≤ 2 ms per frame); a jump would visibly pop every in-flight
   interpolation. Two exceptions snap: the first sample, and an epoch change
   (window cleared, reconverge from zero).

Exposed interface, consumed by later blocks: `serverNow()` (estimated server
time in the current epoch), `rtt()`, `epoch()`.

## Section 3 — Server time base

1. **`System.monotonic_time(:millisecond)`, never `system_time`.** The wall
   clock jumps (OS-level NTP corrections, manual changes); a backwards step
   would corrupt every derived velocity. The monotonic clock never recedes;
   its arbitrary origin is exactly what `epoch` neutralizes. Sent as f64
   milliseconds, symmetric with the client's `performance.now()` — an f64
   holds integer milliseconds exactly.
2. **Stamp at the channel process's edges.** `t1` at PING decode, `t2` at PONG
   encode, as close to the socket as the code gets. The room process stays out
   of the loop, as in today's `reply_pong`. Currently `t2 − t1 ≈ 0`; both
   travel anyway so the formula stays exact if processing ever intervenes.
3. **`epoch` in `:persistent_term`, drawn once at application start.** Free
   reads on the hot path — no copy, no process hop. Restart ⇒ new epoch ⇒
   clients purge and reconverge; multi-node ⇒ one epoch per node ⇒ handoff
   signals itself. No cross-node coordination protocol to invent.

Foundation laid: SNAPSHOT frames can later carry a server timestamp in this
same base, which is what makes the adaptive interpolation delay measurable
rather than guessed.

## Section 4 — Parity tests

Same pattern as the rest of the protocol: golden vectors both suites verify.

1. **Golden vectors** — `(t0, t1, t2, epoch)` → the exact 29 bytes, added to
   `fixtures/protocol_vectors.tsv` by `scripts/generate-fixtures.mjs`, encoded
   *and* decoded by both vitest and ExUnit. f64 IEEE 754 little-endian on both
   sides — binary identity, not approximation. The offset formula itself is
   tested pure, no network.
2. **Estimator (vitest, deterministic)** — the estimator takes its timestamps
   as parameters (already required for worker stamping, so test determinism
   falls out free). Replayed sample sequences assert: asymmetric noise → the
   min-RTT sample wins; slew stays bounded; epoch change → purge + snap; and
   on a realistic RTT trace with queuing spikes, offset error ≤ rtt_min/2 —
   the theoretical bound.
3. **Server (ExUnit)** — `t0` echoed intact (anti-replay), `t1 ≤ t2`, epoch
   stable across a run, frame size 29, and the 9-byte prefix parses as an old
   PONG.
4. **End to end** — via the existing channel test harness: join → PING → PONG
   → computable offset. The restart/handoff scenario is tested by swapping the
   epoch in `:persistent_term` and asserting the next PONG carries it and a
   simulated estimator purges — milliseconds of test time, no actual restart.

## Out of scope

- The adaptive interpolation buffer (next block; consumes `serverNow()`/`rtt()`).
- Snapshot timestamping (enabled by this design, delivered with that block).
- Any multi-node transport or handoff mechanics — this design only guarantees
  the frame format cannot dead-end there.
