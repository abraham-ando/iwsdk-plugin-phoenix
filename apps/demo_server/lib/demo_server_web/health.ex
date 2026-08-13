defmodule DemoServerWeb.Health do
  @moduledoc """
  `GET /health`, and a 404 for everything else.

  A plug rather than a router: the demo serves no pages, and a router would drag
  in controller and template machinery to answer one request.

  The room count is included because it is the single most useful thing to see
  when a client will not connect — it distinguishes "the server is not running"
  from "the server is running and my client never joined".
  """

  @behaviour Plug

  import Plug.Conn

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(%Plug.Conn{request_path: "/health"} = conn, _opts) do
    rooms = IwsdkPhoenix.RoomSupervisor.list()

    body =
      Jason.encode!(%{
        status: "ok",
        rooms: Enum.sort(rooms),
        room_count: length(rooms)
      })

    conn
    |> put_resp_content_type("application/json")
    |> send_resp(200, body)
    |> halt()
  end

  def call(conn, _opts) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(404, ~s({"error":"not_found","try":"/health or the /socket websocket"}))
    |> halt()
  end
end
