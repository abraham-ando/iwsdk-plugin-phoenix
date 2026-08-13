defmodule IwsdkPhoenix.Zone.Handoff do
  @moduledoc """
  Moves a player from one zone process to another without dropping their socket.

  ## Why two phases

  The naive handoff — remove from A, add to B — has a window in which the player
  exists in neither zone. If B is unreachable, crashed, or simply slow, the
  player is gone: their socket is alive but no zone simulates them, and nothing
  in the system notices. The mirror-image mistake, add to B then remove from A,
  leaves them in *both* zones, each simulating a diverging copy.

  So the handoff is two-phase, and the invariant is that the player is always
  recoverable from the source until the target has confirmed:

      1. prepare   source marks the player as migrating and yields a snapshot.
                   They are NOT removed. The source stops applying their input,
                   so only one zone simulates them from this moment.
      2. commit    target admits the player from the snapshot.
      3. finalize  source removes them, now that the target holds them.

  If step 2 fails, `abort` clears the mark and the player simply resumes in the
  source zone, having lost nothing but the input during the attempt.

  The remaining risk is a crash between 2 and 3, which duplicates the player. It
  is bounded — both copies share a `network_id`, so it is detectable — and it is
  the correct side to fail on: a duplicate is visible and repairable, a lost
  player is neither.

  ## Placement

  `transfer/3` takes plain functions for reaching the source and target, so it
  is independent of how zones are located. A single node can use a `Registry`;
  a cluster can use `Horde.Registry` (declared as an optional dependency) and
  the same code works unchanged.

  ## Network ids

  The player keeps their `network_id` across the move — see
  `IwsdkPhoenix.Room.State.admit_migrated/2` for why renumbering is worse. This
  is only sound when ids are unique across zones, which is what
  `IwsdkPhoenix.Zone.IdAllocator.partitioned/2` guarantees.
  """

  require Logger

  @typedoc "Reaches a zone: a pid, a via-tuple, or anything `GenServer` accepts."
  @type zone :: GenServer.server()

  @typedoc "Outcome of a transfer."
  @type result ::
          {:ok, map()}
          | {:error, :unknown_peer}
          | {:error, {:commit_failed, term()}}
          | {:error, {:prepare_failed, term()}}

  @doc """
  Move `peer_id` from `source` to `target`.

  Returns `{:ok, player}` with the player as admitted by the target, or an error
  tuple. On any failure the player is left simulating in `source`.

  ## Example

      IwsdkPhoenix.Zone.Handoff.transfer(zone_a, zone_b, "alice")
  """
  @spec transfer(zone(), zone(), String.t(), timeout()) :: result()
  def transfer(source, target, peer_id, timeout \\ 5_000) do
    case prepare(source, peer_id, timeout) do
      {:ok, nil} ->
        {:error, :unknown_peer}

      {:ok, snapshot} ->
        commit_or_abort(source, target, peer_id, snapshot, timeout)

      {:error, reason} ->
        {:error, {:prepare_failed, reason}}
    end
  end

  defp commit_or_abort(source, target, peer_id, snapshot, timeout) do
    case commit(target, snapshot, timeout) do
      {:ok, player} ->
        # Only now is it safe to drop the source copy.
        finalize(source, peer_id, timeout)
        {:ok, player}

      {:error, reason} ->
        # The target never took them, so put them back where they were.
        abort(source, peer_id, timeout)

        Logger.warning(
          "iwsdk_phoenix handoff of #{peer_id} failed, player retained in source zone: #{inspect(reason)}"
        )

        {:error, {:commit_failed, reason}}
    end
  end

  @doc "Phase one. Marks the player as migrating and returns their snapshot."
  @spec prepare(zone(), String.t(), timeout()) :: {:ok, map() | nil} | {:error, term()}
  def prepare(source, peer_id, timeout \\ 5_000) do
    safe_call(source, {:handoff_prepare, peer_id}, timeout)
  end

  @doc "Phase two. Admits the player into the target zone."
  @spec commit(zone(), map(), timeout()) :: {:ok, map()} | {:error, term()}
  def commit(target, snapshot, timeout \\ 5_000) do
    safe_call(target, {:handoff_commit, snapshot}, timeout)
  end

  @doc "Phase three. Removes the player from the source zone."
  @spec finalize(zone(), String.t(), timeout()) :: :ok | {:error, term()}
  def finalize(source, peer_id, timeout \\ 5_000) do
    case safe_call(source, {:handoff_finalize, peer_id}, timeout) do
      {:ok, _} -> :ok
      # The source dying after the target committed is survivable: the player is
      # already safe in the target, and the stale copy died with the process.
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Undo phase one after a failed commit."
  @spec abort(zone(), String.t(), timeout()) :: :ok | {:error, term()}
  def abort(source, peer_id, timeout \\ 5_000) do
    case safe_call(source, {:handoff_abort, peer_id}, timeout) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  # A zone that is down or slow must surface as an error tuple, not an exit that
  # unwinds whatever process happened to be orchestrating the move.
  defp safe_call(server, message, timeout) do
    {:ok, GenServer.call(server, message, timeout)}
  catch
    :exit, reason -> {:error, reason}
  end
end
