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

    ## One room, one process

    Every socket in `room:lobby` drives the *same* `IwsdkPhoenix.Room.Server`
    process, resolved through `IwsdkPhoenix.RoomSupervisor`. The room owns id
    allocation, membership and ownership arbitration, so those answers are the
    same for every peer. Holding the state in the socket's assigns instead
    would give each connection a private copy of the room, and every peer would
    be allocated the same network id while seeing an empty roster.

    ## Discovery

    A peer learns about the rest of the room through ordinary `SPAWN_ENTITY`
    frames, which the channel emits at two moments:

      * when a peer joins, its avatar is broadcast to everyone already present
      * immediately after that, the joining peer is sent one spawn per peer and
        per server-owned object already in the room

    Both halves are needed. The broadcast alone leaves a late joiner blind to
    everyone who arrived before it; the replay alone leaves everyone else blind
    to the newcomer.

    Player avatars use `prefab_id` 0. An application maps that to whatever it
    renders for another person.

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

    Add `IwsdkPhoenix.RoomSupervisor` to the application's supervision tree.
    The channel starts it lazily if it is missing so a dev server works out of
    the box, but a lazily started supervisor is tied to the lifetime of the
    channel that happened to start it, which is not what a production tree
    wants.

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
    alias IwsdkPhoenix.Room.Server
    alias IwsdkPhoenix.Room.State
    alias IwsdkPhoenix.RoomSupervisor

    @frame_event "frame"

    # Player avatars are spawned under this archetype. Applications map it to
    # whatever mesh they draw for another person.
    @avatar_prefab_id 0

    @identity_rotation %{x: 0.0, y: 0.0, z: 0.0, w: 1.0}

    @impl true
    def join("room:" <> room_id, params, socket) do
      with {:ok, mode} <- Handler.validate_join(params),
           {:ok, room} <- ensure_room(room_id, mode, params, socket) do
        peer_id = peer_id(socket)
        {:ok, player} = Server.join(room, peer_id)

        # Directed frames — WebRTC signalling — are published to a topic of the
        # recipient's own rather than to the room, so subscribe to ours. Phoenix
        # pushes a broadcast the channel does not intercept straight through to
        # the client under its own topic, so the frame arrives on the same
        # "frame" event as everything else.
        socket.endpoint.subscribe(peer_topic(peer_id))

        # If the room dies, this socket's view of it is gone; drop the channel
        # rather than serving frames into a process that no longer exists.
        Process.monitor(room)

        socket =
          socket
          |> assign(:room, room)
          |> assign(:room_id, room_id)
          |> assign(:peer_id, peer_id)
          |> assign(:network_id, player.network_id)

        send(self(), :after_join)

        # The room's mode wins over the requested one: a room already holding
        # players cannot change its authority model under them.
        reply = %{
          peer_id: peer_id,
          network_id: player.network_id,
          mode: Server.state(room).mode
        }

        {:ok, reply, socket}
      else
        {:error, reason} -> {:error, %{reason: to_string(reason)}}
      end
    end

    @impl true
    def handle_info(:after_join, socket) do
      %{room: room, peer_id: peer_id, network_id: network_id} = socket.assigns
      state = Server.state(room)

      # Everyone else learns about us...
      broadcast_from!(socket, @frame_event, {:binary, avatar_spawn(network_id)})

      # ...and we learn about everyone — and everything — already here.
      for player <- State.players(state), player.peer_id != peer_id do
        push(socket, @frame_event, {
          :binary,
          avatar_spawn(player.network_id, player.position)
        })
      end

      for entity <- State.entities(state) do
        push(socket, @frame_event, {:binary, Protocol.encode_spawn(entity)})
      end

      # Component state last: the entities have to exist on the client before
      # values can be applied to them. Without this replay a newcomer would see
      # only future changes, and every component would sit at its default until
      # something happened to touch it.
      for frame <- State.component_frames(state) do
        push(socket, @frame_event, {:binary, frame})
      end

      {:noreply, socket}
    end

    def handle_info({:DOWN, _ref, :process, room, _reason}, socket) do
      if room == socket.assigns[:room] do
        {:stop, :normal, socket}
      else
        {:noreply, socket}
      end
    end

    # A frame published to this peer's own topic: directed signalling.
    #
    # Phoenix routes a broadcast through `handle_out/3` — whose generated
    # catch-all pushes it straight to the client — only when it arrives on the
    # channel's *own* topic. One addressed to a peer topic we subscribed to in
    # `join/3` lands here as an ordinary message instead, and has to be pushed by
    # hand. Without this clause the catch-all below swallowed it and every
    # directed signal vanished silently: the sender saw its frame accepted, the
    # recipient never heard from it, and nothing anywhere logged a thing.
    def handle_info(%Phoenix.Socket.Broadcast{event: @frame_event, payload: payload}, socket) do
      push(socket, @frame_event, payload)
      {:noreply, socket}
    end

    def handle_info(_message, socket), do: {:noreply, socket}

    # Clock sync, answered here rather than in the room.
    #
    # Both server stamps are taken at this process's edges, and the room
    # GenServer never enters the picture: a room busy with a tick would add its
    # queueing delay to `t2 - t1`, and the client would silently attribute that
    # to the network. The offset it computes is only as honest as these two
    # stamps are close to the socket.
    #
    # The literal `7` is `Protocol.op_ping()`. A module attribute cannot be
    # used in a pattern here because this clause is generated inside `quote`,
    # and a function call in a pattern is not allowed at all.
    @impl true
    def handle_in(@frame_event, {:binary, <<7, _::binary>> = frame}, socket) do
      t1 = IwsdkPhoenix.Clock.now_ms()

      case Protocol.decode(frame) do
        {:ok, :ping, %{timestamp: t0}} ->
          pong =
            Protocol.encode_pong(
              t0,
              t1,
              IwsdkPhoenix.Clock.now_ms(),
              IwsdkPhoenix.Clock.epoch()
            )

          {:reply, {:ok, {:binary, pong}}, socket}

        _ ->
          {:reply, {:error, %{reason: "malformed_frame"}}, socket}
      end
    end

    def handle_in(@frame_event, {:binary, frame}, socket) do
      case Server.handle_frame(socket.assigns.room, socket.assigns.peer_id, frame) do
        {:broadcast, payload} ->
          broadcast_from!(socket, @frame_event, {:binary, payload})
          {:noreply, socket}

        {:direct, target_peer, payload} ->
          # Signalling is between two peers; fanning it out would leak the
          # negotiation to the room. Each socket subscribes to its own topic.
          socket.endpoint.broadcast(peer_topic(target_peer), @frame_event, {
            :binary,
            payload
          })

          {:noreply, socket}

        {:broadcast_all, payload} ->
          # Includes the sender. Ownership verdicts go to everyone, and the
          # requester is the peer that most needs the answer.
          broadcast!(socket, @frame_event, {:binary, payload})
          {:noreply, socket}

        {:reply, payload} ->
          {:reply, {:ok, {:binary, payload}}, socket}

        :ok ->
          {:noreply, socket}

        {:error, reason} ->
          Logger.debug("iwsdk_phoenix rejected frame: #{inspect(reason)}")
          {:reply, {:error, %{reason: to_string(reason)}}, socket}
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
          # The room may already be gone — it stops itself with its last
          # occupant, and this socket may be racing another one out the door.
          # A failed departure must not turn into a crashing terminate.
          case safe_leave(room, peer_id) do
            {:ok, player} when not is_nil(player) ->
              broadcast_from(socket, @frame_event, {
                :binary,
                Protocol.encode_despawn(player.network_id)
              })

            _ ->
              :ok
          end

          :ok

        _ ->
          :ok
      end
    end

    @doc """
    Topic a peer subscribes to for messages addressed to it alone.

    Must interpolate: a constant topic would deliver every directed signal to
    every peer, which is both the fan-out and the privacy leak that routing
    exists to avoid.
    """
    def peer_topic(peer_id), do: "iwsdk:peer:#{peer_id}"

    # -- Internals ------------------------------------------------------------

    defp ensure_room(room_id, mode, params, socket) do
      if not RoomSupervisor.running?() do
        Logger.info("""
        IwsdkPhoenix.RoomSupervisor was not running and has been started \
        lazily. Add it to your application's supervision tree so rooms are \
        supervised.\
        """)

        RoomSupervisor.ensure_running()
      end

      RoomSupervisor.ensure_started(room_id,
        mode: mode,
        interest_radius: Map.get(params, "interest_radius", 50.0),
        stop_when_empty: true,
        broadcast: broadcaster(mode, socket.endpoint)
      )
    end

    # Only server-authoritative rooms broadcast their own snapshots. In a
    # host-relayed room the peers' own transform frames are already being
    # forwarded verbatim, and a server snapshot carrying the same positions with
    # an identity rotation would fight them — every remote avatar's head would
    # snap between its real orientation and forward, thirty times a second.
    defp broadcaster(:server_authoritative, endpoint) do
      fn {peer_id, payload} ->
        endpoint.broadcast(peer_topic(peer_id), @frame_event, {:binary, payload})
      end
    end

    defp broadcaster(_mode, _endpoint), do: nil

    defp avatar_spawn(network_id, position \\ %{x: 0.0, y: 0.0, z: 0.0}) do
      Protocol.encode_spawn(%{
        network_id: network_id,
        prefab_id: @avatar_prefab_id,
        owner_id: network_id,
        position: position,
        rotation: @identity_rotation
      })
    end

    defp safe_leave(room, peer_id) do
      Server.leave(room, peer_id)
    catch
      :exit, _reason -> {:ok, nil}
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
