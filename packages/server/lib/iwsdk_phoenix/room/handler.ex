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
    * `{:direct, peer_id, binary, state}` — send to exactly one peer; used for
      signalling, which is a conversation between two peers and must not be
      fanned out to the room
    * `{:reply, binary, state}` — send back to this peer only
    * `{:noreply, state}` — consumed, nothing to send
    * `{:error, reason, state}` — malformed or rejected
  """

  alias IwsdkPhoenix.Protocol
  alias IwsdkPhoenix.Room.State

  @type result ::
          {:broadcast, binary(), State.t()}
          | {:broadcast_all, binary(), State.t()}
          | {:direct, String.t(), binary(), State.t()}
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

      opcode == Protocol.op_signal() ->
        relay_signal(state, peer_id, frame)

      # Decode only when something actually needs the positions. Two features
      # do, for different reasons: area-of-interest filtering needs to know
      # where players are, and server-spawned objects need their authoritative
      # transform kept current or their replicated position goes stale. Gating
      # this on AoI alone was a bug — a room holding objects but no interest
      # radius replicated every object from its spawn position forever.
      needs_positions?(state) and
          opcode in [Protocol.op_transform_update(), Protocol.op_snapshot()] ->
        state = track_positions(state, peer_id, frame)
        {:broadcast, frame, state}

      opcode == Protocol.op_component_update() ->
        relay_components(state, frame)

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

      opcode == Protocol.op_signal() ->
        relay_signal(state, peer_id, frame)

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

      # Same reasoning as the transform rejection just above. Server-authored
      # components arrive with the simulation layer; until then this room's
      # component cache stays empty, which is correct rather than merely
      # unimplemented.
      opcode == Protocol.op_component_update() ->
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

  # Signalling is a two-party conversation. The server's only jobs are to stamp
  # the true sender (so a peer cannot answer in someone else's name) and to
  # deliver it to the addressed peer rather than the whole room.
  defp relay_signal(state, peer_id, frame) do
    sender = State.player(state, peer_id)

    cond do
      is_nil(sender) ->
        {:noreply, state}

      true ->
        case Protocol.decode(frame) do
          {:ok, :signal, %{target_network_id: target}} ->
            {:ok, stamped} = Protocol.stamp_signal_sender(frame, sender.network_id)

            cond do
              # 0 addresses the whole room: used to announce presence before any
              # peer knows the others' ids.
              target == 0 ->
                {:broadcast, stamped, state}

              # Addressing yourself is meaningless and would loop.
              target == sender.network_id ->
                {:noreply, state}

              true ->
                case State.peer_id_of(state, target) do
                  nil -> {:error, :unknown_signal_target, state}
                  target_peer -> {:direct, target_peer, stamped, state}
                end
            end

          _ ->
            {:error, :malformed_frame, state}
        end
    end
  end

  # A pure relay with neither feature enabled keeps the zero-decode fast path:
  # peek one byte, forward the payload untouched.
  # Relayed: cache the payloads and forward verbatim.
  #
  # No ownership check, deliberately — and this is worth stating, because the
  # instinct is to add one. In this mode transforms are relayed regardless of
  # ownership too: `track_positions/3` swallows an ownership failure and the
  # frame is broadcast anyway, because a relayed room trusts its peers by
  # definition. Enforcing components more strictly than transforms would be an
  # inconsistency, not a hardening.
  defp relay_components(state, frame) do
    case Protocol.decode(frame) do
      {:ok, :component_update, %{records: records}} ->
        {:broadcast, frame, State.put_components(state, records, :host_relayed)}

      {:error, reason} ->
        {:error, reason, state}
    end
  end

  defp needs_positions?(state) do
    state.interest_radius != nil or map_size(state.entities) > 0
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
      {:ok, :transform_update, %{network_id: network_id, position: position, rotation: rotation}} ->
        player = State.player(state, peer_id)

        cond do
          is_nil(player) ->
            state

          # The peer's own avatar.
          player.network_id == network_id ->
            State.track_transform(state, peer_id, position)

          # An object it owns. Rejected otherwise, so a client cannot teleport
          # something it does not hold.
          true ->
            case State.track_entity_transform(
                   state,
                   player.network_id,
                   network_id,
                   position,
                   rotation
                 ) do
              {:ok, state} -> state
              {:error, _reason} -> state
            end
        end

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
    with {:ok, mode} <- validate_mode(params) do
      validate_schema_hash(params, mode)
    end
  end

  defp validate_mode(params) do
    case Map.get(params, "mode", "host_relayed") do
      "host_relayed" -> {:ok, :host_relayed}
      "server_authoritative" -> {:ok, :server_authoritative}
      _other -> {:error, :unsupported_mode}
    end
  end

  # A client whose generated components disagree with the server's cannot be
  # served: with no length field in a COMPONENT_UPDATE record, a component id
  # one side does not know makes the whole frame undecodable. Refusing here
  # turns that into an error message; allowing it would turn it into avatars
  # quietly holding wrong values.
  #
  # The param is optional — an application using no Cardinal components should
  # not have to know it exists.
  defp validate_schema_hash(params, mode) do
    # Compared in the body rather than a guard: a guard cannot call a remote
    # function, and the hash lives in the generated registry.
    case Map.get(params, "schema_hash") do
      nil ->
        {:ok, mode}

      hash ->
        if hash == IwsdkPhoenix.Cardinal.Registry.schema_hash() do
          {:ok, mode}
        else
          {:error, :schema_mismatch}
        end
    end
  end
end
