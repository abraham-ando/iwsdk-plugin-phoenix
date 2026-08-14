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
    # The claim the whole design makes: sleeping and waking is
    # indistinguishable from never having slept.
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
