defmodule IwsdkPhoenix.Persistence do
  @moduledoc """
  Behaviour for durable storage of room state.

  ## Why this is a behaviour rather than Ecto directly

  The design specifies "asynchronous batched saves to PostgreSQL via Ecto". The
  batching and coalescing — the parts that decide whether persistence is
  affordable at all — have nothing to do with Ecto, so they live in
  `IwsdkPhoenix.Persistence.Buffer` and `IwsdkPhoenix.Persistence.Writer` and are
  fully testable without a database.

  What remains is a two-function interface an application implements with its
  own repo. That keeps `iwsdk_phoenix` free of an Ecto dependency (and of any
  opinion about your schema), while still shipping the hard part.

  ## Implementing one

      defmodule MyApp.PlayerStore do
        @behaviour IwsdkPhoenix.Persistence

        @impl true
        def persist(records) do
          entries =
            Enum.map(records, fn {id, %{position: p}} ->
              %{player_id: id, x: p.x, y: p.y, z: p.z, updated_at: DateTime.utc_now()}
            end)

          MyApp.Repo.insert_all("player_positions", entries,
            on_conflict: {:replace, [:x, :y, :z, :updated_at]},
            conflict_target: :player_id
          )

          :ok
        end
      end

  Note the single `insert_all` for the whole batch. That is the point of
  batching: one round trip per flush instead of one per player per tick.
  """

  @type record_id :: term()
  @type record :: term()

  @doc """
  Write a batch of records.

  Called from the writer process, never from a room's tick loop, so a slow
  database cannot stall the simulation.

  Returning `{:error, reason}` causes the writer to retain the batch and retry
  on the next flush, coalesced with anything newer. Losing a position update is
  harmless; losing an inventory change is not, and the caller cannot tell which
  this is — so the writer errs toward retrying.
  """
  @callback persist([{record_id(), record()}]) :: :ok | {:error, term()}

  @doc """
  Load previously stored state for a record, if any.

  Optional: a store that only accumulates history need not implement it.
  """
  @callback load(record_id()) :: {:ok, record()} | :error

  @optional_callbacks load: 1
end
