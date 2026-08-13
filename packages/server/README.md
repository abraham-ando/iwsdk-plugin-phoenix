# iwsdk_phoenix

Server-side WebXR multiplayer for [Meta's Immersive Web SDK](https://github.com/facebook/immersive-web-sdk).

Pairs with the npm package [`@iwsdk/plugin-phoenix`](https://www.npmjs.com/package/@iwsdk/plugin-phoenix).
Clients publish compact binary frames over Phoenix Channels; this package
decodes them, optionally simulates them authoritatively, and fans them back out
with spatial filtering.

## Installation

```elixir
def deps do
  [{:iwsdk_phoenix, "~> 0.1"}]
end
```

## Usage

```elixir
defmodule MyAppWeb.UserSocket do
  use Phoenix.Socket

  channel "room:*", IwsdkPhoenix.RoomChannel

  def connect(%{"token" => token}, socket, _connect_info) do
    case MyApp.Auth.verify(token) do
      {:ok, user_id} -> {:ok, assign(socket, :peer_id, user_id)}
      :error -> :error
    end
  end

  def id(socket), do: "peer:#{socket.assigns.peer_id}"
end
```

That is a working host-relayed room. For server authority, have the client join
with `mode: 'server_authoritative'`.

## Modules

| Module | Purpose |
|---|---|
| `IwsdkPhoenix.Protocol` | Binary codec, byte-compatible with the client |
| `IwsdkPhoenix.Protocol.Quantization` | Smallest-three quaternion packing |
| `IwsdkPhoenix.SpatialGrid` | Spatial hashing and area-of-interest |
| `IwsdkPhoenix.Room.State` | Pure room state, id allocation, AoI |
| `IwsdkPhoenix.Room.Handler` | Per-frame decisions, as pure functions |
| `IwsdkPhoenix.Room.Server` | One process per room, with the tick loop |
| `IwsdkPhoenix.RoomChannel` | Thin Phoenix channel |
| `IwsdkPhoenix.Physics` | Behaviour for server authority |
| `IwsdkPhoenix.Physics.Kinematic` | Default backend, pure Elixir |

## Optional dependencies

Every dependency is optional, and only `IwsdkPhoenix.RoomChannel` needs Phoenix —
it is conditionally compiled and simply absent otherwise. Everything else runs
from a plain OTP application.

That is a deliberate structural choice, not a convenience: all room logic lives
in dependency-free modules, so the interesting behaviour is testable without a
socket, an endpoint, or a running Phoenix application, and the channel is
reduced to translating return values into callback tuples.

```bash
IWSDK_CORE_ONLY=1 mix test   # entire core suite, no deps, no network
mix test                     # adds RoomChannel against a real Phoenix
```

`wasmex` and `horde` are likewise optional, for the experimental WASM physics
backend and for multi-node zone placement.

## Authority modes

**`:host_relayed`** — the server reads one byte and forwards the payload
untouched. No decoding on the hot path.

**`:server_authoritative`** — input frames are decoded, validated and
re-simulated. The default `Kinematic` backend rejects:

- speed hacks (movement clamped to the unit disc, which also closes the diagonal
  exploit that per-axis clamping leaves open)
- oversized timesteps (a client claiming one ten-second frame)
- replayed and out-of-order input sequences
- out-of-bounds motion, when bounds are configured

Clients may not assert their own transforms; such a frame is rejected with
`:client_authority_denied` rather than ignored, so a misconfigured client is
obvious rather than silently desynced.

### Parity with client prediction

`Kinematic.integrate/8` implements exactly the step the TypeScript client
predicts with. Because both sides run the same formula, an honest client's
prediction matches the server and the player never sees a correction —
divergence therefore means real packet loss or a lying client.

The equivalence is pinned by `fixtures/protocol_vectors.tsv`, which both test
suites verify.

> The original design proposed running Havok's WASM binary here via Wasmex for
> 1:1 parity. That is not achievable as described — see
> [`docs/FEASIBILITY.md`](../../docs/FEASIBILITY.md) for the Emscripten ABI
> analysis and what replaced it.

## Area of interest

```elixir
IwsdkPhoenix.Room.State.new("lobby", interest_radius: 50.0, cell_size: 50.0)
```

Cell size should be at least the interest radius so one ring of neighbours
covers the bubble. Pass `grid_mode: :flat` for ground-based worlds to skip the
vertical ring (9 cells instead of 27).

## License

MIT
