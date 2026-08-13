defmodule IwsdkPhoenix.SignalTest do
  @moduledoc """
  Opaque peer-to-peer signalling relay.

  The server's only responsibilities are routing to the addressed peer and
  stamping the true sender. It must never need to understand the payload —
  that is what lets WebRTC negotiation evolve without a server change.
  """

  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.Room.Handler
  alias IwsdkPhoenix.Room.State
  alias IwsdkPhoenix.TestFixtures, as: Fixtures

  defp room(opts \\ []) do
    state = State.new("lobby", opts)
    {state, alice} = State.join(state, "alice")
    {state, bob} = State.join(state, "bob")
    {state, alice, bob}
  end

  describe "codec" do
    test "round-trips an arbitrary payload" do
      frame = Protocol.encode_signal(7, "arbitrary bytes", 3)

      assert {:ok, :signal, decoded} = Protocol.decode(frame)
      assert decoded.target_network_id == 7
      assert decoded.sender_network_id == 3
      assert decoded.payload == "arbitrary bytes"
    end

    test "round-trips an empty payload" do
      assert {:ok, :signal, %{payload: ""}} = Protocol.decode(Protocol.encode_signal(1, "", 2))
    end

    test "handles binary payloads, not just text" do
      payload = :crypto.strong_rand_bytes(1024)
      assert {:ok, :signal, decoded} = Protocol.decode(Protocol.encode_signal(1, payload, 2))
      assert decoded.payload == payload
    end

    test "rejects a frame whose declared length exceeds its body" do
      <<head::binary-size(9), _length::16, rest::binary>> = Protocol.encode_signal(1, "hi", 2)
      forged = <<head::binary, 9999::unsigned-little-integer-size(16), rest::binary>>

      assert {:error, :malformed_frame} = Protocol.decode(forged)
    end

    test "matches the TypeScript encoding byte for byte" do
      for [target, sender, text, hex] <- Fixtures.rows("signal") do
        encoded =
          Protocol.encode_signal(
            Fixtures.to_integer(target),
            text,
            Fixtures.to_integer(sender)
          )

        assert Fixtures.to_hex(encoded) == String.trim(hex)
      end
    end
  end

  describe "sender stamping" do
    test "overwrites whatever the client claimed" do
      # A peer must not be able to answer a call in someone else's name.
      forged = Protocol.encode_signal(7, "payload", 999)

      assert {:ok, stamped} = Protocol.stamp_signal_sender(forged, 42)
      assert {:ok, :signal, decoded} = Protocol.decode(stamped)

      assert decoded.sender_network_id == 42
      assert decoded.target_network_id == 7
      assert decoded.payload == "payload"
    end

    test "refuses a non-signal frame" do
      transform =
        Protocol.encode_transform(1, %{x: 0.0, y: 0.0, z: 0.0}, %{
          x: 0.0,
          y: 0.0,
          z: 0.0,
          w: 1.0
        })

      assert {:error, :not_a_signal_frame} = Protocol.stamp_signal_sender(transform, 1)
    end
  end

  describe "routing" do
    for mode <- [:host_relayed, :server_authoritative] do
      test "delivers to exactly the addressed peer in #{mode} mode" do
        {state, alice, bob} = room(mode: unquote(mode))

        frame = Protocol.encode_signal(bob.network_id, "offer", 0)

        assert {:direct, "bob", payload, _state} = Handler.handle_frame(state, "alice", frame)

        assert {:ok, :signal, decoded} = Protocol.decode(payload)
        # Stamped with the real sender, not the zero the client sent.
        assert decoded.sender_network_id == alice.network_id
        assert decoded.payload == "offer"
      end
    end

    test "target 0 reaches the whole room" do
      # Used to announce yourself before you know anyone else's id.
      {state, alice, _bob} = room()

      assert {:broadcast, payload, _state} =
               Handler.handle_frame(state, "alice", Protocol.encode_signal(0, "hello", 0))

      assert {:ok, :signal, decoded} = Protocol.decode(payload)
      assert decoded.sender_network_id == alice.network_id
    end

    test "does not fan a directed signal out to the room" do
      # Leaking negotiation to every peer would be both noisy and a privacy leak.
      {state, _alice, bob} = room()

      result =
        Handler.handle_frame(state, "alice", Protocol.encode_signal(bob.network_id, "x", 0))

      assert match?({:direct, _, _, _}, result)
      refute match?({:broadcast, _, _}, result)
      refute match?({:broadcast_all, _, _}, result)
    end

    test "reports an unknown target rather than dropping silently" do
      {state, _alice, _bob} = room()

      assert {:error, :unknown_signal_target, _state} =
               Handler.handle_frame(state, "alice", Protocol.encode_signal(999_999, "x", 0))
    end

    test "ignores a peer signalling itself" do
      {state, alice, _bob} = room()

      assert {:noreply, _state} =
               Handler.handle_frame(
                 state,
                 "alice",
                 Protocol.encode_signal(alice.network_id, "x", 0)
               )
    end

    test "ignores a signal from an unknown peer" do
      {state, _alice, bob} = room()

      assert {:noreply, _state} =
               Handler.handle_frame(
                 state,
                 "ghost",
                 Protocol.encode_signal(bob.network_id, "x", 0)
               )
    end

    test "rejects a malformed signal frame" do
      {state, _alice, _bob} = room()

      assert {:error, :malformed_frame, _state} =
               Handler.handle_frame(state, "alice", <<Protocol.op_signal(), 1, 2, 3>>)
    end
  end
end
