defmodule IwsdkPhoenix.Clock do
  @moduledoc """
  The server's time base for clock synchronization.

  `System.monotonic_time/1`, never `System.system_time/1`: the wall clock
  jumps (OS-level NTP corrections, manual changes) and a backwards step would
  corrupt every velocity derived from these stamps. The monotonic clock never
  recedes — its arbitrary, per-node origin is exactly what `epoch/0` makes
  harmless.
  """

  @epoch_key {__MODULE__, :epoch}

  @doc """
  Monotonic milliseconds as a float, microsecond resolution.

  A float because the client's `performance.now()` is one, and an f64 holds
  integer milliseconds exactly — the two sides stay symmetric on the wire.
  """
  @spec now_ms() :: float()
  def now_ms do
    System.monotonic_time(:microsecond) / 1000.0
  end

  @doc """
  This node's boot identifier, drawn once and kept in `:persistent_term`.

  Reads are free on the hot path — no copy, no process hop. A restart draws a
  new value, which is how clients learn to discard an offset estimate that has
  silently become meaningless; two nodes have two epochs, so a future handoff
  announces itself with no coordination protocol to invent.

  Lazy init can race at boot: the last writer wins, and a client that saw the
  loser resets exactly once. That is the mechanism working, not a flaw in it.
  """
  @spec epoch() :: non_neg_integer()
  def epoch do
    case :persistent_term.get(@epoch_key, :undefined) do
      :undefined ->
        value = :rand.uniform(4_294_967_296) - 1
        :persistent_term.put(@epoch_key, value)
        value

      value ->
        value
    end
  end

  @doc """
  Force the epoch.

  The restart/handoff scenario, testable in microseconds rather than by
  actually restarting a node.
  """
  @spec put_epoch(non_neg_integer()) :: :ok
  def put_epoch(value) when value >= 0 and value < 4_294_967_296 do
    :persistent_term.put(@epoch_key, value)
  end
end
