# @iwsdk/plugin-phoenix

WebXR multiplayer for [Meta's Immersive Web SDK](https://github.com/facebook/immersive-web-sdk),
backed by [Phoenix Channels](https://hexdocs.pm/phoenix/channels.html).

Pairs with the Hex package [`iwsdk_phoenix`](https://hex.pm/packages/iwsdk_phoenix).

## Install

```bash
npm install @iwsdk/plugin-phoenix
```

`@iwsdk/core` is a peer dependency.

## Use

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
```

Mark an entity as replicated:

```ts
const avatar = world.createTransformEntity();
avatar.addComponent(Networked, { networkId: 1, isLocalOwner: true });
avatar.addComponent(NetworkedTransform);
```

Entities owned elsewhere take the same components with `isLocalOwner: false` and
are interpolated automatically.

## Options

| Option | Default | Meaning |
|---|---|---|
| `endpoint` | — | Socket URL. Required unless `isOffline` or a custom `adapter`. |
| `roomId` | `'lobby'` | Joins the Phoenix topic `room:<roomId>`. |
| `token` | — | Forwarded to the server's `connect/3`. |
| `mode` | `'host_relayed'` | Or `'server_authoritative'`. |
| `isOffline` | `false` | Single player; systems run unchanged. |
| `adapter` | — | Supply your own `INetworkAdapter`. |
| `sendRateHz` | `30` | Publish-rate ceiling. |
| `batchOutbound` | `true` | One `SNAPSHOT` per tick instead of N frames. |
| `quantize` | `false` | Compress outbound quaternions to 32 bits. |
| `prediction` | auto | On by default under server authority. |
| `networkLod` | `true` | Distance-based publish throttling. |
| `moveSpeed` | `4.5` | m/s for prediction; **must match the server**. |

## Threading

All socket work runs in a dedicated worker. Inbound frames reach the render
thread through a lock-free `SharedArrayBuffer` ring drained once per frame — no
per-frame allocation and no message-task churn competing with rendering.

`SharedArrayBuffer` needs cross-origin isolation:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without those headers the plugin transparently falls back to transferable
`postMessage`. Nothing else changes.

If your bundler cannot resolve the worker automatically, pass one in:

```ts
installPhoenixNetworking(world, {
  endpoint: 'wss://example.com/socket',
  adapterOptions: {
    workerFactory: () =>
      new Worker(new URL('@iwsdk/plugin-phoenix/worker', import.meta.url), { type: 'module' }),
  },
});
```

## Single player

```ts
installPhoenixNetworking(world, { isOffline: true });
```

Offline is an adapter, not a flag — every system takes its normal path and
publishes into a sink, so the single-player path cannot drift from the
multiplayer one.

## Testing your own game code

`LoopbackAdapter` runs peers in memory with simulated latency and packet loss,
which is what actually exposes interpolation and reconciliation bugs:

```ts
import { LoopbackNetwork } from '@iwsdk/plugin-phoenix';

const bus = new LoopbackNetwork(80, 0.05); // 80 ms one-way, 5% loss
const adapter = bus.createPeer('alice');

installPhoenixNetworking(world, { adapter });
bus.advance(16); // deterministic: no timers involved
```

## Documentation

- [Architecture](../../docs/ARCHITECTURE.md)
- [Wire protocol](../../docs/PROTOCOL.md)
- [Feasibility review](../../docs/FEASIBILITY.md)
- [RFC 0001 — `@iwsdk/network`](../../docs/rfc/0001-iwsdk-network.md)

## License

MIT
