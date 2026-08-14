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
