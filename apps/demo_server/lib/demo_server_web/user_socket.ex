defmodule DemoServerWeb.UserSocket do
  @moduledoc """
  Socket for the demo.

  ## There is no authentication here

  `connect/3` accepts everyone and invents a peer id for anyone who does not
  bring one. That is the correct shape for a demo you run on your own machine
  and the wrong shape for anything else: the peer id is what the room uses to
  decide who owns an object, so a client that can choose its own peer id can
  claim to be another player.

  A real deployment verifies a token and derives the peer id from it:

      def connect(%{"token" => token}, socket, _connect_info) do
        case MyApp.Auth.verify(token) do
          {:ok, user_id} -> {:ok, assign(socket, :peer_id, user_id)}
          :error -> :error
        end
      end
  """

  use Phoenix.Socket

  channel("room:*", IwsdkPhoenix.RoomChannel)

  @impl true
  def connect(params, socket, _connect_info) do
    {:ok, assign(socket, :peer_id, peer_id(params))}
  end

  @impl true
  def id(socket), do: "peer:#{socket.assigns.peer_id}"

  # A caller-supplied id makes it possible to reconnect as the same player,
  # which is worth having in a demo — the room keeps a peer's network id and its
  # owned objects across a reconnect, and that behaviour is otherwise invisible.
  defp peer_id(%{"peer_id" => id}) when is_binary(id) and id != "", do: id

  defp peer_id(_params),
    do: 16 |> :crypto.strong_rand_bytes() |> Base.url_encode64(padding: false)
end
