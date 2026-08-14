defmodule IwsdkPhoenix.Protocol do
  @moduledoc """
  Binary wire codec, byte-for-byte compatible with the TypeScript
  `BinaryProtocol` in `@iwsdk/plugin-phoenix`.

  Every frame begins with a single unsigned byte opcode. All multi-byte fields
  are little-endian, matching the native byte order of every platform IWSDK
  targets, so neither side ever pays for a byte swap.

  Pattern matching on binaries is what makes this cheap on the BEAM: decoding a
  transform is a single match against a fixed-shape binary, with no
  intermediate allocation. In `:host_relayed` mode the server does not decode at
  all — it forwards the payload untouched.

  ## Frame catalogue

  | OpCode | Name             | Size (bytes)          |
  |--------|------------------|-----------------------|
  | 1      | TRANSFORM_UPDATE | 33                    |
  | 2      | INPUT_UPDATE     | 22                    |
  | 3      | SPAWN_ENTITY     | 41                    |
  | 4      | DESPAWN_ENTITY   | 5                     |
  | 5      | SNAPSHOT         | 8 + n * (32 or 20)    |
  | 6      | RECONCILE        | 21                    |
  | 7      | PING             | 9                     |
  | 8      | PONG             | 9 (legacy) or 29      |
  | 9      | OWNERSHIP_REQUEST| 9                     |
  | 10     | OWNERSHIP_GRANT  | 14                    |
  | 11     | SIGNAL           | 11 + payload          |
  | 12     | COMPONENT_UPDATE | 7 + n * (6 + payload) |

  A `COMPONENT_UPDATE` record carries no length field: the payload size is a
  property of the component id, looked up in `IwsdkPhoenix.Cardinal.Registry`.
  Layouts are generated from `cardinal/components.mjs`.
  """

  import Bitwise

  alias IwsdkPhoenix.Protocol.Quantization

  @op_transform_update 1
  @op_input_update 2
  @op_spawn_entity 3
  @op_despawn_entity 4
  @op_snapshot 5
  @op_reconcile 6
  @op_ping 7
  @op_pong 8
  @op_ownership_request 9
  @op_ownership_grant 10
  @op_signal 11
  @op_component_update 12

  @signal_max_payload 16 * 1024

  @flag_quantized 0x01

  @type vec3 :: %{x: float(), y: float(), z: float()}
  @type quat :: %{x: float(), y: float(), z: float(), w: float()}
  @type transform :: %{network_id: non_neg_integer(), position: vec3(), rotation: quat()}

  @doc "Opcode constants, exposed so callers can match without magic numbers."
  def op_transform_update, do: @op_transform_update
  def op_input_update, do: @op_input_update
  def op_spawn_entity, do: @op_spawn_entity
  def op_despawn_entity, do: @op_despawn_entity
  def op_snapshot, do: @op_snapshot
  def op_reconcile, do: @op_reconcile
  def op_ping, do: @op_ping
  def op_pong, do: @op_pong
  def op_ownership_request, do: @op_ownership_request
  def op_ownership_grant, do: @op_ownership_grant
  def op_signal, do: @op_signal
  def op_component_update, do: @op_component_update

  @doc "Largest signalling payload accepted, in bytes."
  def signal_max_payload, do: @signal_max_payload

  # ---------------------------------------------------------------------------
  # Decoding
  # ---------------------------------------------------------------------------

  @doc """
  Decode any supported frame.

  Returns `{:ok, type, payload}` or `{:error, reason}`. Never raises: the input
  is untrusted network data, and a malformed frame must degrade to an error
  tuple rather than killing the channel process.

  ## Examples

      iex> frame = IwsdkPhoenix.Protocol.encode_transform(42, %{x: 1.0, y: 2.0, z: 3.0}, %{x: 0.0, y: 0.0, z: 0.0, w: 1.0})
      iex> {:ok, :transform_update, decoded} = IwsdkPhoenix.Protocol.decode(frame)
      iex> decoded.network_id
      42
  """
  @spec decode(binary()) :: {:ok, atom(), map()} | {:error, atom()}
  def decode(binary)

  def decode(<<@op_transform_update, rest::binary-size(32)>>) do
    <<network_id::unsigned-little-integer-size(32), px::float-little-size(32),
      py::float-little-size(32), pz::float-little-size(32), rx::float-little-size(32),
      ry::float-little-size(32), rz::float-little-size(32), rw::float-little-size(32)>> = rest

    {:ok, :transform_update,
     %{
       network_id: network_id,
       position: %{x: px, y: py, z: pz},
       rotation: %{x: rx, y: ry, z: rz, w: rw}
     }}
  end

  def decode(
        <<@op_snapshot, flags::unsigned-integer-size(8), count::unsigned-little-integer-size(16),
          server_tick::unsigned-little-integer-size(32), rest::binary>>
      ) do
    quantized? = (flags &&& @flag_quantized) != 0

    case decode_records(rest, count, quantized?, []) do
      {:ok, records} ->
        {:ok, :snapshot, %{server_tick: server_tick, quantized: quantized?, records: records}}

      :error ->
        {:error, :truncated_snapshot}
    end
  end

  def decode(
        <<@op_input_update, sequence::unsigned-little-integer-size(32),
          delta_ms::unsigned-little-integer-size(16), mx::float-little-size(32),
          my::float-little-size(32), yaw::float-little-size(32), b0::unsigned-integer-size(8),
          b1::unsigned-integer-size(8), b2::unsigned-integer-size(8)>>
      ) do
    {:ok, :input_update,
     %{
       sequence: sequence,
       delta_ms: delta_ms,
       movement: %{x: mx, y: my},
       yaw: yaw,
       buttons: b0 ||| b1 <<< 8 ||| b2 <<< 16
     }}
  end

  def decode(
        <<@op_reconcile, network_id::unsigned-little-integer-size(32),
          sequence::unsigned-little-integer-size(32), x::float-little-size(32),
          y::float-little-size(32), z::float-little-size(32)>>
      ) do
    {:ok, :reconcile,
     %{
       network_id: network_id,
       last_processed_sequence: sequence,
       position: %{x: x, y: y, z: z}
     }}
  end

  def decode(
        <<@op_spawn_entity, network_id::unsigned-little-integer-size(32),
          prefab_id::unsigned-little-integer-size(32), owner_id::unsigned-little-integer-size(32),
          px::float-little-size(32), py::float-little-size(32), pz::float-little-size(32),
          rx::float-little-size(32), ry::float-little-size(32), rz::float-little-size(32),
          rw::float-little-size(32)>>
      ) do
    {:ok, :spawn_entity,
     %{
       network_id: network_id,
       prefab_id: prefab_id,
       owner_id: owner_id,
       position: %{x: px, y: py, z: pz},
       rotation: %{x: rx, y: ry, z: rz, w: rw}
     }}
  end

  def decode(<<@op_despawn_entity, network_id::unsigned-little-integer-size(32)>>) do
    {:ok, :despawn_entity, %{network_id: network_id}}
  end

  def decode(
        <<@op_ownership_request, network_id::unsigned-little-integer-size(32),
          request_id::unsigned-little-integer-size(32)>>
      ) do
    {:ok, :ownership_request, %{network_id: network_id, request_id: request_id}}
  end

  def decode(
        <<@op_ownership_grant, network_id::unsigned-little-integer-size(32),
          owner_id::unsigned-little-integer-size(32),
          request_id::unsigned-little-integer-size(32), granted::unsigned-integer-size(8)>>
      ) do
    {:ok, :ownership_grant,
     %{
       network_id: network_id,
       owner_id: owner_id,
       request_id: request_id,
       granted: granted == 1
     }}
  end

  def decode(
        <<@op_signal, target::unsigned-little-integer-size(32),
          sender::unsigned-little-integer-size(32), length::unsigned-little-integer-size(16),
          payload::binary-size(length)>>
      ) do
    {:ok, :signal, %{target_network_id: target, sender_network_id: sender, payload: payload}}
  end

  def decode(<<@op_ping, timestamp::float-little-size(64)>>) do
    {:ok, :ping, %{timestamp: timestamp}}
  end

  def decode(<<@op_pong, timestamp::float-little-size(64)>>) do
    {:ok, :pong, %{timestamp: timestamp}}
  end

  def decode(
        <<@op_component_update, count::unsigned-little-integer-size(16),
          server_tick::unsigned-little-integer-size(32), rest::binary>>
      ) do
    case decode_component_records(rest, count, []) do
      {:ok, records} -> {:ok, :component_update, %{server_tick: server_tick, records: records}}
      {:error, reason} -> {:error, reason}
    end
  end

  def decode(
        <<@op_pong, t0::float-little-size(64), t1::float-little-size(64),
          t2::float-little-size(64), epoch::unsigned-little-integer-size(32)>>
      ) do
    {:ok, :pong, %{timestamp: t0, t1: t1, t2: t2, epoch: epoch}}
  end

  def decode(<<op::unsigned-integer-size(8), _rest::binary>>)
      when op in 1..11 do
    # Known opcode but the body did not match: a length mismatch, not an
    # unknown frame type. Distinguishing the two makes protocol drift obvious
    # in logs instead of looking like garbage traffic.
    {:error, :malformed_frame}
  end

  def decode(<<_op::unsigned-integer-size(8), _rest::binary>>), do: {:error, :unknown_opcode}
  def decode(_), do: {:error, :empty_frame}

  @doc """
  Read a frame's opcode without decoding its body.

  This is the whole basis of `:host_relayed` mode: the server can route a frame
  on one byte and forward the rest verbatim.
  """
  @spec peek_opcode(binary()) :: {:ok, non_neg_integer()} | {:error, :empty_frame}
  def peek_opcode(<<op::unsigned-integer-size(8), _rest::binary>>), do: {:ok, op}
  def peek_opcode(_), do: {:error, :empty_frame}

  defp decode_records(_binary, 0, _quantized?, acc), do: {:ok, Enum.reverse(acc)}

  defp decode_records(
         <<network_id::unsigned-little-integer-size(32), px::float-little-size(32),
           py::float-little-size(32), pz::float-little-size(32),
           packed::unsigned-little-integer-size(32), rest::binary>>,
         count,
         true,
         acc
       ) do
    record = %{
      network_id: network_id,
      position: %{x: px, y: py, z: pz},
      rotation: Quantization.decompress_quaternion(packed)
    }

    decode_records(rest, count - 1, true, [record | acc])
  end

  defp decode_records(
         <<network_id::unsigned-little-integer-size(32), px::float-little-size(32),
           py::float-little-size(32), pz::float-little-size(32), rx::float-little-size(32),
           ry::float-little-size(32), rz::float-little-size(32), rw::float-little-size(32),
           rest::binary>>,
         count,
         false,
         acc
       ) do
    record = %{
      network_id: network_id,
      position: %{x: px, y: py, z: pz},
      rotation: %{x: rx, y: ry, z: rz, w: rw}
    }

    decode_records(rest, count - 1, false, [record | acc])
  end

  defp decode_records(_binary, _count, _quantized?, _acc), do: :error

  # ---------------------------------------------------------------------------
  # Encoding
  # ---------------------------------------------------------------------------

  @doc "Encode a single entity transform as a 33-byte frame."
  @spec encode_transform(non_neg_integer(), vec3(), quat()) :: binary()
  def encode_transform(network_id, position, rotation) do
    <<@op_transform_update, network_id::unsigned-little-integer-size(32),
      position.x::float-little-size(32), position.y::float-little-size(32),
      position.z::float-little-size(32), rotation.x::float-little-size(32),
      rotation.y::float-little-size(32), rotation.z::float-little-size(32),
      rotation.w::float-little-size(32)>>
  end

  @doc """
  Encode many transforms into a single snapshot frame.

  Batching is what keeps a busy room affordable: one message header and one
  WebSocket frame instead of one per entity.
  """
  @spec encode_snapshot([transform()], non_neg_integer(), boolean()) :: binary()
  def encode_snapshot(records, server_tick \\ 0, quantized? \\ false) do
    flags = if quantized?, do: @flag_quantized, else: 0
    count = length(records)

    body =
      records
      |> Enum.map(&encode_record(&1, quantized?))
      |> IO.iodata_to_binary()

    <<@op_snapshot, flags::unsigned-integer-size(8), count::unsigned-little-integer-size(16),
      server_tick::unsigned-little-integer-size(32), body::binary>>
  end

  defp encode_record(%{network_id: id, position: p, rotation: r}, true) do
    <<id::unsigned-little-integer-size(32), p.x::float-little-size(32),
      p.y::float-little-size(32), p.z::float-little-size(32),
      Quantization.compress_quaternion(r)::unsigned-little-integer-size(32)>>
  end

  defp encode_record(%{network_id: id, position: p, rotation: r}, false) do
    <<id::unsigned-little-integer-size(32), p.x::float-little-size(32),
      p.y::float-little-size(32), p.z::float-little-size(32), r.x::float-little-size(32),
      r.y::float-little-size(32), r.z::float-little-size(32), r.w::float-little-size(32)>>
  end

  @doc "Encode an authoritative correction."
  @spec encode_reconcile(non_neg_integer(), non_neg_integer(), vec3()) :: binary()
  def encode_reconcile(network_id, last_processed_sequence, position) do
    <<@op_reconcile, network_id::unsigned-little-integer-size(32),
      last_processed_sequence::unsigned-little-integer-size(32),
      position.x::float-little-size(32), position.y::float-little-size(32),
      position.z::float-little-size(32)>>
  end

  @doc "Encode a client input sample. Mainly used by tests and simulated clients."
  @spec encode_input(map()) :: binary()
  def encode_input(%{
        sequence: sequence,
        delta_ms: delta_ms,
        movement: movement,
        yaw: yaw,
        buttons: buttons
      }) do
    clamped_delta = delta_ms |> round() |> max(0) |> min(65_535)

    <<@op_input_update, sequence::unsigned-little-integer-size(32),
      clamped_delta::unsigned-little-integer-size(16), movement.x::float-little-size(32),
      movement.y::float-little-size(32), yaw::float-little-size(32),
      buttons &&& 0xFF::unsigned-integer-size(8),
      buttons >>> 8 &&& 0xFF::unsigned-integer-size(8),
      buttons >>> 16 &&& 0xFF::unsigned-integer-size(8)>>
  end

  @doc "Encode an entity spawn broadcast."
  @spec encode_spawn(map()) :: binary()
  def encode_spawn(%{
        network_id: network_id,
        prefab_id: prefab_id,
        owner_id: owner_id,
        position: p,
        rotation: r
      }) do
    <<@op_spawn_entity, network_id::unsigned-little-integer-size(32),
      prefab_id::unsigned-little-integer-size(32), owner_id::unsigned-little-integer-size(32),
      p.x::float-little-size(32), p.y::float-little-size(32), p.z::float-little-size(32),
      r.x::float-little-size(32), r.y::float-little-size(32), r.z::float-little-size(32),
      r.w::float-little-size(32)>>
  end

  @doc "Encode an entity removal broadcast."
  @spec encode_despawn(non_neg_integer()) :: binary()
  def encode_despawn(network_id) do
    <<@op_despawn_entity, network_id::unsigned-little-integer-size(32)>>
  end

  @doc """
  Encode an ownership request.

      [0]     Uint8   OpCode (9)
      [1..4]  Uint32  network_id
      [5..8]  Uint32  request_id
  """
  @spec encode_ownership_request(non_neg_integer(), non_neg_integer()) :: binary()
  def encode_ownership_request(network_id, request_id) do
    <<@op_ownership_request, network_id::unsigned-little-integer-size(32),
      request_id::unsigned-little-integer-size(32)>>
  end

  @doc """
  Encode the server's ownership verdict.

      [0]      Uint8   OpCode (10)
      [1..4]   Uint32  network_id
      [5..8]   Uint32  owner_id after arbitration
      [9..12]  Uint32  request_id
      [13]     Uint8   1 = granted, 0 = denied

  Broadcast to the whole room rather than only the requester: ownership is
  room-wide state, so every peer needs to know who may now move the entity.
  """
  @spec encode_ownership_grant(map()) :: binary()
  def encode_ownership_grant(%{
        network_id: network_id,
        owner_id: owner_id,
        request_id: request_id,
        granted: granted
      }) do
    <<@op_ownership_grant, network_id::unsigned-little-integer-size(32),
      owner_id::unsigned-little-integer-size(32), request_id::unsigned-little-integer-size(32),
      if(granted, do: 1, else: 0)::unsigned-integer-size(8)>>
  end

  @doc """
  Encode an opaque signalling frame for relay.

      [0]      Uint8   OpCode (11)
      [1..4]   Uint32  target_network_id, 0 = everyone else
      [5..8]   Uint32  sender_network_id, stamped by the server
      [9..10]  Uint16  payload length
      [11..]   payload

  The server never parses the payload, so WebRTC negotiation can evolve — new
  codecs, trickle ICE, renegotiation — without any server change.
  """
  @spec encode_signal(non_neg_integer(), binary(), non_neg_integer()) :: binary()
  def encode_signal(target_network_id, payload, sender_network_id \\ 0)
      when byte_size(payload) <= @signal_max_payload do
    <<@op_signal, target_network_id::unsigned-little-integer-size(32),
      sender_network_id::unsigned-little-integer-size(32),
      byte_size(payload)::unsigned-little-integer-size(16), payload::binary>>
  end

  @doc """
  Rewrite a signalling frame's sender field.

  The server stamps the true sender rather than trusting the client's value,
  so a peer cannot impersonate another during negotiation — which would let it
  hijack a call by answering in someone else's name.
  """
  @spec stamp_signal_sender(binary(), non_neg_integer()) :: {:ok, binary()} | {:error, atom()}
  def stamp_signal_sender(
        <<@op_signal, target::binary-size(4), _sender::binary-size(4), rest::binary>>,
        sender_network_id
      ) do
    {:ok,
     <<@op_signal, target::binary, sender_network_id::unsigned-little-integer-size(32),
       rest::binary>>}
  end

  def stamp_signal_sender(_frame, _sender), do: {:error, :not_a_signal_frame}

  @doc "Encode a latency probe or its reply."
  @spec encode_ping(float(), boolean()) :: binary()
  def encode_ping(timestamp, pong? \\ false) do
    op = if pong?, do: @op_pong, else: @op_ping
    <<op, timestamp::float-little-size(64)>>
  end

  @doc """
  Extended `PONG`: NTP's four-timestamp exchange plus this node's boot epoch.

  `t0` is the client's send time echoed back, `t1` and `t2` are the server's
  receive and send times. `t3` — the client's receive time — is stamped
  locally by the client and never travels, which is why only three appear
  here.

  The legacy 9-byte form (`encode_ping(t, true)`) stays valid: the two forms
  differ in total size, so their decode clauses cannot shadow each other and
  a client that only understands the short one reads its prefix.
  """
  @spec encode_pong(float(), float(), float(), non_neg_integer()) :: binary()
  def encode_pong(t0, t1, t2, epoch) do
    <<@op_pong, t0::float-little-size(64), t1::float-little-size(64),
      t2::float-little-size(64), epoch::unsigned-little-integer-size(32)>>
  end

  # ---------------------------------------------------------------------------
  # Cardinal components
  # ---------------------------------------------------------------------------

  @doc """
  Batch component payloads into one frame.

  Payloads are raw binaries and stay that way: in a relayed room the server
  never decodes them, and even in an authoritative one this function is only
  responsible for framing. Each payload's size is checked against the schema,
  because a wrong-sized one would silently corrupt every record after it —
  there is no length field to resynchronise on.
  """
  @spec encode_component_update([map()], non_neg_integer()) :: binary()
  def encode_component_update(records, server_tick) do
    body =
      for %{network_id: network_id, component_id: component_id, payload: payload} <- records do
        expected = IwsdkPhoenix.Cardinal.Registry.byte_size_for(component_id)

        cond do
          expected == nil ->
            raise ArgumentError, "unknown component id #{component_id}"

          byte_size(payload) != expected ->
            raise ArgumentError,
                  "component #{component_id} expects #{expected} bytes, got #{byte_size(payload)}"

          true ->
            <<network_id::unsigned-little-integer-size(32),
              component_id::unsigned-little-integer-size(16), payload::binary>>
        end
      end

    IO.iodata_to_binary([
      <<@op_component_update, length(records)::unsigned-little-integer-size(16),
        server_tick::unsigned-little-integer-size(32)>>
      | body
    ])
  end

  @doc """
  Network ids carried by a `COMPONENT_UPDATE` frame, without decoding payloads.

  Currently unused: components follow the transform path's per-mode authority
  rule, which needs no per-entity check. Kept because it is the scan a future
  per-entity policy would need, it is tested, and walking the record headers
  costs a registry lookup each — decoding them would cost the zero-decode
  relay path.
  """
  @spec component_update_network_ids(binary()) :: {:ok, [non_neg_integer()]} | {:error, atom()}
  def component_update_network_ids(
        <<@op_component_update, count::unsigned-little-integer-size(16),
          _tick::unsigned-little-integer-size(32), rest::binary>>
      ) do
    scan_component_ids(rest, count, [])
  end

  def component_update_network_ids(_other), do: {:error, :malformed_frame}

  defp scan_component_ids(_rest, 0, acc), do: {:ok, Enum.reverse(acc)}

  defp scan_component_ids(
         <<network_id::unsigned-little-integer-size(32),
           component_id::unsigned-little-integer-size(16), rest::binary>>,
         count,
         acc
       ) do
    case IwsdkPhoenix.Cardinal.Registry.byte_size_for(component_id) do
      nil ->
        {:error, :unknown_component}

      size when byte_size(rest) >= size ->
        <<_payload::binary-size(^size), tail::binary>> = rest
        scan_component_ids(tail, count - 1, [network_id | acc])

      _short ->
        {:error, :malformed_frame}
    end
  end

  defp scan_component_ids(_rest, _count, _acc), do: {:error, :malformed_frame}

  defp decode_component_records(<<>>, 0, acc), do: {:ok, Enum.reverse(acc)}
  defp decode_component_records(_rest, 0, _acc), do: {:error, :malformed_frame}

  defp decode_component_records(
         <<network_id::unsigned-little-integer-size(32),
           component_id::unsigned-little-integer-size(16), rest::binary>>,
         count,
         acc
       ) do
    case IwsdkPhoenix.Cardinal.Registry.byte_size_for(component_id) do
      nil ->
        {:error, :unknown_component}

      size when byte_size(rest) >= size ->
        <<payload::binary-size(^size), tail::binary>> = rest

        decode_component_records(tail, count - 1, [
          %{network_id: network_id, component_id: component_id, payload: payload} | acc
        ])

      _short ->
        {:error, :malformed_frame}
    end
  end

  defp decode_component_records(_rest, _count, _acc), do: {:error, :malformed_frame}
end
