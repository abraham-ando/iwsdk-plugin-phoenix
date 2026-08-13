defmodule DemoServer.MixProject do
  use Mix.Project

  def project do
    [
      app: :demo_server,
      version: "0.1.0",
      elixir: "~> 1.15",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      mod: {DemoServer.Application, []},
      extra_applications: [:logger]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Deliberately short. A room server needs Phoenix, a PubSub and a web server;
  # it does not need Ecto, templates, assets or a mailer, and leaving them out
  # keeps it obvious which parts of a Phoenix application `iwsdk_phoenix`
  # actually depends on.
  #
  # `iwsdk_phoenix` is a path dependency so this compiles against the source in
  # this repository rather than a published version — which is the point, since
  # the whole reason this app exists is to exercise `IwsdkPhoenix.RoomChannel`
  # against a real Phoenix. Its optional dependencies (wasmex, horde) are not
  # pulled in: an optional dep is only fetched for the project that declares it.
  defp deps do
    [
      {:phoenix, "~> 1.7"},
      {:phoenix_pubsub, "~> 2.1"},
      {:jason, "~> 1.4"},
      {:bandit, "~> 1.5"},
      {:iwsdk_phoenix, path: "../../packages/server"}
    ]
  end
end
