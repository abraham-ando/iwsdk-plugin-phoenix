defmodule IwsdkPhoenix.RoomSupervisor do
  @moduledoc """
  Starts one `IwsdkPhoenix.Room.Server` per room, on demand.

  ## Why this exists

  A room has to be a *single* piece of state shared by every socket in it.
  Without a process to own it, each connection ends up with a private copy —
  and then every peer is allocated network id 1, nobody appears in anybody
  else's snapshot, and ownership arbitration answers each client from its own
  private view of who owns what. Those failures are all silent: the session
  connects, frames flow, and nothing appears in the room.

  So this supervisor sits between the channel and the room. The first peer to
  join `room:lobby` starts the process; everyone after that finds it in the
  registry.

  ## Wiring

  Add it to the host application's supervision tree:

      children = [
        MyAppWeb.Endpoint,
        IwsdkPhoenix.RoomSupervisor
      ]

  `IwsdkPhoenix.RoomChannel` starts it lazily if it is missing, so a dev server
  works without this step; a production tree should be explicit, because a
  supervisor started lazily from a channel is restarted under that channel's
  lifetime rather than the application's.

  ## Options

  Options passed to `ensure_started/2` are forwarded to
  `IwsdkPhoenix.Room.Server.start_link/1`, and through it to
  `IwsdkPhoenix.Room.State.new/2`. They apply only to the peer that *creates*
  the room; later joiners get the room as it already is. That asymmetry is
  deliberate — a room's authority mode cannot change under the players already
  in it — and it is why `RoomChannel` reports the room's actual mode back in
  the join reply instead of echoing what the client asked for.

  This module deliberately depends on nothing outside OTP, so it is testable
  without Phoenix.
  """

  use Supervisor

  alias IwsdkPhoenix.Room.Server

  @registry IwsdkPhoenix.Room.Registry
  @rooms IwsdkPhoenix.Room.DynamicSupervisor

  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @impl true
  def init(_opts) do
    children = [
      {Registry, keys: :unique, name: @registry},
      {DynamicSupervisor, strategy: :one_for_one, name: @rooms}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  @doc "Name of the registry rooms are addressed through."
  def registry, do: @registry

  @doc "True once the supervision tree is up and rooms can be started."
  @spec running?() :: boolean()
  def running?, do: is_pid(Process.whereis(@rooms))

  @doc """
  Start the tree if the host application has not already.

  A convenience for development, so a dev server works before anyone has edited
  their supervision tree. The started supervisor is **unlinked** from its
  caller, which is the whole reason this lives here rather than in the channel:
  `Supervisor.start_link/3` links, and a supervisor linked to whichever socket
  happened to join first would take every room in the node down with that
  socket's disconnect — a bug that would only ever show up under two players.

  Unlinked also means unsupervised: nothing restarts it if it crashes. Put
  `IwsdkPhoenix.RoomSupervisor` in the application's own tree for anything real.
  """
  @spec ensure_running() :: :ok | {:error, term()}
  def ensure_running do
    if running?() do
      :ok
    else
      case start_link([]) do
        {:ok, pid} ->
          Process.unlink(pid)
          :ok

        {:error, {:already_started, _pid}} ->
          :ok

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  @doc """
  Return the room process for `room_id`, starting it if it does not exist yet.

  Two sockets joining an empty room at the same instant is the normal case, not
  an edge case, so the race is resolved rather than avoided: the loser of the
  `start_link` sees `{:already_started, pid}` from the registry and uses the
  winner's process.
  """
  @spec ensure_started(String.t(), keyword()) :: {:ok, pid()} | {:error, term()}
  def ensure_started(room_id, opts \\ []) do
    case whereis(room_id) do
      nil -> start_room(room_id, opts)
      pid -> {:ok, pid}
    end
  end

  @doc "The room process for `room_id`, or `nil`."
  @spec whereis(String.t()) :: pid() | nil
  def whereis(room_id) do
    case Registry.lookup(@registry, room_id) do
      [{pid, _value}] -> pid
      [] -> nil
    end
  end

  @doc "Room ids currently running on this node."
  @spec list() :: [String.t()]
  def list do
    Registry.select(@registry, [{{:"$1", :_, :_}, [], [:"$1"]}])
  end

  @doc """
  Stop a room immediately.

  Rooms normally stop themselves once the last peer leaves; this is for tests
  and for an operator evicting a room by hand.
  """
  @spec stop(String.t()) :: :ok
  def stop(room_id) do
    case whereis(room_id) do
      nil -> :ok
      pid -> DynamicSupervisor.terminate_child(@rooms, pid)
    end

    :ok
  end

  defp start_room(room_id, opts) do
    child = {Server, Keyword.put(opts, :id, room_id)}

    case DynamicSupervisor.start_child(@rooms, child) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
      {:error, reason} -> {:error, reason}
    end
  end
end
