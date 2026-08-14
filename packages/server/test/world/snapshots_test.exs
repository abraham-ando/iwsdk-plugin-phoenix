defmodule IwsdkPhoenix.World.SnapshotsTest do
  use ExUnit.Case, async: false

  alias IwsdkPhoenix.World.Snapshots

  setup do
    # Started under RoomSupervisor in a real deployment; started here so the
    # module can be tested without the whole tree.
    unless Process.whereis(Snapshots), do: start_supervised!(Snapshots)
    :ok
  end

  defp unique_id, do: "sector-#{System.unique_integer([:positive])}"

  test "round-trips a snapshot" do
    id = unique_id()
    Snapshots.put(id, %{world_time_ms: 42, epoch: 7})
    assert Snapshots.get(id) == %{world_time_ms: 42, epoch: 7}
  end

  test "returns nil for a sector it has never seen" do
    assert Snapshots.get(unique_id()) == nil
  end

  test "the newest snapshot wins" do
    id = unique_id()
    Snapshots.put(id, %{world_time_ms: 1})
    Snapshots.put(id, %{world_time_ms: 2})
    assert Snapshots.get(id).world_time_ms == 2
  end

  test "delete forgets a sector" do
    id = unique_id()
    Snapshots.put(id, %{world_time_ms: 1})
    Snapshots.delete(id)
    assert Snapshots.get(id) == nil
  end

  test "outlives the process that wrote it" do
    # The point of the store: a sector stops, and its state is still there for
    # the next one. A table owned by the room would die with it.
    id = unique_id()
    Task.await(Task.async(fn -> Snapshots.put(id, %{world_time_ms: 99}) end))

    assert Snapshots.get(id).world_time_ms == 99
  end
end
