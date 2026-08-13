defmodule IwsdkPhoenix.Zone.IdAllocator do
  @moduledoc """
  Network-id allocation strategies.

  ## The problem zone handoff creates

  A single room can allocate ids from a plain counter: it is the only writer, so
  ids are unique by construction. The moment a player can *move between* zones,
  that breaks. Zone A and zone B both start counting at 1, so a player carrying
  id 7 from A into B collides with whatever B already called 7 — and the
  collision is silent. Two entities share an id, transforms cross-apply, and two
  avatars smear into each other.

  Renumbering on arrival is not a fix either: the id is what every other client
  uses to address the entity, so a change means a despawn/respawn visible to
  everyone in the room, and any in-flight frame referring to the old id lands on
  the wrong entity.

  So ids must be unique across every zone a player can reach. This module offers
  the two strategies that matter.

  ## Strategies

    * `local/0` — a plain counter. Correct for a single-zone deployment, and the
      default. Cheap, no coordination.

    * `partitioned/2` — carves the id space by zone index, so each zone allocates
      from a disjoint range with no coordination at all. This is the right answer
      for a fixed set of zones: uniqueness is structural rather than negotiated,
      so there is no allocator to be a bottleneck or a single point of failure.

  Both stay inside the positive `Int32` range, because the client stores
  `networkId` in an `Int32` (elics has no unsigned 32-bit type).

  ## Choosing the split

  `partitioned/2` splits 31 usable bits between zone index and per-zone counter.
  The default of 8 zone bits gives 256 zones with ~8.3M entities each, which
  suits a world divided into a modest number of large zones. Raise it for many
  small zones; lower it if a single zone must hold more.

  A custom allocator is any `(state -> {id, state})` function, so a deployment
  that genuinely needs cluster-wide sequential ids can supply one backed by
  whatever it already trusts for coordination.
  """

  import Bitwise

  @max_id 2_147_483_647

  @typedoc "Allocator state, opaque to the room."
  @type state :: term()

  @typedoc "Allocates one id, returning it with the advanced state."
  @type t :: (state() -> {pos_integer(), state()})

  @doc """
  Plain incrementing counter starting at 1, wrapping at the `Int32` ceiling.

  ## Examples

      iex> alias IwsdkPhoenix.Zone.IdAllocator
      iex> {allocator, state} = IdAllocator.local()
      iex> {id, state} = allocator.(state)
      iex> {id2, _state} = allocator.(state)
      iex> {id, id2}
      {1, 2}
  """
  @spec local() :: {t(), state()}
  def local do
    allocator = fn next ->
      following = if next >= @max_id, do: 1, else: next + 1
      {next, following}
    end

    {allocator, 1}
  end

  @doc """
  Disjoint id range per zone, requiring no coordination between zones.

  The id layout is `zone_index` in the high bits and a per-zone counter in the
  low bits, so two zones can allocate concurrently and never collide.

  ## Examples

      iex> alias IwsdkPhoenix.Zone.IdAllocator
      iex> {alloc_a, state_a} = IdAllocator.partitioned(0)
      iex> {alloc_b, state_b} = IdAllocator.partitioned(1)
      iex> {id_a, _} = alloc_a.(state_a)
      iex> {id_b, _} = alloc_b.(state_b)
      iex> id_a == id_b
      false

      iex> alias IwsdkPhoenix.Zone.IdAllocator
      iex> {allocator, state} = IdAllocator.partitioned(3)
      iex> {id, _state} = allocator.(state)
      iex> IdAllocator.zone_of(id, 8)
      3
  """
  @spec partitioned(non_neg_integer(), pos_integer()) :: {t(), state()}
  def partitioned(zone_index, zone_bits \\ 8)
      when is_integer(zone_index) and zone_index >= 0 and zone_bits > 0 and zone_bits < 31 do
    counter_bits = 31 - zone_bits
    max_zone = (1 <<< zone_bits) - 1
    max_counter = (1 <<< counter_bits) - 1

    if zone_index > max_zone do
      raise ArgumentError,
            "zone_index #{zone_index} exceeds #{max_zone}, the maximum for #{zone_bits} zone bits"
    end

    prefix = zone_index <<< counter_bits

    allocator = fn counter ->
      # Counter starts at 1 so that id 0 (meaning "unassigned" on the client) is
      # never produced, including in zone 0.
      following = if counter >= max_counter, do: 1, else: counter + 1
      {prefix ||| counter, following}
    end

    {allocator, 1}
  end

  @doc """
  Recover the zone index from an id produced by `partitioned/2`.

  Useful for routing a frame to the zone that owns the entity without a lookup.
  """
  @spec zone_of(pos_integer(), pos_integer()) :: non_neg_integer()
  def zone_of(id, zone_bits \\ 8), do: id >>> (31 - zone_bits)

  @doc "Largest id either strategy will produce."
  def max_id, do: @max_id
end
