if Code.ensure_loaded?(Phoenix.Channel) do
  defmodule IwsdkPhoenix.RoomChannel do
    @moduledoc """
    Phoenix channel carrying binary IWSDK traffic.

    This module is intentionally thin. Every decision it makes is delegated to
    `IwsdkPhoenix.Room.Handler`, which is dependency-free and therefore fully
    unit-tested; what remains here is the translation between that module's
    return values and `Phoenix.Channel` callback tuples.

    It is compiled only when Phoenix is available, so the rest of the package
    can be used — and tested — from a plain OTP application.

    ## Wiring

        defmodule MyAppWeb.UserSocket do
          use Phoenix.Socket

          channel "room:*", IwsdkPhoenix.RoomChannel

          def connect(%{"token" => token}, socket, _connect_info) do
            case MyApp.Auth.verify(token) do
              {:ok, user_id} -> {:ok, assign(socket, :peer_id, user_id)}
              :error -> :error
            end
          end

          def id(socket), do: "peer:\#{socket.assigns.peer_id}"
        end

    ## Binary payloads

    `phoenix.js` detects an `ArrayBuffer` payload and switches to its binary
    encoding automatically, which arrives here as `{:binary, data}`. Replies
    and broadcasts must be wrapped the same way to travel as binary rather
    than being JSON-encoded.
    """

    use Phoenix.Channel

    require Logger

    alias IwsdkPhoenix.Protocol
    alias IwsdkPhoenix.Room.Handler
    alias IwsdkPhoenix.Room.State

    @frame_event "frame"

    @impl true
    def join("room:" <> room_id, params, socket) do
      case Handler.validate_join(params) do
        {:ok, mode} ->
          peer_id = peer_id(socket)

          room =
            State.new(room_id,
              mode: mode,
              interest_radius: Map.get(params, "interest_radius", 50.0)
            )

          {room, player} = State.join(room, peer_id)

          socket =
            socket
            |> assign(:room, room)
            |> assign(:peer_id, peer_id)

          {:ok, %{peer_id: peer_id, network_id: player.network_id, mode: mode}, socket}

        {:error, reason} ->
          {:error, %{reason: to_string(reason)}}
      end
    end

    @impl true
    def handle_in(@frame_event, {:binary, frame}, socket) do
      case Handler.handle_frame(socket.assigns.room, socket.assigns.peer_id, frame) do
        {:broadcast, payload, room} ->
          broadcast_from!(socket, @frame_event, {:binary, payload})
          {:noreply, assign(socket, :room, room)}

        {:reply, payload, room} ->
          {:reply, {:ok, {:binary, payload}}, assign(socket, :room, room)}

        {:noreply, room} ->
          {:noreply, assign(socket, :room, room)}

        {:error, reason, room} ->
          Logger.debug("iwsdk_phoenix rejected frame: #{inspect(reason)}")
          {:reply, {:error, %{reason: to_string(reason)}}, assign(socket, :room, room)}
      end
    end

    # A JSON payload on the binary event means a client that is not speaking
    # this protocol. Reject loudly rather than letting it look like packet loss.
    def handle_in(@frame_event, _payload, socket) do
      {:reply, {:error, %{reason: "expected_binary_payload"}}, socket}
    end

    @impl true
    def terminate(_reason, socket) do
      case socket.assigns do
        %{room: room, peer_id: peer_id} ->
          {room, player} = State.leave(room, peer_id)

          if player do
            broadcast_from(socket, @frame_event, {
              :binary,
              Protocol.encode_despawn(player.network_id)
            })
          end

          {:ok, assign(socket, :room, room)}

        _ ->
          :ok
      end
    end

    # Prefer an id established at socket authentication; fall back to the
    # channel's own join ref so an unauthenticated dev server still works.
    defp peer_id(socket) do
      case socket.assigns do
        %{peer_id: peer_id} when is_binary(peer_id) and peer_id != "" -> peer_id
        _ -> socket.join_ref || "anonymous"
      end
    end
  end
end
