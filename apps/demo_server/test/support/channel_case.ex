defmodule DemoServerWeb.ChannelCase do
  @moduledoc """
  Test case for channel tests, plus the helpers that make binary frames legible
  in assertions.

  The join helper lives inside `using/1` rather than as a function on this
  module because `Phoenix.ChannelTest.socket/3` and `subscribe_and_join/3` are
  macros that read `@endpoint` from the calling module.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      import Phoenix.ChannelTest
      import DemoServerWeb.ChannelCase

      @endpoint DemoServerWeb.Endpoint

      @doc """
      Join `peer_id` to `room_id`, returning `{socket, join_reply}`.

      Also subscribes the test process to the room topic, so a broadcast made by
      any channel in the room lands in this process's mailbox.
      """
      def join_room(peer_id, room_id, params \\ %{}) do
        {:ok, reply, socket} =
          DemoServerWeb.UserSocket
          |> socket(peer_id, %{peer_id: peer_id})
          |> subscribe_and_join(
            "room:#{room_id}",
            Map.merge(%{"mode" => "host_relayed"}, params)
          )

        {socket, reply}
      end
    end
  end

  @doc """
  A room id no other test is using.

  Rooms are process-backed and shared by every socket in them — that is the
  whole point of `IwsdkPhoenix.RoomSupervisor` — so tests reusing one room id
  would share network ids, rosters and ownership, and would only fail when run
  together.
  """
  def unique_room, do: "test-#{System.unique_integer([:positive])}"

  @doc """
  Collect every frame pushed to this process's sockets, then decode them.

  A drain rather than `assert_push`, because both peers in a test share one
  transport process: a single event legitimately produces several pushes, in an
  order that is not the assertion's business. What the tests care about is
  *which* frames arrived, and how many.
  """
  # A hard cap as well as an idle timeout. A server-authoritative room streams
  # snapshots at 30 Hz, so a drain that only stopped when the mailbox went quiet
  # would never stop there — better a bounded, obviously-wrong result than a
  # test that hangs until ExUnit kills it.
  @drain_limit 500

  def drain_frames(timeout \\ 300), do: do_drain(timeout, @drain_limit, [])

  defp do_drain(_timeout, 0, acc), do: Enum.reverse(acc)

  defp do_drain(timeout, remaining, acc) do
    receive do
      %Phoenix.Socket.Message{event: "frame", payload: {:binary, frame}} ->
        do_drain(timeout, remaining - 1, [decode!(frame) | acc])
    after
      timeout -> Enum.reverse(acc)
    end
  end

  @doc "Decode a frame the way a client would."
  def decode!(frame) when is_binary(frame) do
    {:ok, kind, payload} = IwsdkPhoenix.Protocol.decode(frame)
    {kind, payload}
  end

  @doc "Every decoded frame of a given kind from a drain."
  def of_kind(frames, kind), do: for({^kind, payload} <- frames, do: payload)
end
