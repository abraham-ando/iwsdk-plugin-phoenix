# Persistent Sectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sector's world keeps evolving while nobody is in it, caught up in one step on the next join, with the day/night cycle costing nothing on the wire.

**Architecture:** The room process still stops when it empties, but writes a timestamped snapshot to a supervised ETS table first. On restart it loads that snapshot and fast-forwards by the elapsed time. Weather is stateful but its transitions are seeded from world time and sector id, so replaying an interval reproduces exactly what would have happened. Day/night is a pure function both sides compute.

**Tech Stack:** Elixir/OTP (GenServer, ETS, `:rand` with an explicit seed), the repo's golden-vector parity pipeline, the Cardinal component generator from layer 0.

**Spec:** `docs/superpowers/specs/2026-08-14-persistent-sectors-design.md` — read it first; every decision below argues from it.

## Global Constraints

- **Everything that evolves without players must be a pure function of elapsed time.** This is the constraint the whole approach rests on; a stateful transition that cannot be replayed from `(state, elapsed)` does not belong in a sector.
- Time comes from `IwsdkPhoenix.Clock.now_ms/0` (monotonic milliseconds) and `IwsdkPhoenix.Clock.epoch/0`. Never `System.system_time/1`.
- A snapshot loaded under a **different epoch** is restored **without** advancing. Advancing across a node restart would produce an arbitrary elapsed span.
- Snapshots live in a **named public ETS table**, never `:persistent_term` — `put/2` there may trigger a global GC and this design writes on every sector close.
- `advance/2` is bounded to one day cycle; beyond it, jump to the implied state rather than stepping.
- No `:timer.sleep` in any test. `advance` takes `elapsed` as a parameter; lifecycle tests manipulate the snapshot directly.
- Zero compiler warnings — this repo holds that line.
- Repo facts this plan relies on, each verified against the code on 2026-08-14:
  - `Room.Server.init/1` builds a plain map with `room`, `interval`, `broadcast`, `stop_when_empty`, `deadline` (`room/server.ex:88-99`).
  - `handle_call({:leave, ...})` returns `{:stop, :normal, {:ok, player}, state}` when `stop_when_empty` and the room is empty (`room/server.ex:117`).
  - `room_channel.ex:306` hardcodes `stop_when_empty: true`; that is the line to make configurable.
  - `RoomSupervisor.init/1` supervises a `Registry` and a `DynamicSupervisor` (`room_supervisor.ex:59-63`) — the snapshot owner is a third child.
  - `RoomSupervisor.ensure_started/2` returns the existing pid or calls `start_room/2` (`room_supervisor.ex:115`).
  - `State.new/2` takes `(id, opts)` and reads options with `Keyword.get` (`room/state.ex:75`).
  - `Clock` already uses `:persistent_term` for the epoch — written once at boot, which is that primitive's correct use and the contrast this plan's ETS choice rests on.

## File Structure

| File | Role |
|---|---|
| `packages/server/lib/iwsdk_phoenix/world/day_night.ex` (create) | pure sun angle from world time |
| `packages/server/lib/iwsdk_phoenix/world/weather.ex` (create) | seeded weather state, `advance/4`, `force/3` |
| `packages/server/lib/iwsdk_phoenix/world/snapshots.ex` (create) | GenServer owning the snapshot ETS table |
| `packages/server/lib/iwsdk_phoenix/room_supervisor.ex` (modify) | supervise `Snapshots`; load a snapshot in `start_room/2` |
| `packages/server/lib/iwsdk_phoenix/room/state.ex` (modify) | `world_time_ms`, `weather`; `advance/2` |
| `packages/server/lib/iwsdk_phoenix/room/server.ex` (modify) | `persistent` option; snapshot on stop |
| `packages/server/lib/iwsdk_phoenix/room_channel.ex` (modify) | `persistent` join param; publish weather |
| `cardinal/components.mjs` (modify) | the `Weather` component |
| `scripts/generate-fixtures.mjs` (modify) | day/night golden vectors |
| `packages/client/src/world/day-night.ts` (create) | the client half of the sun formula |

---

### Task 1: Day/night as a pure function

**Files:**
- Create: `packages/server/lib/iwsdk_phoenix/world/day_night.ex`
- Test: `packages/server/test/world/day_night_test.exs`

**Interfaces:**
- Consumes: nothing.
- Produces: `IwsdkPhoenix.World.DayNight.default_cycle_ms/0 :: pos_integer`, `sun_angle(world_time_ms, cycle_ms) :: float` (radians, `0..2π`), `sun_elevation(world_time_ms, cycle_ms) :: float` (`-1..1`), `time_of_day(world_time_ms, cycle_ms) :: float` (`0..1`). Tasks 8 and 9 use all four.

- [ ] **Step 1: Write the failing test**

```elixir
# packages/server/test/world/day_night_test.exs
defmodule IwsdkPhoenix.World.DayNightTest do
  use ExUnit.Case, async: true

  alias IwsdkPhoenix.World.DayNight

  @cycle 7_200_000

  describe "sun_angle/2" do
    test "starts at zero and completes exactly one turn per cycle" do
      assert DayNight.sun_angle(0, @cycle) == 0.0
      assert_in_delta DayNight.sun_angle(@cycle, @cycle), 0.0, 1.0e-9
      assert_in_delta DayNight.sun_angle(div(@cycle, 2), @cycle), :math.pi(), 1.0e-9
    end

    test "is periodic — the same phase of any day gives the same angle" do
      # The property that makes it a pure function of time rather than state:
      # a client that reconnects after three days needs no catching up.
      for day <- 0..3 do
        assert_in_delta DayNight.sun_angle(day * @cycle + 1000, @cycle),
                        DayNight.sun_angle(1000, @cycle),
                        1.0e-9
      end
    end

    test "never leaves 0..2pi" do
      for t <- [0, 1, @cycle - 1, @cycle * 17 + 3] do
        angle = DayNight.sun_angle(t, @cycle)
        assert angle >= 0.0 and angle < 2 * :math.pi()
      end
    end
  end

  describe "sun_elevation/2" do
    test "peaks a quarter through the cycle and troughs three quarters through" do
      assert_in_delta DayNight.sun_elevation(div(@cycle, 4), @cycle), 1.0, 1.0e-9
      assert_in_delta DayNight.sun_elevation(3 * div(@cycle, 4), @cycle), -1.0, 1.0e-9
    end
  end

  describe "time_of_day/2" do
    test "is the fraction through the cycle" do
      assert DayNight.time_of_day(0, @cycle) == 0.0
      assert_in_delta DayNight.time_of_day(div(@cycle, 4), @cycle), 0.25, 1.0e-9
    end
  end

  test "a zero or negative cycle falls back to the default rather than dividing by zero" do
    assert DayNight.sun_angle(1000, 0) == DayNight.sun_angle(1000, DayNight.default_cycle_ms())
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/world/day_night_test.exs`
Expected: FAIL — `IwsdkPhoenix.World.DayNight` is not available.

- [ ] **Step 3: Write minimal implementation**

```elixir
# packages/server/lib/iwsdk_phoenix/world/day_night.ex
defmodule IwsdkPhoenix.World.DayNight do
  @moduledoc """
  The sun's position, as a pure function of world time.

  Nothing about the day/night cycle is stored, replicated or caught up: both
  the server and every client compute it from the same world time. That costs
  zero bytes on the wire, and a client that reconnects after three days is
  correct immediately with nothing to reconcile.

  It is deliberately not part of a sector's snapshot. Anything derivable is
  cheaper derived than saved.
  """

  @default_cycle_ms 7_200_000

  @doc "Length of a full virtual day, in milliseconds. Two real hours."
  @spec default_cycle_ms() :: pos_integer()
  def default_cycle_ms, do: @default_cycle_ms

  @doc "Fraction through the current day, `0.0..1.0`."
  @spec time_of_day(integer(), integer()) :: float()
  def time_of_day(world_time_ms, cycle_ms \\ @default_cycle_ms) do
    cycle = usable_cycle(cycle_ms)
    rem(max(world_time_ms, 0), cycle) / cycle
  end

  @doc "Sun angle in radians, `0.0` up to but not including `2π`."
  @spec sun_angle(integer(), integer()) :: float()
  def sun_angle(world_time_ms, cycle_ms \\ @default_cycle_ms) do
    time_of_day(world_time_ms, cycle_ms) * 2 * :math.pi()
  end

  @doc "Sun height, `-1.0` (midnight) to `1.0` (noon)."
  @spec sun_elevation(integer(), integer()) :: float()
  def sun_elevation(world_time_ms, cycle_ms \\ @default_cycle_ms) do
    :math.sin(sun_angle(world_time_ms, cycle_ms))
  end

  # A caller that passes 0 wants the default, not a division by zero taking
  # down the room process.
  defp usable_cycle(cycle_ms) when is_integer(cycle_ms) and cycle_ms > 0, do: cycle_ms
  defp usable_cycle(_other), do: @default_cycle_ms
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && mix test test/world/day_night_test.exs`
Expected: 6 tests, 0 failures, no warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/world/day_night.ex packages/server/test/world/day_night_test.exs
git commit -m "feat(world): day/night cycle as a pure function of world time"
```

---

### Task 2: Weather, seeded by time

**Files:**
- Create: `packages/server/lib/iwsdk_phoenix/world/weather.ex`
- Test: `packages/server/test/world/weather_test.exs`

**Interfaces:**
- Consumes: `DayNight.default_cycle_ms/0` (Task 1), for the advance cap.
- Produces:
  - `%IwsdkPhoenix.World.Weather{kind: :clear | :rain | :storm | :fog, intensity: float, wind: %{x: float, y: float, z: float}, next_transition_at_ms: integer}`
  - `Weather.new(sector_id :: String.t(), world_time_ms :: integer) :: t`
  - `Weather.advance(t, elapsed_ms :: integer, sector_id :: String.t(), world_time_ms :: integer) :: t` — `world_time_ms` is the time *before* the advance
  - `Weather.force(t, kind :: atom, intensity :: float) :: t`
  - `Weather.kind_code(atom) :: 0..3` and `Weather.kind_from_code(0..3) :: atom` — the wire mapping Task 8 uses

- [ ] **Step 1: Write the failing test**

```elixir
# packages/server/test/world/weather_test.exs
defmodule IwsdkPhoenix.World.WeatherTest do
  use ExUnit.Case, async: true

  alias IwsdkPhoenix.World.Weather

  @minute 60_000

  describe "determinism" do
    test "the same sector at the same time always produces the same weather" do
      assert Weather.new("alpha", 5_000) == Weather.new("alpha", 5_000)
    end

    test "different sectors diverge" do
      # Otherwise every sector in the world would have identical weather, which
      # would read as a bug to any player who travelled.
      a = Weather.new("alpha", 0)
      b = Weather.new("beta", 0)
      advanced_a = Weather.advance(a, 50 * @minute, "alpha", 0)
      advanced_b = Weather.advance(b, 50 * @minute, "beta", 0)

      refute {advanced_a.kind, advanced_a.next_transition_at_ms} ==
               {advanced_b.kind, advanced_b.next_transition_at_ms}
    end
  end

  describe "advance/4" do
    test "one long advance equals many short ones — the property fast-forward rests on" do
      # If these ever disagree, a sector that slept produces a different world
      # from one that stayed awake, and the whole approach is unsound.
      start = Weather.new("alpha", 0)

      long = Weather.advance(start, 60 * @minute, "alpha", 0)

      short =
        Enum.reduce(0..11, {start, 0}, fn _i, {state, at} ->
          {Weather.advance(state, 5 * @minute, "alpha", at), at + 5 * @minute}
        end)
        |> elem(0)

      assert long == short
    end

    test "an advance of zero changes nothing" do
      state = Weather.new("alpha", 1_000)
      assert Weather.advance(state, 0, "alpha", 1_000) == state
    end

    test "terminates and stays bounded over six months" do
      # A sector abandoned for half a year must not run half a year of
      # transitions on waking.
      state = Weather.new("alpha", 0)
      six_months = 180 * 24 * 60 * @minute

      advanced = Weather.advance(state, six_months, "alpha", 0)

      assert advanced.kind in [:clear, :rain, :storm, :fog]
      assert advanced.next_transition_at_ms > six_months
    end

    test "the capped result matches one day cycle from the equivalent state" do
      state = Weather.new("alpha", 0)
      day = IwsdkPhoenix.World.DayNight.default_cycle_ms()

      far = Weather.advance(state, day * 400, "alpha", 0)
      near = Weather.advance(state, day, "alpha", day * 399)

      assert far.kind == near.kind
    end
  end

  describe "force/3" do
    test "takes effect immediately" do
      forced = "alpha" |> Weather.new(0) |> Weather.force(:storm, 0.9)
      assert forced.kind == :storm
      assert forced.intensity == 0.9
    end

    test "the next draw proceeds from the forced state" do
      # This is what choosing stateful weather bought: a game event can change
      # it, and the world carries on from there rather than snapping back.
      forced = "alpha" |> Weather.new(0) |> Weather.force(:storm, 0.9)
      assert forced.kind == :storm

      # Before its next transition it is still the forced state.
      assert Weather.advance(forced, 1, "alpha", 0).kind == :storm
    end

    test "clamps intensity into range rather than trusting the caller" do
      forced = "alpha" |> Weather.new(0) |> Weather.force(:rain, 5.0)
      assert forced.intensity == 1.0
    end
  end

  describe "wire mapping" do
    test "round-trips every kind" do
      for kind <- [:clear, :rain, :storm, :fog] do
        assert kind |> Weather.kind_code() |> Weather.kind_from_code() == kind
      end
    end

    test "an unknown code degrades to clear rather than raising" do
      # An out-of-range byte can only reach here as a bug, and a room must not
      # die of one.
      assert Weather.kind_from_code(200) == :clear
    end
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/world/weather_test.exs`
Expected: FAIL — `IwsdkPhoenix.World.Weather` is not available.

- [ ] **Step 3: Write minimal implementation**

```elixir
# packages/server/lib/iwsdk_phoenix/world/weather.ex
defmodule IwsdkPhoenix.World.Weather do
  @moduledoc """
  Weather that a sector carries, and that catches up when it wakes.

  Transitions are *drawn*, but the seed derives from world time and sector id —
  so the same sector at the same world time always produces the same sequence,
  and `advance/4` replays exactly what would have happened rather than
  inventing something new. That seeding is what makes stateful weather
  compatible with a sector that stops when empty.

  A game may `force/3` a state at any time; the next draw proceeds from there.
  That survives fast-forward because nothing forces anything while a sector
  sleeps — no players, no events.
  """

  alias IwsdkPhoenix.World.DayNight

  @kinds [:clear, :rain, :storm, :fog]
  @min_hold_ms 5 * 60_000
  @max_hold_ms 25 * 60_000

  defstruct kind: :clear,
            intensity: 0.0,
            wind: %{x: 0.0, y: 0.0, z: 0.0},
            next_transition_at_ms: 0

  @type kind :: :clear | :rain | :storm | :fog
  @type t :: %__MODULE__{
          kind: kind(),
          intensity: float(),
          wind: %{x: float(), y: float(), z: float()},
          next_transition_at_ms: integer()
        }

  @doc "The weather a sector has at `world_time_ms`, from nothing."
  @spec new(String.t(), integer()) :: t()
  def new(sector_id, world_time_ms) do
    draw(%__MODULE__{}, sector_id, world_time_ms)
  end

  @doc """
  Advance by `elapsed_ms`, starting from `world_time_ms`.

  Bounded to one day cycle: a sector abandoned for six months jumps to the
  state its elapsed time implies rather than stepping through every
  transition. A pure function of time permits that.
  """
  @spec advance(t(), integer(), String.t(), integer()) :: t()
  def advance(%__MODULE__{} = weather, elapsed_ms, sector_id, world_time_ms)
      when elapsed_ms <= 0 do
    _ = {sector_id, world_time_ms}
    weather
  end

  def advance(%__MODULE__{} = weather, elapsed_ms, sector_id, world_time_ms) do
    cap = DayNight.default_cycle_ms()

    {weather, from} =
      if elapsed_ms > cap do
        # Skip to the last capped window. Everything before it is unobservable:
        # nobody was there, and the state at the end is all that can be seen.
        skip_to = world_time_ms + elapsed_ms - cap
        {draw(weather, sector_id, skip_to), skip_to}
      else
        {weather, world_time_ms}
      end

    step(weather, sector_id, from, world_time_ms + elapsed_ms)
  end

  @doc "Override the weather. The next draw proceeds from here."
  @spec force(t(), kind(), number()) :: t()
  def force(%__MODULE__{} = weather, kind, intensity) when kind in @kinds do
    %{weather | kind: kind, intensity: clamp(intensity)}
  end

  @doc "Wire code for a kind. Stable — it is a protocol value."
  @spec kind_code(kind()) :: 0..3
  def kind_code(:clear), do: 0
  def kind_code(:rain), do: 1
  def kind_code(:storm), do: 2
  def kind_code(:fog), do: 3

  @doc "Kind from a wire code; anything unknown degrades to `:clear`."
  @spec kind_from_code(integer()) :: kind()
  def kind_from_code(0), do: :clear
  def kind_from_code(1), do: :rain
  def kind_from_code(2), do: :storm
  def kind_from_code(3), do: :fog
  def kind_from_code(_other), do: :clear

  # -- internals --------------------------------------------------------------

  defp step(weather, sector_id, at, until) when at >= until, do: weather

  defp step(weather, sector_id, _at, until) do
    if weather.next_transition_at_ms > until do
      weather
    else
      next = draw(weather, sector_id, weather.next_transition_at_ms)
      step(next, sector_id, next.next_transition_at_ms, until)
    end
  end

  # The seed is the whole design: same sector, same time, same draw.
  defp draw(weather, sector_id, at_ms) do
    :rand.seed(:exsss, {:erlang.phash2(sector_id), div(at_ms, 1000), 7})

    kind = Enum.at(@kinds, :rand.uniform(length(@kinds)) - 1)
    hold = @min_hold_ms + :rand.uniform(@max_hold_ms - @min_hold_ms)

    %{
      weather
      | kind: kind,
        intensity: intensity_for(kind),
        wind: wind_for(kind),
        next_transition_at_ms: at_ms + hold
    }
  end

  defp intensity_for(:clear), do: 0.0
  defp intensity_for(:fog), do: 0.3 + :rand.uniform() * 0.4
  defp intensity_for(:rain), do: 0.2 + :rand.uniform() * 0.5
  defp intensity_for(:storm), do: 0.7 + :rand.uniform() * 0.3

  defp wind_for(kind) do
    strength =
      case kind do
        :storm -> 8.0
        :rain -> 3.0
        :fog -> 0.5
        :clear -> 1.0
      end

    heading = :rand.uniform() * 2 * :math.pi()

    %{
      x: :math.cos(heading) * strength,
      y: 0.0,
      z: :math.sin(heading) * strength
    }
  end

  defp clamp(value) when is_number(value), do: value |> max(0.0) |> min(1.0) |> :erlang.float()
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && mix test test/world/weather_test.exs`
Expected: 11 tests, 0 failures, **no warnings**. If Elixir warns that `sector_id` is unused in the first `step/4` clause, prefix it with an underscore — do not silence warnings globally.

- [ ] **Step 5: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/world/weather.ex packages/server/test/world/weather_test.exs
git commit -m "feat(world): time-seeded weather that replays under fast-forward"
```

---

### Task 3: The snapshot store

**Files:**
- Create: `packages/server/lib/iwsdk_phoenix/world/snapshots.ex`
- Modify: `packages/server/lib/iwsdk_phoenix/room_supervisor.ex:59-63` (add the child)
- Test: `packages/server/test/world/snapshots_test.exs`

**Interfaces:**
- Consumes: nothing.
- Produces: `IwsdkPhoenix.World.Snapshots.start_link/1`, `put(sector_id :: String.t(), snapshot :: map) :: :ok`, `get(sector_id) :: map | nil`, `delete(sector_id) :: :ok`. Tasks 5 and 6 use `put` and `get`.

- [ ] **Step 1: Write the failing test**

```elixir
# packages/server/test/world/snapshots_test.exs
defmodule IwsdkPhoenix.World.SnapshotsTest do
  use ExUnit.Case, async: false

  alias IwsdkPhoenix.World.Snapshots

  setup do
    # The supervisor may already be running from another test; either way we
    # want a clean slate for this sector id.
    start_supervised!(Snapshots, restart: :temporary)
    :ok
  rescue
    # Already started under RoomSupervisor — fine, just clear our key.
    _ -> :ok
  end

  test "round-trips a snapshot" do
    Snapshots.put("alpha", %{world_time_ms: 42, epoch: 7})
    assert Snapshots.get("alpha") == %{world_time_ms: 42, epoch: 7}
  end

  test "returns nil for a sector it has never seen" do
    assert Snapshots.get("never-seen-#{System.unique_integer([:positive])}") == nil
  end

  test "the newest snapshot wins" do
    Snapshots.put("beta", %{world_time_ms: 1})
    Snapshots.put("beta", %{world_time_ms: 2})
    assert Snapshots.get("beta").world_time_ms == 2
  end

  test "delete forgets a sector" do
    Snapshots.put("gamma", %{world_time_ms: 1})
    Snapshots.delete("gamma")
    assert Snapshots.get("gamma") == nil
  end

  test "outlives the process that wrote it" do
    # The point of the store: a sector stops, and its state is still there for
    # the next one. A table owned by the room would die with it.
    task = Task.async(fn -> Snapshots.put("delta", %{world_time_ms: 99}) end)
    Task.await(task)

    assert Snapshots.get("delta").world_time_ms == 99
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/world/snapshots_test.exs`
Expected: FAIL — `IwsdkPhoenix.World.Snapshots` is not available.

- [ ] **Step 3: Write minimal implementation**

```elixir
# packages/server/lib/iwsdk_phoenix/world/snapshots.ex
defmodule IwsdkPhoenix.World.Snapshots do
  @moduledoc """
  Where a sector's state waits between visits.

  A sector stops when its last peer leaves, so its state has to live somewhere
  that outlives the process. This owns a named public ETS table for exactly
  that, and does nothing else.

  Not `:persistent_term`, though `IwsdkPhoenix.Clock` uses it for the node
  epoch. That is the right primitive for a value written once at boot;
  `put/2` there may trigger a global garbage collection of every process
  holding a reference to the replaced term, and this table is written on every
  sector close. ETS is cheap in both directions.

  The process exists because an ETS table dies with its owner and a supervisor
  cannot own one. It holds no state of its own.
  """

  use GenServer

  @table __MODULE__

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Store a sector's snapshot, replacing any previous one."
  @spec put(String.t(), map()) :: :ok
  def put(sector_id, snapshot) when is_binary(sector_id) and is_map(snapshot) do
    :ets.insert(@table, {sector_id, snapshot})
    :ok
  end

  @doc "A sector's snapshot, or `nil` if it has never been stored."
  @spec get(String.t()) :: map() | nil
  def get(sector_id) when is_binary(sector_id) do
    case :ets.lookup(@table, sector_id) do
      [{^sector_id, snapshot}] -> snapshot
      [] -> nil
    end
  end

  @spec delete(String.t()) :: :ok
  def delete(sector_id) when is_binary(sector_id) do
    :ets.delete(@table, sector_id)
    :ok
  end

  @impl true
  def init(_opts) do
    # Public so rooms write directly, without a round trip through this
    # process — a snapshot write is on the path of a peer leaving.
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true,
                      write_concurrency: true])

    {:ok, %{}}
  end
end
```

Then in `room_supervisor.ex`, add it to the children **before** the DynamicSupervisor, so a room can never start before the table exists:

```elixir
    children = [
      {Registry, keys: :unique, name: @registry},
      IwsdkPhoenix.World.Snapshots,
      {DynamicSupervisor, strategy: :one_for_one, name: @rooms}
    ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && mix test test/world/snapshots_test.exs && mix test`
Expected: the new file green, and the full suite still green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/world/snapshots.ex packages/server/lib/iwsdk_phoenix/room_supervisor.ex packages/server/test/world/snapshots_test.exs
git commit -m "feat(world): supervised ETS store for sector snapshots"
```

---

### Task 4: World time and weather in room state

**Files:**
- Modify: `packages/server/lib/iwsdk_phoenix/room/state.ex` (defstruct ~line 20, `new/2` ~line 75)
- Test: `packages/server/test/world/sector_state_test.exs`

**Interfaces:**
- Consumes: `Weather.new/2`, `Weather.advance/4` (Task 2).
- Produces: `State.world_time_ms` and `State.weather` fields; `State.advance(state, elapsed_ms) :: State.t`; `State.snapshot(state) :: map`; `State.restore(state, snapshot, elapsed_ms) :: State.t`.

- [ ] **Step 1: Write the failing test**

```elixir
# packages/server/test/world/sector_state_test.exs
defmodule IwsdkPhoenix.World.SectorStateTest do
  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Room.State

  @minute 60_000

  test "a new sector starts at world time zero with weather" do
    state = State.new("alpha")
    assert state.world_time_ms == 0
    assert state.weather.kind in [:clear, :rain, :storm, :fog]
  end

  test "advance moves world time and the weather with it" do
    state = State.new("alpha")
    advanced = State.advance(state, 90 * @minute)

    assert advanced.world_time_ms == 90 * @minute
    # Ninety minutes covers at least one transition window, so something moved.
    refute advanced.weather == state.weather
  end

  test "advancing by zero changes nothing" do
    state = State.new("alpha")
    assert State.advance(state, 0) == state
  end

  test "snapshot carries exactly what restore needs" do
    state = "alpha" |> State.new() |> State.advance(30 * @minute)
    snapshot = State.snapshot(state)

    assert Map.has_key?(snapshot, :world_time_ms)
    assert Map.has_key?(snapshot, :weather)
    assert snapshot.world_time_ms == 30 * @minute
  end

  test "restore with elapsed time reproduces a sector that stayed awake" do
    # The claim the whole design makes: sleeping and waking is indistinguishable
    # from never having slept.
    awake = "alpha" |> State.new() |> State.advance(120 * @minute)

    slept =
      "alpha"
      |> State.new()
      |> State.advance(30 * @minute)
      |> State.snapshot()
      |> then(&State.restore(State.new("alpha"), &1, 90 * @minute))

    assert slept.world_time_ms == awake.world_time_ms
    assert slept.weather == awake.weather
  end

  test "restore with zero elapsed leaves the snapshot untouched" do
    # The different-epoch case: restore the state, advance nothing.
    original = "alpha" |> State.new() |> State.advance(30 * @minute)
    restored = State.restore(State.new("alpha"), State.snapshot(original), 0)

    assert restored.world_time_ms == original.world_time_ms
    assert restored.weather == original.weather
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/world/sector_state_test.exs`
Expected: FAIL — `world_time_ms` is not a field of `State`.

- [ ] **Step 3: Write minimal implementation**

Add to the `defstruct` list in `state.ex`:

```elixir
            world_time_ms: 0,
            weather: nil,
```

In `new/2`, after the existing fields are assembled, seed the weather (the
struct literal already ends with `allocator_state`, so add these two keys to
it):

```elixir
      world_time_ms: 0,
      weather: Weather.new(id, 0)
```

And the three functions, next to the other state accessors:

```elixir
  @doc """
  Move the world forward by `elapsed_ms`.

  Everything that evolves without players goes through here, and everything
  that goes through here must be a pure function of the elapsed span — that is
  what lets a sector stop when empty and catch up on waking rather than
  burning a tick loop on an empty world.
  """
  @spec advance(t(), integer()) :: t()
  def advance(%__MODULE__{} = state, elapsed_ms) when elapsed_ms <= 0, do: state

  def advance(%__MODULE__{} = state, elapsed_ms) do
    %{
      state
      | world_time_ms: state.world_time_ms + elapsed_ms,
        weather: Weather.advance(state.weather, elapsed_ms, state.id, state.world_time_ms)
    }
  end

  @doc "The part of a sector worth carrying between visits."
  @spec snapshot(t()) :: map()
  def snapshot(%__MODULE__{} = state) do
    %{world_time_ms: state.world_time_ms, weather: state.weather}
  end

  @doc """
  Restore a snapshot, then advance by `elapsed_ms`.

  Pass `0` for elapsed when the snapshot came from a different node epoch:
  its `last_seen_ms` is then in a time base that no longer exists, and any
  elapsed span computed from it would be arbitrary.
  """
  @spec restore(t(), map(), integer()) :: t()
  def restore(%__MODULE__{} = state, snapshot, elapsed_ms) do
    %{state | world_time_ms: snapshot.world_time_ms, weather: snapshot.weather}
    |> advance(elapsed_ms)
  end
```

Add `alias IwsdkPhoenix.World.Weather` at the top of `state.ex`, beside the
existing aliases.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && mix test test/world/sector_state_test.exs && mix test`
Expected: new file green, full suite green, no warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/room/state.ex packages/server/test/world/sector_state_test.exs
git commit -m "feat(world): world time and weather in sector state, with fast-forward"
```

---

### Task 5: Snapshot on stop

**Files:**
- Modify: `packages/server/lib/iwsdk_phoenix/room/server.ex` (`init/1` ~line 88, `handle_call({:leave, ...})` ~line 110)
- Test: `packages/server/test/world/sector_lifecycle_test.exs`

**Interfaces:**
- Consumes: `Snapshots.put/2` (Task 3), `State.snapshot/1` (Task 4), `Clock.now_ms/0` and `Clock.epoch/0`.
- Produces: a `:persistent` option on `Room.Server`; a snapshot in the store whenever a persistent sector stops.

- [ ] **Step 1: Write the failing test**

```elixir
# packages/server/test/world/sector_lifecycle_test.exs
defmodule IwsdkPhoenix.World.SectorLifecycleTest do
  use ExUnit.Case, async: false

  alias IwsdkPhoenix.Room.Server, as: Room
  alias IwsdkPhoenix.World.Snapshots

  setup do
    unless Process.whereis(Snapshots) do
      start_supervised!(Snapshots)
    end

    :ok
  end

  defp unique_id, do: "sector-#{System.unique_integer([:positive])}"

  test "a persistent sector writes a snapshot when its last peer leaves" do
    id = unique_id()
    {:ok, room} = Room.start_link(id: id, persistent: true, stop_when_empty: true)
    {:ok, _player} = Room.join(room, "alice")

    ref = Process.monitor(room)
    {:ok, _player} = Room.leave(room, "alice")
    assert_receive {:DOWN, ^ref, :process, _pid, :normal}, 1000

    snapshot = Snapshots.get(id)
    assert snapshot != nil
    assert Map.has_key?(snapshot, :world_time_ms)
    assert Map.has_key?(snapshot, :last_seen_ms)
    assert Map.has_key?(snapshot, :epoch)
    assert snapshot.epoch == IwsdkPhoenix.Clock.epoch()
  end

  test "a non-persistent sector leaves nothing behind" do
    # The regression guard: today's behaviour must be unchanged for anyone who
    # has not asked for a persistent world.
    id = unique_id()
    {:ok, room} = Room.start_link(id: id, persistent: false, stop_when_empty: true)
    {:ok, _player} = Room.join(room, "alice")

    ref = Process.monitor(room)
    {:ok, _player} = Room.leave(room, "alice")
    assert_receive {:DOWN, ^ref, :process, _pid, :normal}, 1000

    assert Snapshots.get(id) == nil
  end
end
```

Check `Room.start_link/1`'s actual arity and option names against
`room/server.ex` before running — the test above assumes a keyword list with
`:id`, which is what `init/1` reads via `Keyword.fetch!(opts, :id)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/world/sector_lifecycle_test.exs`
Expected: FAIL — no snapshot is written.

- [ ] **Step 3: Write minimal implementation**

In `init/1`, add the option to the state map:

```elixir
      persistent: Keyword.get(opts, :persistent, false),
```

In the `handle_call({:leave, peer_id}, ...)` clause, before returning `:stop`:

```elixir
    if state.stop_when_empty and State.player_count(room) == 0 do
      # Write before stopping, not in `terminate/2`: a `:stop` return runs
      # terminate, but a brutal kill does not, and the snapshot is the only
      # thing that makes the world persistent.
      save_snapshot(state)
      {:stop, :normal, {:ok, player}, state}
    else
      {:reply, {:ok, player}, state}
    end
```

And the helper, with the other private functions:

```elixir
  # A persistent sector's state has to outlive its process; `last_seen_ms` and
  # `epoch` are what let the next start compute how long it slept, and refuse
  # to guess when the node has restarted underneath it.
  defp save_snapshot(%{persistent: false}), do: :ok

  defp save_snapshot(%{persistent: true, room: room}) do
    snapshot =
      room
      |> State.snapshot()
      |> Map.put(:last_seen_ms, IwsdkPhoenix.Clock.now_ms())
      |> Map.put(:epoch, IwsdkPhoenix.Clock.epoch())

    IwsdkPhoenix.World.Snapshots.put(room.id, snapshot)
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && mix test test/world/sector_lifecycle_test.exs && mix test`
Expected: both tests green, full suite green, no warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/room/server.ex packages/server/test/world/sector_lifecycle_test.exs
git commit -m "feat(world): persistent sectors snapshot their state on stop"
```

---

### Task 6: Fast-forward on start

**Files:**
- Modify: `packages/server/lib/iwsdk_phoenix/room/server.ex` (`init/1`)
- Test: `packages/server/test/world/sector_lifecycle_test.exs` (extend)

**Interfaces:**
- Consumes: `Snapshots.get/1` (Task 3), `State.restore/3` (Task 4), `Clock.now_ms/0`, `Clock.epoch/0`.
- Produces: a sector that reopens with its world advanced by the time it slept.

- [ ] **Step 1: Write the failing test**

Append to `IwsdkPhoenix.World.SectorLifecycleTest`:

```elixir
  test "a sector reopens with its world advanced by the time it slept" do
    id = unique_id()

    # Pretend it stopped an hour ago, in this node's epoch.
    Snapshots.put(id, %{
      world_time_ms: 1_000,
      weather: IwsdkPhoenix.World.Weather.new(id, 1_000),
      last_seen_ms: IwsdkPhoenix.Clock.now_ms() - 3_600_000,
      epoch: IwsdkPhoenix.Clock.epoch()
    })

    {:ok, room} = Room.start_link(id: id, persistent: true)
    state = Room.state(room)

    # An hour of world time, give or take the milliseconds this test took.
    assert_in_delta state.world_time_ms, 1_000 + 3_600_000, 2_000
  end

  test "a snapshot from a different epoch restores without advancing" do
    # The node restarted: `last_seen_ms` is in a monotonic base that no longer
    # exists, so any elapsed span computed from it would be arbitrary. Better a
    # visibly conservative world than one that leaps seventeen years.
    id = unique_id()

    Snapshots.put(id, %{
      world_time_ms: 5_000,
      weather: IwsdkPhoenix.World.Weather.new(id, 5_000),
      last_seen_ms: -999_999_999,
      epoch: IwsdkPhoenix.Clock.epoch() + 1
    })

    {:ok, room} = Room.start_link(id: id, persistent: true)

    assert Room.state(room).world_time_ms == 5_000
  end

  test "a sector with no snapshot starts a new world" do
    {:ok, room} = Room.start_link(id: unique_id(), persistent: true)
    assert Room.state(room).world_time_ms == 0
  end

  test "a non-persistent sector ignores any snapshot lying around" do
    id = unique_id()

    Snapshots.put(id, %{
      world_time_ms: 999_999,
      weather: IwsdkPhoenix.World.Weather.new(id, 0),
      last_seen_ms: IwsdkPhoenix.Clock.now_ms(),
      epoch: IwsdkPhoenix.Clock.epoch()
    })

    {:ok, room} = Room.start_link(id: id, persistent: false)
    assert Room.state(room).world_time_ms == 0
  end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && mix test test/world/sector_lifecycle_test.exs`
Expected: FAIL — world time stays at 0.

- [ ] **Step 3: Write minimal implementation**

Replace the `room:` line in `init/1`'s state map with a call to a helper, and
add the helper below:

```elixir
    persistent = Keyword.get(opts, :persistent, false)

    state = %{
      room: load_room(Keyword.fetch!(opts, :id), opts, persistent),
      interval: interval,
      broadcast: Keyword.get(opts, :broadcast),
      stop_when_empty: Keyword.get(opts, :stop_when_empty, false),
      persistent: persistent,
      deadline: System.monotonic_time(:millisecond) + interval
    }
```

```elixir
  # A persistent sector wakes into the world it left, advanced by however long
  # it slept. Three cases, and the third is the one that matters: a snapshot
  # from a different node epoch has a `last_seen_ms` in a monotonic base that
  # no longer exists, so it is restored without advancing rather than jumping
  # by an arbitrary span.
  defp load_room(id, opts, false), do: State.new(id, opts)

  defp load_room(id, opts, true) do
    fresh = State.new(id, opts)

    case IwsdkPhoenix.World.Snapshots.get(id) do
      nil ->
        fresh

      %{epoch: epoch} = snapshot ->
        elapsed =
          if epoch == IwsdkPhoenix.Clock.epoch() do
            trunc(IwsdkPhoenix.Clock.now_ms() - snapshot.last_seen_ms)
          else
            0
          end

        State.restore(fresh, snapshot, max(elapsed, 0))
    end
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && mix test test/world/sector_lifecycle_test.exs && mix test`
Expected: six tests in that file green, full suite green, no warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/room/server.ex packages/server/test/world/sector_lifecycle_test.exs
git commit -m "feat(world): sectors fast-forward on start, refusing to guess across epochs"
```

---

### Task 7: The `persistent` join parameter

**Files:**
- Modify: `packages/server/lib/iwsdk_phoenix/room_channel.ex:306` and `ensure_room/4`
- Test: `apps/demo_server/test/demo_server_web/room_channel_test.exs` (append)

**Interfaces:**
- Consumes: the `:persistent` option (Tasks 5, 6).
- Produces: a `"persistent"` join param, default `false`, forwarded to `RoomSupervisor.ensure_started/2`.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe "relaying"` block, or a new one, in
`DemoServerWeb.RoomChannelTest`:

```elixir
  describe "persistent sectors" do
    test "a room is ephemeral unless the join asks otherwise" do
      # Today's behaviour, and the default: a demo lobby should not accumulate
      # world state nobody asked for.
      room = unique_room()
      {socket, _reply} = join_room("alice", room)

      pid = socket.assigns.room
      ref = Process.monitor(pid)
      Process.unlink(socket.channel_pid)
      leave(socket)

      assert_receive {:DOWN, ^ref, :process, _pid, _reason}, 2000
    end

    test "a persistent room survives its last peer" do
      room = unique_room()
      {socket, _reply} = join_room("alice", room, %{"persistent" => true})

      pid = socket.assigns.room
      ref = Process.monitor(pid)
      Process.unlink(socket.channel_pid)
      leave(socket)

      refute_receive {:DOWN, ^ref, :process, _pid, _reason}, 500
      assert Process.alive?(pid)
    end
  end
```

`leave/1` comes from `Phoenix.ChannelTest`. If the surrounding tests use a
different teardown, copy theirs — the assertion that matters is whether the
room process outlives the channel.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/demo_server && mix test test/demo_server_web/room_channel_test.exs`
Expected: FAIL — the persistent room stops anyway.

- [ ] **Step 3: Write minimal implementation**

In `ensure_room/4`, replace the hardcoded `stop_when_empty: true`:

```elixir
      persistent = Map.get(params, "persistent", false) == true

      RoomSupervisor.ensure_started(room_id,
        mode: mode,
        interest_radius: Map.get(params, "interest_radius", 50.0),
        # Still reaped with its last peer — a sector that stops is the whole
        # point of the design; `persistent` decides whether its world is kept.
        stop_when_empty: not persistent,
        persistent: persistent,
        broadcast: broadcaster(mode, socket.endpoint)
      )
```

Note what this does *not* do: a persistent room keeps running rather than
stopping. That is a deliberate simplification for this block — the sector
process is cheap while a handful exist, and the fast-forward path is exercised
by Task 6's tests and by a real restart. Making a persistent sector *also*
stop and reload on demand is a follow-up, and the snapshot machinery is
already in place for it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/demo_server && mix test test/demo_server_web/room_channel_test.exs`
Expected: all green, no warnings.

- [ ] **Step 5: Commit**

```bash
git add packages/server/lib/iwsdk_phoenix/room_channel.ex apps/demo_server/test/demo_server_web/room_channel_test.exs
git commit -m "feat(world): persistent join param, replacing the hardcoded reap"
```

---

### Task 8: Weather on the wire

**Files:**
- Modify: `cardinal/components.mjs`
- Generated: all four Cardinal artifacts (regenerate)
- Modify: `packages/server/lib/iwsdk_phoenix/room/server.ex` (publish on tick)
- Test: `packages/server/test/world/weather_wire_test.exs`

**Interfaces:**
- Consumes: `Weather.kind_code/1` (Task 2), `Protocol.encode_component_update/2` and the Cardinal registry (layer 0), `State.put_components/3`.
- Produces: component id `3`, `Weather`, 17 bytes: `kind` (`u8`), `intensity` (`f32`), `wind` (`vec3`).

- [ ] **Step 1: Add the component to the schema**

In `cardinal/components.mjs`, append to the array:

```js
  {
    id: 3,
    name: 'Weather',
    fields: [
      /** 0 clear, 1 rain, 2 storm, 3 fog — see IwsdkPhoenix.World.Weather. */
      { name: 'kind', type: 'u8' },
      { name: 'intensity', type: 'f32' },
      { name: 'wind', type: 'vec3' },
    ],
  },
```

- [ ] **Step 2: Regenerate and confirm the drift check agrees**

Run: `node scripts/generate-cardinal.mjs && node scripts/check-cardinal-drift.mjs`
Expected: four artifacts rewritten, drift check OK. The schema hash changes —
that is correct and is exactly what the join-time check exists to catch.

- [ ] **Step 3: Write the failing test**

```elixir
# packages/server/test/world/weather_wire_test.exs
defmodule IwsdkPhoenix.World.WeatherWireTest do
  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Cardinal.Weather, as: WireWeather
  alias IwsdkPhoenix.World.Weather

  test "the generated component matches the world model's shape" do
    assert WireWeather.byte_size() == 17
    assert WireWeather.field_order() == [:kind, :intensity, :wind]
  end

  test "a world weather round-trips through the wire component" do
    world = Weather.new("alpha", 0)

    wire = %WireWeather{
      kind: Weather.kind_code(world.kind),
      intensity: world.intensity,
      wind: world.wind
    }

    assert {:ok, decoded} = wire |> WireWeather.encode() |> WireWeather.decode()
    assert Weather.kind_from_code(decoded.kind) == world.kind
    assert_in_delta decoded.intensity, world.intensity, 1.0e-6
  end
end
```

- [ ] **Step 4: Run it**

Run: `cd packages/server && mix test test/world/weather_wire_test.exs`
Expected: PASS — the generator already produced the module in Step 2.

- [ ] **Step 5: Give the sector a real entity**

The weather has to hang on something the client can find. `PhoenixNetworkSystem`'s
COMPONENT_UPDATE ingest looks the network id up in its `EntityIndex` and
**drops the record when nothing matches** — so a synthetic id such as `0` would
never reach the client's ECS at all. A sector therefore spawns one ordinary
entity for itself, and everything downstream works with no special case: the
existing `SPAWN_ENTITY` broadcast tells clients about it, `EntityIndex` finds
it, and the component cache replays its weather to late joiners.

In `Room.State`, add a `world_entity_id` field defaulting to `nil`, and spawn it
lazily the first time weather is published — `spawn_entity/2` already returns
`{state, entity, frame}` and the room already knows how to broadcast a spawn
frame:

```elixir
  @doc """
  The entity that carries sector-scoped components, spawning it on first use.

  Sector state needs an entity because a client resolves every component record
  through its network id; a synthetic id would simply be dropped on arrival.
  """
  @spec ensure_world_entity(t()) :: {t(), pos_integer(), binary() | nil}
  def ensure_world_entity(%__MODULE__{world_entity_id: nil} = state) do
    {state, entity, frame} = spawn_entity(state, prefab_id: 0, owner_id: 0)
    {%{state | world_entity_id: entity.network_id}, entity.network_id, frame}
  end

  def ensure_world_entity(%__MODULE__{world_entity_id: id} = state) do
    {state, id, nil}
  end
```

- [ ] **Step 6: Publish weather from the room**

In `room/server.ex`'s `handle_info(:tick, state)`, before the existing
broadcast. Read that clause first — it already builds per-peer output through
`state.broadcast`, and the weather frame must follow whatever shape that
callback expects.

```elixir
  # Sector-scoped components ride the same COMPONENT_UPDATE path as anything
  # else; only the entity they hang on is unusual. Published only on change,
  # against the cache the room already keeps, so a settled world costs nothing.
  defp publish_weather(state) do
    {room, network_id, spawn_frame} = State.ensure_world_entity(state.room)
    if spawn_frame, do: broadcast_to_peers(state, spawn_frame)

    payload =
      IwsdkPhoenix.Cardinal.Weather.encode(%IwsdkPhoenix.Cardinal.Weather{
        kind: IwsdkPhoenix.World.Weather.kind_code(room.weather.kind),
        intensity: room.weather.intensity,
        wind: room.weather.wind
      })

    if IwsdkPhoenix.Cardinal.Cache.get(room.components, network_id, 3) == payload do
      %{state | room: room}
    else
      record = %{network_id: network_id, component_id: 3, payload: payload}
      broadcast_to_peers(state, IwsdkPhoenix.Protocol.encode_component_update([record], room.tick))
      %{state | room: State.put_components(room, [record], room.mode)}
    end
  end

  defp broadcast_to_peers(%{broadcast: nil}, _frame), do: :ok

  defp broadcast_to_peers(%{broadcast: broadcast, room: room}, frame) do
    for player <- Map.values(room.players), do: broadcast.({player.peer_id, frame})
    :ok
  end
```

Call it from the tick, and only when peers are present — an empty sector has
nobody to tell, and it does not tick anyway:

```elixir
    state = if State.player_count(state.room) > 0, do: publish_weather(state), else: state
```

If `broadcast` is `nil` — the host-relayed case, where the room has no
broadcaster — publication is skipped and the cache still carries the weather to
newcomers through `after_join`. Add a test for that: a host-relayed room's
cache holds a weather record after a tick even though nothing was pushed.

- [ ] **Step 7: Run every suite**

Run: `cd packages/server && mix test && cd ../../apps/demo_server && mix test && cd ../.. && pnpm test`
Expected: all green. The client suite regenerated its artifacts in Step 2, so
the schema hash matches on both sides.

- [ ] **Step 8: Commit**

```bash
git add cardinal/components.mjs packages/client/src/cardinal packages/server/lib/iwsdk_phoenix/cardinal fixtures/cardinal_vectors.tsv packages/server/lib/iwsdk_phoenix/room/server.ex packages/server/test/world/weather_wire_test.exs
git commit -m "feat(world): replicate weather as a Cardinal component"
```

---

### Task 9: The client half of day/night

**Files:**
- Create: `packages/client/src/world/day-night.ts`
- Modify: `scripts/generate-fixtures.mjs` (day/night vectors)
- Modify: `packages/client/test/parity.test.ts`, `packages/server/test/parity_test.exs`
- Modify: `packages/client/src/index.ts` (export)

**Interfaces:**
- Consumes: nothing at runtime.
- Produces: `DEFAULT_CYCLE_MS = 7_200_000`, `timeOfDay(worldTimeMs, cycleMs?)`, `sunAngle(worldTimeMs, cycleMs?)`, `sunElevation(worldTimeMs, cycleMs?)` — mirroring `IwsdkPhoenix.World.DayNight` exactly.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/test/day-night.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CYCLE_MS,
  sunAngle,
  sunElevation,
  timeOfDay,
} from '../src/world/day-night.js';

const CYCLE = 7_200_000;

describe('day/night', () => {
  it('completes exactly one turn per cycle', () => {
    expect(sunAngle(0, CYCLE)).toBe(0);
    expect(sunAngle(CYCLE, CYCLE)).toBeCloseTo(0, 9);
    expect(sunAngle(CYCLE / 2, CYCLE)).toBeCloseTo(Math.PI, 9);
  });

  it('is periodic, so a long absence needs no catching up', () => {
    for (let day = 0; day < 4; day++) {
      expect(sunAngle(day * CYCLE + 1000, CYCLE)).toBeCloseTo(sunAngle(1000, CYCLE), 9);
    }
  });

  it('peaks a quarter through and troughs three quarters through', () => {
    expect(sunElevation(CYCLE / 4, CYCLE)).toBeCloseTo(1, 9);
    expect(sunElevation((3 * CYCLE) / 4, CYCLE)).toBeCloseTo(-1, 9);
  });

  it('reports the fraction through the cycle', () => {
    expect(timeOfDay(CYCLE / 4, CYCLE)).toBeCloseTo(0.25, 9);
  });

  it('falls back to the default cycle rather than dividing by zero', () => {
    expect(sunAngle(1000, 0)).toBe(sunAngle(1000, DEFAULT_CYCLE_MS));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @iwsdk/plugin-phoenix test -- day-night`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/client/src/world/day-night.ts
/**
 * The sun's position, as a pure function of world time.
 *
 * The mirror of `IwsdkPhoenix.World.DayNight`. Nothing about the day/night
 * cycle travels on the wire: both sides compute it from the same world time,
 * which costs zero bytes and means a client that reconnects after three days
 * is correct immediately.
 *
 * The two implementations are pinned together by golden vectors in
 * `fixtures/protocol_vectors.tsv` — a shared formula, proven, which is the
 * pattern the whole package uses in place of shared binaries.
 */

/** Length of a full virtual day, in milliseconds. Two real hours. */
export const DEFAULT_CYCLE_MS = 7_200_000;

/** Fraction through the current day, `0..1`. */
export function timeOfDay(worldTimeMs: number, cycleMs = DEFAULT_CYCLE_MS): number {
  const cycle = usableCycle(cycleMs);
  return (Math.max(worldTimeMs, 0) % cycle) / cycle;
}

/** Sun angle in radians, `0` up to but not including `2π`. */
export function sunAngle(worldTimeMs: number, cycleMs = DEFAULT_CYCLE_MS): number {
  return timeOfDay(worldTimeMs, cycleMs) * 2 * Math.PI;
}

/** Sun height, `-1` (midnight) to `1` (noon). */
export function sunElevation(worldTimeMs: number, cycleMs = DEFAULT_CYCLE_MS): number {
  return Math.sin(sunAngle(worldTimeMs, cycleMs));
}

// A caller passing 0 wants the default, not a division by zero producing NaN
// and a black sky.
function usableCycle(cycleMs: number): number {
  return Number.isFinite(cycleMs) && cycleMs > 0 ? cycleMs : DEFAULT_CYCLE_MS;
}
```

Export from `packages/client/src/index.ts`, beside the other math helpers:

```ts
// World
export {
  DEFAULT_CYCLE_MS,
  sunAngle,
  sunElevation,
  timeOfDay,
} from './world/day-night.js';
```

- [ ] **Step 4: Add golden vectors**

In `scripts/generate-fixtures.mjs`, after the movement rows:

```js
comment('daynight <worldTimeMs> <cycleMs> <angle> <elevation>');
for (const [worldTimeMs, cycleMs] of [
  [0, 7200000],
  [1800000, 7200000],
  [3600000, 7200000],
  [5400000, 7200000],
  [7199999, 7200000],
  [123456789, 7200000],
  [1000, 60000],
]) {
  row(
    'daynight',
    String(worldTimeMs),
    String(cycleMs),
    f(sunAngle(worldTimeMs, cycleMs)),
    f(sunElevation(worldTimeMs, cycleMs)),
  );
}
comment('');
```

importing `sunAngle` and `sunElevation` from the built client package the same
way the file already imports `BinaryProtocol`.

- [ ] **Step 5: Assert them on both sides**

`packages/client/test/parity.test.ts`, beside the movement assertion:

```ts
  it('day/night matches', () => {
    const cases = of('daynight');
    expect(cases.length).toBeGreaterThan(0);

    for (const [worldTimeMs, cycleMs, angle, elevation] of cases) {
      expect(sunAngle(num(worldTimeMs), num(cycleMs))).toBeCloseTo(num(angle), 12);
      expect(sunElevation(num(worldTimeMs), num(cycleMs))).toBeCloseTo(num(elevation), 12);
    }
  });
```

`packages/server/test/parity_test.exs`, beside the movement block:

```elixir
    test "day/night matches" do
      rows = Fixtures.rows("daynight")
      assert rows != []

      for [world_time, cycle, angle, elevation] <- rows do
        t = String.to_integer(String.trim(world_time))
        c = String.to_integer(String.trim(cycle))

        assert_in_delta IwsdkPhoenix.World.DayNight.sun_angle(t, c),
                        Fixtures.to_float(angle),
                        1.0e-12

        assert_in_delta IwsdkPhoenix.World.DayNight.sun_elevation(t, c),
                        Fixtures.to_float(elevation),
                        1.0e-12
      end
    end
```

- [ ] **Step 6: Regenerate and run both suites**

Run: `pnpm build && node scripts/generate-fixtures.mjs && pnpm test && (cd packages/server && mix test)`
Expected: all green, and the fixture diff shows only the new `daynight` rows.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/world packages/client/src/index.ts packages/client/test/day-night.test.ts scripts/generate-fixtures.mjs fixtures/protocol_vectors.tsv packages/client/test/parity.test.ts packages/server/test/parity_test.exs
git commit -m "feat(world): day/night on the client, pinned to the server by golden vectors"
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/PROTOCOL.md` (the Cardinal component list, if it enumerates them)
- Modify: `README.md`

- [ ] **Step 1: Describe the sector model in ARCHITECTURE.md**

Add a section after the Cardinal one, covering: a room is a sector; it stops
when empty and fast-forwards on waking; everything evolving without players
must be a pure function of elapsed time; the epoch guard; and why the
macro-tick alternative was rejected (the 187,500 messages/second arithmetic —
a reader who reaches for it should find the number rather than recompute it).

- [ ] **Step 2: Note the `persistent` join param in README.md**

In the section describing join options, document `persistent` (default
`false`), what it costs, and that world state currently lives only in memory —
a node restart resets it, and wiring `Persistence` is a separate block.

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md docs/PROTOCOL.md README.md
git commit -m "docs: sector persistence model and the persistent join param"
```

---

### Task 11: Full verification sweep

- [ ] **Step 1: Regenerate everything and confirm no drift**

```bash
node scripts/generate-cardinal.mjs
pnpm build && node scripts/generate-fixtures.mjs
git diff --exit-code   # must be empty
node scripts/check-cardinal-drift.mjs
```

- [ ] **Step 2: Every suite**

Run: `pnpm test && pnpm typecheck && (cd packages/server && mix test) && (cd apps/demo_server && mix test)`
Expected: all green, zero warnings from `iwsdk_phoenix` modules.

- [ ] **Step 3: Demo builds**

Run: `pnpm demo:build && pnpm demo:typecheck`
Expected: clean.

- [ ] **Step 4: Live check**

Start the Phoenix server and the static host, join with a client, and confirm
in the console that the schema hash still matches (the join succeeds — the
`Weather` component changed it, so this proves both sides regenerated) and
that a `COMPONENT_UPDATE` carrying component 3 arrives, on the network id the
sector's own entity was spawned with. Remove
any temporary logging afterwards.

- [ ] **Step 5: Final state**

```bash
git status --short   # clean
```

---

## Self-review notes (already applied)

- **Spec coverage:** Section 1 (time model) → Tasks 4, 6; Section 2 (weather) → Tasks 2, 8; Section 3 (lifecycle) → Tasks 3, 5, 6, 7; Section 4 (verification) → every task's tests plus Tasks 9 and 11. The three lifecycle cases in the spec's table each have a named test in Task 6.
- **The one deliberate narrowing:** Task 7 makes a persistent room *keep running* rather than stop-and-reload. The fast-forward path is still fully built and tested (Tasks 5, 6) and is what a node restart exercises. Making a persistent sector also stop when empty is a small follow-up; the machinery is in place. This is called out in Task 7 rather than left implicit.
- **Type consistency:** `Weather.advance/4` takes `(state, elapsed_ms, sector_id, world_time_ms)` everywhere; `State.advance/2` takes `(state, elapsed_ms)` and supplies the other two from the struct; `State.restore/3` is `(state, snapshot, elapsed_ms)`. The snapshot map has exactly `world_time_ms`, `weather`, `last_seen_ms`, `epoch` — the first two written by `State.snapshot/1`, the last two added by `Room.Server`.
- **A gap self-review caught before execution:** the first draft published weather on network id `0` as "the sector itself". The client's COMPONENT_UPDATE ingest resolves every record through `EntityIndex` and drops what it cannot find, so that record would silently never have arrived. Task 8 now spawns a real entity for the sector, which needs no special case anywhere downstream.
- **Deliberately deferred:** `Persistence.Buffer`/`Writer` wiring, cross-node handoff of sector state, any simulation beyond weather, and client-side rendering of weather.
