# Clock Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every client a live estimate of the server's clock (offset, RTT, epoch) over the existing PING/PONG opcodes, exposed as `handle.clock.serverNow()`.

**Architecture:** The server extends its PONG reply from 9 to 29 bytes (NTP's four-timestamp exchange plus a node-boot epoch) and answers PINGs in the channel process, never calling the room. The client sends PINGs from its network worker, stamps both ends there, filters samples through a min-RTT window, and hands the main thread a slewed offset. Everything statistical is a pure module with timestamps as parameters.

**Tech Stack:** TypeScript (vitest), Elixir (ExUnit), the repo's golden-vector parity pipeline (`fixtures/protocol_vectors.tsv` + `scripts/generate-fixtures.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-14-clock-sync-design.md` — read it first; every decision below argues from it.

## Global Constraints

- All multi-byte wire fields are **little-endian** (`docs/PROTOCOL.md` rule; `LITTLE_ENDIAN = true` in `BinaryProtocol.ts`, `-little-` in `protocol.ex`).
- Timestamps travel as **f64 milliseconds** (client `performance.now()`, server `System.monotonic_time` converted to fractional ms).
- Opcodes `PING = 7`, `PONG = 8` are **unchanged**. Legacy 9-byte PONG must keep decoding on both sides.
- No new dependencies, client or server.
- TDD: every task writes its failing test first, and commits when green.
- Repo state facts this plan relies on (verified 2026-08-14): nobody sends PINGs today, `NetworkStats.rttMs` has no writer, and the client drops push replies — the whole client loop is additive.

## File Structure

| File | Role |
|---|---|
| `packages/server/lib/iwsdk_phoenix/clock.ex` (create) | monotonic ms + persistent_term epoch |
| `packages/server/lib/iwsdk_phoenix/protocol.ex` (modify) | `encode_pong/4`, 29-byte decode clause |
| `packages/server/lib/iwsdk_phoenix/room_channel.ex` (modify) | PING fast path in `handle_in`, room stays out |
| `packages/client/src/protocol/opcodes.ts` (modify) | `PONG_EXTENDED_BYTES = 29` |
| `packages/client/src/protocol/BinaryProtocol.ts` (modify) | `encodePong`, length-discriminated PONG decode |
| `packages/client/src/math/clock-sync.ts` (create) | `ClockSyncEstimator`, `SlewedOffset`, `combineWorkerOffset` — all pure |
| `packages/client/src/transport/PhoenixConnection.ts` (modify) | `sendPing(onPong)` — stamps `t0`/`t3` at the socket |
| `packages/client/src/transport/clock-loop.ts` (create) | burst + cruise cadence, feeds the estimator |
| `packages/client/src/transport/worker-messages.ts` (modify) | `CLOCK` worker→main message |
| `packages/client/src/workers/network.worker.ts` (modify) | start/stop the loop on connection state |
| `packages/client/src/adapters/PhoenixAdapter.ts` (modify) | store the reading, fold in the timeOrigin delta |
| `packages/client/src/interfaces/INetworkAdapter.ts` (modify) | optional `clockEstimate` |
| `packages/client/src/plugin.ts` (modify) | `handle.clock: NetworkClock` |
| `packages/client/src/systems/PhoenixNetworkSystem.ts` (modify) | finally write `NetworkStats.rttMs` |
| `scripts/generate-fixtures.mjs` (modify) | `pong` golden vectors |
| `docs/PROTOCOL.md` (modify) | PONG layout, opcode table |

---

### Task 1: Server clock module

**Files:**
- Create: `packages/server/lib/iwsdk_phoenix/clock.ex`
- Test: `packages/server/test/clock_test.exs`

**Interfaces:**
- Consumes: nothing.
- Produces: `IwsdkPhoenix.Clock.now_ms/0 :: float`, `IwsdkPhoenix.Clock.epoch/0 :: non_neg_integer` (0..2^32−1), `IwsdkPhoenix.Clock.put_epoch/1` (test hook). Tasks 5 uses all three.

- [ ] **Step 1: Write the failing test**

```elixir
# packages/server/test/clock_test.exs
defmodule IwsdkPhoenix.ClockTest do
  use ExUnit.Case, async: false

  alias IwsdkPhoenix.Clock

  test "now_ms never goes backwards and has sub-ms resolution" do
    a = Clock.now_ms()
    b = Clock.now_ms()
    assert is_float(a)
    assert b >= a
  end

  test "epoch is stable across calls and fits in a u32" do
    e = Clock.epoch()
    assert e == Clock.epoch()
    assert e >= 0 and e < 4_294_967_296
  end

  test "put_epoch swaps the value read by epoch/0" do
    original = Clock.epoch()
    Clock.put_epoch(12_345)
    assert Clock.epoch() == 12_345
    Clock.put_epoch(original)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/clock_test.exs`
Expected: FAIL — `IwsdkPhoenix.Clock` is not available.

- [ ] **Step 3: Write minimal implementation**

```elixir
# packages/server/lib/iwsdk_phoenix/clock.ex
defmodule IwsdkPhoenix.Clock do
  @moduledoc """
  The server's time base for clock synchronization.

  `System.monotonic_time/1`, never `System.system_time/1`: the wall clock
  jumps (OS-level NTP corrections, manual changes) and a backwards step
  would corrupt every velocity derived from these stamps. The monotonic
  clock never recedes — its arbitrary, per-node origin is exactly what
  `epoch/0` makes harmless.
  """

  @epoch_key {__MODULE__, :epoch}

  @doc """
  Monotonic milliseconds as a float, microsecond resolution.

  A float because the client's `performance.now()` is one, and an f64
  holds integer milliseconds exactly — the two sides stay symmetric.
  """
  @spec now_ms() :: float()
  def now_ms do
    System.monotonic_time(:microsecond) / 1000.0
  end

  @doc """
  This node's boot identifier, drawn once and kept in `:persistent_term`.

  Reads are free on the hot path — no copy, no process hop. A restart
  draws a new value, which is how clients learn to discard their offset
  estimate; two nodes have two epochs, so a future handoff announces
  itself without any coordination protocol. Lazy init can race at boot:
  the last writer wins and any client that saw the loser just resets
  once, which is the mechanism working as designed.
  """
  @spec epoch() :: non_neg_integer()
  def epoch do
    case :persistent_term.get(@epoch_key, :undefined) do
      :undefined ->
        value = :rand.uniform(4_294_967_296) - 1
        :persistent_term.put(@epoch_key, value)
        value

      value ->
        value
    end
  end

  @doc "Force the epoch — the restart/handoff scenario, testable in microseconds."
  @spec put_epoch(non_neg_integer()) :: :ok
  def put_epoch(value) when value >= 0 and value < 4_294_967_296 do
    :persistent_term.put(@epoch_key, value)
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && mix test test/clock_test.exs`
Expected: 3 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/clock.ex packages/server/test/clock_test.exs
git commit -m "feat(server): monotonic clock module with a persistent_term boot epoch"
```

---

### Task 2: Server PONG encode/decode

**Files:**
- Modify: `packages/server/lib/iwsdk_phoenix/protocol.ex` (encode_ping is at the end of the module, `def encode_ping(timestamp, pong? \\ false)`; the pong decode clause is `def decode(<<@op_pong, timestamp::float-little-size(64)>>)`)
- Test: `packages/server/test/protocol_test.exs` (append to the existing module)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Protocol.encode_pong(t0 :: float, t1 :: float, t2 :: float, epoch :: non_neg_integer) :: <<_::232>>` (29 bytes) and `Protocol.decode/1` returning `{:ok, :pong, %{timestamp: t0, t1: t1, t2: t2, epoch: epoch}}` for 29-byte input, unchanged `%{timestamp: t}` for 9-byte input. Task 4 and 5 use both.

- [ ] **Step 1: Write the failing test**

Append inside `IwsdkPhoenix.ProtocolTest`:

```elixir
  describe "extended pong" do
    test "encode_pong is 29 bytes and round-trips" do
      frame = Protocol.encode_pong(1234.5, 10_001.25, 10_001.5, 305_419_896)
      assert byte_size(frame) == 29
      assert {:ok, :pong, decoded} = Protocol.decode(frame)
      assert decoded.timestamp == 1234.5
      assert decoded.t1 == 10_001.25
      assert decoded.t2 == 10_001.5
      assert decoded.epoch == 305_419_896
    end

    test "legacy 9-byte pong still decodes" do
      assert {:ok, :pong, %{timestamp: 42.0}} = Protocol.decode(Protocol.encode_ping(42.0, true))
    end
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/protocol_test.exs`
Expected: FAIL — `Protocol.encode_pong/4` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `protocol.ex`, next to `encode_ping`:

```elixir
  @doc """
  Extended PONG: NTP's four-timestamp exchange plus the node's boot epoch.

  `t3` — the client's receive time — is measured locally by the client and
  never travels. The legacy 9-byte form (`encode_ping(t, true)`) remains
  valid; old and new frames are disjoint by total size, so the decode
  clauses cannot shadow each other.
  """
  def encode_pong(t0, t1, t2, epoch) do
    <<@op_pong, t0::float-little-size(64), t1::float-little-size(64),
      t2::float-little-size(64), epoch::unsigned-little-integer-size(32)>>
  end
```

And a decode clause beside the existing `@op_pong` one:

```elixir
  def decode(
        <<@op_pong, t0::float-little-size(64), t1::float-little-size(64),
          t2::float-little-size(64), epoch::unsigned-little-integer-size(32)>>
      ) do
    {:ok, :pong, %{timestamp: t0, t1: t1, t2: t2, epoch: epoch}}
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && mix test test/protocol_test.exs`
Expected: PASS, no other test broken.

- [ ] **Step 5: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/protocol.ex packages/server/test/protocol_test.exs
git commit -m "feat(server): 29-byte extended PONG encode and decode"
```

---

### Task 3: Client PONG encode/decode

**Files:**
- Modify: `packages/client/src/protocol/opcodes.ts` (size constants live at the bottom, e.g. `OWNERSHIP_GRANT_BYTES = 14`)
- Modify: `packages/client/src/protocol/BinaryProtocol.ts` (`encodePing` around line 480; the `case OpCode.PING/PONG` decode around line 725; the `DecodedFrame` union member `{ opCode: OpCode.PING | OpCode.PONG; timestamp: number }` around line 111)
- Test: `packages/client/test/binary-protocol.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PONG_EXTENDED_BYTES = 29`; `BinaryProtocol.encodePong(t0: number, t1: number, t2: number, epoch: number): ArrayBuffer`; `PongTimes { t1: number; t2: number; epoch: number }`; the decode union member becomes `{ opCode: OpCode.PING | OpCode.PONG; timestamp: number; pong?: PongTimes }`. Tasks 4 and 8 use these exact names.

- [ ] **Step 1: Write the failing test**

```ts
describe('extended pong', () => {
  it('encodes 29 bytes and round-trips all four fields', () => {
    const frame = BinaryProtocol.encodePong(1234.5, 10001.25, 10001.5, 0x12345678);
    expect(frame.byteLength).toBe(29);
    const decoded = BinaryProtocol.decode(frame);
    if (decoded.opCode !== OpCode.PONG) throw new Error('wrong opcode');
    expect(decoded.timestamp).toBe(1234.5);
    expect(decoded.pong).toEqual({ t1: 10001.25, t2: 10001.5, epoch: 0x12345678 });
  });

  it('decodes a legacy 9-byte pong with no pong extension', () => {
    const decoded = BinaryProtocol.decode(BinaryProtocol.encodePing(42, true));
    if (decoded.opCode !== OpCode.PONG) throw new Error('wrong opcode');
    expect(decoded.timestamp).toBe(42);
    expect(decoded.pong).toBeUndefined();
  });
});
```

(Import `OpCode` if the file does not already; it does — check its header.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- binary-protocol`
Expected: FAIL — `encodePong` does not exist.

- [ ] **Step 3: Write minimal implementation**

`opcodes.ts`, with the other size constants:

```ts
/** Extended PONG: op + t0 + t1 + t2 (f64 each) + epoch (u32). Legacy form is 9. */
export const PONG_EXTENDED_BYTES = 29;
```

`BinaryProtocol.ts` — the union member and a new interface next to the other frame types:

```ts
/** Server timestamps carried by an extended (29-byte) PONG. */
export interface PongTimes {
  t1: number;
  t2: number;
  epoch: number;
}
```

```ts
  | { opCode: OpCode.PING | OpCode.PONG; timestamp: number; pong?: PongTimes }
```

Next to `encodePing`:

```ts
  /**
   * Extended PONG. `t3` — the receiver's arrival stamp — is measured locally
   * and never travels; see docs/superpowers/specs/2026-08-14-clock-sync-design.md.
   */
  static encodePong(t0: number, t1: number, t2: number, epoch: number): ArrayBuffer {
    const buffer = new ArrayBuffer(PONG_EXTENDED_BYTES);
    const view = new DataView(buffer);
    view.setUint8(0, OpCode.PONG);
    view.setFloat64(1, t0, LITTLE_ENDIAN);
    view.setFloat64(9, t1, LITTLE_ENDIAN);
    view.setFloat64(17, t2, LITTLE_ENDIAN);
    view.setUint32(25, epoch, LITTLE_ENDIAN);
    return buffer;
  }
```

Replace the body of the `case OpCode.PING: case OpCode.PONG:` decode block:

```ts
      case OpCode.PING:
      case OpCode.PONG: {
        const view = new DataView(buffer as ArrayBuffer, byteOffset);
        if (view.byteLength < 9) throw new ProtocolError('PING/PONG needs 9 bytes');
        const timestamp = view.getFloat64(1, LITTLE_ENDIAN);
        // Length-discriminated, not versioned: an old server sends 9 bytes and
        // the caller sees no `pong` — RTT-only, degraded, never wrong.
        if (opCode === OpCode.PONG && view.byteLength >= PONG_EXTENDED_BYTES) {
          return {
            opCode,
            timestamp,
            pong: {
              t1: view.getFloat64(9, LITTLE_ENDIAN),
              t2: view.getFloat64(17, LITTLE_ENDIAN),
              epoch: view.getUint32(25, LITTLE_ENDIAN),
            },
          };
        }
        return { opCode, timestamp };
      }
```

Import `PONG_EXTENDED_BYTES` from `./opcodes.js` at the top (the file already imports from there).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- binary-protocol`
Expected: PASS, whole file green.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/protocol/opcodes.ts packages/client/src/protocol/BinaryProtocol.ts packages/client/test/binary-protocol.test.ts
git commit -m "feat(client): 29-byte extended PONG encode and length-discriminated decode"
```

---

### Task 4: PONG golden vectors

**Files:**
- Modify: `scripts/generate-fixtures.mjs` (the `ping` rows are near `comment('ping <timestamp> <pong:0|1> <hex>')`, line ~221)
- Modify: `packages/client/test/parity.test.ts` (the `ping` loop is at line ~148, pattern `for (const [timestamp, pong, expected] of of('ping'))`)
- Modify: `packages/server/test/parity_test.exs` (the `ping` block is at line ~188, pattern `for [timestamp, pong, hex] <- Fixtures.rows("ping")`)
- Modify: `fixtures/protocol_vectors.tsv` (regenerated, never hand-edited)

**Interfaces:**
- Consumes: `BinaryProtocol.encodePong` (Task 3), `Protocol.encode_pong/4` (Task 2).
- Produces: `pong` vector rows `pong <t0> <t1> <t2> <epoch> <hex>` in the TSV.

- [ ] **Step 1: Add the vector generation**

In `generate-fixtures.mjs`, after the `ping` rows, following the file's `comment`/`row`/`f`/`hex` helpers:

```js
comment('pong <t0> <t1> <t2> <epoch> <hex>');
for (const [t0, t1, t2, epoch] of [
  [0, 0, 0, 0],
  [1234.5, 10001.25, 10001.5, 1],
  [98765.4321, 5.5, 6.25, 4294967295],
  [2 ** 40 + 0.5, 2 ** 41 + 0.25, 2 ** 41 + 0.75, 305419896],
]) {
  row('pong', f(t0), f(t1), f(t2), String(epoch), hex(BinaryProtocol.encodePong(t0, t1, t2, epoch)));
}
```

- [ ] **Step 2: Regenerate the fixtures**

Run: `pnpm build && node scripts/generate-fixtures.mjs`
Expected: `fixtures/protocol_vectors.tsv` gains 4 `pong` rows (check with `grep '^pong' fixtures/protocol_vectors.tsv`).

- [ ] **Step 3: Write the failing parity assertions**

`packages/client/test/parity.test.ts`, next to the `ping` loop and in its style:

```ts
  it('pong vectors', () => {
    for (const [t0, t1, t2, epoch, expected] of of('pong')) {
      expect(
        hex(BinaryProtocol.encodePong(Number(t0), Number(t1), Number(t2), Number(epoch))),
      ).toBe(expected);
    }
  });
```

`packages/server/test/parity_test.exs`, next to the `ping` block and in its style:

```elixir
    test "pong vectors" do
      for [t0, t1, t2, epoch, hex] <- Fixtures.rows("pong") do
        encoded =
          Protocol.encode_pong(
            Fixtures.to_float(t0),
            Fixtures.to_float(t1),
            Fixtures.to_float(t2),
            String.to_integer(epoch)
          )

        assert Base.encode16(encoded, case: :lower) == hex
      end
    end
```

(Adapt helper names to what the surrounding tests actually use — `of`/`hex` on the TS side, `Fixtures.rows/1`, `Fixtures.to_float/1` on the Elixir side; both exist, copy the neighbors.)

- [ ] **Step 4: Run both suites**

Run: `pnpm test && (cd packages/server && mix test test/parity_test.exs)`
Expected: PASS on both sides — byte-identical f64 little-endian encodings.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-fixtures.mjs fixtures/protocol_vectors.tsv packages/client/test/parity.test.ts packages/server/test/parity_test.exs
git commit -m "test: PONG golden vectors verified by both suites"
```

---

### Task 5: Channel PING fast path

**Files:**
- Modify: `packages/server/lib/iwsdk_phoenix/room_channel.ex` — inside the `quote` block, immediately BEFORE the existing `def handle_in(@frame_event, {:binary, frame}, socket)` clause (line ~177); Elixir dispatches clauses in order, so placement matters.
- Test: `packages/server/test/room_channel_test.exs` (append; copy the join/push pattern of the existing tests in that file)

**Interfaces:**
- Consumes: `Clock.now_ms/0`, `Clock.epoch/0`, `Clock.put_epoch/1` (Task 1), `Protocol.encode_pong/4` (Task 2).
- Produces: a PING pushed on the `"frame"` event is answered with `{:ok, {:binary, <29-byte pong>}}` as a push reply, without a `GenServer.call` to the room. The legacy path (`Handler.reply_pong`, reached through `Server.handle_frame`) is left in place for non-channel embedders; the channel simply never reaches it anymore.

- [ ] **Step 1: Write the failing test**

Append to `room_channel_test.exs`, using the same join helper its other tests use:

```elixir
  describe "ping fast path" do
    test "answers with a 29-byte extended pong carrying the echo, ordered stamps and the epoch", %{socket: socket} do
      IwsdkPhoenix.Clock.put_epoch(777)
      ref = push(socket, "frame", {:binary, Protocol.encode_ping(1234.5)})
      assert_reply ref, :ok, {:binary, pong}

      assert byte_size(pong) == 29
      assert {:ok, :pong, %{timestamp: 1234.5, t1: t1, t2: t2, epoch: 777}} = Protocol.decode(pong)
      assert t1 <= t2
    end

    test "a swapped epoch shows up on the very next pong", %{socket: socket} do
      IwsdkPhoenix.Clock.put_epoch(1)
      ref = push(socket, "frame", {:binary, Protocol.encode_ping(1.0)})
      assert_reply ref, :ok, {:binary, pong}
      assert {:ok, :pong, %{epoch: 1}} = Protocol.decode(pong)

      IwsdkPhoenix.Clock.put_epoch(2)
      ref = push(socket, "frame", {:binary, Protocol.encode_ping(2.0)})
      assert_reply ref, :ok, {:binary, pong}
      assert {:ok, :pong, %{epoch: 2}} = Protocol.decode(pong)
    end
  end
```

If the file's tests receive their socket differently (e.g. a `setup` returning `%{socket: socket}` after joining `RoomChannel`), reuse that setup verbatim.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/room_channel_test.exs`
Expected: FAIL — the reply is the legacy 9-byte pong (`byte_size(pong) == 9`).

- [ ] **Step 3: Write minimal implementation**

In `room_channel.ex`, before the generic binary `handle_in`:

```elixir
      # PING fast path: stamped at this process's edges, the room GenServer
      # never in the loop — a queued room must not pollute the clock samples.
      # `7` is Protocol.op_ping(); a macro-generated clause cannot call it in
      # a pattern.
      @impl true
      def handle_in(@frame_event, {:binary, <<7, _::binary>> = frame}, socket) do
        t1 = IwsdkPhoenix.Clock.now_ms()

        case IwsdkPhoenix.Protocol.decode(frame) do
          {:ok, :ping, %{timestamp: t0}} ->
            pong =
              IwsdkPhoenix.Protocol.encode_pong(
                t0,
                t1,
                IwsdkPhoenix.Clock.now_ms(),
                IwsdkPhoenix.Clock.epoch()
              )

            {:reply, {:ok, {:binary, pong}}, socket}

          _ ->
            {:reply, {:error, %{reason: "malformed_frame"}}, socket}
        end
      end
```

Note: if the surrounding clauses already carry `@impl true` only on the first `handle_in`, match the file's convention (Elixir wants `@impl` once per group of clauses of the same function — putting this clause adjacent to the existing one keeps the compiler quiet).

- [ ] **Step 4: Run the full server suite**

Run: `cd packages/server && mix test`
Expected: all green — including any pre-existing ping test, which now exercises the fast path. If a pre-existing test asserted a 9-byte reply, update it to assert the 29-byte form (the design supersedes it).

- [ ] **Step 5: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/room_channel.ex packages/server/test/room_channel_test.exs
git commit -m "feat(server): answer PINGs at the channel edge with the extended PONG"
```

---

### Task 6: Client estimator — pure math

**Files:**
- Create: `packages/client/src/math/clock-sync.ts`
- Test: `packages/client/test/clock-sync.test.ts`

**Interfaces:**
- Consumes: nothing — pure, all timestamps are parameters.
- Produces (Tasks 7–9 use these exact names):

```ts
export interface ClockSample { t0: number; t1: number; t2: number; t3: number; epoch: number }
export interface ClockEstimate { offsetMs: number; rttMs: number; epoch: number }
export class ClockSyncEstimator {
  constructor(windowSize?: number);            // default 8
  addSample(sample: ClockSample): void;
  estimate(): ClockEstimate | null;
}
export class SlewedOffset {
  constructor(maxSlewMsPerSecond?: number);    // default 120 (≈2 ms per 60 Hz frame)
  update(target: ClockEstimate, nowMs: number): number;
}
export function combineWorkerOffset(offsetMs: number, workerTimeOrigin: number, mainTimeOrigin: number): number;
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/client/test/clock-sync.test.ts
import { describe, expect, it } from 'vitest';
import {
  ClockSyncEstimator,
  SlewedOffset,
  combineWorkerOffset,
} from '../src/math/clock-sync.js';

/** Build a sample with a known true offset and a chosen one-way delay pair. */
function sample(trueOffset: number, up: number, down: number, t0: number, epoch = 1) {
  const t1 = t0 + up + trueOffset;
  const t2 = t1 + 0.1; // negligible server processing
  const t3 = t0 + up + 0.1 + down;
  return { t0, t1, t2, t3, epoch };
}

describe('ClockSyncEstimator', () => {
  it('recovers the true offset exactly from a symmetric sample', () => {
    const e = new ClockSyncEstimator();
    e.addSample(sample(500, 20, 20, 1000));
    expect(e.estimate()!.offsetMs).toBeCloseTo(500, 6);
    expect(e.estimate()!.rttMs).toBeCloseTo(40, 6);
  });

  it('prefers the min-RTT sample: queue spikes never displace a clean sample', () => {
    const e = new ClockSyncEstimator();
    e.addSample(sample(500, 20, 20, 1000)); // clean, rtt 40
    e.addSample(sample(500, 20, 180, 3000)); // downlink queue spike, rtt 200
    e.addSample(sample(500, 150, 25, 5000)); // uplink spike, rtt 175
    const est = e.estimate()!;
    expect(est.rttMs).toBeCloseTo(40, 6);
    expect(Math.abs(est.offsetMs - 500)).toBeLessThanOrEqual(est.rttMs / 2);
  });

  it('bounds the error by rtt_min/2 on a realistic asymmetric trace', () => {
    const e = new ClockSyncEstimator();
    // Base 15 ms each way; every third sample hits a 60–120 ms queue one-way.
    for (let i = 0; i < 24; i++) {
      const spike = i % 3 === 2 ? 60 + (i % 5) * 15 : 0;
      const up = 15 + (i % 2 === 0 ? spike : 0);
      const down = 15 + (i % 2 === 1 ? spike : 0);
      e.addSample(sample(-250, up, down, i * 2000));
    }
    const est = e.estimate()!;
    expect(Math.abs(est.offsetMs - -250)).toBeLessThanOrEqual(est.rttMs / 2);
  });

  it('an epoch change discards the window', () => {
    const e = new ClockSyncEstimator();
    e.addSample(sample(500, 10, 10, 1000, 1));
    e.addSample(sample(-9000, 10, 10, 3000, 2)); // server restarted
    const est = e.estimate()!;
    expect(est.epoch).toBe(2);
    expect(est.offsetMs).toBeCloseTo(-9000, 6);
  });

  it('rejects a sample whose rtt comes out negative', () => {
    const e = new ClockSyncEstimator();
    e.addSample({ t0: 100, t1: 0, t2: 500, t3: 110, epoch: 1 }); // t2−t1 > t3−t0
    expect(e.estimate()).toBeNull();
  });

  it('window is bounded: the 9th sample evicts the 1st', () => {
    const e = new ClockSyncEstimator();
    e.addSample(sample(500, 1, 1, 0)); // rtt 2 — best, but about to be evicted
    for (let i = 1; i <= 8; i++) e.addSample(sample(500, 10 + i, 10 + i, i * 2000));
    expect(e.estimate()!.rttMs).toBeGreaterThan(2.2);
  });
});

describe('SlewedOffset', () => {
  const est = (offsetMs: number, epoch = 1) => ({ offsetMs, rttMs: 40, epoch });

  it('snaps on the first update', () => {
    const s = new SlewedOffset();
    expect(s.update(est(500), 0)).toBe(500);
  });

  it('moves toward a new target at most maxSlew per second', () => {
    const s = new SlewedOffset(120);
    s.update(est(500), 0);
    expect(s.update(est(1000), 1000)).toBeCloseTo(620, 6); // one second: +120 max
    expect(s.update(est(1000), 1500)).toBeCloseTo(680, 6); // half second: +60
  });

  it('never overshoots the target', () => {
    const s = new SlewedOffset(120);
    s.update(est(500), 0);
    expect(s.update(est(505), 1000)).toBe(505);
  });

  it('snaps on an epoch change', () => {
    const s = new SlewedOffset();
    s.update(est(500, 1), 0);
    expect(s.update(est(-9000, 2), 100)).toBe(-9000);
  });
});

describe('combineWorkerOffset', () => {
  it('folds the timeOrigin difference into the worker-measured offset', () => {
    // Worker created 3000 ms after the page: same absolute instant reads
    // 3000 less on the worker clock, so the main-thread offset must be
    // 3000 smaller than the worker-measured one... verified by construction:
    // serverNow = now_main + combined  must equal  now_worker + offset.
    const mainTimeOrigin = 1_700_000_000_000;
    const workerTimeOrigin = 1_700_000_003_000;
    const combined = combineWorkerOffset(500, workerTimeOrigin, mainTimeOrigin);
    const nowMain = 10_000;
    const nowWorker = nowMain + (mainTimeOrigin - workerTimeOrigin);
    expect(nowMain + combined).toBeCloseTo(nowWorker + 500, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- clock-sync`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/math/clock-sync.ts
/**
 * Clock synchronization math — pure, every timestamp a parameter.
 *
 * That purity is not only for tests: the samples are stamped in the network
 * worker (a main-thread render hitch must never pollute a measurement), so
 * nothing in here may reach for a clock of its own.
 * Design: docs/superpowers/specs/2026-08-14-clock-sync-design.md.
 */

/** One PING/PONG exchange. `t3` is stamped locally on PONG arrival. */
export interface ClockSample {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
  epoch: number;
}

/** The estimator's current belief. */
export interface ClockEstimate {
  offsetMs: number;
  rttMs: number;
  epoch: number;
}

/**
 * Sliding-window, min-RTT offset estimator.
 *
 * No averaging: a sample's error is bounded by rtt/2 and network noise is
 * asymmetric — queues only ever add delay — so the fastest sample in the
 * window is the least contaminated. NTP's own choice.
 */
export class ClockSyncEstimator {
  private samples: { offsetMs: number; rttMs: number }[] = [];
  private currentEpoch: number | null = null;

  constructor(private readonly windowSize = 8) {}

  addSample({ t0, t1, t2, t3, epoch }: ClockSample): void {
    if (this.currentEpoch !== null && epoch !== this.currentEpoch) {
      // Server restarted (or a future handoff): every old sample is now a lie.
      this.samples = [];
    }
    this.currentEpoch = epoch;

    const rttMs = (t3 - t0) - (t2 - t1);
    if (rttMs < 0) return; // inconsistent stamps; a poisoned sample beats no guard
    const offsetMs = ((t1 - t0) + (t2 - t3)) / 2;

    this.samples.push({ offsetMs, rttMs });
    if (this.samples.length > this.windowSize) this.samples.shift();
  }

  estimate(): ClockEstimate | null {
    if (this.samples.length === 0 || this.currentEpoch === null) return null;
    let best = this.samples[0];
    for (const s of this.samples) if (s.rttMs < best.rttMs) best = s;
    return { offsetMs: best.offsetMs, rttMs: best.rttMs, epoch: this.currentEpoch };
  }
}

/**
 * Rate-limited application of an offset estimate.
 *
 * A jump in the applied offset would visibly pop every in-flight
 * interpolation, so the value slews toward the target at a bounded rate.
 * Two exceptions snap: the first estimate, and an epoch change — there the
 * old value is not merely stale but meaningless.
 */
export class SlewedOffset {
  private applied: number | null = null;
  private epoch: number | null = null;
  private lastNowMs = 0;

  constructor(private readonly maxSlewMsPerSecond = 120) {}

  update(target: ClockEstimate, nowMs: number): number {
    if (this.applied === null || this.epoch !== target.epoch) {
      this.applied = target.offsetMs;
      this.epoch = target.epoch;
      this.lastNowMs = nowMs;
      return this.applied;
    }

    const budget = Math.max(0, ((nowMs - this.lastNowMs) / 1000) * this.maxSlewMsPerSecond);
    const delta = target.offsetMs - this.applied;
    this.applied += Math.sign(delta) * Math.min(Math.abs(delta), budget);
    this.lastNowMs = nowMs;
    return this.applied;
  }
}

/**
 * Map a worker-clock offset onto the main thread's clock.
 *
 * `performance.now()` counts from `performance.timeOrigin`, and a worker's
 * origin is its creation time, not the page's — the same absolute instant
 * reads differently on the two clocks. serverNow on the main thread is
 * `performance.now() + combineWorkerOffset(...)`.
 */
export function combineWorkerOffset(
  offsetMs: number,
  workerTimeOrigin: number,
  mainTimeOrigin: number,
): number {
  return offsetMs + mainTimeOrigin - workerTimeOrigin;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- clock-sync`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/math/clock-sync.ts packages/client/test/clock-sync.test.ts
git commit -m "feat(client): pure min-RTT clock estimator with bounded slew"
```

---

### Task 7: `sendPing` on the connection

**Files:**
- Modify: `packages/client/src/transport/PhoenixConnection.ts` (`send` is at line ~175; `PushLike.receive` already exists in the structural types at line ~37)
- Test: `packages/client/test/clock-loop.test.ts` (create — Task 8 extends this same file)

**Interfaces:**
- Consumes: `BinaryProtocol.encodePing` (existing).
- Produces: `PhoenixConnection.sendPing(onPong: (frame: ArrayBuffer | null, t0: number, t3: number) => void): void`. Stamps `t0` before the push and `t3` inside the reply callback — both on this thread's clock, which is the worker's when running there.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/test/clock-loop.test.ts
import { describe, expect, it } from 'vitest';
import { PhoenixConnection } from '../src/transport/PhoenixConnection.js';
import { BinaryProtocol } from '../src/protocol/BinaryProtocol.js';
import { OpCode } from '../src/protocol/opcodes.js';
import type {
  ChannelLike,
  PushLike,
  SocketLike,
} from '../src/transport/PhoenixConnection.js';

/** A socket whose channel records pushes and lets the test answer them. */
function fakeSocket() {
  const pushes: { payload: unknown; reply: (resp: unknown) => void }[] = [];
  const channel: ChannelLike = {
    join: () => okPush(),
    leave: () => okPush(),
    on: () => 0,
    push(_event, payload) {
      let onOk: ((resp?: unknown) => void) | null = null;
      pushes.push({ payload, reply: (resp) => onOk?.(resp) });
      const push: PushLike = {
        receive(status, callback) {
          if (status === 'ok') onOk = callback;
          return push;
        },
      };
      return push;
    },
  };
  const socket: SocketLike = {
    connect() {},
    disconnect(cb) { cb?.(); },
    channel: () => channel,
    onError() {},
    onClose() {},
    onOpen(cb) { cb(); },
  };
  const okPush = (): PushLike => {
    const p: PushLike = {
      receive(status, callback) {
        if (status === 'ok') callback({ peer_id: 'p1', network_id: 1, mode: 'host_relayed' });
        return p;
      },
    };
    return p;
  };
  return { socket, pushes };
}

async function connected() {
  const { socket, pushes } = fakeSocket();
  const connection = new PhoenixConnection(
    { onFrame() {}, onPeerJoin() {}, onPeerLeave() {}, onState() {}, onError() {} },
    () => socket,
  );
  await connection.connect('ws://test', { roomId: 'lobby' });
  return { connection, pushes };
}

describe('sendPing', () => {
  it('pushes a 9-byte PING and hands the reply back with both local stamps', async () => {
    const { connection, pushes } = await connected();

    let got: { frame: ArrayBuffer | null; t0: number; t3: number } | null = null;
    connection.sendPing((frame, t0, t3) => (got = { frame, t0, t3 }));

    const sent = pushes.at(-1)!;
    const ping = BinaryProtocol.decode(sent.payload as ArrayBuffer);
    if (ping.opCode !== OpCode.PING) throw new Error('not a ping');

    const pong = BinaryProtocol.encodePong(ping.timestamp, 5, 6, 42);
    sent.reply(pong);

    expect(got).not.toBeNull();
    expect(got!.frame).toBe(pong);
    expect(got!.t0).toBe(ping.timestamp); // the wire t0 IS the local stamp
    expect(got!.t3).toBeGreaterThanOrEqual(got!.t0);
  });

  it('reports a non-binary reply as null so the caller can drop it', async () => {
    const { connection, pushes } = await connected();
    let frame: ArrayBuffer | null = new ArrayBuffer(1);
    connection.sendPing((f) => (frame = f));
    pushes.at(-1)!.reply({ unexpected: true });
    expect(frame).toBeNull();
  });
});
```

Adapt the `connect` options and the join-reply shape to what `PhoenixConnection.connect` actually expects — read its implementation once and mirror the real `ConnectOptions` and join payload keys; the existing connection-level tests (if any use a fake socket) are the reference.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- clock-loop`
Expected: FAIL — `sendPing` does not exist.

- [ ] **Step 3: Write minimal implementation**

In `PhoenixConnection.ts`, next to `send`:

```ts
  /**
   * One clock-sync exchange. Both local stamps are taken here — as close to
   * the socket as this code gets — so a busy caller cannot pollute a sample.
   * The reply is the push reply, not a broadcast frame; an old server answers
   * with 9 bytes and the caller sees no server stamps.
   */
  sendPing(onPong: (frame: ArrayBuffer | null, t0: number, t3: number) => void): void {
    if (!this.channel || this.currentState !== 'connected') return;
    const t0 = performance.now();
    this.channel.push(FRAME_EVENT, BinaryProtocol.encodePing(t0)).receive('ok', (response?: unknown) => {
      const t3 = performance.now();
      onPong(response instanceof ArrayBuffer ? response : null, t0, t3);
    });
  }
```

Add the `BinaryProtocol` import if the file lacks it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- clock-loop`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/transport/PhoenixConnection.ts packages/client/test/clock-loop.test.ts
git commit -m "feat(client): sendPing stamps both edges of the exchange at the socket"
```

---

### Task 8: ClockLoop, worker message, worker wiring

**Files:**
- Create: `packages/client/src/transport/clock-loop.ts`
- Modify: `packages/client/src/transport/worker-messages.ts` (WorkerToMainMessage union, line ~26)
- Modify: `packages/client/src/workers/network.worker.ts` (connection callbacks at line ~29, `onState` at line ~47, `DISCONNECT` case at line ~82)
- Test: `packages/client/test/clock-loop.test.ts` (extend Task 7's file)

**Interfaces:**
- Consumes: `ClockSyncEstimator`, `ClockEstimate` (Task 6); `sendPing` (Task 7); `BinaryProtocol.decode` with `pong?: PongTimes` (Task 3).
- Produces:

```ts
// clock-loop.ts
export interface ClockReading {
  offsetMs: number | null; // null = old server, RTT only
  rttMs: number;
  epoch: number | null;
}
export interface ClockLoopOptions {
  sendPing(onPong: (frame: ArrayBuffer | null, t0: number, t3: number) => void): void;
  onReading(reading: ClockReading): void;
  burstCount?: number;      // default 4
  burstIntervalMs?: number; // default 250
  cruiseIntervalMs?: number; // default 2000
}
export class ClockLoop {
  constructor(options: ClockLoopOptions);
  start(): void; // idempotent; (re)starts burst-then-cruise
  stop(): void;
}
// worker-messages.ts gains:
| { type: 'CLOCK'; offsetMs: number | null; rttMs: number; epoch: number | null; workerTimeOrigin: number }
```

Task 9 consumes the `CLOCK` message and `ClockReading`.

- [ ] **Step 1: Write the failing tests** (append to `clock-loop.test.ts`)

```ts
import { afterEach, beforeEach, vi } from 'vitest';
import { ClockLoop } from '../src/transport/clock-loop.js';
import type { ClockReading } from '../src/transport/clock-loop.js';

describe('ClockLoop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** sendPing stub that answers every ping with given server stamps. */
  function answering(t1 = 5, t2 = 6, epoch = 42) {
    let count = 0;
    const sendPing = (onPong: (f: ArrayBuffer | null, t0: number, t3: number) => void) => {
      count += 1;
      const t0 = count * 1000;
      onPong(BinaryProtocol.encodePong(t0, t1, t2, epoch), t0, t0 + 40);
    };
    return { sendPing, sent: () => count };
  }

  it('bursts 4 pings 250 ms apart, then cruises every 2 s', () => {
    const { sendPing, sent } = answering();
    const loop = new ClockLoop({ sendPing, onReading() {} });
    loop.start();
    expect(sent()).toBe(1); // first ping immediately
    vi.advanceTimersByTime(750);
    expect(sent()).toBe(4); // burst complete
    vi.advanceTimersByTime(2000);
    expect(sent()).toBe(5); // cruise
    loop.stop();
    vi.advanceTimersByTime(10_000);
    expect(sent()).toBe(5); // stopped means stopped
  });

  it('publishes a reading with offset, rtt and epoch from a full pong', () => {
    const readings: ClockReading[] = [];
    const { sendPing } = answering(500 + 1020, 500 + 1021, 7); // t0=1000, up 20, ~true offset 500
    const loop = new ClockLoop({ sendPing, onReading: (r) => readings.push(r) });
    loop.start();
    loop.stop();
    expect(readings.length).toBe(1);
    expect(readings[0].epoch).toBe(7);
    expect(readings[0].offsetMs).not.toBeNull();
    expect(readings[0].rttMs).toBeGreaterThan(0);
  });

  it('a 9-byte pong from an old server yields an RTT-only reading', () => {
    const readings: ClockReading[] = [];
    const sendPing = (onPong: (f: ArrayBuffer | null, t0: number, t3: number) => void) =>
      onPong(BinaryProtocol.encodePing(1000, true), 1000, 1040);
    const loop = new ClockLoop({ sendPing, onReading: (r) => readings.push(r) });
    loop.start();
    loop.stop();
    expect(readings).toEqual([{ offsetMs: null, rttMs: 40, epoch: null }]);
  });

  it('drops a pong whose echoed t0 does not match', () => {
    const readings: ClockReading[] = [];
    const sendPing = (onPong: (f: ArrayBuffer | null, t0: number, t3: number) => void) =>
      onPong(BinaryProtocol.encodePong(999, 5, 6, 1), 1000, 1040); // echo mismatch
    const loop = new ClockLoop({ sendPing, onReading: (r) => readings.push(r) });
    loop.start();
    loop.stop();
    expect(readings).toEqual([]);
  });

  it('drops a null frame', () => {
    const readings: ClockReading[] = [];
    const loop = new ClockLoop({
      sendPing: (onPong) => onPong(null, 1000, 1040),
      onReading: (r) => readings.push(r),
    });
    loop.start();
    loop.stop();
    expect(readings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- clock-loop`
Expected: FAIL — `clock-loop.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/transport/clock-loop.ts
/**
 * Ping cadence and sample intake — runs where the socket lives.
 *
 * Burst at join (a usable offset in about a second), cruise after: the
 * estimator's window then spans ~16 s, far below real clock drift, for
 * 29 bytes every 2 s. Design: docs/superpowers/specs/2026-08-14-clock-sync-design.md.
 */
import { BinaryProtocol } from '../protocol/BinaryProtocol.js';
import { OpCode } from '../protocol/opcodes.js';
import { ClockSyncEstimator } from '../math/clock-sync.js';

/** What the loop publishes after each accepted exchange. */
export interface ClockReading {
  /** `null` when the server answered with a legacy 9-byte PONG — RTT only. */
  offsetMs: number | null;
  rttMs: number;
  epoch: number | null;
}

export interface ClockLoopOptions {
  sendPing(onPong: (frame: ArrayBuffer | null, t0: number, t3: number) => void): void;
  onReading(reading: ClockReading): void;
  burstCount?: number;
  burstIntervalMs?: number;
  cruiseIntervalMs?: number;
}

export class ClockLoop {
  private readonly estimator = new ClockSyncEstimator();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sentInBurst = 0;
  private running = false;

  constructor(private readonly options: ClockLoopOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.sentInBurst = 0;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (!this.running) return;
    this.options.sendPing((frame, t0, t3) => this.handlePong(frame, t0, t3));
    this.sentInBurst += 1;

    const { burstCount = 4, burstIntervalMs = 250, cruiseIntervalMs = 2000 } = this.options;
    const delay = this.sentInBurst < burstCount ? burstIntervalMs : cruiseIntervalMs;
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private handlePong(frame: ArrayBuffer | null, t0: number, t3: number): void {
    if (!frame) return;
    let decoded;
    try {
      decoded = BinaryProtocol.decode(frame);
    } catch {
      return; // malformed reply must not kill the loop
    }
    if (decoded.opCode !== OpCode.PONG) return;
    // The echo is the anti-replay check: a reply to some other ping (or a
    // server bug) must not become a sample.
    if (decoded.timestamp !== t0) return;

    if (!decoded.pong) {
      // Old server: degraded, never wrong.
      this.options.onReading({ offsetMs: null, rttMs: t3 - t0, epoch: null });
      return;
    }

    const { t1, t2, epoch } = decoded.pong;
    this.estimator.addSample({ t0, t1, t2, t3, epoch });
    const estimate = this.estimator.estimate();
    if (estimate) this.options.onReading(estimate);
  }
}
```

`worker-messages.ts` — add to `WorkerToMainMessage`:

```ts
  | {
      type: 'CLOCK';
      offsetMs: number | null;
      rttMs: number;
      epoch: number | null;
      /** Lets the main thread convert the worker-clock offset to its own. */
      workerTimeOrigin: number;
    }
```

`network.worker.ts` — after the `connection` construction:

```ts
const clockLoop = new ClockLoop({
  sendPing: (onPong) => connection.sendPing(onPong),
  onReading: (reading) =>
    post({ type: 'CLOCK', ...reading, workerTimeOrigin: performance.timeOrigin }),
});
```

In the existing `onState(state)` callback body, before the `post`:

```ts
    if (state === 'connected') clockLoop.start();
    else clockLoop.stop();
```

In the `DISCONNECT` case, before `connection.disconnect()`:

```ts
      clockLoop.stop();
```

Add the import: `import { ClockLoop } from '../transport/clock-loop.js';`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- clock-loop` then the full `pnpm test`
Expected: all green (the worker file has no unit test; the typecheck covers its wiring — run `pnpm typecheck`).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/transport/clock-loop.ts packages/client/src/transport/worker-messages.ts packages/client/src/workers/network.worker.ts packages/client/test/clock-loop.test.ts
git commit -m "feat(client): clock loop in the network worker, published as CLOCK messages"
```

---

### Task 9: Adapter reading, `handle.clock`, `NetworkStats.rttMs`

**Files:**
- Modify: `packages/client/src/interfaces/INetworkAdapter.ts` (interface at line ~51)
- Modify: `packages/client/src/adapters/PhoenixAdapter.ts` (`handleWorkerMessage` switch at line ~193)
- Modify: `packages/client/src/plugin.ts` (`PhoenixNetworkingHandle` at line ~99)
- Modify: `packages/client/src/systems/PhoenixNetworkSystem.ts` (stats block at line ~595)
- Modify: `packages/client/src/index.ts` (re-export the new public types)
- Test: `packages/client/test/clock-sync.test.ts` (extend with the `NetworkClock` cases)

**Interfaces:**
- Consumes: `CLOCK` message and `ClockReading` (Task 8), `SlewedOffset` + `combineWorkerOffset` (Task 6).
- Produces:

```ts
// INetworkAdapter gains (optional — Offline/Loopback adapters don't implement it):
readonly clockEstimate?: ClockReading | null;

// plugin.ts:
export interface NetworkClock {
  serverNow(): number;    // estimated server time; falls back to performance.now() until synced
  rttMs(): number;        // 0 until measured
  epoch(): number | null;
  synced(): boolean;
}
export function createNetworkClock(adapter: Pick<INetworkAdapter, 'clockEstimate'>): NetworkClock;
// PhoenixNetworkingHandle gains: clock: NetworkClock
```

- [ ] **Step 1: Write the failing tests** (append to `clock-sync.test.ts`)

```ts
import { createNetworkClock } from '../src/plugin.js';

describe('NetworkClock', () => {
  it('falls back to local time while unsynced, without lying about it', () => {
    const clock = createNetworkClock({ clockEstimate: null });
    const before = performance.now();
    const now = clock.serverNow();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(clock.synced()).toBe(false);
    expect(clock.rttMs()).toBe(0);
    expect(clock.epoch()).toBeNull();
  });

  it('applies the estimate once synced', () => {
    const adapter = {
      clockEstimate: { offsetMs: 5000, rttMs: 40, epoch: 3 } as const,
    };
    const clock = createNetworkClock(adapter);
    expect(clock.synced()).toBe(true);
    expect(clock.epoch()).toBe(3);
    expect(clock.rttMs()).toBe(40);
    expect(clock.serverNow() - performance.now()).toBeCloseTo(5000, 0);
  });

  it('stays RTT-only against an old server', () => {
    const clock = createNetworkClock({
      clockEstimate: { offsetMs: null, rttMs: 40, epoch: null },
    });
    expect(clock.synced()).toBe(false);
    expect(clock.rttMs()).toBe(40);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- clock-sync`
Expected: FAIL — `createNetworkClock` not exported.

- [ ] **Step 3: Write minimal implementation**

`INetworkAdapter.ts` — import the type and add the optional member to the interface:

```ts
import type { ClockReading } from '../transport/clock-loop.js';
```

```ts
  /**
   * Latest clock-sync reading, already mapped to THIS thread's clock.
   * Absent on adapters with no server to sync against; the consumer treats
   * absent and null alike.
   */
  readonly clockEstimate?: ClockReading | null;
```

`PhoenixAdapter.ts` — a field, the getter, and the switch case:

```ts
  private clockReading: ClockReading | null = null;

  /** See {@link INetworkAdapter.clockEstimate}. */
  get clockEstimate(): ClockReading | null {
    return this.clockReading;
  }
```

```ts
      case 'CLOCK': {
        const { offsetMs, rttMs, epoch, workerTimeOrigin } = message;
        this.clockReading = {
          // The worker measured against its own clock; fold in the
          // timeOrigin difference so consumers never think about it.
          offsetMs:
            offsetMs === null
              ? null
              : combineWorkerOffset(offsetMs, workerTimeOrigin, performance.timeOrigin),
          rttMs,
          epoch,
        };
        break;
      }
```

(plus imports for `ClockReading` and `combineWorkerOffset`).

`plugin.ts` — the public clock:

```ts
import { SlewedOffset } from './math/clock-sync.js';
import type { ClockReading } from './transport/clock-loop.js';
```

```ts
/** Live view of the server's clock. All methods are safe to call every frame. */
export interface NetworkClock {
  /** Estimated server time in ms; local `performance.now()` until synced. */
  serverNow(): number;
  /** Smoothed round-trip time in ms; 0 until measured. */
  rttMs(): number;
  /** Server node's boot epoch; null until synced. */
  epoch(): number | null;
  /** True once a full offset estimate exists. */
  synced(): boolean;
}

/**
 * Build the clock over whatever the adapter currently believes. The slew
 * lives here — on the reading side — so a fresh estimate never jumps
 * `serverNow()`, it bends it.
 */
export function createNetworkClock(
  adapter: Pick<INetworkAdapter, 'clockEstimate'>,
): NetworkClock {
  const slew = new SlewedOffset();
  const reading = (): ClockReading | null => adapter.clockEstimate ?? null;
  return {
    serverNow() {
      const r = reading();
      if (!r || r.offsetMs === null || r.epoch === null) return performance.now();
      const applied = slew.update(
        { offsetMs: r.offsetMs, rttMs: r.rttMs, epoch: r.epoch },
        performance.now(),
      );
      return performance.now() + applied;
    },
    rttMs: () => reading()?.rttMs ?? 0,
    epoch: () => reading()?.epoch ?? null,
    synced: () => reading()?.offsetMs != null,
  };
}
```

In `PhoenixNetworkingHandle`, add:

```ts
  /** Estimated server clock; see {@link NetworkClock}. */
  clock: NetworkClock;
```

and in `installPhoenixNetworking`'s returned object: `clock: createNetworkClock(adapter),`.

`PhoenixNetworkSystem.ts` — in the stats block beside `framesReceived` (line ~595), using the adapter reference that block already reaches:

```ts
      entity.setValue(NetworkStats, 'rttMs', this.adapter?.clockEstimate?.rttMs ?? 0);
```

(Match the actual adapter field name used in that file — read the surrounding lines; the value written must come from the same adapter instance the system receives frames from.)

`index.ts` — re-export alongside the existing public types:

```ts
export type { NetworkClock } from './plugin.js';
export { createNetworkClock } from './plugin.js';
export type { ClockReading } from './transport/clock-loop.js';
export { ClockSyncEstimator, SlewedOffset, combineWorkerOffset } from './math/clock-sync.js';
export type { ClockEstimate, ClockSample } from './math/clock-sync.js';
```

- [ ] **Step 4: Run the full client suite**

Run: `pnpm test && pnpm typecheck && pnpm demo:typecheck`
Expected: all green — including the packaging test, which will catch a missing export.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/interfaces/INetworkAdapter.ts packages/client/src/adapters/PhoenixAdapter.ts packages/client/src/plugin.ts packages/client/src/systems/PhoenixNetworkSystem.ts packages/client/src/index.ts packages/client/test/clock-sync.test.ts
git commit -m "feat(client): expose handle.clock and finally write NetworkStats.rttMs"
```

---

### Task 10: Protocol documentation

**Files:**
- Modify: `docs/PROTOCOL.md` (opcode table line ~31: `| 8 | PONG | server → client | 9 |`; the `PING (7) / PONG (8) — 9 bytes` section at line ~158)

**Interfaces:** none — documentation of Tasks 2/3/5.

- [ ] **Step 1: Update the opcode table row**

```markdown
| 8 | `PONG` | server → client | 9 (legacy) / 29 |
```

- [ ] **Step 2: Rewrite the PING/PONG section**

Replace the section body so it documents both forms — layout table in the file's existing style:

```markdown
## `PING` (7) / `PONG` (8)

`PING` is unchanged: 9 bytes, `u8` opcode + `f64` client send time (`t0`).

`PONG` has two forms, discriminated by length — there is no version
negotiation. Servers emit the 29-byte form; a 9-byte `PONG` is what an older
server produced, and a client that receives one runs RTT-only.

| bytes | type | field |
|---|---|---|
| 0 | `u8` | opcode = 8 |
| 1–8 | `f64` | `t0` — echo of the client's send time (anti-replay) |
| 9–16 | `f64` | `t1` — server receive time |
| 17–24 | `f64` | `t2` — server send time |
| 25–28 | `u32` | `epoch` — server node boot identifier |

Server times are `System.monotonic_time` milliseconds: an arbitrary,
per-node origin that never goes backwards. `epoch` is a random `u32` drawn
at node boot; when it changes, every previously computed offset is
meaningless and the client must discard its estimate. The client stamps
`t3` (PONG arrival) locally — it never travels. From one exchange:

    offset = ((t1 − t0) + (t2 − t3)) / 2
    rtt    = (t3 − t0) − (t2 − t1)

The PONG travels as the *push reply* to the PING, not as a broadcast frame,
and is answered in the channel process without entering the room — a queued
room must not pollute clock samples.
```

- [ ] **Step 3: Check the cross-reference note**

`docs/PROTOCOL.md` ends with a warning that layout changes require regenerating fixtures — confirm the wording still holds (it does; Task 4 already regenerated them).

- [ ] **Step 4: Commit**

```bash
git add docs/PROTOCOL.md
git commit -m "docs: extended PONG layout and clock-sync exchange"
```

---

### Task 11: Full verification sweep

**Files:** none created — this is the gate before calling the feature done.

- [ ] **Step 1: Both suites, all green**

Run: `pnpm test && pnpm typecheck && (cd packages/server && mix test)`
Expected: every test passes, including the 111 pre-existing client tests and the pre-existing server suite.

- [ ] **Step 2: The demo still builds and typechecks**

Run: `pnpm demo:build && pnpm demo:typecheck`
Expected: clean.

- [ ] **Step 3: Live end-to-end**

Start the Phoenix server (`cd apps/demo_server && mix phx.server`), serve `apps/demo/dist` with the COOP/COEP static server, open a client, and verify in the console (or via a temporary `console.log`) that `net.clock.synced()` turns true within ~1 s of connecting and `net.clock.rttMs()` reports a plausible local value (< 50 ms). Remove any temporary logging afterwards.

- [ ] **Step 4: Final commit if anything moved**

```bash
git status --short   # should be clean; commit any stragglers with context
```

---

## Self-review notes (already applied)

- **Spec coverage:** Section 1 → Tasks 2/3/4/10; Section 2 → Tasks 6/7/8; Section 3 → Tasks 1/5; Section 4 → Tasks 1–8's tests + Task 4's vectors + Task 5's epoch-swap test. The spec's "burst then cruise" cadence, min-RTT window, slew bounds, worker stamping, timeOrigin conversion, legacy degradation and `:persistent_term` epoch each have a named test.
- **Legacy `Handler.reply_pong`:** deliberately left in place (non-channel embedders keep a working 9-byte reply; the channel never reaches it). The client treats a 9-byte reply as "old server" — consistent degradation either way.
- **Type consistency:** `ClockReading` originates in `clock-loop.ts` and is imported everywhere else; `ClockEstimate`/`ClockSample` originate in `math/clock-sync.ts`; `PongTimes` in `BinaryProtocol.ts`. `offsetMs`/`rttMs`/`epoch` are the field names on every boundary.
