# Tests for the Phoenix-only shim.
#
# `IwsdkPhoenix.RoomChannel` is compiled only when Phoenix is available, so this
# file guards on the same condition. Under `IWSDK_CORE_ONLY=1` it defines
# nothing and the core suite stays dependency-free; CI runs it with a real
# Phoenix.
#
# This exists because of a bug CI caught that no local test could: `peer_topic/1`
# had an escaped `\#{}` and therefore returned a constant string, so every peer
# shared one topic and every directed signal would have been delivered to the
# whole room. The channel had never been compiled locally, so nothing flagged it.
if Code.ensure_loaded?(Phoenix.Channel) do
  defmodule IwsdkPhoenix.RoomChannelTest do
    use ExUnit.Case, async: true

    alias IwsdkPhoenix.RoomChannel

    describe "peer_topic/1" do
      test "is distinct per peer" do
        # The property that matters. A constant topic is not a cosmetic slip:
        # it turns directed signalling into a room-wide broadcast, which is
        # both the fan-out and the privacy leak routing exists to prevent.
        topics = Enum.map(["alice", "bob", "carol"], &RoomChannel.peer_topic/1)

        assert length(Enum.uniq(topics)) == 3
      end

      test "actually interpolates the peer id" do
        topic = RoomChannel.peer_topic("alice")

        assert topic == "iwsdk:peer:alice"
        refute String.contains?(topic, "\#{")
      end

      test "is stable for the same peer" do
        assert RoomChannel.peer_topic("alice") == RoomChannel.peer_topic("alice")
      end

      test "namespaces its topics" do
        # Avoids colliding with an application's own Phoenix topics.
        assert String.starts_with?(RoomChannel.peer_topic("alice"), "iwsdk:peer:")
      end
    end
  end
end
