defmodule IwsdkPhoenix.MixProject do
  use Mix.Project

  @version "0.1.0"
  @source_url "https://github.com/abraham-ando/iwsdk-plugin-phoenix"

  def project do
    [
      app: :iwsdk_phoenix,
      version: @version,
      elixir: "~> 1.14",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      description:
        "Server-side WebXR multiplayer for Meta's Immersive Web SDK: binary Phoenix " <>
          "Channels, spatial area-of-interest filtering and pluggable server authority.",
      package: package(),
      docs: docs(),
      name: "iwsdk_phoenix",
      source_url: @source_url,
      test_coverage: [summary: [threshold: 0]]
    ]
  end

  def application do
    [
      extra_applications: [:logger]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Every dependency is optional, and every module outside RoomChannel is
  # dependency-free by construction. Setting IWSDK_CORE_ONLY=1 drops the list
  # entirely so the protocol, spatial-grid, physics and room suites can be
  # compiled and run with no package registry access at all - useful for a fast
  # inner loop, an air-gapped build, or a container without hex.pm reachable.
  #
  #     IWSDK_CORE_ONLY=1 mix test
  #
  # A full `mix test` additionally compiles IwsdkPhoenix.RoomChannel against a
  # real Phoenix, and CI runs it that way.
  defp deps do
    if System.get_env("IWSDK_CORE_ONLY") == "1" do
      []
    else
      [
        # Phoenix supplies Channel and Presence. Optional so the package can be
        # used from a plain OTP application without pulling in the web stack.
        {:phoenix, "~> 1.7", optional: true},
        {:jason, "~> 1.4", optional: true},

        # Experimental server-side WASM physics. See docs/FEASIBILITY.md for
        # why this is opt-in rather than the default.
        {:wasmex, "~> 0.8", optional: true},

        # Distributed process placement for multi-node zone handoff.
        {:horde, "~> 0.8", optional: true},
        {:ex_doc, "~> 0.31", only: :dev, runtime: false}
      ]
    end
  end

  defp package do
    [
      licenses: ["MIT"],
      links: %{"GitHub" => @source_url},
      files: ~w(lib mix.exs README.md .formatter.exs)
    ]
  end

  defp docs do
    [
      main: "readme",
      extras: ["README.md"],
      source_ref: "v#{@version}"
    ]
  end
end
