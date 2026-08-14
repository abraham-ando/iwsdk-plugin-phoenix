defmodule IwsdkPhoenix.ProtocolTest do
  use ExUnit.Case, async: true
  doctest IwsdkPhoenix.Protocol
  doctest IwsdkPhoenix.Protocol.Quantization

  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.Protocol.Quantization

  @identity %{x: 0.0, y: 0.0, z: 0.0, w: 1.0}

  describe "TRANSFORM_UPDATE" do
    test "is exactly 33 bytes" do
      frame = Protocol.encode_transform(1, %{x: 0.0, y: 0.0, z: 0.0}, @identity)
      assert byte_size(frame) == 33
    end

    test "round-trips" do
      position = %{x: 1.5, y: -2.25, z: 3.0}
      frame = Protocol.encode_transform(42, position, @identity)

      assert {:ok, :transform_update, decoded} = Protocol.decode(frame)
      assert decoded.network_id == 42
      assert_in_delta decoded.position.x, 1.5, 1.0e-6
      assert_in_delta decoded.position.y, -2.25, 1.0e-6
      assert_in_delta decoded.position.z, 3.0, 1.0e-6
    end

    test "handles the full Uint32 id range" do
      frame = Protocol.encode_transform(4_294_967_295, %{x: 0.0, y: 0.0, z: 0.0}, @identity)
      assert {:ok, :transform_update, %{network_id: 4_294_967_295}} = Protocol.decode(frame)
    end
  end

  describe "SNAPSHOT" do
    test "round-trips an empty snapshot" do
      assert {:ok, :snapshot, decoded} = Protocol.decode(Protocol.encode_snapshot([], 5))
      assert decoded.records == []
      assert decoded.server_tick == 5
    end

    test "round-trips many records and preserves order" do
      records =
        for id <- 1..50 do
          %{
            network_id: id,
            position: %{x: id * 1.0, y: 0.0, z: -id * 1.0},
            rotation: @identity
          }
        end

      assert {:ok, :snapshot, decoded} = Protocol.decode(Protocol.encode_snapshot(records, 99))

      assert length(decoded.records) == 50
      assert Enum.map(decoded.records, & &1.network_id) == Enum.to_list(1..50)
    end

    test "quantized records are 20 bytes and full records 32" do
      records = [%{network_id: 1, position: %{x: 0.0, y: 0.0, z: 0.0}, rotation: @identity}]

      assert byte_size(Protocol.encode_snapshot(records, 0, false)) == 8 + 32
      assert byte_size(Protocol.encode_snapshot(records, 0, true)) == 8 + 20
    end

    test "rejects a snapshot claiming more records than it carries" do
      <<head::binary-size(2), _count::16, rest::binary>> = Protocol.encode_snapshot([], 0)
      forged = <<head::binary, 100::unsigned-little-integer-size(16), rest::binary>>

      assert {:error, :truncated_snapshot} = Protocol.decode(forged)
    end
  end

  describe "malformed input" do
    test "never raises on arbitrary bytes" do
      # Decoding is fed untrusted network data; an error tuple is required, a
      # crash is not acceptable since it would take the channel process down.
      for _ <- 1..500 do
        bytes = :crypto.strong_rand_bytes(:rand.uniform(64))

        assert match?({:ok, _, _}, Protocol.decode(bytes)) or
                 match?({:error, _}, Protocol.decode(bytes))
      end
    end

    test "distinguishes an unknown opcode from a malformed known one" do
      assert {:error, :unknown_opcode} = Protocol.decode(<<200, 0, 0, 0>>)
      assert {:error, :malformed_frame} = Protocol.decode(<<1, 0, 0>>)
      assert {:error, :empty_frame} = Protocol.decode(<<>>)
    end

    test "peek_opcode reads one byte without decoding the body" do
      assert {:ok, 1} = Protocol.peek_opcode(<<1, "garbage">>)
      assert {:error, :empty_frame} = Protocol.peek_opcode(<<>>)
    end
  end

  describe "quantization" do
    test "returns a normalized quaternion for any 32-bit input" do
      for _ <- 1..2000 do
        packed = :rand.uniform(4_294_967_296) - 1
        q = Quantization.decompress_quaternion(packed)
        length = :math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)

        assert_in_delta length, 1.0, 1.0e-6
      end
    end

    test "keeps angular error under 0.25 degrees over random rotations" do
      limit = 0.25 * :math.pi() / 180

      for _ <- 1..5000 do
        q = random_quaternion()
        decoded = q |> Quantization.compress_quaternion() |> Quantization.decompress_quaternion()

        assert Quantization.angle_between(q, decoded) < limit
      end
    end

    test "treats q and -q as the same rotation" do
      q = %{x: 0.5, y: -0.5, z: 0.5, w: -0.5}
      negated = %{x: -q.x, y: -q.y, z: -q.z, w: -q.w}

      assert Quantization.compress_quaternion(q) ==
               Quantization.compress_quaternion(negated)
    end

    test "degrades a zero quaternion to identity instead of NaN" do
      decoded =
        %{x: 0.0, y: 0.0, z: 0.0, w: 0.0}
        |> Quantization.compress_quaternion()
        |> Quantization.decompress_quaternion()

      assert decoded == %{x: 0.0, y: 0.0, z: 0.0, w: 1.0}
    end
  end

  describe "extended pong" do
    test "encode_pong is 29 bytes and round-trips" do
      frame = Protocol.encode_pong(1234.5, 10_001.25, 10_001.5, 305_419_896)
      assert byte_size(frame) == 29
      assert {:ok, :pong, decoded} = Protocol.decode(frame)
      assert decoded.timestamp == 1234.5
      assert decoded.t1 == 10_001.25
      assert decoded.t2 == 10_001.5
      assert decoded.epoch == 305_419_896
    end

    test "legacy 9-byte pong still decodes" do
      assert {:ok, :pong, %{timestamp: 42.0}} = Protocol.decode(Protocol.encode_ping(42.0, true))
    end
  end

  # Shoemake's uniform random rotation.
  defp random_quaternion do
    u1 = :rand.uniform()
    u2 = :rand.uniform()
    u3 = :rand.uniform()
    s1 = :math.sqrt(1 - u1)
    s2 = :math.sqrt(u1)

    %{
      x: s1 * :math.sin(2 * :math.pi() * u2),
      y: s1 * :math.cos(2 * :math.pi() * u2),
      z: s2 * :math.sin(2 * :math.pi() * u3),
      w: s2 * :math.cos(2 * :math.pi() * u3)
    }
  end
end
