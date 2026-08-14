defmodule IwsdkPhoenix.World.Snapshots do
  @moduledoc """
  Where a sector's state waits between visits.

  A sector stops when its last peer leaves, so its state has to live somewhere
  that outlives the process. This owns a named public ETS table for exactly
  that, and does nothing else.

  Not `:persistent_term`, though `IwsdkPhoenix.Clock` uses it for the node
  epoch. That is the right primitive for a value written once at boot;
  `:persistent_term.put/2` may trigger a global garbage collection of every
  process holding a reference to the replaced term, and this table is written
  on every sector close. ETS is cheap in both directions.

  The process exists because an ETS table dies with its owner and a supervisor
  cannot own one. It holds no state of its own.
  """

  use GenServer

  @table __MODULE__

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc "Store a sector's snapshot, replacing any previous one."
  @spec put(String.t(), map()) :: :ok
  def put(sector_id, snapshot) when is_binary(sector_id) and is_map(snapshot) do
    :ets.insert(@table, {sector_id, snapshot})
    :ok
  end

  @doc "A sector's snapshot, or `nil` if it has never been stored."
  @spec get(String.t()) :: map() | nil
  def get(sector_id) when is_binary(sector_id) do
    case :ets.lookup(@table, sector_id) do
      [{^sector_id, snapshot}] -> snapshot
      [] -> nil
    end
  end

  @spec delete(String.t()) :: :ok
  def delete(sector_id) when is_binary(sector_id) do
    :ets.delete(@table, sector_id)
    :ok
  end

  @impl true
  def init(_opts) do
    # Public so rooms write directly, without a round trip through this
    # process — a snapshot write is on the path of a peer leaving.
    :ets.new(@table, [
      :named_table,
      :public,
      :set,
      read_concurrency: true,
      write_concurrency: true
    ])

    {:ok, %{}}
  end
end
