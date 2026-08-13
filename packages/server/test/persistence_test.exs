defmodule IwsdkPhoenix.PersistenceTest do
  use ExUnit.Case, async: true
  doctest IwsdkPhoenix.Persistence.Buffer

  # Several tests deliberately exercise failing stores, which log warnings by
  # design. Capturing them keeps the suite quiet so a *real* warning stands out.
  @moduletag :capture_log

  alias IwsdkPhoenix.Persistence.Buffer
  alias IwsdkPhoenix.Persistence.Writer

  # ---------------------------------------------------------------------------
  # Test stores
  # ---------------------------------------------------------------------------

  defmodule EchoStore do
    @moduledoc "Reports every batch back to the test process."
    @behaviour IwsdkPhoenix.Persistence

    @impl true
    def persist(records) do
      # A writer flushes again from terminate/2, which can run after the test
      # process has exited. Guard rather than raising into shutdown.
      if pid = Process.whereis(:persistence_test), do: send(pid, {:persisted, records})
      :ok
    end
  end

  defmodule FailingStore do
    @moduledoc "Fails until the test flips the flag, so retries can be observed."
    @behaviour IwsdkPhoenix.Persistence

    @impl true
    def persist(records) do
      if :persistent_term.get({__MODULE__, :fail?}, true) do
        {:error, :database_down}
      else
        if pid = Process.whereis(:persistence_test), do: send(pid, {:persisted, records})
        :ok
      end
    end
  end

  defmodule RaisingStore do
    @moduledoc "Raises, to prove the writer survives a badly-behaved store."
    @behaviour IwsdkPhoenix.Persistence

    @impl true
    def persist(_records), do: raise("store exploded")
  end

  setup do
    Process.register(self(), :persistence_test)
    :ok
  end

  # ---------------------------------------------------------------------------
  # Buffer
  # ---------------------------------------------------------------------------

  describe "coalescing" do
    test "keeps only the newest value per key" do
      # This is the property that makes persistence affordable: a player at
      # 30 Hz must cost one write per flush, not thirty per second.
      buffer =
        Enum.reduce(1..30, Buffer.new(), fn i, acc ->
          Buffer.put(acc, "player-1", %{x: i * 1.0})
        end)

      assert Buffer.size(buffer) == 1
      assert {[{"player-1", %{x: 30.0}}], _buffer} = Buffer.flush(buffer)
    end

    test "scales with changed keys, not with write count" do
      buffer =
        Enum.reduce(1..1000, Buffer.new(), fn i, acc ->
          Buffer.put(acc, "player-#{rem(i, 10)}", i)
        end)

      # 1000 writes across 10 players collapse to 10 rows.
      assert Buffer.size(buffer) == 10
    end
  end

  describe "flush ordering" do
    test "emits in first-touch order, deterministically" do
      # Stable order avoids the deadlock class that arises when concurrent
      # insert_all batches touch the same rows in different orders.
      buffer =
        Buffer.new()
        |> Buffer.put(:c, 1)
        |> Buffer.put(:a, 1)
        |> Buffer.put(:b, 1)
        |> Buffer.put(:a, 2)

      {records, _buffer} = Buffer.flush(buffer)
      assert Enum.map(records, &elem(&1, 0)) == [:c, :a, :b]
    end

    test "empties the buffer but keeps lifetime counters" do
      {_records, buffer} = Buffer.new() |> Buffer.put(:a, 1) |> Buffer.flush()

      assert Buffer.empty?(buffer)
      assert Buffer.stats(buffer).flushes == 1
      assert Buffer.stats(buffer).written == 1
    end
  end

  describe "bounded memory" do
    test "drops the oldest entry past max_size and counts it" do
      # Unbounded growth while the database is down would turn a degraded
      # service into a dead node.
      buffer =
        Enum.reduce(1..10, Buffer.new(max_size: 3), fn i, acc ->
          Buffer.put(acc, i, i)
        end)

      assert Buffer.size(buffer) == 3
      assert Buffer.stats(buffer).dropped == 7

      # The survivors are the newest.
      {records, _} = Buffer.flush(buffer)
      assert Enum.map(records, &elem(&1, 0)) == [8, 9, 10]
    end

    test "re-touching a pending key does not count against the limit" do
      buffer =
        Enum.reduce(1..100, Buffer.new(max_size: 3), fn _i, acc ->
          Buffer.put(acc, :same, :value)
        end)

      assert Buffer.size(buffer) == 1
      assert Buffer.stats(buffer).dropped == 0
    end
  end

  describe "requeue" do
    test "restores a failed batch" do
      buffer = Buffer.new() |> Buffer.requeue([{:a, 1}, {:b, 2}])
      assert Buffer.size(buffer) == 2
    end

    test "never resurrects a stale value over a newer one" do
      # A transient database error must not roll a player's position backwards.
      buffer =
        Buffer.new()
        |> Buffer.put(:player, %{x: 99.0})
        |> Buffer.requeue([{:player, %{x: 1.0}}])

      assert {[{:player, %{x: 99.0}}], _} = Buffer.flush(buffer)
    end
  end

  # ---------------------------------------------------------------------------
  # Writer
  # ---------------------------------------------------------------------------

  describe "writer" do
    test "batches many records into a single store call" do
      {:ok, writer} = Writer.start_link(store: EchoStore, interval_ms: 50, name: nil)

      for i <- 1..5, do: Writer.record(writer, "player-#{i}", i)

      assert_receive {:persisted, records}, 500
      # One call carrying five rows, not five calls.
      assert length(records) == 5
    end

    test "recording is asynchronous and cannot block the caller" do
      {:ok, writer} = Writer.start_link(store: EchoStore, interval_ms: 60_000, name: nil)

      # No flush is due for a minute; recording must still return at once.
      assert :ok = Writer.record(writer, :a, 1)
      assert Writer.stats(writer).pending == 1
    end

    test "retries a failed batch instead of dropping it" do
      :persistent_term.put({FailingStore, :fail?}, true)
      {:ok, writer} = Writer.start_link(store: FailingStore, interval_ms: 50, name: nil)

      Writer.record(writer, :a, 1)

      assert {:error, :database_down} = Writer.flush(writer)
      assert Writer.stats(writer).pending == 1
      assert Writer.stats(writer).failures >= 1

      # Once storage recovers, the retained record lands.
      :persistent_term.put({FailingStore, :fail?}, false)
      assert :ok = Writer.flush(writer)
      assert_receive {:persisted, [{:a, 1}]}, 500
      assert Writer.stats(writer).pending == 0
    end

    test "survives a store that raises" do
      # Losing the writer would discard the whole buffer, which is far worse
      # than one failed batch.
      {:ok, writer} = Writer.start_link(store: RaisingStore, interval_ms: 50, name: nil)

      Writer.record(writer, :a, 1)
      assert {:error, _} = Writer.flush(writer)

      assert Process.alive?(writer)
      assert Writer.stats(writer).pending == 1
    end

    test "skips the store entirely when nothing is pending" do
      {:ok, writer} = Writer.start_link(store: EchoStore, interval_ms: 30, name: nil)

      # No wasted round trips on an idle room.
      refute_receive {:persisted, _}, 150
      assert Writer.stats(writer).flushes == 0
    end

    test "flushes what is pending on graceful shutdown" do
      # Without trap_exit + terminate/2 the last interval of writes is lost.
      {:ok, writer} = Writer.start_link(store: EchoStore, interval_ms: 60_000, name: nil)

      Writer.record(writer, :last, :value)
      GenServer.stop(writer, :normal)

      assert_receive {:persisted, [{:last, :value}]}, 500
    end

    test "coalesces across the whole interval" do
      {:ok, writer} = Writer.start_link(store: EchoStore, interval_ms: 60_000, name: nil)

      for i <- 1..100, do: Writer.record(writer, "player-1", i)

      assert :ok = Writer.flush(writer)
      assert_receive {:persisted, [{"player-1", 100}]}, 500
    end
  end
end
