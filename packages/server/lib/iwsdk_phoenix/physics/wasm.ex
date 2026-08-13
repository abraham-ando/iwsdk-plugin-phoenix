defmodule IwsdkPhoenix.Physics.Wasm do
  @moduledoc """
  Experimental WASM-backed authority via `Wasmex`. **Opt-in and unfinished.**

  ## Read this before enabling it

  The original design called for hosting IWSDK's own `havok_physics.wasm` here,
  giving strict 1:1 client/server parity. **That will not work with the Havok
  build IWSDK ships**, and this module will not make it work.

  `@babylonjs/havok` is an *Emscripten* build. It is not a freestanding module:
  it imports a large `env` table that Emscripten's JavaScript glue is expected
  to provide — `emscripten_memcpy_big`, `emscripten_resize_heap`, `abort`,
  `__assert_fail`, a family of `__syscall_*` shims, an imported `Memory` with
  dynamic growth, and a `Table` populated at startup for indirect calls.

  `Wasmex` can supply host functions for imports, so this is not categorically
  impossible. But implementing a faithful Emscripten ABI and libc shim in Elixir
  is a project in its own right, and it is self-defeating: any gap in the shim
  reintroduces precisely the client/server divergence that parity was meant to
  eliminate, while being much harder to detect than having no shared physics at
  all. There is also a determinism caveat that survives a perfect shim — Havok
  does not guarantee bit-identical results across builds.

  So: this module targets modules built for a **freestanding** target
  (`wasm32-unknown-unknown` or WASI) that export a simple numeric interface. It
  is the right shape for a purpose-built deterministic simulation compiled from
  Rust or C, not for lifting a browser physics engine onto the BEAM.

  For almost every application, `IwsdkPhoenix.Physics.Kinematic` is the correct
  choice: it achieves exact client/server agreement by sharing a *formula*
  rather than a binary, which is a route that actually works and is pinned by
  golden vectors.

  See `docs/FEASIBILITY.md` for the full analysis.

  ## Expected module interface

  The `.wasm` module must export:

      apply_input(x: f64, z: f64, mx: f64, my: f64, yaw: f64, dt: f64, speed: f64) -> f64

  returning the new X, with the new Z available from an exported `last_z()`.
  Two scalars rather than a struct keeps the boundary free of memory management,
  which is where most of the complexity in a WASM interface lives.

  ## Usage

      # mix.exs
      {:wasmex, "~> 0.8"}

      IwsdkPhoenix.Room.State.new("lobby",
        mode: :server_authoritative,
        physics_module: IwsdkPhoenix.Physics.Wasm,
        physics_opts: [wasm_path: "priv/wasm/movement.wasm", move_speed: 4.5]
      )

  If `Wasmex` is not loaded, or the file is missing, `init/1` returns an error
  rather than silently degrading — a server that believes it is authoritative
  but is not would be worse than one that refuses to start.
  """

  @behaviour IwsdkPhoenix.Physics

  defstruct instance: nil, move_speed: 4.5, max_delta_ms: 100

  @impl true
  def init(opts \\ []) do
    path = Keyword.get(opts, :wasm_path)

    cond do
      not Code.ensure_loaded?(Wasmex) ->
        {:error,
         {:wasmex_not_available,
          "add {:wasmex, \"~> 0.8\"} to your deps, or use IwsdkPhoenix.Physics.Kinematic"}}

      is_nil(path) ->
        {:error, {:missing_option, :wasm_path}}

      not File.exists?(path) ->
        {:error, {:wasm_not_found, path}}

      true ->
        start_instance(path, opts)
    end
  end

  @impl true
  def apply_input(player, _input, %__MODULE__{instance: nil} = config) do
    # No instance means init/1 failed and the caller ignored it. Refuse to move
    # the player rather than silently falling back to unvalidated motion.
    {player, config}
  end

  def apply_input(player, input, %__MODULE__{} = config) do
    if input.sequence <= player.last_sequence do
      {player, config}
    else
      delta_seconds = min(input.delta_ms, config.max_delta_ms) / 1000

      case call_wasm(config, player.position, input, delta_seconds) do
        {:ok, {x, z}} ->
          {%{
             player
             | position: %{x: x, y: player.position.y, z: z},
               last_sequence: input.sequence
           }, config}

        {:error, _reason} ->
          {player, config}
      end
    end
  end

  defp start_instance(path, opts) do
    bytes = File.read!(path)

    case apply(Wasmex, :start_link, [%{bytes: bytes}]) do
      {:ok, instance} ->
        {:ok,
         %__MODULE__{
           instance: instance,
           move_speed: Keyword.get(opts, :move_speed, 4.5),
           max_delta_ms: Keyword.get(opts, :max_delta_ms, 100)
         }}

      {:error, reason} ->
        {:error, {:wasm_instantiation_failed, reason}}
    end
  end

  defp call_wasm(config, position, input, delta_seconds) do
    args = [
      position.x,
      position.z,
      input.movement.x,
      input.movement.y,
      input.yaw,
      delta_seconds,
      config.move_speed
    ]

    with {:ok, [x]} <- apply(Wasmex, :call_function, [config.instance, "apply_input", args]),
         {:ok, [z]} <- apply(Wasmex, :call_function, [config.instance, "last_z", []]) do
      {:ok, {x, z}}
    else
      other -> {:error, other}
    end
  end
end
