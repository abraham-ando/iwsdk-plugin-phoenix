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
  def advance(%__MODULE__{} = weather, elapsed_ms, _sector_id, _world_time_ms)
      when elapsed_ms <= 0 do
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

  defp step(weather, _sector_id, at, until) when at >= until, do: weather

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

  defp clamp(value) when is_number(value) do
    value |> max(0.0) |> min(1.0) |> :erlang.float()
  end
end
