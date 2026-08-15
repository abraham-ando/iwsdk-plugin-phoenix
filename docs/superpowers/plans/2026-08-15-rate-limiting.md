# Per-peer rate limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound what one peer can cost a room, so a single hostile client cannot degrade the other 79.

**Architecture:** A weighted token bucket per peer. The decision is a pure, dependency-free module (`IwsdkPhoenix.RateLimiter`); the cost table is a second module that knows the protocol (`IwsdkPhoenix.RateLimiter.Costs`); the application point is `IwsdkPhoenix.RoomChannel`, where the bucket lives in the socket's assigns and is checked before the frame reaches the room's `GenServer.call`. Over-budget frames are dropped silently.

**Tech Stack:** Elixir, ExUnit. No new dependencies — the limiter must compile and pass under `IWSDK_CORE_ONLY=1`.

**Spec:** `docs/superpowers/specs/2026-08-15-rate-limiting-design.md`

## Global Constraints

- **No new dependencies.** `RateLimiter` and `Costs` depend on nothing outside `IwsdkPhoenix.Protocol`, itself dependency-free. Both must pass under `IWSDK_CORE_ONLY=1`.
- **No wire change.** No opcode is added, no frame layout changes. Cardinal is not regenerated, and `fixtures/protocol_vectors.tsv` is untouched.
- **Time is an argument.** `RateLimiter` never reads a clock. `now_ms` is passed in, as in `Kinematic.integrate/8` and `DayNight.sun_angle/1`. No `Process.sleep` in any test.
- **Defaults:** 256 tokens/second sustained, capacity 768.
- **A drop does not consume tokens.** Charging for rejected frames would let a sustained flood hold the bucket at zero.
- **A backwards `now_ms` mints nothing** and must not corrupt the bucket.
- **`RoomChannel` is generated inside a `quote`.** No function call is allowed in a pattern there. All limiter calls go in clause *bodies*.
- `mix format --check-formatted` and `mix compile --warnings-as-errors` must stay clean.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/server/lib/iwsdk_phoenix/rate_limiter.ex` | **Create.** The bucket: `new/1`, `take/3`, `counters/1`. Knows nothing about frames or opcodes. |
| `packages/server/lib/iwsdk_phoenix/rate_limiter/costs.ex` | **Create.** Opcode → cost. The only place the price list lives. |
| `packages/server/test/rate_limiter_test.exs` | **Create.** Pure bucket mechanics. |
| `packages/server/test/rate_limiter/costs_test.exs` | **Create.** Price list, plus the honest-peer regression. |
| `packages/server/lib/iwsdk_phoenix/room_channel.ex` | **Modify.** `join/3` builds the bucket; all three `handle_in` clauses spend from it. |
| `apps/demo_server/test/support/channel_case.ex` | **Modify.** Add `join_room_limited/3`. |
| `apps/demo_server/test/demo_server_web/rate_limit_test.exs` | **Create.** End-to-end through a real socket. |

Splitting the bucket from the price list is what keeps the bucket testable without the protocol and the price list changeable without touching the mechanics.

---

### Task 1: The pure token bucket

**Files:**
- Create: `packages/server/lib/iwsdk_phoenix/rate_limiter.ex`
- Test: `packages/server/test/rate_limiter_test.exs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RateLimiter.new(opts :: keyword()) :: t()` — opts `:capacity` (number, default 768), `:tokens_per_second` (number, default 256), `:now_ms` (integer, default 0). Starts full.
  - `RateLimiter.take(t(), cost :: number(), now_ms :: integer()) :: {:ok, t()} | {:drop, t()}`
  - `RateLimiter.counters(t()) :: %{dropped: non_neg_integer(), tokens: float()}`
  - Struct fields `:tokens`, `:capacity`, `:refill_per_ms`, `:last_ms`, `:dropped`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/rate_limiter_test.exs`:

```elixir
defmodule IwsdkPhoenix.RateLimiterTest do
  @moduledoc """
  The bucket, with time injected.

  Every test passes `now_ms` explicitly, so there is no sleeping and no
  flakiness: the same reason `Kinematic.integrate/8` takes a timestep rather
  than reading a clock.
  """

  use ExUnit.Case, async: true

  alias IwsdkPhoenix.RateLimiter

  describe "new/1" do
    test "starts full, so a joining peer has its burst reserve immediately" do
      limiter = RateLimiter.new(capacity: 100, tokens_per_second: 50, now_ms: 1_000)

      assert limiter.tokens == 100.0
      assert RateLimiter.counters(limiter) == %{dropped: 0, tokens: 100.0}
    end

    test "defaults to the calibration in the spec" do
      limiter = RateLimiter.new()

      assert limiter.capacity == 768.0
      assert limiter.refill_per_ms == 0.256
    end
  end

  describe "take/3" do
    test "spends tokens" do
      limiter = RateLimiter.new(capacity: 100, tokens_per_second: 50, now_ms: 0)

      assert {:ok, limiter} = RateLimiter.take(limiter, 10, 0)
      assert limiter.tokens == 90.0
    end

    test "drops when the cost exceeds the balance" do
      limiter = RateLimiter.new(capacity: 10, tokens_per_second: 1, now_ms: 0)

      assert {:drop, limiter} = RateLimiter.take(limiter, 11, 0)
      assert limiter.dropped == 1
    end

    test "a drop consumes nothing, so a flood cannot deny a peer its recovery" do
      limiter = RateLimiter.new(capacity: 10, tokens_per_second: 1, now_ms: 0)

      {:ok, limiter} = RateLimiter.take(limiter, 10, 0)
      {:drop, limiter} = RateLimiter.take(limiter, 5, 0)
      {:drop, limiter} = RateLimiter.take(limiter, 5, 0)

      assert limiter.tokens == 0.0
      assert limiter.dropped == 2

      # One second on, exactly one token has accrued and is spendable.
      assert {:ok, _} = RateLimiter.take(limiter, 1, 1_000)
    end

    test "refills at the configured rate" do
      limiter = RateLimiter.new(capacity: 100, tokens_per_second: 50, now_ms: 0)

      {:ok, limiter} = RateLimiter.take(limiter, 100, 0)
      assert limiter.tokens == 0.0

      # 500 ms at 50/s is 25 tokens, all of which this take spends.
      {:ok, limiter} = RateLimiter.take(limiter, 25, 500)
      assert_in_delta limiter.tokens, 0.0, 0.000_001
    end

    test "never exceeds capacity, however long the silence" do
      limiter = RateLimiter.new(capacity: 100, tokens_per_second: 50, now_ms: 0)

      {:ok, limiter} = RateLimiter.take(limiter, 100, 0)
      {:ok, limiter} = RateLimiter.take(limiter, 0, 10_000_000)

      assert limiter.tokens == 100.0
    end

    test "a backwards clock mints nothing and does not rewind the bucket" do
      limiter = RateLimiter.new(capacity: 100, tokens_per_second: 50, now_ms: 10_000)

      {:ok, limiter} = RateLimiter.take(limiter, 50, 10_000)
      {:ok, limiter} = RateLimiter.take(limiter, 0, 5_000)

      assert limiter.tokens == 50.0
      assert limiter.last_ms == 10_000
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/rate_limiter_test.exs`
Expected: FAIL — `** (UndefinedFunctionError) function IwsdkPhoenix.RateLimiter.new/1 is undefined (module IwsdkPhoenix.RateLimiter is not available)`

- [ ] **Step 3: Write minimal implementation**

Create `packages/server/lib/iwsdk_phoenix/rate_limiter.ex`:

```elixir
defmodule IwsdkPhoenix.RateLimiter do
  @moduledoc """
  A token bucket, as a value.

  One of these belongs to each peer. It bounds what that peer can cost a room,
  which matters here more than it would behind a stateless HTTP endpoint:
  frames reach a room through a synchronous `GenServer.call`, so a peer sending
  faster than the room can serve does not merely queue — it serialises, and
  expires the calls of every other peer in the room.

  ## No process, no timer

  Refill is lazy: `take/3` credits whatever accrued since the last call, at the
  moment a message arrives. Nothing runs while a peer is silent. A bucket is
  five machine words and no process, which is the only shape that survives
  375,000 sectors of 80 peers.

  ## Time is an argument

  This module never reads a clock. `now_ms` is passed in, exactly as
  `IwsdkPhoenix.Physics.Kinematic` takes a timestep, which is what makes the
  tests deterministic and free of sleeping.
  """

  @default_capacity 768.0
  @default_tokens_per_second 256.0

  defstruct tokens: @default_capacity,
            capacity: @default_capacity,
            refill_per_ms: @default_tokens_per_second / 1000,
            last_ms: 0,
            dropped: 0

  @type t :: %__MODULE__{
          tokens: float(),
          capacity: float(),
          refill_per_ms: float(),
          last_ms: integer(),
          dropped: non_neg_integer()
        }

  @doc """
  Build a bucket, full.

  ## Options

    * `:capacity` — burst reserve in tokens, default #{trunc(@default_capacity)}
    * `:tokens_per_second` — sustained rate, default #{trunc(@default_tokens_per_second)}
    * `:now_ms` — the reading `take/3` will measure the first refill against

  It starts full rather than empty because a peer's first seconds are its
  busiest: joining, spawning and settling all happen at once, and a bucket that
  filled from zero would drop precisely the traffic a legitimate join produces.
  """
  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    capacity = opts |> Keyword.get(:capacity, @default_capacity) |> to_float()
    rate = opts |> Keyword.get(:tokens_per_second, @default_tokens_per_second) |> to_float()

    %__MODULE__{
      tokens: capacity,
      capacity: capacity,
      refill_per_ms: rate / 1000,
      last_ms: Keyword.get(opts, :now_ms, 0),
      dropped: 0
    }
  end

  @doc """
  Charge `cost` against the bucket.

  Returns `{:ok, limiter}` when the peer could afford it, `{:drop, limiter}`
  when it could not. A drop leaves the token count untouched — charging for
  rejected frames would let a sustained flood pin the bucket at zero and deny
  the peer the recovery the refill is there to give it.
  """
  @spec take(t(), number(), integer()) :: {:ok, t()} | {:drop, t()}
  def take(%__MODULE__{} = limiter, cost, now_ms)
      when is_number(cost) and cost >= 0 and is_integer(now_ms) do
    limiter = refill(limiter, now_ms)

    if limiter.tokens >= cost do
      {:ok, %{limiter | tokens: limiter.tokens - cost}}
    else
      {:drop, %{limiter | dropped: limiter.dropped + 1}}
    end
  end

  @doc """
  Lifetime counters, for telemetry.

  Exposed the way `IwsdkPhoenix.Persistence.Buffer` exposes its own: this
  package publishes no metrics and takes no telemetry dependency, so an
  application reads these and reports them wherever it already reports.
  """
  @spec counters(t()) :: %{dropped: non_neg_integer(), tokens: float()}
  def counters(%__MODULE__{} = limiter) do
    %{dropped: limiter.dropped, tokens: limiter.tokens}
  end

  # Elapsed time is clamped at zero. Monotonic time is monotonic per node, but
  # a bucket must not mint negative tokens if that ever stops being true.
  defp refill(%__MODULE__{} = limiter, now_ms) do
    elapsed = max(now_ms - limiter.last_ms, 0)
    tokens = min(limiter.tokens + elapsed * limiter.refill_per_ms, limiter.capacity)

    %{limiter | tokens: tokens, last_ms: max(now_ms, limiter.last_ms)}
  end

  defp to_float(value) when is_integer(value), do: value * 1.0
  defp to_float(value) when is_float(value), do: value
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && mix test test/rate_limiter_test.exs`
Expected: PASS, 8 tests

Then prove it is dependency-free:

Run: `cd packages/server && IWSDK_CORE_ONLY=1 MIX_BUILD_ROOT=_build_core mix test test/rate_limiter_test.exs`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
cd packages/server && mix format
git add packages/server/lib/iwsdk_phoenix/rate_limiter.ex packages/server/test/rate_limiter_test.exs
git commit -m "feat(server): a lazy token bucket, with time as an argument"
```

---

### Task 2: The cost table, and the honest-peer regression

**Files:**
- Create: `packages/server/lib/iwsdk_phoenix/rate_limiter/costs.ex`
- Test: `packages/server/test/rate_limiter/costs_test.exs`

**Interfaces:**
- Consumes: `RateLimiter.new/1`, `RateLimiter.take/3` from Task 1; `Protocol.peek_opcode/1`, `Protocol.op_*/0`.
- Produces:
  - `Costs.of(frame :: binary()) :: pos_integer()`
  - `Costs.malformed_cost() :: pos_integer()` — 10, used by the channel for non-binary payloads.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/rate_limiter/costs_test.exs`:

```elixir
defmodule IwsdkPhoenix.RateLimiter.CostsTest do
  @moduledoc """
  The price list, and the regression that protects honest players.

  Costs are derived from the opcode and the frame length only. Nothing here
  decodes a frame: `byte_size/1` is O(1) on an Erlang binary, so the
  length-derived component is free.
  """

  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.RateLimiter
  alias IwsdkPhoenix.RateLimiter.Costs

  # Frames of the right opcode and the right length. The bodies are zeroes:
  # nothing in the cost path looks past the first byte and the size.
  defp frame(opcode, bytes), do: <<opcode>> <> <<0::size((bytes - 1) * 8)>>

  defp input, do: frame(Protocol.op_input_update(), 22)
  defp transform, do: frame(Protocol.op_transform_update(), 33)

  describe "of/1" do
    test "bills the cheap fixed-size frames at one" do
      assert Costs.of(input()) == 1
      assert Costs.of(transform()) == 1
      assert Costs.of(frame(Protocol.op_ping(), 9)) == 1
    end

    test "bills a snapshot by length, at roughly one token per four records" do
      # 32-byte records, 128 bytes per token: eight records cost two extra.
      assert Costs.of(frame(Protocol.op_snapshot(), 1 + 8 * 32)) == 3
    end

    test "bills the frames that mutate room state well above a transform" do
      assert Costs.of(frame(Protocol.op_component_update(), 20)) == 5
      assert Costs.of(frame(Protocol.op_ownership_request(), 9)) == 10
    end

    test "bills a signal by payload size, up to seventeen at the 16 KiB cap" do
      assert Costs.of(frame(Protocol.op_signal(), 16 * 1024)) == 17
    end

    test "bills an unknown opcode at the malformed rate, not at a transform's" do
      # The limiter runs before dispatch, so an unknown opcode has not been
      # rejected yet — and rejecting it costs a log line and a reply. If garbage
      # were the cheapest thing to send, garbage is what a flood would be made
      # of.
      assert Costs.of(frame(200, 10)) == Costs.malformed_cost()
      assert Costs.malformed_cost() == 10
    end

    test "bills a server-to-client opcode as malformed, since no client sends one" do
      assert Costs.of(frame(Protocol.op_reconcile(), 20)) == 10
      assert Costs.of(frame(Protocol.op_spawn_entity(), 20)) == 10
    end

    test "bills an empty frame as malformed rather than crashing" do
      assert Costs.of(<<>>) == Costs.malformed_cost()
    end
  end

  describe "the honest peer" do
    test "at 120 Hz holding two objects, over ten seconds, is never dropped" do
      # The regression that matters most. A future tightening of the constants
      # that breaks legitimate players fails here — and nowhere else, because in
      # production it looks exactly like packet loss.
      #
      # 120 inputs/s: ClientPredictionSystem sends one per rendered frame.
      # 2 objects x 30 Hz: sendRateHz, per owned entity.
      inputs = for i <- 0..1199, do: {div(i * 1000, 120), input()}
      transforms = for i <- 0..299, _object <- 1..2, do: {div(i * 1000, 30), transform()}

      events = Enum.sort_by(inputs ++ transforms, &elem(&1, 0))

      {_limiter, drops} =
        Enum.reduce(events, {RateLimiter.new(now_ms: 0), 0}, fn {ms, frame}, {limiter, drops} ->
          case RateLimiter.take(limiter, Costs.of(frame), ms) do
            {:ok, limiter} -> {limiter, drops}
            {:drop, limiter} -> {limiter, drops + 1}
          end
        end)

      assert drops == 0
    end

    test "an ownership flood is capped near the spec's 25 per second" do
      request = frame(Protocol.op_ownership_request(), 9)

      # Ten seconds of hammering as fast as a client can, one per millisecond.
      {_limiter, allowed} =
        Enum.reduce(0..9_999, {RateLimiter.new(now_ms: 0), 0}, fn ms, {limiter, allowed} ->
          case RateLimiter.take(limiter, Costs.of(request), ms) do
            {:ok, limiter} -> {limiter, allowed + 1}
            {:drop, limiter} -> {limiter, allowed}
          end
        end)

      # 256 tokens/s over 10 s at 10 each is ~256, plus the 768 opening reserve
      # at 10 each is ~76. Well under a thousandth of what it attempted.
      assert allowed < 350
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/rate_limiter/costs_test.exs`
Expected: FAIL — `** (UndefinedFunctionError) function IwsdkPhoenix.RateLimiter.Costs.of/1 is undefined`

- [ ] **Step 3: Write minimal implementation**

Create `packages/server/lib/iwsdk_phoenix/rate_limiter/costs.ex`:

```elixir
defmodule IwsdkPhoenix.RateLimiter.Costs do
  @moduledoc """
  What each opcode costs a peer's bucket.

  Opcodes differ by more than an order of magnitude in the work they cause. A
  `TRANSFORM_UPDATE` is relayed without being decoded; an `OWNERSHIP_REQUEST`
  arbitrates, writes and then broadcasts to every peer in the room; a `SIGNAL`
  may carry 16 KiB. A uniform budget would have to be calibrated for the most
  expensive of them, throttling ordinary movement to contain ownership spam.

  ## Nothing is decoded

  Cost comes from the opcode and the frame length alone:

      cost = base(opcode) + div(byte_size(frame), bytes_per_token(opcode))

  `peek_opcode/1` reads one byte and `byte_size/1` is O(1) on a binary, so a
  snapshot is billed by its length rather than by parsing out its entity count.

  ## Why unknown opcodes cost more, not less

  This runs *before* dispatch, so an unrecognised opcode has not been rejected
  yet — and rejecting it is not free. Billing garbage at a transform's rate
  would make garbage the cheapest flood to build. Server-to-client opcodes land
  here too: no honest client sends a `RECONCILE`.
  """

  alias IwsdkPhoenix.Protocol

  # Module attributes, not function calls: a pattern cannot contain a call.
  @op_transform_update Protocol.op_transform_update()
  @op_input_update Protocol.op_input_update()
  @op_ping Protocol.op_ping()
  @op_snapshot Protocol.op_snapshot()
  @op_component_update Protocol.op_component_update()
  @op_ownership_request Protocol.op_ownership_request()
  @op_signal Protocol.op_signal()

  @malformed_cost 10

  @doc "The cost of one inbound frame, in tokens."
  @spec of(binary()) :: pos_integer()
  def of(frame) when is_binary(frame) do
    case Protocol.peek_opcode(frame) do
      {:ok, opcode} -> cost(opcode, byte_size(frame))
      {:error, _reason} -> @malformed_cost
    end
  end

  @doc """
  What a payload that is not a protocol frame costs.

  The channel charges this for a JSON body arriving on the binary event, which
  never reaches `of/1` at all.
  """
  @spec malformed_cost() :: pos_integer()
  def malformed_cost, do: @malformed_cost

  defp cost(@op_transform_update, _bytes), do: 1
  defp cost(@op_input_update, _bytes), do: 1
  defp cost(@op_ping, _bytes), do: 1
  defp cost(@op_snapshot, bytes), do: 1 + div(bytes, 128)
  defp cost(@op_component_update, _bytes), do: 5
  defp cost(@op_ownership_request, _bytes), do: 10
  defp cost(@op_signal, bytes), do: 1 + div(bytes, 1024)
  defp cost(_unknown, _bytes), do: @malformed_cost
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && mix test test/rate_limiter/costs_test.exs`
Expected: PASS, 9 tests

Run: `cd packages/server && IWSDK_CORE_ONLY=1 MIX_BUILD_ROOT=_build_core mix test test/rate_limiter/costs_test.exs`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
cd packages/server && mix format
git add packages/server/lib/iwsdk_phoenix/rate_limiter/costs.ex packages/server/test/rate_limiter/costs_test.exs
git commit -m "feat(server): weight frame cost by opcode, billing malformed traffic highest"
```

---

### Task 3: Spend from the bucket in every channel clause

**Files:**
- Modify: `packages/server/lib/iwsdk_phoenix/room_channel.ex` — aliases (~line 74), `join/3` assigns (~line 106), and all three `handle_in` clauses (196, 216, 252)

**Interfaces:**
- Consumes: `RateLimiter.new/1`, `RateLimiter.take/3`, `Costs.of/1`, `Costs.malformed_cost/0`.
- Produces: `socket.assigns.rate_limiter`, a `RateLimiter.t()` present from `join/3` onward.

This task has no test of its own — `packages/server/test/room_channel_test.exs` only compiles when Phoenix is loaded, and the behaviour is asserted end-to-end in Task 4. Verification here is that the suite still passes and the module compiles without warnings.

- [ ] **Step 1: Add the aliases**

In `packages/server/lib/iwsdk_phoenix/room_channel.ex`, after `alias IwsdkPhoenix.Protocol` (line 74), add:

```elixir
    alias IwsdkPhoenix.RateLimiter
    alias IwsdkPhoenix.RateLimiter.Costs
```

Keep the existing four-space indentation: this is inside the `quote`.

- [ ] **Step 2: Build the bucket at join**

In `join/3`, extend the assign pipeline (lines 106-111) with one more line:

```elixir
        socket =
          socket
          |> assign(:room, room)
          |> assign(:room_id, room_id)
          |> assign(:peer_id, peer_id)
          |> assign(:network_id, player.network_id)
          |> assign(:rate_limiter, build_limiter(socket))
```

- [ ] **Step 3: Add the two private helpers**

Add these near the other private functions, before `defp peer_topic/1`:

```elixir
    # Three levels of precedence, general to specific: module defaults, then the
    # deployment's config, then whatever `connect/2` put on the socket. The last
    # is what lets an application widen the budget for a trusted character and
    # tighten it for a flagged one, without this package holding any opinion
    # about accounts.
    defp build_limiter(socket) do
      Application.get_env(:iwsdk_phoenix, :rate_limit, [])
      |> Keyword.merge(socket.assigns[:rate_limit] || [])
      |> Keyword.put(:now_ms, IwsdkPhoenix.Clock.now_ms())
      |> RateLimiter.new()
    end

    # Silent on the way out: no reply, so an attacker gets no oracle for
    # calibrating a flood to sit just under the limit. An honest peer should
    # never reach here, so there is nothing to tell it either.
    defp spend(socket, cost) do
      case RateLimiter.take(socket.assigns.rate_limiter, cost, IwsdkPhoenix.Clock.now_ms()) do
        {:ok, limiter} ->
          {:ok, assign(socket, :rate_limiter, limiter)}

        {:drop, limiter} ->
          Logger.debug("iwsdk_phoenix rate limited a frame from #{socket.assigns.peer_id}")
          {:drop, assign(socket, :rate_limiter, limiter)}
      end
    end
```

- [ ] **Step 4: Charge the ping clause**

`handle_in` at line 196 is the clock-sync path: cheap per call, unbounded per second, and it performs two clock reads, a decode and an encode. Wrap its body, leaving the inner logic untouched:

```elixir
    def handle_in(@frame_event, {:binary, <<7, _::binary>> = frame}, socket) do
      case spend(socket, Costs.of(frame)) do
        {:drop, socket} ->
          {:noreply, socket}

        {:ok, socket} ->
          t1 = IwsdkPhoenix.Clock.now_ms()

          case Protocol.decode(frame) do
            {:ok, :ping, %{timestamp: t0}} ->
              pong =
                Protocol.encode_pong(
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
    end
```

- [ ] **Step 5: Charge the general binary clause**

Replace `handle_in` at line 216 with the following. Only the wrapper and the indentation change — every branch keeps its logic and its comment:

```elixir
    def handle_in(@frame_event, {:binary, frame}, socket) do
      case spend(socket, Costs.of(frame)) do
        {:drop, socket} ->
          {:noreply, socket}

        {:ok, socket} ->
          case Server.handle_frame(socket.assigns.room, socket.assigns.peer_id, frame) do
            {:broadcast, payload} ->
              broadcast_from!(socket, @frame_event, {:binary, payload})
              {:noreply, socket}

            {:direct, target_peer, payload} ->
              # Signalling is between two peers; fanning it out would leak the
              # negotiation to the room. Each socket subscribes to its own topic.
              socket.endpoint.broadcast(peer_topic(target_peer), @frame_event, {
                :binary,
                payload
              })

              {:noreply, socket}

            {:broadcast_all, payload} ->
              # Includes the sender. Ownership verdicts go to everyone, and the
              # requester is the peer that most needs the answer.
              broadcast!(socket, @frame_event, {:binary, payload})
              {:noreply, socket}

            {:reply, payload} ->
              {:reply, {:ok, {:binary, payload}}, socket}

            :ok ->
              {:noreply, socket}

            {:error, reason} ->
              Logger.debug("iwsdk_phoenix rejected frame: #{inspect(reason)}")
              {:reply, {:error, %{reason: to_string(reason)}}, socket}
          end
      end
    end
```

- [ ] **Step 6: Charge the non-binary clause**

Replace the body at line 252, keeping the existing rejection reason:

```elixir
    # A JSON payload on the binary event means a client that is not speaking
    # this protocol. Reject loudly rather than letting it look like packet loss
    # — but charge for it first, or it becomes the way around the limiter.
    def handle_in(@frame_event, _payload, socket) do
      case spend(socket, Costs.malformed_cost()) do
        {:drop, socket} ->
          {:noreply, socket}

        {:ok, socket} ->
          {:reply, {:error, %{reason: "expected_binary_payload"}}, socket}
      end
    end
```

- [ ] **Step 7: Verify the module compiles and the suite still passes**

Run: `cd packages/server && mix format && MIX_ENV=test mix compile --force --warnings-as-errors`
Expected: compiles clean, no warnings

Confirm the channel is actually in this build — a dependency-free compile leaves it out, and its tests then skip silently:

Run: `ls packages/server/_build/test/lib/iwsdk_phoenix/ebin/ | grep RoomChannel`
Expected: `Elixir.IwsdkPhoenix.RoomChannel.beam`

Run: `cd packages/server && mix test`
Expected: PASS, 297 tests (280 existing, plus 8 from Task 1 and 9 from Task 2), no failures

- [ ] **Step 8: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/room_channel.ex
git commit -m "feat(server): charge every channel entry point against the peer's bucket"
```

---

### Task 4: End to end, through a real socket

**Files:**
- Modify: `apps/demo_server/test/support/channel_case.ex`
- Create: `apps/demo_server/test/demo_server_web/rate_limit_test.exs`

**Interfaces:**
- Consumes: `join_room/3`, `unique_room/0`, `drain_frames/1`, `of_kind/2` from `DemoServerWeb.ChannelCase`.
- Produces: `join_room_limited(peer_id, room_id, limit_opts)` — joins with a per-socket `:rate_limit`, returning `{socket, reply}`.

- [ ] **Step 1: Add the join helper**

In `apps/demo_server/test/support/channel_case.ex`, inside the `using do quote do` block, after `join_room/3`:

```elixir
      @doc """
      Join with a deliberately small budget.

      Set on the socket rather than in application config so these tests stay
      `async: true`: config is global, and a shared budget would make one test's
      flood another test's failure.
      """
      def join_room_limited(peer_id, room_id, limit_opts) do
        {:ok, reply, socket} =
          DemoServerWeb.UserSocket
          |> socket(peer_id, %{peer_id: peer_id, rate_limit: limit_opts})
          |> subscribe_and_join("room:#{room_id}", %{"mode" => "host_relayed"})

        {socket, reply}
      end
```

- [ ] **Step 2: Write the failing test**

Create `apps/demo_server/test/demo_server_web/rate_limit_test.exs`:

```elixir
defmodule DemoServerWeb.RateLimitTest do
  @moduledoc """
  The limiter through a real Phoenix socket.

  What matters here is not that a flood is throttled — that is Task 2's
  arithmetic — but that throttling one peer leaves the room working for
  everybody else. Frames reach a room through a synchronous `GenServer.call`,
  so before this existed one peer sending faster than the room could serve
  expired the calls of all the others.
  """

  use DemoServerWeb.ChannelCase, async: true

  alias IwsdkPhoenix.Protocol

  # Ten tokens, one per second: a budget small enough that a burst is bounded
  # and slow enough that it does not refill during the test.
  @tiny [capacity: 10, tokens_per_second: 1]

  defp transform_frame(network_id) do
    Protocol.encode_transform(
      network_id,
      %{x: 1.0, y: 2.0, z: 3.0},
      %{x: 0.0, y: 0.0, z: 0.0, w: 1.0}
    )
  end

  test "a peer's flood is bounded, and its neighbour keeps being served" do
    room = unique_room()

    {flooder, flooder_reply} = join_room_limited("flooder", room, @tiny)
    {neighbour, neighbour_reply} = join_room("neighbour", room)

    # Drain the spawn frames the joins produced, so the counts below are only
    # about the traffic this test pushes.
    drain_frames()

    flood = transform_frame(flooder_reply.network_id)
    for _ <- 1..100, do: push(flooder, "frame", {:binary, flood})

    relayed =
      drain_frames()
      |> of_kind(:transform_update)
      |> Enum.filter(&(&1.network_id == flooder_reply.network_id))

    # Ten tokens at one per transform: the room saw a fraction of the hundred.
    assert length(relayed) > 0
    assert length(relayed) <= 15

    # The room is still serving the peer that behaved.
    push(neighbour, "frame", {:binary, transform_frame(neighbour_reply.network_id)})

    from_neighbour =
      drain_frames()
      |> of_kind(:transform_update)
      |> Enum.filter(&(&1.network_id == neighbour_reply.network_id))

    assert length(from_neighbour) == 1
  end

  test "a peer cannot sidestep the limiter with JSON on the binary event" do
    room = unique_room()
    {peer, _reply} = join_room_limited("json-peer", room, @tiny)

    # The non-binary clause is charged the malformed rate, so the budget is gone
    # well before these are exhausted; the replies stop when it is.
    replies =
      for _ <- 1..20 do
        ref = push(peer, "frame", %{"not" => "binary"})

        receive do
          %Phoenix.Socket.Reply{ref: ^ref} -> :replied
        after
          50 -> :dropped
        end
      end

    assert :dropped in replies
  end
end
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/demo_server && mix test test/demo_server_web/rate_limit_test.exs`
Expected: FAIL — without a limiter all 100 frames relay, so `assert length(relayed) <= 15` fails with a count near 100.

- [ ] **Step 4: Run test to verify it passes**

Tasks 1-3 are what make it pass; nothing new is implemented here.

Run: `cd apps/demo_server && mix test`
Expected: PASS, 29 tests

- [ ] **Step 5: Commit**

```bash
cd apps/demo_server && mix format
git add apps/demo_server/test/support/channel_case.ex apps/demo_server/test/demo_server_web/rate_limit_test.exs
git commit -m "test(demo_server): a flood is bounded and the room keeps serving everyone else"
```

---

### Task 5: Document the limiter

**Files:**
- Modify: `README.md` — the "What is in the box" server list
- Modify: `docs/ARCHITECTURE.md` — after "Two authority modes"

- [ ] **Step 1: Add the README bullet**

In `README.md`, under **Server** in "What is in the box", after the pluggable authority backend bullet:

```markdown
- Per-peer rate limiting, weighted by what each opcode actually costs the room
```

- [ ] **Step 2: Add the architecture section**

In `docs/ARCHITECTURE.md`, after the "Two authority modes" section:

```markdown
### One peer cannot cost the room everything

Frames reach a room through a synchronous `GenServer.call`, so all 80 peers are
serialised through one process. A peer sending faster than the room can serve
therefore does not merely queue behind itself — it expires the calls of
everyone else. Validation alone does not help: the frames may each be perfectly
legal.

Each socket holds a token bucket, and a frame is charged before it reaches the
room. The charge is weighted by what the opcode costs: a relayed transform is
1, an ownership request that arbitrates and broadcasts to the room is 10, a
16 KiB signal is 17. Malformed traffic costs 10 — the check runs before
dispatch, so garbage has not been rejected yet, and billing it cheaply would
make garbage the cheapest flood to build.

Over-budget frames are dropped silently. There is no rejection frame: an honest
peer never reaches the limit, and a reply would hand an attacker an oracle for
calibrating a flood to sit just underneath it.

This bounds what *one* peer costs. It does not bound 80 honest peers at 120 Hz
against a single process — that is a capacity question, not an adversary one.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/ARCHITECTURE.md
git commit -m "docs: per-peer rate limiting"
```
