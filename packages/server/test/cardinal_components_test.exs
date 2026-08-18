defmodule IwsdkPhoenix.CardinalComponentsTest do
  use ExUnit.Case, async: true

  alias IwsdkPhoenix.Cardinal.{Grabbable, Health, Registry, CharacterGenome}

  describe "registry" do
    test "knows every schema component by id" do
      assert Enum.sort(Registry.ids()) == [1, 2, 3, 4]
      assert Registry.module_for(1) == Health
      assert Registry.module_for(2) == Grabbable
      assert Registry.module_for(3) == IwsdkPhoenix.Cardinal.Weather
      assert Registry.module_for(4) == CharacterGenome
    end

    test "returns nil for an unknown id rather than raising" do
      # An unknown id can only reach here as a bug — the join-time hash check
      # rules out schema drift — so it must degrade, not crash the room.
      assert Registry.module_for(9999) == nil
      assert Registry.byte_size_for(9999) == nil
    end

    test "reports constant byte sizes" do
      assert Registry.byte_size_for(1) == 8
      assert Registry.byte_size_for(2) == 16
      assert Registry.byte_size_for(4) == 13
    end

    test "exposes an eight-hex-character schema hash" do
      assert Registry.schema_hash() =~ ~r/^[0-9a-f]{8}$/
    end
  end

  describe "Health" do
    test "round-trips" do
      encoded = Health.encode(%Health{current: 12.5, max: 100.0})
      assert byte_size(encoded) == 8
      assert {:ok, %Health{current: 12.5, max: 100.0}} = Health.decode(encoded)
    end

    test "rejects a payload of the wrong size" do
      assert Health.decode(<<0, 0, 0>>) == :error
    end

    test "reports its declaration order, which struct key order does not preserve" do
      assert Health.field_order() == [:current, :max]
    end
  end

  describe "Grabbable" do
    test "round-trips, vec3 included" do
      value = %Grabbable{holder_id: 42, grab_point: %{x: 1.0, y: -2.0, z: 3.5}}
      assert {:ok, decoded} = value |> Grabbable.encode() |> Grabbable.decode()
      assert decoded.holder_id == 42
      assert decoded.grab_point == %{x: 1.0, y: -2.0, z: 3.5}
    end

    test "encodes little-endian" do
      encoded = Grabbable.encode(%Grabbable{holder_id: 1, grab_point: %{x: 0.0, y: 0.0, z: 0.0}})
      assert <<1, 0, 0, 0, _rest::binary>> = encoded
    end

    test "reports its declaration order" do
      assert Grabbable.field_order() == [:holder_id, :grab_point]
    end
  end
end
