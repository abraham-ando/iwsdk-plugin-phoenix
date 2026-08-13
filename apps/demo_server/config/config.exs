import Config

config :demo_server, DemoServerWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  pubsub_server: DemoServer.PubSub

config :logger, :console, format: "$time [$level] $message\n"

config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
