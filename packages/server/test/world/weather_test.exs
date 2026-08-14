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

    test "past the cap only the waking time matters, not how long it slept" do
      # The semantics the cap gives, and the reason it is safe: beyond one day
      # cycle the intervening weather was unobservable — nobody was there — so
      # two sectors waking at the same world time are in the same state
      # however long each had been asleep.
      state = Weather.new("alpha", 0)
      day = IwsdkPhoenix.World.DayNight.default_cycle_ms()

      slept_400_days = Weather.advance(state, day * 400, "alpha", 0)
      slept_300_days = Weather.advance(state, day * 300, "alpha", day * 100)

      assert slept_400_days == slept_300_days
    end

    test "a capped advance is deterministic" do
      state = Weather.new("alpha", 0)
      day = IwsdkPhoenix.World.DayNight.default_cycle_ms()

      assert Weather.advance(state, day * 400, "alpha", 0) ==
               Weather.advance(state, day * 400, "alpha", 0)
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
