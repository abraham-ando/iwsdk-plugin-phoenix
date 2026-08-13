defmodule IwsdkPhoenix.EntityTest do
  @moduledoc """
  Server-owned replicated objects.

  Without these a room can only replicate avatars. Combined with ownership
  transfer, this is what makes "pick up the ball" work end to end.
  """

  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.Room.Handler
  alias IwsdkPhoenix.Room.Server, as: RoomServer
  alias IwsdkPhoenix.Room.State

  @identity %{x: 0.0, y: 0.0, z: 0.0, w: 1.0}

  describe "spawning" do
    test "allocates an id and emits a decodable SPAWN frame" do
      state = State.new("lobby")

      {state, entity, frame} =
        State.spawn_entity(state,
          prefab_id: 42,
          position: %{x: 1.0, y: 2.0, z: 3.0}
        )

      assert entity.network_id > 0
      assert entity.prefab_id == 42
      assert entity.server_spawned

      assert {:ok, :spawn_entity, decoded} = Protocol.decode(frame)
      assert decoded.network_id == entity.network_id
      assert decoded.prefab_id == 42
      assert_in_delta decoded.position.y, 2.0, 1.0e-5

      assert State.entity(state, entity.network_id)
    end

    test "does not collide with player ids" do
      state = State.new("lobby")
      {state, alice} = State.join(state, "alice")
      {state, entity, _frame} = State.spawn_entity(state)
      {_state, bob} = State.join(state, "bob")

      assert length(Enum.uniq([alice.network_id, entity.network_id, bob.network_id])) == 3
    end

    test "despawn emits a frame and is harmless when repeated" do
      state = State.new("lobby")
      {state, entity, _frame} = State.spawn_entity(state)

      {state, frame} = State.despawn_entity(state, entity.network_id)
      assert {:ok, :despawn_entity, %{network_id: id}} = Protocol.decode(frame)
      assert id == entity.network_id

      # A duplicate despawn must not emit a second broadcast clients would
      # have to learn to ignore.
      assert {_state, nil} = State.despawn_entity(state, entity.network_id)
    end

    test "lists spawned entities in id order" do
      state = State.new("lobby")
      {state, _e1, _} = State.spawn_entity(state)
      {state, _e2, _} = State.spawn_entity(state)
      {state, _e3, _} = State.spawn_entity(state)

      ids = state |> State.entities() |> Enum.map(& &1.network_id)
      assert ids == Enum.sort(ids)
      assert length(ids) == 3
    end
  end

  describe "replication" do
    test "spawned objects appear in a viewer's snapshot" do
      state = State.new("lobby", interest_radius: nil)
      {state, _alice} = State.join(state, "alice")
      {state, ball, _} = State.spawn_entity(state, position: %{x: 4.0, y: 0.0, z: 0.0})

      records = State.snapshot_for(state, "alice")

      assert Enum.map(records, & &1.network_id) == [ball.network_id]
      assert_in_delta hd(records).position.x, 4.0, 1.0e-6
    end

    test "objects are area-of-interest filtered like players" do
      state = State.new("lobby", interest_radius: 50.0)
      {state, _alice} = State.join(state, "alice", %{x: 0.0, y: 0.0, z: 0.0})
      {state, near, _} = State.spawn_entity(state, position: %{x: 10.0, y: 0.0, z: 0.0})
      {state, _far, _} = State.spawn_entity(state, position: %{x: 900.0, y: 0.0, z: 0.0})

      assert Enum.map(State.snapshot_for(state, "alice"), & &1.network_id) ==
               [near.network_id]
    end

    test "an object the viewer owns is excluded from their own snapshot" do
      # They predict it locally; echoing it back would fight that prediction,
      # exactly as for their own avatar.
      state = State.new("lobby", interest_radius: nil)
      {state, _alice} = State.join(state, "alice")
      {state, ball, _} = State.spawn_entity(state, position: %{x: 1.0, y: 0.0, z: 0.0})
      {state, grant} = State.request_ownership(state, "alice", ball.network_id, 1)

      assert grant.granted
      assert State.snapshot_for(state, "alice") == []
    end

    test "but another player still sees it" do
      state = State.new("lobby", interest_radius: nil)
      {state, _alice} = State.join(state, "alice")
      {state, _bob} = State.join(state, "bob")
      {state, ball, _} = State.spawn_entity(state, position: %{x: 1.0, y: 0.0, z: 0.0})
      {state, _grant} = State.request_ownership(state, "alice", ball.network_id, 1)

      assert ball.network_id in Enum.map(State.snapshot_for(state, "bob"), & &1.network_id)
    end

    test "a bare ownership record is not replicated" do
      # Ownership can be claimed over a client-side entity the server never
      # spawned; there is no authoritative transform to send for it.
      state = State.new("lobby", interest_radius: nil)
      {state, _alice} = State.join(state, "alice")
      {state, _bob} = State.join(state, "bob")
      {state, grant} = State.request_ownership(state, "bob", 12_345, 1)

      assert grant.granted
      refute 12_345 in Enum.map(State.snapshot_for(state, "alice"), & &1.network_id)
    end
  end

  describe "authority over object transforms" do
    setup do
      state = State.new("lobby", interest_radius: nil)
      {state, alice} = State.join(state, "alice")
      {state, bob} = State.join(state, "bob")
      {state, ball, _} = State.spawn_entity(state, position: %{x: 0.0, y: 0.0, z: 0.0})
      {:ok, state: state, alice: alice, bob: bob, ball: ball}
    end

    test "the owner may move it", %{state: state, alice: alice, ball: ball} do
      {state, _grant} = State.request_ownership(state, "alice", ball.network_id, 1)

      assert {:ok, state} =
               State.track_entity_transform(
                 state,
                 alice.network_id,
                 ball.network_id,
                 %{x: 9.0, y: 0.0, z: 0.0},
                 @identity
               )

      assert_in_delta State.entity(state, ball.network_id).position.x, 9.0, 1.0e-6
    end

    test "a non-owner may not", %{state: state, bob: bob, ball: ball} do
      # Otherwise any client could teleport any object, which is the same
      # authority hole ownership arbitration exists to close.
      {state, _grant} = State.request_ownership(state, "alice", ball.network_id, 1)

      assert {:error, :not_owner} =
               State.track_entity_transform(
                 state,
                 bob.network_id,
                 ball.network_id,
                 %{x: 99.0, y: 0.0, z: 0.0},
                 @identity
               )
    end

    test "an unknown entity is reported, not silently created", %{
      state: state,
      alice: alice
    } do
      assert {:error, :unknown_entity} =
               State.track_entity_transform(
                 state,
                 alice.network_id,
                 999_999,
                 %{x: 0.0, y: 0.0, z: 0.0},
                 @identity
               )
    end

    test "a relayed frame from the owner updates server state", %{
      state: state,
      ball: ball
    } do
      # The relay path must still learn where the object is, or area-of-interest
      # filtering would work off a stale position.
      {state, _grant} = State.request_ownership(state, "alice", ball.network_id, 1)

      frame = Protocol.encode_transform(ball.network_id, %{x: 6.0, y: 0.0, z: 0.0}, @identity)

      assert {:broadcast, ^frame, state} = Handler.handle_frame(state, "alice", frame)
      assert_in_delta State.entity(state, ball.network_id).position.x, 6.0, 1.0e-5
    end

    test "a relayed frame from a non-owner is forwarded but ignored", %{
      state: state,
      ball: ball
    } do
      {state, _grant} = State.request_ownership(state, "alice", ball.network_id, 1)

      frame = Protocol.encode_transform(ball.network_id, %{x: 77.0, y: 0.0, z: 0.0}, @identity)

      assert {:broadcast, ^frame, state} = Handler.handle_frame(state, "bob", frame)
      # Relayed for compatibility, but the server's authoritative copy is intact.
      assert_in_delta State.entity(state, ball.network_id).position.x, 0.0, 1.0e-5
    end
  end

  describe "position tracking gate" do
    test "a pure relay with no AoI and no objects stays on the zero-decode path" do
      state = State.new("lobby", interest_radius: nil)
      {state, _alice} = State.join(state, "alice")

      # Nothing needs the positions, so an undecodable body is still forwarded.
      opaque = <<Protocol.op_transform_update(), "not a real transform">>
      assert {:broadcast, ^opaque, _state} = Handler.handle_frame(state, "alice", opaque)
    end

    test "spawning an object turns tracking on even with AoI disabled" do
      # Regression: gating tracking on interest_radius alone meant a room with
      # objects but no interest radius replicated them from their spawn
      # position forever.
      state = State.new("lobby", interest_radius: nil)
      {state, _alice} = State.join(state, "alice")
      {state, ball, _} = State.spawn_entity(state, position: %{x: 0.0, y: 0.0, z: 0.0})
      {state, _grant} = State.request_ownership(state, "alice", ball.network_id, 1)

      frame = Protocol.encode_transform(ball.network_id, %{x: 5.0, y: 0.0, z: 0.0}, @identity)

      assert {:broadcast, ^frame, state} = Handler.handle_frame(state, "alice", frame)
      assert_in_delta State.entity(state, ball.network_id).position.x, 5.0, 1.0e-5
    end
  end

  describe "lifecycle across a room process" do
    test "spawn and despawn through the GenServer" do
      {:ok, room} =
        RoomServer.start_link(
          id: "entities-#{System.unique_integer([:positive])}",
          name: nil,
          interest_radius: nil
        )

      {:ok, _alice} = RoomServer.join(room, "alice")
      assert {:ok, ball, spawn_frame} = RoomServer.spawn_entity(room, prefab_id: 7)

      assert {:ok, :spawn_entity, _} = Protocol.decode(spawn_frame)
      assert length(State.entities(RoomServer.state(room))) == 1

      assert {:ok, despawn_frame} = RoomServer.despawn_entity(room, ball.network_id)
      assert {:ok, :despawn_entity, _} = Protocol.decode(despawn_frame)
      assert State.entities(RoomServer.state(room)) == []
    end

    test "an owner leaving releases the object rather than stranding it" do
      state = State.new("lobby")
      {state, _alice} = State.join(state, "alice")
      {state, ball, _} = State.spawn_entity(state)
      {state, _grant} = State.request_ownership(state, "alice", ball.network_id, 1)

      {state, _player} = State.leave(state, "alice")

      # The entity record goes with its owner; a fresh spawn is the room's job.
      assert State.entity(state, ball.network_id) == nil
    end
  end
end
