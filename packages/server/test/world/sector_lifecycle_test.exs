defmodule IwsdkPhoenix.World.SectorLifecycleTest do
  use ExUnit.Case, async: false

  alias IwsdkPhoenix.Clock
  alias IwsdkPhoenix.Room.Server, as: Room
  alias IwsdkPhoenix.World.Snapshots
  alias IwsdkPhoenix.World.Weather

  setup do
    unless Process.whereis(Snapshots), do: start_supervised!(Snapshots)
    :ok
  end

  defp unique_id, do: "sector-#{System.unique_integer([:positive])}"

  # `name: nil` keeps the room out of the Registry, which lives under
  # RoomSupervisor — these tests exercise the sector's own lifecycle, not its
  # registration. Same pattern as `room_server_test.exs`.
  defp start_room(opts) do
    {:ok, pid} = Room.start_link(Keyword.put(opts, :name, nil))
    pid
  end

  describe "snapshot on stop" do
    test "a persistent sector writes a snapshot when its last peer leaves" do
      id = unique_id()
      room = start_room(id: id, persistent: true, stop_when_empty: true)
      {:ok, _player} = Room.join(room, "alice")

      ref = Process.monitor(room)
      {:ok, _player} = Room.leave(room, "alice")
      assert_receive {:DOWN, ^ref, :process, _pid, :normal}, 1000

      snapshot = Snapshots.get(id)
      assert snapshot != nil
      assert Map.has_key?(snapshot, :world_time_ms)
      assert Map.has_key?(snapshot, :last_seen_ms)
      assert snapshot.epoch == Clock.epoch()
    end

    test "a non-persistent sector leaves nothing behind" do
      # The regression guard: today's behaviour must be unchanged for anyone
      # who has not asked for a persistent world.
      id = unique_id()
      room = start_room(id: id, persistent: false, stop_when_empty: true)
      {:ok, _player} = Room.join(room, "alice")

      ref = Process.monitor(room)
      {:ok, _player} = Room.leave(room, "alice")
      assert_receive {:DOWN, ^ref, :process, _pid, :normal}, 1000

      assert Snapshots.get(id) == nil
    end
  end

  describe "fast-forward on start" do
    test "a sector reopens with its world advanced by the time it slept" do
      id = unique_id()

      Snapshots.put(id, %{
        world_time_ms: 1_000,
        weather: Weather.new(id, 1_000),
        last_seen_ms: Clock.now_ms() - 3_600_000,
        epoch: Clock.epoch()
      })

      room = start_room(id: id, persistent: true)

      # An hour of world time, give or take the milliseconds this test took.
      assert_in_delta Room.state(room).world_time_ms, 1_000 + 3_600_000, 2_000
    end

    test "a snapshot from a different epoch restores without advancing" do
      # The node restarted: `last_seen_ms` is in a monotonic base that no
      # longer exists, so any elapsed span computed from it would be arbitrary.
      # Better a visibly conservative world than one that leaps seventeen years.
      id = unique_id()

      Snapshots.put(id, %{
        world_time_ms: 5_000,
        weather: Weather.new(id, 5_000),
        last_seen_ms: -999_999_999,
        epoch: Clock.epoch() + 1
      })

      room = start_room(id: id, persistent: true)

      assert Room.state(room).world_time_ms == 5_000
    end

    test "a sector with no snapshot starts a new world" do
      room = start_room(id: unique_id(), persistent: true)
      assert Room.state(room).world_time_ms == 0
    end

    test "a non-persistent sector ignores any snapshot lying around" do
      id = unique_id()

      Snapshots.put(id, %{
        world_time_ms: 999_999,
        weather: Weather.new(id, 0),
        last_seen_ms: Clock.now_ms(),
        epoch: Clock.epoch()
      })

      room = start_room(id: id, persistent: false)
      assert Room.state(room).world_time_ms == 0
    end
  end
end
