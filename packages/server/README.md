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
| `IwsdkPhoenix.Zone.Handoff` | Two-phase player migration between zones |
| `IwsdkPhoenix.Zone.IdAllocator` | Collision-free network ids across zones |
| `IwsdkPhoenix.Persistence.Buffer` | Coalescing write-behind buffer |
| `IwsdkPhoenix.Persistence.Writer` | Batched flush process |

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

## Replicated objects

A room can own entities, not just avatars — a ball, a tool, a door:

```elixir
{:ok, ball, spawn_frame} =
  IwsdkPhoenix.Room.Server.spawn_entity(room, prefab_id: 3, position: %{x: 0.0, y: 1.0, z: 0.0})
```

Broadcast `spawn_frame` and every client instantiates it. Objects are
area-of-interest filtered like players, and excluded from their own owner's
snapshot since that client predicts them locally.

Only the current owner may move an object; a transform published by anyone else
is relayed for compatibility but never applied to the server's copy. Combined
with `request_ownership`, that is the complete "pick it up, move it, put it
down" path.

## Zone handoff

Moving a player between zones is two-phase, because the obvious one-phase
versions are both wrong: remove-then-add loses the player if the target is
unreachable, and add-then-remove leaves them simulating in two places at once.

```elixir
IwsdkPhoenix.Zone.Handoff.transfer(zone_a, zone_b, "alice")
```

The player is retained in the source until the target confirms, so a failed
handoff costs only the input during the attempt.

Handoff requires ids that are unique across zones — a per-room counter would
silently collide. Give each zone a disjoint range:

```elixir
IwsdkPhoenix.Room.State.new("zone-3",
  allocator: IwsdkPhoenix.Zone.IdAllocator.partitioned(3)
)
```

## Persistence

Asynchronous, batched, and coalescing — a player publishing at 30 Hz costs one
write per flush interval, not thirty per second.

```elixir
{IwsdkPhoenix.Persistence.Writer, store: MyApp.PlayerStore, interval_ms: 5_000}
```

Rooms call `Writer.record/3`, which is a cast and therefore cannot block a tick
or fail. Failed batches are retried without overwriting newer values, and
whatever is pending is flushed on graceful shutdown.

## License

MIT
