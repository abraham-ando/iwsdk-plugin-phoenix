defmodule IwsdkPhoenix.Room.State do
  @moduledoc """
  Pure room state: membership, network-id allocation and authoritative player
  positions.

  Deliberately free of any Phoenix or process concerns. Everything here is a
  plain function over a struct, which means the interesting behaviour of a room
  — id allocation, authority, area-of-interest filtering — is testable without
  starting a socket, a channel or even a GenServer.

  `IwsdkPhoenix.Room.Server` wraps this in a process; `IwsdkPhoenix.RoomChannel`
  drives it from channel callbacks.
  """

  alias IwsdkPhoenix.Physics.Kinematic
  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.SpatialGrid
  alias IwsdkPhoenix.Zone.IdAllocator

  defstruct id: nil,
            mode: :host_relayed,
            players: %{},
            entities: %{},
            allocator: nil,
            allocator_state: nil,
            migrating: MapSet.new(),
            tick: 0,
            physics_module: Kinematic,
            physics_state: nil,
            interest_radius: 50.0,
            cell_size: 50.0,
            grid_mode: :full,
            steal_policy: :deny

  @type mode :: :host_relayed | :server_authoritative

  @type player :: %{
          peer_id: String.t(),
          network_id: pos_integer(),
          position: Protocol.vec3(),
          last_sequence: non_neg_integer()
        }

  @type t :: %__MODULE__{}

  @doc """
  Build a room.

  ## Options

    * `:mode` — `:host_relayed` (default) or `:server_authoritative`
    * `:interest_radius` — metres; `nil` disables area-of-interest filtering
    * `:cell_size` — spatial grid cell edge, metres
    * `:physics_module` — a `IwsdkPhoenix.Physics` implementation
    * `:physics_opts` — forwarded to the backend's `init/1`
    * `:steal_policy` — `:deny` (default) or `:allow`, controlling whether one
      player may take an object another player already owns
    * `:allocator` — `{fun, initial_state}` from `IwsdkPhoenix.Zone.IdAllocator`.
      Defaults to a local counter. A deployment where players migrate between
      zones **must** supply a globally-unique allocator, or ids will collide
      silently across zones
  """
  @spec new(String.t(), keyword()) :: t()
  def new(id, opts \\ []) do
    physics_module = Keyword.get(opts, :physics_module, Kinematic)
    {:ok, physics_state} = physics_module.init(Keyword.get(opts, :physics_opts, []))
    {allocator, allocator_state} = Keyword.get(opts, :allocator) || IdAllocator.local()

    %__MODULE__{
      id: id,
      mode: Keyword.get(opts, :mode, :host_relayed),
      physics_module: physics_module,
      physics_state: physics_state,
      interest_radius: Keyword.get(opts, :interest_radius, 50.0),
      cell_size: Keyword.get(opts, :cell_size, SpatialGrid.default_cell_size()),
      grid_mode: Keyword.get(opts, :grid_mode, :full),
      steal_policy: Keyword.get(opts, :steal_policy, :deny),
      allocator: allocator,
      allocator_state: allocator_state
    }
  end

  @doc """
  Admit a peer, allocating it a network id.

  Returns `{state, player}`. Re-joining with the same `peer_id` is idempotent
  and keeps the existing id — a socket reconnect must not orphan the peer's
  entity and hand it a new identity.
  """
  @spec join(t(), String.t(), Protocol.vec3()) :: {t(), player()}
  def join(%__MODULE__{} = state, peer_id, position \\ %{x: 0.0, y: 0.0, z: 0.0}) do
    case Map.fetch(state.players, peer_id) do
      {:ok, existing} ->
        {state, existing}

      :error ->
        {network_id, state} = allocate_network_id(state)

        player = %{
          peer_id: peer_id,
          network_id: network_id,
          position: position,
          last_sequence: 0
        }

        {%{state | players: Map.put(state.players, peer_id, player)}, player}
    end
  end

  @doc "Remove a peer and everything it owned."
  @spec leave(t(), String.t()) :: {t(), player() | nil}
  def leave(%__MODULE__{} = state, peer_id) do
    case Map.pop(state.players, peer_id) do
      {nil, _players} ->
        {state, nil}

      {player, players} ->
        entities =
          state.entities
          |> Enum.reject(fn {_id, entity} -> entity.owner_id == player.network_id end)
          |> Map.new()

        {%{state | players: players, entities: entities}, player}
    end
  end

  @doc "Look up a player by peer id."
  @spec player(t(), String.t()) :: player() | nil
  def player(%__MODULE__{} = state, peer_id), do: Map.get(state.players, peer_id)

  @doc "Number of connected peers."
  @spec player_count(t()) :: non_neg_integer()
  def player_count(%__MODULE__{} = state), do: map_size(state.players)

  @doc """
  Apply one client input under server authority.

  Returns `{state, reconcile_frame}` where the frame is the correction to send
  back to that client. Returns `{state, nil}` for an unknown peer or when the
  room is not server-authoritative.
  """
  @spec apply_input(t(), String.t(), map()) :: {t(), binary() | nil}
  def apply_input(%__MODULE__{mode: :host_relayed} = state, _peer_id, _input), do: {state, nil}

  def apply_input(%__MODULE__{} = state, peer_id, input) do
    # Mid-handoff: the target zone owns this player's simulation now. Applying
    # input in both places would make the two copies diverge.
    if MapSet.member?(state.migrating, peer_id) do
      {state, nil}
    else
      do_apply_input(state, peer_id, input)
    end
  end

  defp do_apply_input(%__MODULE__{} = state, peer_id, input) do
    case Map.fetch(state.players, peer_id) do
      :error ->
        {state, nil}

      {:ok, player} ->
        {updated, physics_state} =
          state.physics_module.apply_input(
            %{position: player.position, last_sequence: player.last_sequence},
            input,
            state.physics_state
          )

        player = %{
          player
          | position: updated.position,
            last_sequence: updated.last_sequence
        }

        state = %{
          state
          | players: Map.put(state.players, peer_id, player),
            physics_state: physics_state
        }

        frame =
          Protocol.encode_reconcile(player.network_id, player.last_sequence, player.position)

        {state, frame}
    end
  end

  @doc """
  Arbitrate a request for authority over an entity.

  Returns `{state, grant}` where `grant` is the map to broadcast, or
  `{state, nil}` for an unknown peer.

  ## Policy

  Ownership is **first-come, first-served**, decided by the server. That is the
  only place it can be decided correctly: two players reaching for the same
  object at the same moment will both believe they grabbed it, and only a single
  serialisation point can break the tie. The verdict goes to the whole room, so
  the loser learns who actually won rather than merely that it failed.

    * unowned entity -> granted
    * already owned by the requester -> granted, idempotently, so a retry after
      a dropped packet is harmless
    * owned by someone still connected -> denied, unless `steal_policy: :allow`
    * owned by a peer that has since left -> granted, because otherwise a
      disconnect would strand the object forever

  `steal_policy: :allow` exists for objects that are meant to be taken from
  another player. It is off by default: silently letting anyone seize anything
  is rarely what an application wants, and it is the kind of default that only
  reveals itself as wrong in front of users.
  """
  @spec request_ownership(t(), String.t(), non_neg_integer(), non_neg_integer()) ::
          {t(), map() | nil}
  def request_ownership(%__MODULE__{} = state, peer_id, network_id, request_id) do
    case Map.fetch(state.players, peer_id) do
      :error ->
        {state, nil}

      {:ok, requester} ->
        current_owner = Map.get(state.entities, network_id)

        granted? =
          cond do
            is_nil(current_owner) -> true
            current_owner.owner_id == requester.network_id -> true
            state.steal_policy == :allow -> true
            not owner_connected?(state, current_owner.owner_id) -> true
            true -> false
          end

        owner_id = if granted?, do: requester.network_id, else: current_owner.owner_id

        state =
          if granted? do
            %{state | entities: Map.put(state.entities, network_id, %{owner_id: owner_id})}
          else
            state
          end

        {state,
         %{
           network_id: network_id,
           owner_id: owner_id,
           request_id: request_id,
           granted: granted?
         }}
    end
  end

  @doc "Current owner's network id for an entity, or `nil` when unowned."
  @spec owner_of(t(), non_neg_integer()) :: non_neg_integer() | nil
  def owner_of(%__MODULE__{} = state, network_id) do
    case Map.get(state.entities, network_id) do
      nil -> nil
      %{owner_id: owner_id} -> owner_id
    end
  end

  defp owner_connected?(%__MODULE__{} = state, owner_id) do
    Enum.any?(state.players, fn {_peer_id, player} -> player.network_id == owner_id end)
  end

  @doc """
  Begin migrating a player to another zone. Phase one of a two-phase handoff.

  Returns `{state, snapshot}`, or `{state, nil}` for an unknown peer. The player
  is marked as migrating but **deliberately not removed**: if the target zone
  refuses or crashes, `abort_migration/2` puts them straight back. Removing here
  instead would mean a failed handoff loses the player entirely.

  While marked, the source stops applying their input — otherwise both zones
  would simulate the same player for the duration of the handoff and their
  positions would diverge.
  """
  @spec begin_migration(t(), String.t()) :: {t(), map() | nil}
  def begin_migration(%__MODULE__{} = state, peer_id) do
    case Map.fetch(state.players, peer_id) do
      :error ->
        {state, nil}

      {:ok, player} ->
        owned =
          state.entities
          |> Enum.filter(fn {_id, entity} -> entity.owner_id == player.network_id end)
          |> Enum.map(fn {id, _entity} -> id end)

        snapshot = %{
          peer_id: peer_id,
          network_id: player.network_id,
          position: player.position,
          last_sequence: player.last_sequence,
          owned_entities: owned
        }

        {%{state | migrating: MapSet.put(state.migrating, peer_id)}, snapshot}
    end
  end

  @doc """
  Phase three: the target confirmed, so drop the player here.

  Safe to call for a peer that is not migrating; it behaves like `leave/2`.
  """
  @spec complete_migration(t(), String.t()) :: t()
  def complete_migration(%__MODULE__{} = state, peer_id) do
    {state, _player} = leave(state, peer_id)
    %{state | migrating: MapSet.delete(state.migrating, peer_id)}
  end

  @doc "Undo `begin_migration/2` after a failed handoff; the player resumes here."
  @spec abort_migration(t(), String.t()) :: t()
  def abort_migration(%__MODULE__{} = state, peer_id) do
    %{state | migrating: MapSet.delete(state.migrating, peer_id)}
  end

  @doc """
  Phase two: admit a player migrating in from another zone.

  The incoming `network_id` is preserved rather than reallocated. Renumbering
  would be visible to every other client as a despawn/respawn, and any in-flight
  frame naming the old id would land on the wrong entity. Preserving it is only
  sound when the allocator makes ids unique across zones — see
  `IwsdkPhoenix.Zone.IdAllocator`.
  """
  @spec admit_migrated(t(), map()) :: {t(), map()}
  def admit_migrated(%__MODULE__{} = state, snapshot) do
    player = %{
      peer_id: snapshot.peer_id,
      network_id: snapshot.network_id,
      position: snapshot.position,
      last_sequence: snapshot.last_sequence
    }

    entities =
      Enum.reduce(Map.get(snapshot, :owned_entities, []), state.entities, fn id, acc ->
        Map.put(acc, id, %{owner_id: snapshot.network_id})
      end)

    {%{state | players: Map.put(state.players, snapshot.peer_id, player), entities: entities},
     player}
  end

  @doc "Whether a peer is mid-handoff."
  @spec migrating?(t(), String.t()) :: boolean()
  def migrating?(%__MODULE__{} = state, peer_id), do: MapSet.member?(state.migrating, peer_id)

  @doc """
  Record a transform reported by its owner.

  Used in `:host_relayed` rooms so the server still knows where everyone is —
  which is what makes area-of-interest filtering possible even when the server
  is not simulating.
  """
  @spec track_transform(t(), String.t(), Protocol.vec3()) :: t()
  def track_transform(%__MODULE__{} = state, peer_id, position) do
    case Map.fetch(state.players, peer_id) do
      :error -> state
      {:ok, player} -> put_in(state.players[peer_id], %{player | position: position})
    end
  end

  @doc """
  Build the snapshot a given viewer should receive.

  When `interest_radius` is set, only players inside the viewer's bubble are
  included — and the viewer itself is always excluded, since its own position is
  predicted locally and echoing it back would fight prediction.
  """
  @spec snapshot_for(t(), String.t()) :: [Protocol.transform()]
  def snapshot_for(%__MODULE__{} = state, viewer_peer_id) do
    viewer = Map.get(state.players, viewer_peer_id)

    state.players
    |> Enum.reject(fn {peer_id, _player} -> peer_id == viewer_peer_id end)
    |> Enum.filter(fn {_peer_id, player} -> visible?(state, viewer, player) end)
    |> Enum.map(fn {_peer_id, player} ->
      %{
        network_id: player.network_id,
        position: player.position,
        rotation: %{x: 0.0, y: 0.0, z: 0.0, w: 1.0}
      }
    end)
    |> Enum.sort_by(& &1.network_id)
  end

  defp visible?(_state, nil, _player), do: true
  defp visible?(%__MODULE__{interest_radius: nil}, _viewer, _player), do: true

  defp visible?(%__MODULE__{interest_radius: radius}, viewer, player) do
    SpatialGrid.within?(viewer.position, player.position, radius)
  end

  @doc "Advance the tick counter."
  @spec tick(t()) :: t()
  def tick(%__MODULE__{} = state), do: %{state | tick: state.tick + 1}

  # Network ids are consumed by the client as Int32 (elics has no unsigned
  # 32-bit storage), so every allocator stays inside the positive Int32 range.
  defp allocate_network_id(%__MODULE__{} = state) do
    {id, allocator_state} = state.allocator.(state.allocator_state)
    {id, %{state | allocator_state: allocator_state}}
  end
end
