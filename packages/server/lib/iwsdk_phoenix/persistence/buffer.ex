defmodule IwsdkPhoenix.Persistence.Buffer do
  @moduledoc """
  Write-behind buffer with coalescing. Pure data structure.

  ## The one idea that makes persistence affordable

  A player publishing at 30 Hz produces 30 position writes per second. Only the
  **last** one is worth storing — the intermediate positions are already gone
  from the simulation and nobody will ever read them back. Coalescing by key
  turns 30 writes per player per second into one per flush interval, a ~150x
  reduction at a 5-second interval.

  Without coalescing, batching alone does not save you: you would still ship
  every intermediate row to the database, merely in bigger groups. Coalescing is
  what turns "persist everything" from a per-tick cost into a per-interval cost
  that is independent of tick rate.

  ## Ordering

  `put/3` keeps the newest value per key and preserves *first-touch* insertion
  order for the flush. Stable order matters because a store that uses
  `insert_all` with `on_conflict` can deadlock under concurrent batches when
  rows arrive in different orders; emitting them deterministically avoids that
  entire class of problem.

  ## Losing writes

  `max_size` bounds memory. When exceeded, the **oldest** pending entry is
  dropped and counted in `dropped`. That is the right trade for a real-time
  system: the alternative is unbounded growth when the database is down, which
  turns a degraded service into a dead node. The counter exists so the condition
  is observable rather than silent.
  """

  defstruct entries: %{},
            order: [],
            max_size: 10_000,
            dropped: 0,
            flushes: 0,
            written: 0

  @type t :: %__MODULE__{}

  @doc """
  Build a buffer.

  ## Options

    * `:max_size` — maximum pending keys before the oldest is dropped
  """
  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    %__MODULE__{max_size: Keyword.get(opts, :max_size, 10_000)}
  end

  @doc """
  Record a value, replacing any pending value for the same key.

  ## Examples

      iex> alias IwsdkPhoenix.Persistence.Buffer
      iex> buffer = Buffer.new() |> Buffer.put(:a, 1) |> Buffer.put(:a, 2)
      iex> Buffer.size(buffer)
      1
      iex> {records, _buffer} = Buffer.flush(buffer)
      iex> records
      [{:a, 2}]
  """
  @spec put(t(), term(), term()) :: t()
  def put(%__MODULE__{} = buffer, key, value) do
    if Map.has_key?(buffer.entries, key) do
      # Already pending: replace the value, keep its position in the order.
      %{buffer | entries: Map.put(buffer.entries, key, value)}
    else
      buffer
      |> append(key, value)
      |> enforce_limit()
    end
  end

  @doc """
  Record many values at once.

      iex> alias IwsdkPhoenix.Persistence.Buffer
      iex> Buffer.new() |> Buffer.put_all([{:a, 1}, {:b, 2}]) |> Buffer.size()
      2
  """
  @spec put_all(t(), [{term(), term()}]) :: t()
  def put_all(%__MODULE__{} = buffer, pairs) do
    Enum.reduce(pairs, buffer, fn {key, value}, acc -> put(acc, key, value) end)
  end

  @doc """
  Take everything pending, in first-touch order, and return an emptied buffer.

  Returns `{records, buffer}`. The counters survive the flush so they can be
  reported as lifetime totals.
  """
  @spec flush(t()) :: {[{term(), term()}], t()}
  def flush(%__MODULE__{} = buffer) do
    records =
      buffer.order
      |> Enum.reverse()
      |> Enum.map(fn key -> {key, Map.fetch!(buffer.entries, key)} end)

    {records,
     %{
       buffer
       | entries: %{},
         order: [],
         flushes: buffer.flushes + 1,
         written: buffer.written + length(records)
     }}
  end

  @doc """
  Put a failed batch back, without clobbering anything newer.

  A retry must never resurrect a stale value: if the key has been written again
  since the failed flush, the newer value wins. Getting this backwards would
  make a transient database error roll a player's position backwards, which is
  far worse than the original failure.
  """
  @spec requeue(t(), [{term(), term()}]) :: t()
  def requeue(%__MODULE__{} = buffer, records) do
    Enum.reduce(records, buffer, fn {key, value}, acc ->
      if Map.has_key?(acc.entries, key) do
        acc
      else
        acc |> append(key, value) |> enforce_limit()
      end
    end)
  end

  @doc "Number of pending keys."
  @spec size(t()) :: non_neg_integer()
  def size(%__MODULE__{} = buffer), do: map_size(buffer.entries)

  @doc "True when nothing is pending."
  @spec empty?(t()) :: boolean()
  def empty?(%__MODULE__{} = buffer), do: map_size(buffer.entries) == 0

  @doc "Lifetime counters, for telemetry."
  @spec stats(t()) :: %{
          pending: non_neg_integer(),
          dropped: non_neg_integer(),
          flushes: non_neg_integer(),
          written: non_neg_integer()
        }
  def stats(%__MODULE__{} = buffer) do
    %{
      pending: size(buffer),
      dropped: buffer.dropped,
      flushes: buffer.flushes,
      written: buffer.written
    }
  end

  defp append(buffer, key, value) do
    %{
      buffer
      | entries: Map.put(buffer.entries, key, value),
        order: [key | buffer.order]
    }
  end

  defp enforce_limit(%__MODULE__{max_size: max} = buffer)
       when map_size(buffer.entries) > max do
    # `order` is newest-first, so the oldest key is at the tail.
    case List.pop_at(buffer.order, -1) do
      {nil, _order} ->
        buffer

      {oldest, order} ->
        %{
          buffer
          | entries: Map.delete(buffer.entries, oldest),
            order: order,
            dropped: buffer.dropped + 1
        }
    end
  end

  defp enforce_limit(buffer), do: buffer
end
