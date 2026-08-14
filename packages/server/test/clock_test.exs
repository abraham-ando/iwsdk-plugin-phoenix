defmodule IwsdkPhoenix.ClockTest do
  use ExUnit.Case, async: false

  alias IwsdkPhoenix.Clock

  test "now_ms never goes backwards and has sub-ms resolution" do
    a = Clock.now_ms()
    b = Clock.now_ms()
    assert is_float(a)
    assert b >= a
  end

  test "epoch is stable across calls and fits in a u32" do
    e = Clock.epoch()
    assert e == Clock.epoch()
    assert e >= 0 and e < 4_294_967_296
  end

  test "put_epoch swaps the value read by epoch/0" do
    original = Clock.epoch()
    Clock.put_epoch(12_345)
    assert Clock.epoch() == 12_345
    Clock.put_epoch(original)
  end
end
