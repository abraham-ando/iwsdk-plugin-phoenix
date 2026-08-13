defmodule IwsdkPhoenix.ZoneTest do
  @moduledoc """
  Zone handoff and cross-zone id allocation.

  The invariant under test throughout: a player is never in two zones at once,
  and never in none.
  """

  use ExUnit.Case, async: true
  doctest IwsdkPhoenix.Zone.IdAllocator

  @moduletag :capture_log

  alias IwsdkPhoenix.Room.Server, as: RoomServer
  alias IwsdkPhoenix.Room.State
  alias IwsdkPhoenix.Zone.Handoff
  alias IwsdkPhoenix.Zone.IdAllocator

  defp start_zone(index, opts \\ []) do
    {:ok, pid} =
      RoomServer.start_link(
        [
          id: "zone-#{index}-#{System.unique_integer([:positive])}",
          name: nil,
          tick_hz: 20,
          mode: :server_authoritative,
          allocator: IdAllocator.partitioned(index)
        ] ++ opts
      )

    pid
  end

  # ---------------------------------------------------------------------------
  # Id allocation
  # ---------------------------------------------------------------------------

  describe "partitioned id allocation" do
    test "zones never collide" do
      # The whole reason partitioning exists: two zones counting from 1 would
      # both hand out id 1, and the collision is silent.
      allocators =
        for zone <- 0..7 do
          {allocator, state} = IdAllocator.partitioned(zone)

          Enum.map_reduce(1..50, state, fn _i, acc -> allocator.(acc) end)
          |> elem(0)
        end

      all = List.flatten(allocators)
      assert length(all) == length(Enum.uniq(all))
    end

    test "every id stays a positive Int32" do
      {allocator, state} = IdAllocator.partitioned(255)
      {ids, _state} = Enum.map_reduce(1..100, state, fn _i, acc -> allocator.(acc) end)

      assert Enum.all?(ids, &(&1 > 0))
      assert Enum.all?(ids, &(&1 <= IdAllocator.max_id()))
    end

    test "zone 0 never emits id 0, which means 'unassigned' on the client" do
      {allocator, state} = IdAllocator.partitioned(0)
      {ids, _state} = Enum.map_reduce(1..1000, state, fn _i, acc -> allocator.(acc) end)

      refute 0 in ids
    end

    test "the zone index is recoverable from an id" do
      for zone <- [0, 1, 42, 255] do
        {allocator, state} = IdAllocator.partitioned(zone)
        {id, _state} = allocator.(state)
        assert IdAllocator.zone_of(id) == zone
      end
    end

    test "rejects a zone index that does not fit its bit budget" do
      assert_raise ArgumentError, fn -> IdAllocator.partitioned(256, 8) end
    end

    test "the local allocator wraps rather than overflowing Int32" do
      {allocator, _state} = IdAllocator.local()
      {id, next} = allocator.(IdAllocator.max_id())

      assert id == IdAllocator.max_id()
      assert next == 1
    end

    test "a room uses the allocator it was given" do
      state = State.new("zone-5", allocator: IdAllocator.partitioned(5))
      {_state, player} = State.join(state, "alice")

      assert IdAllocator.zone_of(player.network_id) == 5
    end
  end

  # ---------------------------------------------------------------------------
  # Handoff, at the pure-state level
  # ---------------------------------------------------------------------------

  describe "migration state" do
    test "prepare marks without removing, so a failure cannot lose the player" do
      state = State.new("a")
      {state, player} = State.join(state, "alice", %{x: 5.0, y: 0.0, z: -3.0})

      {state, snapshot} = State.begin_migration(state, "alice")

      assert snapshot.network_id == player.network_id
      assert snapshot.position == %{x: 5.0, y: 0.0, z: -3.0}
      # Still present: an unreachable target must not strand them.
      assert State.player(state, "alice")
      assert State.migrating?(state, "alice")
    end

    test "a migrating player stops being simulated by the source" do
      # Otherwise both zones simulate them and the copies diverge.
      state = State.new("a", mode: :server_authoritative, physics_opts: [move_speed: 10.0])
      {state, _player} = State.join(state, "alice")
      {state, _snapshot} = State.begin_migration(state, "alice")

      input = %{
        sequence: 1,
        delta_ms: 100,
        movement: %{x: 0.0, y: 1.0},
        yaw: 0.0,
        buttons: 0
      }

      {state, reply} = State.apply_input(state, "alice", input)

      assert reply == nil
      assert State.player(state, "alice").position.z == 0.0
    end

    test "abort restores the player to normal service" do
      state = State.new("a", mode: :server_authoritative, physics_opts: [move_speed: 10.0])
      {state, _player} = State.join(state, "alice")
      {state, _snapshot} = State.begin_migration(state, "alice")
      state = State.abort_migration(state, "alice")

      refute State.migrating?(state, "alice")

      {state, reply} =
        State.apply_input(state, "alice", %{
          sequence: 1,
          delta_ms: 100,
          movement: %{x: 0.0, y: 1.0},
          yaw: 0.0,
          buttons: 0
        })

      assert reply != nil
      assert_in_delta State.player(state, "alice").position.z, -1.0, 1.0e-5
    end

    test "admit preserves the network id and owned entities" do
      source = State.new("a", allocator: IdAllocator.partitioned(0))
      {source, player} = State.join(source, "alice", %{x: 1.0, y: 2.0, z: 3.0})
      {source, _grant} = State.request_ownership(source, "alice", 900, 1)
      {_source, snapshot} = State.begin_migration(source, "alice")

      target = State.new("b", allocator: IdAllocator.partitioned(1))
      {target, admitted} = State.admit_migrated(target, snapshot)

      # Renumbering would be a visible despawn/respawn for every other client.
      assert admitted.network_id == player.network_id
      assert admitted.position == %{x: 1.0, y: 2.0, z: 3.0}
      assert State.owner_of(target, 900) == player.network_id
    end

    test "complete removes the player from the source" do
      state = State.new("a")
      {state, _player} = State.join(state, "alice")
      {state, _snapshot} = State.begin_migration(state, "alice")
      state = State.complete_migration(state, "alice")

      assert State.player(state, "alice") == nil
      refute State.migrating?(state, "alice")
    end
  end

  # ---------------------------------------------------------------------------
  # Handoff, across live zone processes
  # ---------------------------------------------------------------------------

  describe "transfer between zone processes" do
    test "moves the player exactly once" do
      zone_a = start_zone(0)
      zone_b = start_zone(1)

      {:ok, player} = RoomServer.join(zone_a, "alice", %{x: 12.0, y: 0.0, z: -8.0})

      assert {:ok, moved} = Handoff.transfer(zone_a, zone_b, "alice")

      assert moved.network_id == player.network_id
      assert moved.position == %{x: 12.0, y: 0.0, z: -8.0}

      # Present in exactly one zone.
      assert State.player(RoomServer.state(zone_a), "alice") == nil
      assert State.player(RoomServer.state(zone_b), "alice")
      assert State.player_count(RoomServer.state(zone_a)) == 0
      assert State.player_count(RoomServer.state(zone_b)) == 1
    end

    test "carries owned entities across" do
      zone_a = start_zone(0)
      zone_b = start_zone(1)

      {:ok, player} = RoomServer.join(zone_a, "alice")

      RoomServer.handle_frame(
        zone_a,
        "alice",
        IwsdkPhoenix.Protocol.encode_ownership_request(500, 1)
      )

      assert {:ok, _moved} = Handoff.transfer(zone_a, zone_b, "alice")

      assert State.owner_of(RoomServer.state(zone_b), 500) == player.network_id
      assert State.owner_of(RoomServer.state(zone_a), 500) == nil
    end

    test "the player keeps simulating in the target after the move" do
      zone_a = start_zone(0)
      zone_b = start_zone(1)

      {:ok, _player} = RoomServer.join(zone_a, "alice")
      assert {:ok, _moved} = Handoff.transfer(zone_a, zone_b, "alice")

      frame =
        IwsdkPhoenix.Protocol.encode_input(%{
          sequence: 1,
          delta_ms: 100,
          movement: %{x: 0.0, y: 1.0},
          yaw: 0.0,
          buttons: 0
        })

      assert {:reply, _reconcile} = RoomServer.handle_frame(zone_b, "alice", frame)
    end

    test "retains the player in the source when the target is unreachable" do
      # The failure mode that matters: a dead target must not lose the player.
      zone_a = start_zone(0)
      zone_b = start_zone(1)
      {:ok, _player} = RoomServer.join(zone_a, "alice")

      GenServer.stop(zone_b, :normal)

      assert {:error, {:commit_failed, _reason}} = Handoff.transfer(zone_a, zone_b, "alice")

      # Still here, and no longer marked, so they simulate normally again.
      assert State.player(RoomServer.state(zone_a), "alice")
      refute State.migrating?(RoomServer.state(zone_a), "alice")
    end

    test "reports an unknown peer without touching either zone" do
      zone_a = start_zone(0)
      zone_b = start_zone(1)

      assert {:error, :unknown_peer} = Handoff.transfer(zone_a, zone_b, "ghost")
      assert State.player_count(RoomServer.state(zone_b)) == 0
    end

    test "surfaces an unreachable source as an error rather than an exit" do
      zone_a = start_zone(0)
      zone_b = start_zone(1)
      GenServer.stop(zone_a, :normal)

      assert {:error, {:prepare_failed, _reason}} = Handoff.transfer(zone_a, zone_b, "alice")
    end

    test "a chain of moves keeps exactly one copy" do
      zones = for index <- 0..3, do: start_zone(index)
      [first | _rest] = zones

      {:ok, player} = RoomServer.join(first, "alice", %{x: 1.0, y: 0.0, z: 1.0})

      Enum.zip(zones, tl(zones))
      |> Enum.each(fn {source, target} ->
        assert {:ok, _moved} = Handoff.transfer(source, target, "alice")
      end)

      present =
        Enum.count(zones, fn zone -> State.player(RoomServer.state(zone), "alice") != nil end)

      assert present == 1

      assert List.last(zones)
             |> RoomServer.state()
             |> State.player("alice")
             |> Map.get(:network_id) ==
               player.network_id
    end
  end
end
