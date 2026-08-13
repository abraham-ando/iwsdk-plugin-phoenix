defmodule IwsdkPhoenix.Persistence.Writer do
  @moduledoc """
  Process that owns a write-behind buffer and flushes it on an interval.

  ## Why a separate process

  Rooms must never block on a database. `record/3` is a `cast` — it returns
  immediately and cannot fail — so a room's tick loop is decoupled from storage
  latency entirely. If the database goes away, the buffer grows (bounded), the
  room keeps simulating, and writes resume when it comes back.

  This is the asynchronous batched persistence the design calls for, with the
  awkward parts made explicit:

    * **Coalescing** happens in `IwsdkPhoenix.Persistence.Buffer`, so cost scales
      with the number of *changed entities per interval*, not with tick rate.
    * **Failures retry** rather than being dropped, and a retry never overwrites
      a newer value.
    * **Shutdown flushes.** `terminate/2` writes whatever is pending, so a
      graceful stop does not discard the last few seconds. This is why the
      process traps exits — without that, `terminate/2` is not guaranteed to run
      on a supervisor shutdown, and the final flush would be silently skipped.
  """

  use GenServer

  require Logger

  alias IwsdkPhoenix.Persistence.Buffer

  @default_interval_ms 5_000

  # -- Client API -------------------------------------------------------------

  @doc """
  Start a writer.

  ## Options

    * `:store` — module implementing `IwsdkPhoenix.Persistence` (required)
    * `:interval_ms` — flush period, default 5000
    * `:max_size` — bound on pending keys, default 10_000
    * `:name` — process name
  """
  def start_link(opts) do
    {name, opts} = Keyword.pop(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @doc """
  Queue a value for eventual persistence.

  Asynchronous and infallible by design: a room calls this from its tick and
  must not be able to block or crash because storage is unhealthy.
  """
  def record(writer \\ __MODULE__, key, value) do
    GenServer.cast(writer, {:record, key, value})
  end

  @doc "Queue many values at once."
  def record_all(writer \\ __MODULE__, pairs) do
    GenServer.cast(writer, {:record_all, pairs})
  end

  @doc "Force an immediate flush and wait for it. Mainly for tests and shutdown."
  def flush(writer \\ __MODULE__, timeout \\ 5_000) do
    GenServer.call(writer, :flush, timeout)
  end

  @doc "Lifetime counters."
  def stats(writer \\ __MODULE__), do: GenServer.call(writer, :stats)

  # -- Callbacks --------------------------------------------------------------

  @impl true
  def init(opts) do
    # Required so terminate/2 runs on a supervised shutdown and the final flush
    # actually happens.
    Process.flag(:trap_exit, true)

    state = %{
      store: Keyword.fetch!(opts, :store),
      buffer: Buffer.new(max_size: Keyword.get(opts, :max_size, 10_000)),
      interval: Keyword.get(opts, :interval_ms, @default_interval_ms),
      failures: 0
    }

    schedule(state)
    {:ok, state}
  end

  @impl true
  def handle_cast({:record, key, value}, state) do
    {:noreply, %{state | buffer: Buffer.put(state.buffer, key, value)}}
  end

  def handle_cast({:record_all, pairs}, state) do
    {:noreply, %{state | buffer: Buffer.put_all(state.buffer, pairs)}}
  end

  @impl true
  def handle_call(:flush, _from, state) do
    {result, state} = do_flush(state)
    {:reply, result, state}
  end

  def handle_call(:stats, _from, state) do
    {:reply, Map.put(Buffer.stats(state.buffer), :failures, state.failures), state}
  end

  @impl true
  def handle_info(:flush, state) do
    {_result, state} = do_flush(state)
    schedule(state)
    {:noreply, state}
  end

  def handle_info({:EXIT, _pid, reason}, state), do: {:stop, reason, state}
  def handle_info(_message, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    # Last chance to persist. Failures here are logged, not raised: raising in
    # terminate/2 would just obscure the original shutdown reason.
    {_result, _state} = do_flush(state)
    :ok
  end

  # -- Internals --------------------------------------------------------------

  defp do_flush(state) do
    if Buffer.empty?(state.buffer) do
      {:ok, state}
    else
      {records, buffer} = Buffer.flush(state.buffer)

      case safe_persist(state.store, records) do
        :ok ->
          {:ok, %{state | buffer: buffer}}

        {:error, reason} ->
          Logger.warning(
            "iwsdk_phoenix persistence flush failed (#{length(records)} records): #{inspect(reason)}"
          )

          # Requeue without clobbering anything written since the flush started.
          {{:error, reason},
           %{state | buffer: Buffer.requeue(buffer, records), failures: state.failures + 1}}
      end
    end
  end

  # A store that raises must not take the writer down with it — that would lose
  # the entire buffer, which is a far worse outcome than one failed batch.
  defp safe_persist(store, records) do
    store.persist(records)
  rescue
    error -> {:error, error}
  catch
    :exit, reason -> {:error, {:exit, reason}}
  end

  defp schedule(state), do: Process.send_after(self(), :flush, state.interval)
end
