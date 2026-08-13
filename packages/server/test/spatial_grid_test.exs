defmodule IwsdkPhoenix.SpatialGridTest do
  use ExUnit.Case, async: true
  doctest IwsdkPhoenix.SpatialGrid

  alias IwsdkPhoenix.SpatialGrid

  describe "cell_for/2" do
    test "floors rather than truncating toward zero" do
      # This is the whole correctness question for a spatial grid. `div/2`
      # truncates, which would fold -10 and +10 into the same cell and collapse
      # the negative half of the world onto the positive half.
      assert SpatialGrid.cell_for(%{x: 10.0, y: 0.0, z: 0.0}, 50.0) == {0, 0, 0}
      assert SpatialGrid.cell_for(%{x: -10.0, y: 0.0, z: 0.0}, 50.0) == {-1, 0, 0}
      assert SpatialGrid.cell_for(%{x: -60.0, y: 0.0, z: 0.0}, 50.0) == {-2, 0, 0}
    end

    test "boundaries land in the higher cell" do
      assert SpatialGrid.cell_for(%{x: 50.0, y: 0.0, z: 0.0}, 50.0) == {1, 0, 0}
      assert SpatialGrid.cell_for(%{x: 49.999, y: 0.0, z: 0.0}, 50.0) == {0, 0, 0}
    end

    test "adjacent positions across a boundary land in adjacent cells" do
      a = SpatialGrid.cell_for(%{x: 49.9, y: 0.0, z: 0.0}, 50.0)
      b = SpatialGrid.cell_for(%{x: 50.1, y: 0.0, z: 0.0}, 50.0)

      assert b in SpatialGrid.neighbouring_cells(a)
    end
  end

  describe "neighbouring_cells/2" do
    test "full mode covers a 3x3x3 block, flat mode a 3x3 plane" do
      assert length(SpatialGrid.neighbouring_cells({0, 0, 0}, :full)) == 27
      assert length(SpatialGrid.neighbouring_cells({0, 0, 0}, :flat)) == 9
    end

    test "always includes the cell itself" do
      assert {5, -2, 3} in SpatialGrid.neighbouring_cells({5, -2, 3})
    end

    test "flat mode keeps the original Y" do
      for {_x, y, _z} <- SpatialGrid.neighbouring_cells({0, 7, 0}, :flat) do
        assert y == 7
      end
    end
  end

  describe "transition/4" do
    test "is empty when the viewer has not changed cell" do
      assert {[], []} =
               SpatialGrid.transition(
                 %{x: 1.0, y: 0.0, z: 1.0},
                 %{x: 2.0, y: 0.0, z: 2.0},
                 50.0
               )
    end

    test "swaps only the leading and trailing planes when crossing one boundary" do
      # Crossing a single boundary in flat mode changes 3 of 9 cells, not all 9.
      # Recomputing the delta rather than resubscribing wholesale is what keeps
      # zone crossings cheap.
      {subscribe, unsubscribe} =
        SpatialGrid.transition(
          %{x: 40.0, y: 0.0, z: 0.0},
          %{x: 60.0, y: 0.0, z: 0.0},
          50.0,
          :flat
        )

      assert length(subscribe) == 3
      assert length(unsubscribe) == 3
      assert Enum.all?(subscribe, &String.starts_with?(&1, "iwsdk:cell:"))
    end

    test "a distant jump replaces the whole neighbourhood" do
      {subscribe, unsubscribe} =
        SpatialGrid.transition(
          %{x: 0.0, y: 0.0, z: 0.0},
          %{x: 10_000.0, y: 0.0, z: 10_000.0},
          50.0,
          :flat
        )

      assert length(subscribe) == 9
      assert length(unsubscribe) == 9
    end
  end

  describe "within?/3" do
    test "uses true euclidean distance" do
      origin = %{x: 0.0, y: 0.0, z: 0.0}

      assert SpatialGrid.within?(origin, %{x: 3.0, y: 4.0, z: 0.0}, 5.0)
      refute SpatialGrid.within?(origin, %{x: 3.0, y: 4.0, z: 0.1}, 5.0)
    end
  end

  describe "lod_rate/1" do
    test "follows the specified distance bands" do
      assert SpatialGrid.lod_rate(0.0) == 30
      assert SpatialGrid.lod_rate(10.0) == 30
      assert SpatialGrid.lod_rate(10.1) == 15
      assert SpatialGrid.lod_rate(30.0) == 15
      assert SpatialGrid.lod_rate(30.1) == 5
    end

    test "is monotonically non-increasing with distance" do
      rates = Enum.map(0..100, &SpatialGrid.lod_rate(&1 * 1.0))
      assert rates == Enum.sort(rates, :desc)
    end
  end
end
