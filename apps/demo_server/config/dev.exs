import Config

config :demo_server, DemoServerWeb.Endpoint,
  http: [ip: {0, 0, 0, 0}, port: String.to_integer(System.get_env("PORT") || "4000")],
  server: true,
  debug_errors: true,
  # The demo client is served by Vite on another port, so its WebSocket upgrade
  # is cross-origin. Disabling the check is acceptable for a local demo and is
  # NOT acceptable anywhere else — a real deployment lists its own origins here.
  check_origin: false,
  # Signing only; this app has no sessions and stores nothing. Overridable so
  # the literal is never the thing anyone relies on.
  secret_key_base:
    System.get_env("SECRET_KEY_BASE") ||
      "demo-only-not-a-secret-I5cH-J2z3JocjuvnmK3BaksX8SrZRe2aPeFxWrJ-tPNncNhozRsC7rJdJya6JFU6"

config :logger, level: :info
