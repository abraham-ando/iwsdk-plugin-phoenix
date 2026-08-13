defmodule DemoServerWeb.Endpoint do
  @moduledoc """
  The whole HTTP surface of the demo server.

  One socket and one health check. Socket paths are dispatched before the plug
  pipeline, so `/socket` never reaches `DemoServerWeb.Health`.
  """

  use Phoenix.Endpoint, otp_app: :demo_server

  socket("/socket", DemoServerWeb.UserSocket,
    websocket: true,
    longpoll: false
  )

  plug(DemoServerWeb.Health)
end
