defmodule IwsdkPhoenix.RoomSupervisorTest do
  @moduledoc """
  The property this module exists for: every socket in a room must reach the
  *same* room process.

  Before it existed, `RoomChannel` built a room in each socket's assigns, so two
  peers in `room:lobby` each held a private copy — both allocated network id 1,
  neither appeared in the other's snapshot, and ownership was arbitrated twice
  against two different views. Nothing errored. These tests pin the sharing down
  where it can be checked without Phoenix.
  """

  # Not async: the supervisor registers globally named children.
  use ExUnit.Case, async: false

  alias IwsdkPhoenix.Room.Server
  alias IwsdkPhoenix.Room.State
  alias IwsdkPhoenix.RoomSupervisor

  setup do
    start_supervised!(RoomSupervisor)
    :ok
  end

  describe "ensure_started/2" do
    test "starts a room on first use" do
      assert RoomSupervisor.whereis("lobby") == nil

      {:ok, pid} = RoomSupervisor.ensure_started("lobby")

      assert Process.alive?(pid)
      assert RoomSupervisor.whereis("lobby") == pid
    end

    test "returns the same process for the same room" do
      {:ok, first} = RoomSupervisor.ensure_started("lobby")
      {:ok, second} = RoomSupervisor.ensure_started("lobby")

      assert first == second
    end

    test "keeps different rooms apart" do
      {:ok, lobby} = RoomSupervisor.ensure_started("lobby")
      {:ok, arena} = RoomSupervisor.ensure_started("arena")

      refute lobby == arena
    end

    test "resolves a race between two joiners without either losing" do
      # Two peers joining an empty room at the same instant is the normal case
      # for a room that starts on demand, not an edge case.
      results =
        1..20
        |> Task.async_stream(fn _ -> RoomSupervisor.ensure_started("stampede") end,
          max_concurrency: 20
        )
        |> Enum.map(fn {:ok, result} -> result end)

      assert Enum.all?(results, &match?({:ok, pid} when is_pid(pid), &1))
      assert results |> Enum.map(fn {:ok, pid} -> pid end) |> Enum.uniq() |> length() == 1
    end

    test "the shared room allocates distinct ids to distinct peers" do
      # The whole point. A per-socket room hands every peer id 1.
      {:ok, room} = RoomSupervisor.ensure_started("lobby")

      {:ok, alice} = Server.join(room, "alice")
      {:ok, bob} = Server.join(room, "bob")

      refute alice.network_id == bob.network_id
    end

    test "a peer rejoining keeps its id" do
      {:ok, room} = RoomSupervisor.ensure_started("lobby")

      {:ok, first} = Server.join(room, "alice")
      {:ok, second} = Server.join(room, "alice")

      assert first.network_id == second.network_id
    end

    test "every joiner sees every other in the roster" do
      {:ok, room} = RoomSupervisor.ensure_started("lobby")

      {:ok, _alice} = Server.join(room, "alice")
      {:ok, _bob} = Server.join(room, "bob")

      peers = room |> Server.state() |> State.players() |> Enum.map(& &1.peer_id)

      assert peers == ["alice", "bob"]
    end

    test "options apply to the room the first joiner creates" do
      {:ok, room} = RoomSupervisor.ensure_started("lobby", mode: :server_authoritative)

      assert Server.state(room).mode == :server_authoritative
    end

    test "a later joiner does not re-configure a live room" do
      # A room's authority model cannot change under the players already in it,
      # which is why the channel replies with the room's mode rather than the
      # one the client asked for.
      {:ok, room} = RoomSupervisor.ensure_started("lobby", mode: :server_authoritative)
      {:ok, same} = RoomSupervisor.ensure_started("lobby", mode: :host_relayed)

      assert same == room
      assert Server.state(room).mode == :server_authoritative
    end
  end

  describe "lifecycle" do
    test "a room stops itself when its last peer leaves" do
      {:ok, room} = RoomSupervisor.ensure_started("lobby", stop_when_empty: true)
      reference = Process.monitor(room)

      {:ok, _alice} = Server.join(room, "alice")
      {:ok, _player} = Server.leave(room, "alice")

      assert_receive {:DOWN, ^reference, :process, ^room, :normal}, 1_000
      assert RoomSupervisor.whereis("lobby") == nil
    end

    test "a room stays up while anyone is still in it" do
      {:ok, room} = RoomSupervisor.ensure_started("lobby", stop_when_empty: true)

      {:ok, _alice} = Server.join(room, "alice")
      {:ok, _bob} = Server.join(room, "bob")
      {:ok, _player} = Server.leave(room, "alice")

      assert Process.alive?(room)
    end

    test "a room that stopped normally is not restarted" do
      # :transient, not :permanent. A room reaped with its last occupant must
      # stay reaped, or the supervisor immediately resurrects an empty room and
      # the reaping accomplishes nothing.
      {:ok, room} = RoomSupervisor.ensure_started("lobby", stop_when_empty: true)
      reference = Process.monitor(room)

      {:ok, _alice} = Server.join(room, "alice")
      {:ok, _player} = Server.leave(room, "alice")
      assert_receive {:DOWN, ^reference, :process, ^room, :normal}, 1_000

      Process.sleep(50)

      assert RoomSupervisor.whereis("lobby") == nil
    end

    test "stop_when_empty is off by default" do
      {:ok, room} = RoomSupervisor.ensure_started("lobby")

      {:ok, _alice} = Server.join(room, "alice")
      {:ok, _player} = Server.leave(room, "alice")

      assert Process.alive?(room)
    end

    test "a room can be evicted by hand" do
      {:ok, room} = RoomSupervisor.ensure_started("lobby")
      reference = Process.monitor(room)

      :ok = RoomSupervisor.stop("lobby")

      assert_receive {:DOWN, ^reference, :process, ^room, _reason}, 1_000
      assert RoomSupervisor.whereis("lobby") == nil
    end

    test "stopping an unknown room is harmless" do
      assert RoomSupervisor.stop("never-existed") == :ok
    end

    test "rejoining after a room was reaped starts a fresh one" do
      {:ok, first} = RoomSupervisor.ensure_started("lobby", stop_when_empty: true)
      reference = Process.monitor(first)

      {:ok, _alice} = Server.join(first, "alice")
      {:ok, _player} = Server.leave(first, "alice")
      assert_receive {:DOWN, ^reference, :process, ^first, :normal}, 1_000

      {:ok, second} = RoomSupervisor.ensure_started("lobby")

      refute second == first
      assert Process.alive?(second)
    end
  end

  describe "introspection" do
    test "lists the running rooms" do
      {:ok, _lobby} = RoomSupervisor.ensure_started("lobby")
      {:ok, _arena} = RoomSupervisor.ensure_started("arena")

      assert Enum.sort(RoomSupervisor.list()) == ["arena", "lobby"]
    end

    test "reports itself as running" do
      assert RoomSupervisor.running?()
    end

    test "ensure_running is a no-op once it is up" do
      assert RoomSupervisor.ensure_running() == :ok
      assert RoomSupervisor.running?()
    end
  end

  describe "ensure_running/0 from scratch" do
    setup do
      # This block needs the tree *down*, so undo the outer setup.
      stop_supervised!(RoomSupervisor)
      refute RoomSupervisor.running?()

      # These tests deliberately leave an *unsupervised* tree behind, so ExUnit
      # cannot clean it up. Tear it down synchronously, or the next test's
      # `start_supervised!` collides with a registry that is still shutting down.
      on_exit(&kill_supervisor/0)
      :ok
    end

    test "starts the tree" do
      assert RoomSupervisor.ensure_running() == :ok
      assert RoomSupervisor.running?()
    end

    test "does not link the tree to its caller" do
      # The property that matters. `Supervisor.start_link/3` links, so a
      # supervisor started lazily from inside a channel would die with the first
      # socket to disconnect and take every room on the node with it — a failure
      # that only ever appears once there are two players.
      caller =
        spawn(fn ->
          RoomSupervisor.ensure_running()

          receive do
            :die -> exit(:normal)
          end
        end)

      wait_until(fn -> RoomSupervisor.running?() end)
      supervisor = Process.whereis(RoomSupervisor)
      reference = Process.monitor(caller)

      send(caller, :die)
      assert_receive {:DOWN, ^reference, :process, ^caller, _reason}, 1_000

      Process.sleep(50)
      assert Process.alive?(supervisor)
    end
  end

  defp kill_supervisor do
    case Process.whereis(RoomSupervisor) do
      nil ->
        :ok

      pid ->
        # `Supervisor.stop/1` rather than `Process.exit(pid, :kill)`: it is
        # synchronous, shuts the children down in order, and does not fill the
        # test output with crash reports for a teardown we asked for.
        Supervisor.stop(pid, :normal)
    end

    # The named children die with the supervisor, but asynchronously; waiting on
    # the names is what makes this safe to follow with another start.
    wait_until(fn ->
      Process.whereis(RoomSupervisor.registry()) == nil and
        Process.whereis(IwsdkPhoenix.Room.DynamicSupervisor) == nil
    end)
  end

  defp wait_until(predicate, attempts \\ 100) do
    cond do
      predicate.() -> :ok
      attempts == 0 -> flunk("condition never became true")
      true -> Process.sleep(10) && wait_until(predicate, attempts - 1)
    end
  end
end
