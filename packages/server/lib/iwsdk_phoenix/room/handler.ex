defmodule IwsdkPhoenix.Room.Handler do
  @moduledoc """
  Decision logic for an incoming room frame, as pure functions.

  `IwsdkPhoenix.RoomChannel` is a thin shim over this module. Splitting them
  apart is what makes the interesting half of the channel testable without a
  socket, an endpoint or a running Phoenix application — the channel is reduced
  to translating a return value into a `Phoenix.Channel` callback tuple.

  ## Return values

    * `{:broadcast, binary, state}` — forward verbatim to every other peer
    * `{:broadcast_all, binary, state}` — send to every peer *including* the
      sender; used for ownership verdicts, where the requester is precisely the
      peer that most needs the answer
    * `{:reply, binary, state}` — send back to this peer only
    * `{:noreply, state}` — consumed, nothing to send
    * `{:error, reason, state}` — malformed or rejected
  """

  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.Room.State

  @type result ::
          {:broadcast, binary(), State.t()}
          | {:broadcast_all, binary(), State.t()}
          | {:reply, binary(), State.t()}
          | {:noreply, State.t()}
          | {:error, atom(), State.t()}

  @doc """
  Handle one binary frame from `peer_id`.

  ## Host-relayed mode

  The frame is forwarded without being decoded. This is the fast path the
  design calls for: the server is a switch, and a room costs almost nothing per
  message beyond the PubSub fan-out.

  The one exception is `TRANSFORM_UPDATE` / `SNAPSHOT` when interest filtering
  is enabled, where the server peeks at positions so it can still answer "who
  is near whom" — a relayed room that broadcasts blindly cannot do
  area-of-interest at all.

  ## Server-authoritative mode

  Input frames are decoded, validated and re-simulated; the client receives a
  correction rather than having its claim trusted. Clients are not permitted to
  assert their own transforms at all, which is what makes the mode meaningful.
  """
  @spec handle_frame(State.t(), String.t(), binary()) :: result()
  def handle_frame(%State{} = state, peer_id, frame) when is_binary(frame) do
    case Protocol.peek_opcode(frame) do
      {:error, reason} ->
        {:error, reason, state}

      {:ok, opcode} ->
        dispatch(state, peer_id, opcode, frame)
    end
  end

  defp dispatch(%State{mode: :host_relayed} = state, peer_id, opcode, frame) do
    cond do
      opcode == Protocol.op_ping() ->
        reply_pong(state, frame)

      opcode == Protocol.op_ownership_request() ->
        arbitrate_ownership(state, peer_id, frame)

      # Track positions only when filtering actually needs them; otherwise stay
      # on the zero-decode path.
      state.interest_radius != nil and
          opcode in [Protocol.op_transform_update(), Protocol.op_snapshot()] ->
        state = track_positions(state, peer_id, frame)
        {:broadcast, frame, state}

      true ->
        {:broadcast, frame, state}
    end
  end

  defp dispatch(%State{mode: :server_authoritative} = state, peer_id, opcode, frame) do
    cond do
      opcode == Protocol.op_ping() ->
        reply_pong(state, frame)

      opcode == Protocol.op_ownership_request() ->
        arbitrate_ownership(state, peer_id, frame)

      opcode == Protocol.op_input_update() ->
        case Protocol.decode(frame) do
          {:ok, :input_update, input} ->
            case State.apply_input(state, peer_id, input) do
              {state, nil} -> {:noreply, state}
              {state, reconcile} -> {:reply, reconcile, state}
            end

          {:error, reason} ->
            {:error, reason, state}
        end

      # A client asserting its own transform is exactly what this mode exists
      # to prevent. Rejecting rather than ignoring makes a misconfigured client
      # obvious instead of silently desynced.
      opcode in [Protocol.op_transform_update(), Protocol.op_snapshot()] ->
        {:error, :client_authority_denied, state}

      true ->
        {:broadcast, frame, state}
    end
  end

  # Ownership is arbitrated identically in both modes. Even a host-relayed room
  # needs a single decision point here: two players grabbing the same object at
  # the same instant will both believe they succeeded, and only the server can
  # break that tie.
  defp arbitrate_ownership(state, peer_id, frame) do
    case Protocol.decode(frame) do
      {:ok, :ownership_request, %{network_id: network_id, request_id: request_id}} ->
        case State.request_ownership(state, peer_id, network_id, request_id) do
          {state, nil} ->
            {:noreply, state}

          {state, grant} ->
            {:broadcast_all, Protocol.encode_ownership_grant(grant), state}
        end

      _ ->
        {:error, :malformed_frame, state}
    end
  end

  defp reply_pong(state, frame) do
    case Protocol.decode(frame) do
      {:ok, :ping, %{timestamp: timestamp}} ->
        {:reply, Protocol.encode_ping(timestamp, true), state}

      _ ->
        {:error, :malformed_frame, state}
    end
  end

  defp track_positions(state, peer_id, frame) do
    case Protocol.decode(frame) do
      {:ok, :transform_update, %{position: position}} ->
        State.track_transform(state, peer_id, position)

      {:ok, :snapshot, %{records: [%{position: position} | _]}} ->
        # The first record is the peer's own avatar by convention; that is
        # enough to place it on the grid.
        State.track_transform(state, peer_id, position)

      _ ->
        state
    end
  end

  @doc """
  Validate a join request.

  Returns `{:ok, mode}` or `{:error, reason}`. Only modes the server actually
  implements are accepted — an unknown string must not silently fall back to a
  permissive mode.
  """
  @spec validate_join(map()) :: {:ok, State.mode()} | {:error, atom()}
  def validate_join(params) when is_map(params) do
    case Map.get(params, "mode", "host_relayed") do
      "host_relayed" -> {:ok, :host_relayed}
      "server_authoritative" -> {:ok, :server_authoritative}
      _other -> {:error, :unsupported_mode}
    end
  end
end
