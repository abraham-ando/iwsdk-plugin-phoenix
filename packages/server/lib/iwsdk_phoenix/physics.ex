defmodule IwsdkPhoenix.Physics do
  @moduledoc """
  Behaviour for server-side authority over player motion.

  ## Why this is a behaviour rather than "just run Havok"

  The original design called for hosting the identical `havok_physics.wasm`
  binary on the BEAM through `Wasmex`, giving strict 1:1 client/server parity.
  That goal is right, but the direct route does not work as stated, and
  pretending otherwise would produce a package that fails on first contact.

  `@babylonjs/havok` ships an Emscripten build. It is not a freestanding
  `.wasm` module: it imports a large `env` table supplied by Emscripten's
  JavaScript glue (`emscripten_memcpy_big`, `__syscall_*`, `abort`, dynamic
  memory growth, and a `WebAssembly.Table` for indirect calls). `Wasmex` can
  instantiate a module and let you supply imports, but standing up a faithful
  Emscripten ABI in Elixir is a substantial project in its own right — and any
  gap in it reintroduces exactly the divergence the parity was meant to
  eliminate. See `docs/FEASIBILITY.md` for the full analysis.

  So authority is expressed as a behaviour with two implementations:

    * `IwsdkPhoenix.Physics.Kinematic` — pure Elixir, the default. It re-runs
      the same movement integration the client predicts with, which is enough
      to reject speed hacks, teleports and out-of-bounds movement. This is what
      most WebXR applications actually need, and it is exact rather than
      approximate because the client and server share one formula.

    * `IwsdkPhoenix.Physics.Wasm` — opt-in, experimental, for a WASM module
      built with a freestanding target (`wasm32-unknown-unknown` or WASI)
      rather than Emscripten.

  A host application can supply its own implementation for anything else.
  """

  @type position :: %{x: float(), y: float(), z: float()}

  @type input :: %{
          sequence: non_neg_integer(),
          delta_ms: non_neg_integer(),
          movement: %{x: float(), y: float()},
          yaw: float(),
          buttons: non_neg_integer()
        }

  @type player_state :: %{
          position: position(),
          last_sequence: non_neg_integer()
        }

  @doc "Initialise backend state from options."
  @callback init(keyword()) :: {:ok, term()} | {:error, term()}

  @doc """
  Apply one client input to a player's state.

  Returns the updated player state and the backend's own state. Implementations
  must be deterministic: the same input applied to the same state must always
  produce the same result, or reconciliation will oscillate.
  """
  @callback apply_input(player_state(), input(), term()) :: {player_state(), term()}

  @doc "Advance the simulation by one server tick."
  @callback step(term(), float()) :: term()

  @optional_callbacks step: 2
end
