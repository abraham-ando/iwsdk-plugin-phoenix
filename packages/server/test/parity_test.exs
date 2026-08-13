defmodule IwsdkPhoenix.ParityTest do
  @moduledoc """
  Cross-language parity.

  Every vector in `fixtures/protocol_vectors.tsv` was produced by the
  TypeScript implementation. Reproducing them here byte-for-byte is what turns
  "the two implementations agree" from a claim into something CI enforces.

  A failure in this file means the wire format has diverged. That is worth
  treating as a breaking change, not a bug fix: a client and server that
  disagree about the protocol do not crash, they just quietly misplace
  everyone's avatar.
  """

  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Physics.Kinematic
  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.Protocol.Quantization
  alias IwsdkPhoenix.TestFixtures, as: Fixtures

  @moduletag :parity

  setup_all do
    unless Fixtures.available?() do
      raise """
      Missing #{Fixtures.fixture_path()}.

      Regenerate it with:
          pnpm --filter @iwsdk/plugin-phoenix build && node scripts/generate-fixtures.mjs
      """
    end

    :ok
  end

  describe "quaternion compression" do
    test "packs identically to the TypeScript implementation" do
      for [x, y, z, w, expected] <- Fixtures.rows("quat") do
        quaternion = Fixtures.quat(x, y, z, w)
        actual = Quantization.compress_quaternion(quaternion)

        assert actual == Fixtures.to_integer(expected),
               "compress #{inspect(quaternion)}: expected #{expected}, got #{actual}"
      end
    end

    test "decompresses back to within the documented tolerance" do
      # 0.25 degrees is the bound the client documents and tests against.
      limit = 0.25 * :math.pi() / 180

      for [x, y, z, w, packed] <- Fixtures.rows("quat") do
        original = Fixtures.quat(x, y, z, w)
        decoded = Quantization.decompress_quaternion(Fixtures.to_integer(packed))

        assert Quantization.angle_between(original, decoded) < limit
      end
    end

    test "identity round-trips exactly" do
      identity = %{x: 0.0, y: 0.0, z: 0.0, w: 1.0}

      assert identity
             |> Quantization.compress_quaternion()
             |> Quantization.decompress_quaternion() == identity
    end
  end

  describe "frame encoding" do
    test "TRANSFORM_UPDATE matches byte for byte" do
      for [id, px, py, pz, rx, ry, rz, rw, hex] <- Fixtures.rows("transform") do
        network_id = Fixtures.to_integer(id)
        position = Fixtures.vec3(px, py, pz)
        rotation = Fixtures.quat(rx, ry, rz, rw)

        encoded = Protocol.encode_transform(network_id, position, rotation)

        assert Fixtures.to_hex(encoded) == String.trim(hex)
        assert byte_size(encoded) == 33
      end
    end

    test "TRANSFORM_UPDATE decodes what TypeScript encoded" do
      for [id, px, py, pz, _rx, _ry, _rz, _rw, hex] <- Fixtures.rows("transform") do
        assert {:ok, :transform_update, decoded} = Protocol.decode(Fixtures.from_hex(hex))

        assert decoded.network_id == Fixtures.to_integer(id)
        assert_in_delta decoded.position.x, Fixtures.to_float(px), 1.0e-4
        assert_in_delta decoded.position.y, Fixtures.to_float(py), 1.0e-4
        assert_in_delta decoded.position.z, Fixtures.to_float(pz), 1.0e-4
      end
    end

    test "SNAPSHOT matches byte for byte, quantized and not" do
      for {[quantized, tick, count, hex], record_rows} <- Fixtures.snapshots() do
        records =
          Enum.map(record_rows, fn [id, px, py, pz, rx, ry, rz, rw] ->
            %{
              network_id: Fixtures.to_integer(id),
              position: Fixtures.vec3(px, py, pz),
              rotation: Fixtures.quat(rx, ry, rz, rw)
            }
          end)

        assert length(records) == Fixtures.to_integer(count)

        encoded = Protocol.encode_snapshot(records, Fixtures.to_integer(tick), quantized == "1")

        assert Fixtures.to_hex(encoded) == String.trim(hex),
               "snapshot(quantized=#{quantized}, tick=#{tick})"
      end
    end

    test "SNAPSHOT decodes what TypeScript encoded" do
      for {[quantized, tick, count, hex], _records} <- Fixtures.snapshots() do
        assert {:ok, :snapshot, decoded} = Protocol.decode(Fixtures.from_hex(hex))

        assert decoded.server_tick == Fixtures.to_integer(tick)
        assert decoded.quantized == (quantized == "1")
        assert length(decoded.records) == Fixtures.to_integer(count)
      end
    end

    test "INPUT_UPDATE matches byte for byte" do
      for [sequence, delta_ms, mx, my, yaw, buttons, hex] <- Fixtures.rows("input") do
        encoded =
          Protocol.encode_input(%{
            sequence: Fixtures.to_integer(sequence),
            delta_ms: Fixtures.to_integer(delta_ms),
            movement: %{x: Fixtures.to_float(mx), y: Fixtures.to_float(my)},
            yaw: Fixtures.to_float(yaw),
            buttons: Fixtures.to_integer(buttons)
          })

        assert Fixtures.to_hex(encoded) == String.trim(hex)
        assert byte_size(encoded) == 22
      end
    end

    test "INPUT_UPDATE decodes the 24-bit button mask correctly" do
      for [sequence, delta_ms, _mx, _my, _yaw, buttons, hex] <- Fixtures.rows("input") do
        assert {:ok, :input_update, decoded} = Protocol.decode(Fixtures.from_hex(hex))

        assert decoded.sequence == Fixtures.to_integer(sequence)
        assert decoded.delta_ms == Fixtures.to_integer(delta_ms)
        assert decoded.buttons == Fixtures.to_integer(buttons)
      end
    end

    test "RECONCILE matches byte for byte" do
      for [id, sequence, x, y, z, hex] <- Fixtures.rows("reconcile") do
        encoded =
          Protocol.encode_reconcile(
            Fixtures.to_integer(id),
            Fixtures.to_integer(sequence),
            Fixtures.vec3(x, y, z)
          )

        assert Fixtures.to_hex(encoded) == String.trim(hex)
        assert byte_size(encoded) == 21
      end
    end

    test "SPAWN_ENTITY matches byte for byte" do
      for [id, prefab, owner, px, py, pz, rx, ry, rz, rw, hex] <- Fixtures.rows("spawn") do
        encoded =
          Protocol.encode_spawn(%{
            network_id: Fixtures.to_integer(id),
            prefab_id: Fixtures.to_integer(prefab),
            owner_id: Fixtures.to_integer(owner),
            position: Fixtures.vec3(px, py, pz),
            rotation: Fixtures.quat(rx, ry, rz, rw)
          })

        assert Fixtures.to_hex(encoded) == String.trim(hex)
      end
    end

    test "DESPAWN_ENTITY matches byte for byte" do
      for [id, hex] <- Fixtures.rows("despawn") do
        encoded = Protocol.encode_despawn(Fixtures.to_integer(id))
        assert Fixtures.to_hex(encoded) == String.trim(hex)
        assert byte_size(encoded) == 5
      end
    end

    test "PING and PONG match byte for byte" do
      for [timestamp, pong, hex] <- Fixtures.rows("ping") do
        encoded = Protocol.encode_ping(Fixtures.to_float(timestamp), pong == "1")
        assert Fixtures.to_hex(encoded) == String.trim(hex)
        assert byte_size(encoded) == 9
      end
    end
  end

  describe "movement integration" do
    test "reproduces the client's prediction step exactly" do
      for [x, z, mx, my, yaw, dt, speed, max_delta, out_x, out_z] <-
            Fixtures.rows("movement") do
        {actual_x, actual_z} =
          Kinematic.integrate(
            Fixtures.to_float(x),
            Fixtures.to_float(z),
            Fixtures.to_float(mx),
            Fixtures.to_float(my),
            Fixtures.to_float(yaw),
            Fixtures.to_float(dt),
            Fixtures.to_float(speed),
            Fixtures.to_integer(max_delta)
          )

        # Both sides compute in IEEE-754 doubles through the same libm, so the
        # tolerance here is for the decimal round-trip through the fixture
        # file, not for any difference in the arithmetic itself.
        assert_in_delta actual_x, Fixtures.to_float(out_x), 1.0e-12
        assert_in_delta actual_z, Fixtures.to_float(out_z), 1.0e-12
      end
    end
  end
end
