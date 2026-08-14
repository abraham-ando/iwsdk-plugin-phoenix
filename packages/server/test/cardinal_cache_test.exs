defmodule IwsdkPhoenix.Cardinal.CacheTest do
  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Cardinal.{Cache, Health}
  alias IwsdkPhoenix.Protocol

  defp health_payload(current, max), do: Health.encode(%Health{current: current, max: max})

  defp records do
    [
      %{network_id: 7, component_id: 1, payload: health_payload(50.0, 100.0)},
      %{network_id: 9, component_id: 1, payload: health_payload(25.0, 100.0)}
    ]
  end

  describe "host_relayed" do
    test "stores payloads verbatim, never decoding them" do
      cache = Cache.put(Cache.new(), :host_relayed, records())
      assert Cache.get(cache, 7, 1) == health_payload(50.0, 100.0)
    end

    test "the newest value for an entity-component wins" do
      cache =
        Cache.new()
        |> Cache.put(:host_relayed, records())
        |> Cache.put(:host_relayed, [
          %{network_id: 7, component_id: 1, payload: health_payload(10.0, 100.0)}
        ])

      assert Cache.get(cache, 7, 1) == health_payload(10.0, 100.0)
    end
  end

  describe "server_authoritative" do
    test "stores decoded structs, because server logic reads them" do
      cache = Cache.put(Cache.new(), :server_authoritative, records())
      assert %Health{current: 50.0, max: 100.0} = Cache.get(cache, 7, 1)
    end

    test "ignores a record whose payload will not decode" do
      # Caching it would replay the same client bug to every future joiner.
      cache =
        Cache.put(Cache.new(), :server_authoritative, [
          %{network_id: 7, component_id: 1, payload: <<0, 0>>}
        ])

      assert Cache.get(cache, 7, 1) == nil
    end

    test "ignores a record naming an unknown component" do
      cache =
        Cache.put(Cache.new(), :server_authoritative, [
          %{network_id: 7, component_id: 9999, payload: <<0::size(64)>>}
        ])

      assert Cache.get(cache, 7, 9999) == nil
    end
  end

  describe "frames/2" do
    test "replays every cached value as decodable frames" do
      cache = Cache.put(Cache.new(), :host_relayed, records())
      frames = Cache.frames(cache, 99)

      decoded =
        frames
        |> Enum.flat_map(fn frame ->
          {:ok, :component_update, %{records: rs}} = Protocol.decode(frame)
          rs
        end)
        |> Enum.sort_by(& &1.network_id)

      assert decoded == Enum.sort_by(records(), & &1.network_id)
    end

    test "replays from the authoritative cache too" do
      cache = Cache.put(Cache.new(), :server_authoritative, records())
      frames = Cache.frames(cache, 0)
      assert {:ok, :component_update, %{records: [_ | _]}} = Protocol.decode(hd(frames))
    end

    test "an empty cache replays nothing at all" do
      # Not an empty frame: a late joiner with no state to receive should get
      # no traffic, not a header.
      assert Cache.frames(Cache.new(), 0) == []
    end
  end

  describe "drop_entity/2" do
    test "forgets everything about one entity" do
      cache =
        Cache.new()
        |> Cache.put(:host_relayed, records())
        |> Cache.drop_entity(7)

      assert Cache.get(cache, 7, 1) == nil
      assert Cache.get(cache, 9, 1) != nil
    end

    test "is harmless for an entity it never held" do
      cache = Cache.new() |> Cache.put(:host_relayed, records()) |> Cache.drop_entity(4242)
      assert Cache.get(cache, 7, 1) != nil
    end
  end

  describe "lifecycle inside Room.State" do
    alias IwsdkPhoenix.Room.State

    test "a despawn forgets that entity's components" do
      # A drop_entity nobody calls is a leak with a tidy name: without this the
      # cache grows without bound and replays a dead entity to every joiner.
      {state, entity, _spawn_frame} =
        State.new("cache-despawn")
        |> State.spawn_entity(prefab_id: 1, owner_id: 0)

      network_id = entity.network_id

      state =
        State.put_components(
          state,
          [%{network_id: network_id, component_id: 1, payload: health_payload(50.0, 100.0)}],
          :host_relayed
        )

      assert State.component_frames(state) != []

      {state, _despawn_frame} = State.despawn_entity(state, network_id)
      assert State.component_frames(state) == []
    end

    test "a departing peer takes its own components with it" do
      state = State.new("cache-leave")
      {state, player} = State.join(state, "alice")

      state =
        State.put_components(
          state,
          [%{network_id: player.network_id, component_id: 1, payload: health_payload(1.0, 2.0)}],
          :host_relayed
        )

      assert State.component_frames(state) != []

      {state, _player} = State.leave(state, "alice")
      assert State.component_frames(state) == []
    end
  end
end
