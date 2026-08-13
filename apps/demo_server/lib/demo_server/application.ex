defmodule DemoServer.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      {Phoenix.PubSub, name: DemoServer.PubSub},
      # Before the endpoint, deliberately. A socket that connects the instant
      # the port opens must find the room supervisor already up; otherwise the
      # channel falls back to starting it lazily, which is a development
      # convenience and not something a running server should ever rely on.
      IwsdkPhoenix.RoomSupervisor,
      DemoServerWeb.Endpoint
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: DemoServer.Supervisor)
  end

  @impl true
  def config_change(changed, _new, removed) do
    DemoServerWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
