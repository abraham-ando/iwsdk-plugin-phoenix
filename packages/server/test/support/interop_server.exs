# Interop harness: a minimal IWSDK server speaking the binary protocol over stdio.
#
# The golden vectors prove the two implementations *encode* identically. They
# cannot prove the two actually interoperate — that a frame the TypeScript
# client emits is routed, decoded, simulated and answered correctly by the
# Elixir server. This script closes that gap by running the real
# `IwsdkPhoenix.Room.Handler` and `Room.State` against frames produced by the
# genuine client codec in another process.
#
# Driven by packages/client/test/interop.test.ts. Run standalone with:
#
#     IWSDK_CORE_ONLY=1 mix run test/support/interop_server.exs
#
# ## Harness framing
#
# stdio is a byte stream, so each message is length-prefixed. This framing is
# *not* the game protocol — it only delimits messages on the pipe.
#
#     in:  <<size::32-little, tag::8, body::binary>>
#     out: <<"IWSD", size::32-little, kind::8, body::binary>>
#
# Outbound messages carry a magic marker because stdout is shared with `mix`,
# which prints compilation progress on a cold build. Without it those bytes are
# read as a length prefix and the stream never resynchronises.
#
# Inbound tags:  0 = game frame from "alice", 1 = control command (UTF-8)
# Outbound kinds: 0 broadcast, 1 reply, 2 broadcast_all, 3 direct,
#                 4 error, 5 control reply

defmodule Interop do
  alias IwsdkPhoenix.Room.Handler
  alias IwsdkPhoenix.Room.State

  @tag_frame 0
  @tag_control 1

  @kind_broadcast 0
  @kind_reply 1
  @kind_broadcast_all 2
  @kind_direct 3
  @kind_error 4
  @kind_control 5

  # Marks the start of every outbound message; see emit/2.
  @magic "IWSD"

  def main do
    # Binary mode: any encoding translation would corrupt the frames.
    :io.setopts(:standard_io, encoding: :latin1)

    room =
      State.new("interop",
        mode: :server_authoritative,
        interest_radius: nil,
        physics_opts: [move_speed: 10.0]
      )

    {room, alice} = State.join(room, "alice")
    {room, bob} = State.join(room, "bob", %{x: 3.0, y: 0.0, z: 0.0})

    emit(@kind_control, "ready alice=#{alice.network_id} bob=#{bob.network_id}")

    loop(room)
  end

  defp loop(room) do
    case read_message() do
      :eof ->
        :ok

      {@tag_frame, frame} ->
        room
        |> handle_frame(frame)
        |> loop()

      {@tag_control, command} ->
        room
        |> handle_control(String.trim(command))
        |> loop()
    end
  end

  defp handle_frame(room, frame) do
    case Handler.handle_frame(room, "alice", frame) do
      {:broadcast, payload, room} ->
        emit(@kind_broadcast, payload)
        room

      {:broadcast_all, payload, room} ->
        emit(@kind_broadcast_all, payload)
        room

      {:direct, target, payload, room} ->
        # Prefix the target so the client can assert on routing, not just bytes.
        emit(@kind_direct, target <> "\0" <> payload)
        room

      {:reply, payload, room} ->
        emit(@kind_reply, payload)
        room

      {:noreply, room} ->
        emit(@kind_control, "noreply")
        room

      {:error, reason, room} ->
        emit(@kind_error, to_string(reason))
        room
    end
  end

  # Control commands let the client drive server-side situations it cannot
  # produce from frames alone — asking for a snapshot, or moving the other peer.
  defp handle_control(room, "snapshot") do
    records = State.snapshot_for(room, "alice")
    emit(@kind_broadcast, IwsdkPhoenix.Protocol.encode_snapshot(records, room.tick, false))
    room
  end

  defp handle_control(room, "snapshot_quantized") do
    records = State.snapshot_for(room, "alice")
    emit(@kind_broadcast, IwsdkPhoenix.Protocol.encode_snapshot(records, room.tick, true))
    room
  end

  defp handle_control(room, "position") do
    player = State.player(room, "alice")
    emit(@kind_control, "#{player.position.x},#{player.position.y},#{player.position.z}")
    room
  end

  defp handle_control(room, "owner " <> network_id) do
    owner = State.owner_of(room, String.to_integer(network_id))
    emit(@kind_control, to_string(owner || "none"))
    room
  end

  defp handle_control(room, "move_bob " <> coords) do
    [x, y, z] = coords |> String.split(",") |> Enum.map(&String.to_float/1)
    room = State.track_transform(room, "bob", %{x: x, y: y, z: z})
    emit(@kind_control, "ok")
    room
  end

  defp handle_control(room, "quit") do
    emit(@kind_control, "bye")
    System.halt(0)
    room
  end

  defp handle_control(room, other) do
    emit(@kind_error, "unknown control: #{other}")
    room
  end

  # -- Framing ----------------------------------------------------------------

  defp read_message do
    case IO.binread(:stdio, 4) do
      :eof ->
        :eof

      {:error, _reason} ->
        :eof

      <<size::unsigned-little-integer-size(32)>> ->
        case IO.binread(:stdio, size) do
          :eof -> :eof
          {:error, _reason} -> :eof
          <<tag::unsigned-integer-size(8), body::binary>> -> {tag, body}
        end
    end
  end

  # Each outbound message is prefixed with a magic marker so the reader can
  # resynchronise. stdout is a shared channel: `mix` writes compilation progress
  # to it on a cold build, and without a marker those bytes are read as a length
  # prefix and the stream never recovers. The marker turns unexpected output
  # into skippable noise rather than a permanent desync.
  defp emit(kind, body) when is_binary(body) do
    payload = <<kind::unsigned-integer-size(8), body::binary>>

    IO.binwrite(
      :stdio,
      @magic <> <<byte_size(payload)::unsigned-little-integer-size(32)>> <> payload
    )
  end
end

Interop.main()
