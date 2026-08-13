defmodule IwsdkPhoenix.RoomServerTest do
  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.Room.Server, as: RoomServer
  alias IwsdkPhoenix.Room.State

  @identity %{x: 0.0, y: 0.0, z: 0.0, w: 1.0}

  defp start_room(opts \\ []) do
    test_pid = self()

    defaults = [
      id: "room-#{System.unique_integer([:positive])}",
      tick_hz: 50,
      broadcast: fn {peer_id, frame} -> send(test_pid, {:snapshot, peer_id, frame}) end
    ]

    {:ok, pid} = RoomServer.start_link(Keyword.merge(defaults, opts) |> Keyword.put(:name, nil))
    pid
  end

  test "admits peers and allocates ids" do
    room = start_room()

    assert {:ok, alice} = RoomServer.join(room, "alice")
    assert {:ok, bob} = RoomServer.join(room, "bob")

    assert alice.network_id != bob.network_id
    assert State.player_count(RoomServer.state(room)) == 2
  end

  test "relays a frame in host-relayed mode" do
    room = start_room()
    {:ok, _} = RoomServer.join(room, "alice")

    frame = Protocol.encode_transform(1, %{x: 1.0, y: 0.0, z: 0.0}, @identity)

    assert {:broadcast, ^frame} = RoomServer.handle_frame(room, "alice", frame)
  end

  test "returns a correction in server-authoritative mode" do
    room = start_room(mode: :server_authoritative, physics_opts: [move_speed: 10.0])
    {:ok, _} = RoomServer.join(room, "alice")

    frame =
      Protocol.encode_input(%{
        sequence: 1,
        delta_ms: 100,
        movement: %{x: 0.0, y: 1.0},
        yaw: 0.0,
        buttons: 0
      })

    assert {:reply, reconcile} = RoomServer.handle_frame(room, "alice", frame)
    assert {:ok, :reconcile, decoded} = Protocol.decode(reconcile)
    assert_in_delta decoded.position.z, -1.0, 1.0e-5
  end

  test "surfaces a rejection rather than crashing" do
    room = start_room(mode: :server_authoritative)
    {:ok, _} = RoomServer.join(room, "alice")

    frame = Protocol.encode_transform(1, %{x: 0.0, y: 0.0, z: 0.0}, @identity)

    assert {:error, :client_authority_denied} = RoomServer.handle_frame(room, "alice", frame)
    assert Process.alive?(room)
  end

  test "ticks and broadcasts a per-viewer snapshot" do
    room = start_room(tick_hz: 50)
    {:ok, _} = RoomServer.join(room, "alice", %{x: 0.0, y: 0.0, z: 0.0})
    {:ok, bob} = RoomServer.join(room, "bob", %{x: 1.0, y: 0.0, z: 0.0})

    # Alice must receive a snapshot describing Bob, and not herself.
    assert_receive {:snapshot, "alice", frame}, 500

    assert {:ok, :snapshot, decoded} = Protocol.decode(frame)
    assert Enum.map(decoded.records, & &1.network_id) == [bob.network_id]
  end

  test "the tick counter advances even with nothing to broadcast" do
    # The loop must keep running independently of whether it has traffic to
    # send; a room that only ticks when someone is listening cannot drive
    # server-side simulation.
    room = start_room(tick_hz: 100)
    {:ok, _} = RoomServer.join(room, "alice")

    first = RoomServer.state(room).tick
    Process.sleep(80)

    assert RoomServer.state(room).tick > first
  end

  test "an empty room broadcasts nothing" do
    _room = start_room(tick_hz: 100)

    # Nothing to send when there are no players, so no wasted frames.
    refute_receive {:snapshot, _, _}, 100
  end

  test "a lone player receives no snapshot" do
    room = start_room(tick_hz: 100)
    {:ok, _} = RoomServer.join(room, "solo")

    # Their own position is predicted locally; echoing it back would fight
    # client-side prediction, so an empty snapshot is simply not sent.
    refute_receive {:snapshot, "solo", _}, 100
  end

  test "leaving removes the player from later snapshots" do
    room = start_room(tick_hz: 100)
    {:ok, _} = RoomServer.join(room, "alice")
    {:ok, _} = RoomServer.join(room, "bob", %{x: 1.0, y: 0.0, z: 0.0})

    assert_receive {:snapshot, "alice", _}, 500

    {:ok, _} = RoomServer.leave(room, "bob")

    assert State.player_count(RoomServer.state(room)) == 1
    refute_receive {:snapshot, "alice", _}, 100
  end

  test "survives a flood of malformed frames" do
    room = start_room()
    {:ok, _} = RoomServer.join(room, "alice")

    for _ <- 1..200 do
      RoomServer.handle_frame(room, "alice", :crypto.strong_rand_bytes(:rand.uniform(40)))
    end

    assert Process.alive?(room)
    assert State.player_count(RoomServer.state(room)) == 1
  end
end
