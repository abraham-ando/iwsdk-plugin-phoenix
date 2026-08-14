defmodule IwsdkPhoenix.World.DayNight do
  @moduledoc """
  The sun's position, as a pure function of world time.

  Nothing about the day/night cycle is stored, replicated or caught up: both
  the server and every client compute it from the same world time. That costs
  zero bytes on the wire, and a client that reconnects after three days is
  correct immediately with nothing to reconcile.

  It is deliberately not part of a sector's snapshot. Anything derivable is
  cheaper derived than saved.

  The TypeScript mirror is `packages/client/src/world/day-night.ts`; golden
  vectors in `fixtures/protocol_vectors.tsv` pin the two together.
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
