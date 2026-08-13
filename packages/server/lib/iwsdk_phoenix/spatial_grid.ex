defmodule IwsdkPhoenix.SpatialGrid do
  @moduledoc """
  Uniform spatial hash used for area-of-interest filtering.

  ## Why this exists

  Broadcasting every entity to every player is `O(players * entities)` per tick.
  That is fine for a demo and fatal for an MMO: at 100 players and 1000 entities
  it is 100k transform copies at 30 Hz. Spatial hashing turns it into
  "each player receives only what is near them", which is `O(players * local
  density)` and stays flat as the world grows.

  The world is diced into cubic cells. A player subscribes to the cells within
  their interest radius; an entity publishes only to the cell it occupies. Two
  entities exchange updates only when their cells overlap.

  ## Choosing a cell size

  Cell size should be at least the interest radius, otherwise a player's bubble
  spans many cells and the neighbour scan grows cubically. The 3x3x3 neighbour
  query below assumes exactly that: with `cell_size >= interest_radius`, one
  ring of neighbours is guaranteed to cover the bubble. The default 50 m cell
  matches the 50 m interest radius from the design spec.

  ## Y axis

  Cells are cubic in all three axes. For a mostly-flat world this wastes a
  little: everything lands in one Y band, so the 27-cell neighbourhood does the
  work of 9. `neighbouring_cells/2` accepts `:flat` to skip the vertical ring
  entirely, which is the right choice for a room-scale or ground-based scene.
  """

  @default_cell_size 50.0

  @type cell :: {integer(), integer(), integer()}
  @type position :: %{x: number(), y: number(), z: number()}

  @doc "Default edge length of a grid cell, in metres."
  def default_cell_size, do: @default_cell_size

  @doc """
  Map a world position onto its cell coordinate.

  ## Examples

      iex> IwsdkPhoenix.SpatialGrid.cell_for(%{x: 10.0, y: 0.0, z: -60.0})
      {0, 0, -2}

      iex> IwsdkPhoenix.SpatialGrid.cell_for(%{x: 120.0, y: 0.0, z: 0.0}, 50.0)
      {2, 0, 0}
  """
  @spec cell_for(position(), number()) :: cell()
  def cell_for(%{x: x, y: y, z: z}, cell_size \\ @default_cell_size)
      when is_number(cell_size) and cell_size > 0 do
    {floor_div(x, cell_size), floor_div(y, cell_size), floor_div(z, cell_size)}
  end

  @doc """
  Cells forming the interest neighbourhood of `cell`.

  Pass `:flat` to omit the vertical ring, which is the right default for
  ground-based worlds where nothing meaningful is 50 m overhead.

  ## Examples

      iex> IwsdkPhoenix.SpatialGrid.neighbouring_cells({0, 0, 0}) |> length()
      27

      iex> IwsdkPhoenix.SpatialGrid.neighbouring_cells({0, 0, 0}, :flat) |> length()
      9
  """
  @spec neighbouring_cells(cell(), :full | :flat) :: [cell()]
  def neighbouring_cells(cell, mode \\ :full)

  def neighbouring_cells({cx, cy, cz}, :full) do
    for dx <- -1..1, dy <- -1..1, dz <- -1..1, do: {cx + dx, cy + dy, cz + dz}
  end

  def neighbouring_cells({cx, cy, cz}, :flat) do
    for dx <- -1..1, dz <- -1..1, do: {cx + dx, cy, cz + dz}
  end

  @doc """
  Phoenix topic for a cell.

  Cell topics are how the BEAM does the fan-out for us: a player subscribes to
  the topics in their bubble and `Phoenix.PubSub` handles delivery, so the game
  server never iterates over recipients.

      iex> IwsdkPhoenix.SpatialGrid.cell_topic({1, 0, -2})
      "iwsdk:cell:1:0:-2"
  """
  @spec cell_topic(cell()) :: String.t()
  def cell_topic({cx, cy, cz}), do: "iwsdk:cell:#{cx}:#{cy}:#{cz}"

  @doc """
  Topics a viewer at `position` should be subscribed to.

      iex> IwsdkPhoenix.SpatialGrid.topics_for(%{x: 0.0, y: 0.0, z: 0.0}, 50.0, :flat) |> length()
      9
  """
  @spec topics_for(position(), number(), :full | :flat) :: [String.t()]
  def topics_for(position, cell_size \\ @default_cell_size, mode \\ :full) do
    position
    |> cell_for(cell_size)
    |> neighbouring_cells(mode)
    |> Enum.map(&cell_topic/1)
  end

  @doc """
  Subscription delta for a viewer that moved from `from` to `to`.

  Returns `{to_subscribe, to_unsubscribe}`. Computing the delta rather than
  resubscribing wholesale is what keeps zone crossings cheap: a player walking
  across a cell boundary changes 9 of their 27 subscriptions, not all 27.

      iex> IwsdkPhoenix.SpatialGrid.transition(%{x: 0.0, y: 0.0, z: 0.0}, %{x: 0.0, y: 0.0, z: 0.0})
      {[], []}
  """
  @spec transition(position(), position(), number(), :full | :flat) ::
          {[String.t()], [String.t()]}
  def transition(from, to, cell_size \\ @default_cell_size, mode \\ :full) do
    before = MapSet.new(topics_for(from, cell_size, mode))
    now = MapSet.new(topics_for(to, cell_size, mode))

    {
      now |> MapSet.difference(before) |> Enum.sort(),
      before |> MapSet.difference(now) |> Enum.sort()
    }
  end

  @doc """
  Whether two positions are close enough to exchange updates.

  Compares squared distances to avoid a square root.

      iex> IwsdkPhoenix.SpatialGrid.within?(%{x: 0.0, y: 0.0, z: 0.0}, %{x: 3.0, y: 4.0, z: 0.0}, 5.0)
      true
  """
  @spec within?(position(), position(), number()) :: boolean()
  def within?(a, b, radius) do
    dx = a.x - b.x
    dy = a.y - b.y
    dz = a.z - b.z
    dx * dx + dy * dy + dz * dz <= radius * radius
  end

  @doc """
  Network level of detail for a distance, following the design spec:
  30 Hz within 10 m, 15 Hz to 30 m, 5 Hz beyond.

      iex> IwsdkPhoenix.SpatialGrid.lod_rate(5.0)
      30
      iex> IwsdkPhoenix.SpatialGrid.lod_rate(20.0)
      15
      iex> IwsdkPhoenix.SpatialGrid.lod_rate(80.0)
      5
  """
  @spec lod_rate(number()) :: pos_integer()
  def lod_rate(distance) when distance <= 10, do: 30
  def lod_rate(distance) when distance <= 30, do: 15
  def lod_rate(_distance), do: 5

  # Elixir's `div/2` truncates toward zero, which would map both -10 and +10 to
  # cell 0 and fold the negative half of the world onto the positive half.
  # Flooring division is required for a correct grid.
  defp floor_div(value, size), do: floor(value / size)
end
