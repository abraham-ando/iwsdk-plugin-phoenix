import Config

# `server: false` — the channel tests drive the socket directly through
# `Phoenix.ChannelTest`, which needs the endpoint process and its PubSub but no
# listening port.
config :demo_server, DemoServerWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  server: false,
  secret_key_base:
    "test-only-not-a-secret-I5cH-J2z3JocjuvnmK3BaksX8SrZRe2aPeFxWrJ-tPNncNhozRsC7rJdJya6JFU6"

config :logger, level: :warning
