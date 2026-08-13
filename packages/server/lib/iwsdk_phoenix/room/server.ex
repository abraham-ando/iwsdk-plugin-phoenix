defmodule IwsdkPhoenix.Room.Server do
  @moduledoc """
  One BEAM process per room, owning the authoritative state and the tick loop.

  ## Why a process per room

  This is the structural advantage the design is built on. A BEAM process costs
  a few hundred bytes and is scheduled pre-emptively, so "one lightweight
  process per room" scales to numbers that a shared event loop cannot approach —
  and, just as importantly, a crash in one room cannot take down another. The
  supervisor restarts that room; every other room never notices.

  The tick loop uses `Process.send_after/3` re-armed against a monotonic
  deadline rather than `:timer.send_interval/2`. Fixed-interval timers drift:
  if a tick takes longer than the interval, messages queue up and the room
  spirals. Re-arming against the deadline lets a slow tick simply shorten the
  next sleep, and skip entirely if it is already late.
  """

  # :transient, so a room that stops itself after the last peer leaves is not
  # immediately restarted by its supervisor, while a crash still is.
  use GenServer, restart: :transient

  require Logger

  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.Room.State

  @default_tick_hz 30

  # -- Client API -------------------------------------------------------------

  @doc """
  Start a room.

  ## Options

    * `:id` — room identifier (required)
    * `:tick_hz` — simulation and broadcast rate, default 30
    * `:broadcast` — 1-arity fun receiving `{peer_id, binary}` snapshots.
      Injected rather than calling `Phoenix.PubSub` directly so the loop is
      testable without a running endpoint.
    * `:stop_when_empty` — stop the room once its last peer leaves, default
      `false`. Rooms started on demand per socket want this; a persistent room
      that outlives its occupants does not.
    * everything accepted by `IwsdkPhoenix.Room.State.new/2`
  """
  def start_link(opts) do
    id = Keyword.fetch!(opts, :id)
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, via(id)))
  end

  @doc "Registry-based name, so rooms can be addressed by id across a node."
  def via(id), do: {:via, Registry, {IwsdkPhoenix.Room.Registry, id}}

  @doc "Admit a peer. Returns the allocated player map."
  def join(room, peer_id, position \\ %{x: 0.0, y: 0.0, z: 0.0}) do
    GenServer.call(room, {:join, peer_id, position})
  end

  @doc "Remove a peer."
  def leave(room, peer_id), do: GenServer.call(room, {:leave, peer_id})

  @doc "Feed one binary frame into the room."
  def handle_frame(room, peer_id, frame) do
    GenServer.call(room, {:frame, peer_id, frame})
  end

  @doc """
  Create a replicated object in the room.

  Returns `{:ok, entity, spawn_frame}`. Broadcast the frame to the room so
  every client instantiates it.
  """
  def spawn_entity(room, opts \\ []), do: GenServer.call(room, {:spawn_entity, opts})

  @doc "Remove an object. Returns `{:ok, despawn_frame}` or `{:ok, nil}`."
  def despawn_entity(room, network_id),
    do: GenServer.call(room, {:despawn_entity, network_id})

  @doc "Current room state. Intended for tests and diagnostics."
  def state(room), do: GenServer.call(room, :state)

  # -- Callbacks --------------------------------------------------------------

  @impl true
  def init(opts) do
    tick_hz = Keyword.get(opts, :tick_hz, @default_tick_hz)
    interval = max(1, div(1000, tick_hz))

    state = %{
      room: State.new(Keyword.fetch!(opts, :id), opts),
      interval: interval,
      broadcast: Keyword.get(opts, :broadcast),
      stop_when_empty: Keyword.get(opts, :stop_when_empty, false),
      deadline: System.monotonic_time(:millisecond) + interval
    }

    schedule(state)
    {:ok, state}
  end

  @impl true
  def handle_call({:join, peer_id, position}, _from, state) do
    {room, player} = State.join(state.room, peer_id, position)
    {:reply, {:ok, player}, %{state | room: room}}
  end

  def handle_call({:leave, peer_id}, _from, state) do
    {room, player} = State.leave(state.room, peer_id)
    state = %{state | room: room}

    # Reap the room with its last occupant, otherwise a server accumulates one
    # idle tick loop per room anyone has ever visited. Only on a departure: a
    # room that has not been joined yet is also empty, and stopping it there
    # would kill it out from under the peer on its way in.
    if state.stop_when_empty and State.player_count(room) == 0 do
      {:stop, :normal, {:ok, player}, state}
    else
      {:reply, {:ok, player}, state}
    end
  end

  def handle_call({:frame, peer_id, frame}, _from, state) do
    case IwsdkPhoenix.Room.Handler.handle_frame(state.room, peer_id, frame) do
      {:broadcast, payload, room} ->
        {:reply, {:broadcast, payload}, %{state | room: room}}

      {:broadcast_all, payload, room} ->
        {:reply, {:broadcast_all, payload}, %{state | room: room}}

      {:direct, target_peer, payload, room} ->
        {:reply, {:direct, target_peer, payload}, %{state | room: room}}

      {:reply, payload, room} ->
        {:reply, {:reply, payload}, %{state | room: room}}

      {:noreply, room} ->
        {:reply, :ok, %{state | room: room}}

      {:error, reason, room} ->
        {:reply, {:error, reason}, %{state | room: room}}
    end
  end

  def handle_call({:spawn_entity, opts}, _from, state) do
    {room, entity, frame} = State.spawn_entity(state.room, opts)
    {:reply, {:ok, entity, frame}, %{state | room: room}}
  end

  def handle_call({:despawn_entity, network_id}, _from, state) do
    {room, frame} = State.despawn_entity(state.room, network_id)
    {:reply, {:ok, frame}, %{state | room: room}}
  end

  def handle_call(:state, _from, state), do: {:reply, state.room, state}

  # -- Zone handoff -----------------------------------------------------------
  #
  # Driven by IwsdkPhoenix.Zone.Handoff. Kept as plain calls so a zone can be
  # anything addressable by GenServer — a local Registry entry or a Horde one.

  def handle_call({:handoff_prepare, peer_id}, _from, state) do
    {room, snapshot} = State.begin_migration(state.room, peer_id)
    {:reply, snapshot, %{state | room: room}}
  end

  def handle_call({:handoff_commit, snapshot}, _from, state) do
    {room, player} = State.admit_migrated(state.room, snapshot)
    {:reply, player, %{state | room: room}}
  end

  def handle_call({:handoff_finalize, peer_id}, _from, state) do
    {:reply, :ok, %{state | room: State.complete_migration(state.room, peer_id)}}
  end

  def handle_call({:handoff_abort, peer_id}, _from, state) do
    {:reply, :ok, %{state | room: State.abort_migration(state.room, peer_id)}}
  end

  @impl true
  def handle_info(:tick, state) do
    room = State.tick(state.room)
    broadcast_snapshots(room, state.broadcast)

    now = System.monotonic_time(:millisecond)

    # Re-arm against the deadline. If we are already past it (a slow tick, or
    # the scheduler was busy), the next sleep shortens rather than the room
    # accumulating a backlog it can never work off.
    deadline = next_deadline(state.deadline + state.interval, now, state.interval)
    state = %{state | room: room, deadline: deadline}

    schedule(state, max(0, deadline - now))
    {:noreply, state}
  end

  def handle_info(message, state) do
    Logger.debug("IwsdkPhoenix.Room.Server ignoring #{inspect(message)}")
    {:noreply, state}
  end

  # -- Internals --------------------------------------------------------------

  defp schedule(state, delay \\ nil) do
    Process.send_after(self(), :tick, delay || state.interval)
  end

  defp next_deadline(deadline, now, interval) do
    if deadline <= now do
      # Skip missed ticks outright instead of firing them back to back.
      now + interval
    else
      deadline
    end
  end

  defp broadcast_snapshots(_room, nil), do: :ok

  defp broadcast_snapshots(room, broadcast) when is_function(broadcast, 1) do
    Enum.each(room.players, fn {peer_id, _player} ->
      case State.snapshot_for(room, peer_id) do
        [] ->
          :ok

        records ->
          broadcast.({peer_id, Protocol.encode_snapshot(records, room.tick, false)})
      end
    end)
  end
end
