# @iwsdk/plugin-phoenix

WebXR multiplayer for [Meta's Immersive Web SDK](https://github.com/facebook/immersive-web-sdk),
backed by [Phoenix Channels](https://hexdocs.pm/phoenix/channels.html) and the BEAM.

Two packages, one wire protocol:

| Package | Language | Purpose |
|---|---|---|
| [`@iwsdk/plugin-phoenix`](packages/client) | TypeScript | IWSDK plugin: ECS components, systems, worker transport |
| [`iwsdk_phoenix`](packages/server) | Elixir | Phoenix channel, room processes, spatial filtering, server authority |

## Why this pairing

A headset renders at 90 FPS — **11.1 ms** per frame. Anything that blocks the
main thread costs a frame, and dropped frames in VR are a comfort problem rather
than a polish one. So all socket work happens in a dedicated worker and reaches
the render thread through a lock-free shared-memory ring that it drains once per
frame.

On the server, the BEAM's process model maps onto rooms almost exactly: a
process costs a few hundred bytes, is pre-emptively scheduled, and a crash in one
room cannot take down another.

## Quick start

### Client

```bash
npm install @iwsdk/plugin-phoenix
```

```ts
import { World, SessionMode } from '@iwsdk/core';
import { installPhoenixNetworking, Networked, NetworkedTransform } from '@iwsdk/plugin-phoenix';

const world = await World.create(document.getElementById('scene')!, {
  xr: { sessionMode: SessionMode.ImmersiveVR },
});

const net = installPhoenixNetworking(world, {
  endpoint: 'wss://example.com/socket',
  roomId: 'lobby',
});
await net.ready;

// Replicate an entity you own.
const avatar = world.createTransformEntity();
avatar.addComponent(Networked, { networkId: 1, isLocalOwner: true });
avatar.addComponent(NetworkedTransform);
```

Remote entities need the same two components with `isLocalOwner: false`; the
plugin interpolates them automatically.

### Server

```elixir
# mix.exs
{:iwsdk_phoenix, "~> 0.1"}
```

```elixir
# lib/my_app_web/channels/user_socket.ex
defmodule MyAppWeb.UserSocket do
  use Phoenix.Socket

  channel "room:*", IwsdkPhoenix.RoomChannel

  def connect(%{"token" => token}, socket, _info) do
    case MyApp.Auth.verify(token) do
      {:ok, user_id} -> {:ok, assign(socket, :peer_id, user_id)}
      :error -> :error
    end
  end

  def id(socket), do: "peer:#{socket.assigns.peer_id}"
end
```

That is enough for a working host-relayed room.

## Single player

```ts
installPhoenixNetworking(world, { isOffline: true });
```

Offline is implemented as an *adapter*, not a flag. Every system runs its normal
code path and publishes into a sink, so there is no `if (offline)` branch
anywhere in the update loop that could drift out of sync with the networked one.

## Authority modes

```ts
installPhoenixNetworking(world, {
  endpoint: 'wss://example.com/socket',
  mode: 'server_authoritative',   // enables client prediction automatically
  moveSpeed: 4.5,                 // must match the server
});
```

- **`host_relayed`** (default) — the server reads one byte and forwards the
  payload untouched. Cheapest path; right for cooperative and social scenes.
- **`server_authoritative`** — input is decoded, validated and re-simulated.
  Clients cannot assert their own transforms.

Under server authority the client predicts locally and reconciles against
corrections, so the player feels no round-trip latency on their own movement.
Client and server run the **same movement formula**, pinned by golden vectors, so
an honest client's prediction matches exactly and no correction is ever visible.

## What is in the box

**Client**

- 33-byte transform frames, batched snapshots, optional 32-bit quaternion compression
- Dedicated network worker; `SharedArrayBuffer` ring with `postMessage` fallback
- Interpolation with a render delay, plus capped dead reckoning
- Client prediction with reconciliation and input replay
- Distance-based publish-rate throttling
- Server-arbitrated ownership transfer for picking up shared objects
- Opaque WebRTC signalling relay for peer-to-peer voice
- Phoenix, Offline and Loopback adapters behind one `INetworkAdapter`

**Server**

- Binary codec, byte-compatible with the client
- One process per room, with a drift-free tick loop
- Spatial-hash area-of-interest filtering
- Server-owned replicated objects, with authority enforced on their transforms
- Pluggable authority backend; the default rejects speed hacks, the diagonal
  exploit, oversized timesteps and replayed input
- Two-phase zone handoff that never loses or duplicates a player, with
  collision-free id allocation across zones
- Coalescing write-behind persistence, independent of Ecto
- Works without Phoenix for everything except the channel itself

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it fits together, and why each layer is shaped that way |
| [PROTOCOL.md](docs/PROTOCOL.md) | Normative wire format |
| [FEASIBILITY.md](docs/FEASIBILITY.md) | **Read this.** What was built as specified, what was changed, what was not built |
| [RFC 0001](docs/rfc/0001-iwsdk-network.md) | Proposal for a backend-agnostic `@iwsdk/network` |

`docs/FEASIBILITY.md` is not boilerplate. The original design called for running
Havok's WASM build on the BEAM through Wasmex for 1:1 physics parity; that is not
achievable as described, and the document explains why and what replaced it.

## Development

```bash
pnpm install
pnpm build                    # ESM + .d.ts + bundled worker
pnpm test                     # client suite
pnpm typecheck                # against the real @iwsdk/core

cd packages/server
mix deps.get && mix test      # full server suite
IWSDK_CORE_ONLY=1 mix test    # core suite, no dependencies, no network
```

### Cross-language parity

`fixtures/protocol_vectors.tsv` holds golden vectors generated from the
TypeScript implementation and verified byte-for-byte by **both** suites — frame
layouts, quaternion packing, and the movement formula. Whichever side breaks
parity is the side that reports it.

Regenerate after any protocol change, and treat the diff as the change record:

```bash
pnpm build && node scripts/generate-fixtures.mjs
```

Golden vectors prove the two sides *encode* identically. They cannot prove the
two actually interoperate, so `packages/client/test/interop.test.ts` spawns the
real Elixir server and drives a full session through it — input simulation,
reconciliation, snapshots, ownership arbitration and signalling — using the
genuine client codec, with nothing stubbed on either side. It skips itself when
Elixir is unavailable.

## Status

Verified: 95 client tests (incl. 9 live interop), 179 server tests, cross-language parity, clean
typecheck against `@iwsdk/core@0.5.3`, successful build.

Not yet verified in a browser: the Web Worker path (its `RingBuffer` is tested
directly, including a 20,000-step fuzz run). Not yet compiled against a real
Phoenix in this environment — see the verification table in
[FEASIBILITY.md](docs/FEASIBILITY.md#5-verification-status).

## License

MIT
