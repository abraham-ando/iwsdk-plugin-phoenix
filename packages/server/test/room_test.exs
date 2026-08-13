defmodule IwsdkPhoenix.RoomTest do
  use ExUnit.Case, async: true
  doctest IwsdkPhoenix.Physics.Kinematic

  alias IwsdkPhoenix.Physics.Kinematic
  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.Room.Handler
  alias IwsdkPhoenix.Room.State

  @identity %{x: 0.0, y: 0.0, z: 0.0, w: 1.0}
  @origin %{x: 0.0, y: 0.0, z: 0.0}

  defp input(sequence, opts \\ []) do
    %{
      sequence: sequence,
      delta_ms: Keyword.get(opts, :delta_ms, 100),
      movement: Keyword.get(opts, :movement, %{x: 0.0, y: 1.0}),
      yaw: Keyword.get(opts, :yaw, 0.0),
      buttons: 0
    }
  end

  describe "network id allocation" do
    test "assigns distinct ids and is idempotent per peer" do
      state = State.new("lobby")

      {state, alice} = State.join(state, "alice")
      {state, bob} = State.join(state, "bob")

      assert alice.network_id != bob.network_id

      # A socket reconnect must not orphan the peer's entity by handing it a
      # fresh identity.
      {_state, alice_again} = State.join(state, "alice")
      assert alice_again.network_id == alice.network_id
    end

    test "stays inside the positive Int32 range the client can store" do
      state = State.new("lobby")

      {_state, player} =
        Enum.reduce(1..100, {state, nil}, fn i, {acc, _} ->
          State.join(acc, "peer-#{i}")
        end)

      assert player.network_id > 0
      assert player.network_id <= 2_147_483_647
    end
  end

  describe "leaving" do
    test "removes the player and everything it owned" do
      state = State.new("lobby")
      {state, _alice} = State.join(state, "alice")
      {state, _bob} = State.join(state, "bob")

      assert State.player_count(state) == 2

      {state, player} = State.leave(state, "alice")
      assert player.peer_id == "alice"
      assert State.player_count(state) == 1
      assert State.player(state, "alice") == nil
    end

    test "is a no-op for an unknown peer" do
      state = State.new("lobby")
      assert {^state, nil} = State.leave(state, "ghost")
    end
  end

  describe "server authority" do
    test "re-simulates input and returns a correction" do
      state = State.new("lobby", mode: :server_authoritative, physics_opts: [move_speed: 10.0])
      {state, player} = State.join(state, "alice")

      {state, frame} = State.apply_input(state, "alice", input(1))

      assert {:ok, :reconcile, decoded} = Protocol.decode(frame)
      assert decoded.network_id == player.network_id
      assert decoded.last_processed_sequence == 1
      # 100 ms at 10 m/s forward = 1 m along -Z.
      assert_in_delta decoded.position.z, -1.0, 1.0e-5

      assert State.player(state, "alice").position.z < 0
    end

    test "ignores replayed and out-of-order sequences" do
      state = State.new("lobby", mode: :server_authoritative, physics_opts: [move_speed: 10.0])
      {state, _player} = State.join(state, "alice")

      {state, _} = State.apply_input(state, "alice", input(5))
      moved = State.player(state, "alice").position

      # Replaying sequence 5, and an older 3, must not move the player again.
      {state, _} = State.apply_input(state, "alice", input(5))
      {state, _} = State.apply_input(state, "alice", input(3))

      assert State.player(state, "alice").position == moved
    end

    test "clamps an oversized timestep" do
      state = State.new("lobby", mode: :server_authoritative, physics_opts: [move_speed: 10.0])
      {state, _player} = State.join(state, "alice")

      # A client claiming one ten-second frame must not cross the map.
      {state, _} = State.apply_input(state, "alice", input(1, delta_ms: 10_000))

      # Clamped to 100 ms => 1 m, not 100 m.
      assert_in_delta State.player(state, "alice").position.z, -1.0, 1.0e-5
    end

    test "clamps diagonal movement to the unit disc" do
      state = State.new("lobby", mode: :server_authoritative, physics_opts: [move_speed: 10.0])
      {state, _player} = State.join(state, "alice")

      {state, _} = State.apply_input(state, "alice", input(1, movement: %{x: 1.0, y: 1.0}))

      position = State.player(state, "alice").position
      speed = :math.sqrt(position.x * position.x + position.z * position.z)

      # sqrt(2) m would be the diagonal exploit; 1 m is correct.
      assert_in_delta speed, 1.0, 1.0e-5
    end

    test "an absurd movement magnitude confers no advantage" do
      state = State.new("lobby", mode: :server_authoritative, physics_opts: [move_speed: 10.0])
      {state, _player} = State.join(state, "alice")

      {state, _} = State.apply_input(state, "alice", input(1, movement: %{x: 0.0, y: 1000.0}))

      assert_in_delta State.player(state, "alice").position.z, -1.0, 1.0e-5
    end

    test "respects configured bounds" do
      bounds = %{min: %{x: -1.0, y: -1.0, z: -1.0}, max: %{x: 1.0, y: 1.0, z: 1.0}}

      state =
        State.new("lobby",
          mode: :server_authoritative,
          physics_opts: [move_speed: 100.0, bounds: bounds]
        )

      {state, _player} = State.join(state, "alice")
      {state, _} = State.apply_input(state, "alice", input(1))

      assert State.player(state, "alice").position.z >= -1.0
    end

    test "host-relayed rooms do not simulate at all" do
      state = State.new("lobby", mode: :host_relayed)
      {state, _player} = State.join(state, "alice")

      assert {^state, nil} = State.apply_input(state, "alice", input(1))
    end
  end

  describe "area of interest" do
    test "excludes the viewer's own avatar" do
      state = State.new("lobby")
      {state, _} = State.join(state, "alice", %{x: 0.0, y: 0.0, z: 0.0})
      {state, bob} = State.join(state, "bob", %{x: 1.0, y: 0.0, z: 0.0})

      snapshot = State.snapshot_for(state, "alice")

      assert Enum.map(snapshot, & &1.network_id) == [bob.network_id]
    end

    test "filters out players beyond the interest radius" do
      state = State.new("lobby", interest_radius: 50.0)
      {state, _} = State.join(state, "alice", @origin)
      {state, near} = State.join(state, "near", %{x: 10.0, y: 0.0, z: 0.0})
      {state, _far} = State.join(state, "far", %{x: 500.0, y: 0.0, z: 0.0})

      assert Enum.map(State.snapshot_for(state, "alice"), & &1.network_id) ==
               [near.network_id]
    end

    test "a nil radius disables filtering entirely" do
      state = State.new("lobby", interest_radius: nil)
      {state, _} = State.join(state, "alice", @origin)
      {state, _} = State.join(state, "far", %{x: 100_000.0, y: 0.0, z: 0.0})

      assert length(State.snapshot_for(state, "alice")) == 1
    end

    test "tracked transforms move a player in and out of view" do
      state = State.new("lobby", interest_radius: 50.0)
      {state, _} = State.join(state, "alice", @origin)
      {state, bob} = State.join(state, "bob", %{x: 500.0, y: 0.0, z: 0.0})

      assert State.snapshot_for(state, "alice") == []

      state = State.track_transform(state, "bob", %{x: 5.0, y: 0.0, z: 0.0})

      assert Enum.map(State.snapshot_for(state, "alice"), & &1.network_id) ==
               [bob.network_id]
    end
  end

  describe "Handler in host-relayed mode" do
    setup do
      state = State.new("lobby", mode: :host_relayed, interest_radius: nil)
      {state, _} = State.join(state, "alice")
      {:ok, state: state}
    end

    test "forwards a transform frame verbatim, without decoding", %{state: state} do
      frame = Protocol.encode_transform(1, %{x: 1.0, y: 2.0, z: 3.0}, @identity)

      assert {:broadcast, ^frame, _state} = Handler.handle_frame(state, "alice", frame)
    end

    test "forwards even a frame it cannot decode", %{state: state} do
      # The zero-decode fast path is the point of this mode: the server routes
      # on one byte and is not in the business of validating payloads.
      opaque = <<Protocol.op_spawn_entity(), "not really a spawn frame">>

      assert {:broadcast, ^opaque, _state} = Handler.handle_frame(state, "alice", opaque)
    end

    test "answers a ping without broadcasting it", %{state: state} do
      assert {:reply, pong, _state} =
               Handler.handle_frame(state, "alice", Protocol.encode_ping(1234.5))

      assert {:ok, :pong, %{timestamp: 1234.5}} = Protocol.decode(pong)
    end

    test "rejects an empty frame", %{state: state} do
      assert {:error, :empty_frame, _state} = Handler.handle_frame(state, "alice", <<>>)
    end
  end

  describe "Handler with interest filtering" do
    test "learns positions from relayed frames so it can filter" do
      state = State.new("lobby", mode: :host_relayed, interest_radius: 50.0)
      {state, _} = State.join(state, "alice", @origin)
      {state, bob} = State.join(state, "bob", %{x: 900.0, y: 0.0, z: 0.0})

      frame = Protocol.encode_transform(bob.network_id, %{x: 3.0, y: 0.0, z: 0.0}, @identity)
      assert {:broadcast, ^frame, state} = Handler.handle_frame(state, "bob", frame)

      # Bob is now near Alice, so he appears in her snapshot.
      assert Enum.map(State.snapshot_for(state, "alice"), & &1.network_id) ==
               [bob.network_id]
    end
  end

  describe "Handler in server-authoritative mode" do
    setup do
      state = State.new("lobby", mode: :server_authoritative, physics_opts: [move_speed: 10.0])

      {state, _} = State.join(state, "alice")
      {:ok, state: state}
    end

    test "replies to input with a correction", %{state: state} do
      frame =
        Protocol.encode_input(%{
          sequence: 1,
          delta_ms: 100,
          movement: %{x: 0.0, y: 1.0},
          yaw: 0.0,
          buttons: 0
        })

      assert {:reply, reconcile, _state} = Handler.handle_frame(state, "alice", frame)
      assert {:ok, :reconcile, _} = Protocol.decode(reconcile)
    end

    test "refuses a client asserting its own transform", %{state: state} do
      # Accepting this would make the mode meaningless. Rejecting rather than
      # silently ignoring makes a misconfigured client obvious.
      frame = Protocol.encode_transform(1, %{x: 999.0, y: 0.0, z: 0.0}, @identity)

      assert {:error, :client_authority_denied, _state} =
               Handler.handle_frame(state, "alice", frame)
    end

    test "refuses a client-authored snapshot", %{state: state} do
      frame = Protocol.encode_snapshot([], 0)

      assert {:error, :client_authority_denied, _state} =
               Handler.handle_frame(state, "alice", frame)
    end

    test "ignores input from an unknown peer", %{state: state} do
      frame =
        Protocol.encode_input(%{
          sequence: 1,
          delta_ms: 16,
          movement: %{x: 0.0, y: 1.0},
          yaw: 0.0,
          buttons: 0
        })

      assert {:noreply, _state} = Handler.handle_frame(state, "ghost", frame)
    end
  end

  describe "validate_join/1" do
    test "accepts only implemented modes" do
      assert {:ok, :host_relayed} = Handler.validate_join(%{})
      assert {:ok, :host_relayed} = Handler.validate_join(%{"mode" => "host_relayed"})

      assert {:ok, :server_authoritative} =
               Handler.validate_join(%{"mode" => "server_authoritative"})

      # An unknown mode must not silently fall back to something permissive.
      assert {:error, :unsupported_mode} = Handler.validate_join(%{"mode" => "trust_me"})
    end
  end

  describe "Kinematic" do
    test "clamps to the unit disc, preserving direction" do
      {x, y} = Kinematic.clamp_to_unit_disc(3.0, 4.0)

      assert_in_delta :math.sqrt(x * x + y * y), 1.0, 1.0e-9
      assert_in_delta x / y, 3.0 / 4.0, 1.0e-9
    end

    test "leaves an in-range vector untouched" do
      assert Kinematic.clamp_to_unit_disc(0.0, 0.5) == {0.0, 0.5}
    end

    test "yaw rotates the movement frame" do
      # Facing +90 degrees, "forward" points along +X rather than -Z.
      {x, z} = Kinematic.integrate(0.0, 0.0, 0.0, 1.0, :math.pi() / 2, 0.1, 10.0)

      assert_in_delta x, 1.0, 1.0e-9
      assert_in_delta z, 0.0, 1.0e-9
    end

    test "is deterministic" do
      args = [1.0, 2.0, 0.3, -0.7, 1.1, 0.016, 4.5]
      assert apply(Kinematic, :integrate, args) == apply(Kinematic, :integrate, args)
    end
  end
end
