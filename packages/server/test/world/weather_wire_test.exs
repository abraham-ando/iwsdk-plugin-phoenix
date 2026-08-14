defmodule IwsdkPhoenix.World.WeatherWireTest do
  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Cardinal.Weather, as: WireWeather
  alias IwsdkPhoenix.World.Weather

  test "the generated component matches the world model's shape" do
    assert WireWeather.byte_size() == 17
    assert WireWeather.field_order() == [:kind, :intensity, :wind]
  end

  test "a world weather round-trips through the wire component" do
    # The world model and the wire component are separate on purpose: one is
    # simulation state with a next-transition time, the other is only what a
    # client needs to render. This is the seam between them.
    world = Weather.new("alpha", 0)

    wire = %WireWeather{
      kind: Weather.kind_code(world.kind),
      intensity: world.intensity,
      wind: world.wind
    }

    assert {:ok, decoded} = wire |> WireWeather.encode() |> WireWeather.decode()
    assert Weather.kind_from_code(decoded.kind) == world.kind
    assert_in_delta decoded.intensity, world.intensity, 1.0e-6
    assert_in_delta decoded.wind.x, world.wind.x, 1.0e-4
  end
end
