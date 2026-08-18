defmodule IwsdkPhoenix.Room.State.AuthorComponentTest do
  @moduledoc """
  `State.author_component/4` — the server acting as an object's owner.

  This is the same dedup/cache/frame path `Room.Server`'s `publish_weather/1`
  has used for a sector's weather since it existed; these tests cover it as a
  generic, reusable primitive so any other server-authored component — an
  NPC's genome, say — can ride the same path (TS-D3).
  """

  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Cardinal.CharacterGenome
  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.Room.State

  @network_id 200_001
  @component_id 4

  defp genome_payload(genes), do: CharacterGenome.encode(%CharacterGenome{genes: genes})

  test "a first publication produces a frame and populates the cache" do
    state = State.new("village")
    payload = genome_payload(List.duplicate(1, 13))

    assert {state, frame} = State.author_component(state, @network_id, @component_id, payload)

    assert is_binary(frame)
    assert {:ok, :component_update, %{records: [record]}} = Protocol.decode(frame)
    assert record.network_id == @network_id
    assert record.component_id == @component_id
    assert record.payload == payload

    assert State.component_frames(state) != []
  end

  test "republishing the same payload produces no new frame" do
    state = State.new("village")
    payload = genome_payload(List.duplicate(2, 13))

    {state, frame1} = State.author_component(state, @network_id, @component_id, payload)
    assert frame1 != nil

    assert {_state, nil} = State.author_component(state, @network_id, @component_id, payload)
  end

  test "republishing a different payload produces a new frame and overwrites the cache" do
    state = State.new("village")
    first_payload = genome_payload(List.duplicate(3, 13))
    second_payload = genome_payload(List.duplicate(4, 13))

    {state, _frame1} = State.author_component(state, @network_id, @component_id, first_payload)

    assert {state, frame2} =
             State.author_component(state, @network_id, @component_id, second_payload)

    assert is_binary(frame2)
    assert {:ok, :component_update, %{records: [record]}} = Protocol.decode(frame2)
    assert record.payload == second_payload

    [replay_frame] = State.component_frames(state)
    assert {:ok, :component_update, %{records: [replayed]}} = Protocol.decode(replay_frame)
    assert replayed.payload == second_payload
  end

  test "component_frames/1 replays the authored value to a late joiner" do
    state = State.new("village")
    payload = genome_payload(List.duplicate(5, 13))

    {state, _frame} = State.author_component(state, @network_id, @component_id, payload)

    [frame] = State.component_frames(state)
    assert {:ok, :component_update, %{records: [record]}} = Protocol.decode(frame)
    assert record.network_id == @network_id
    assert record.component_id == @component_id
    assert record.payload == payload
  end
end
