# RFC 0001 — `@iwsdk/network`: a backend-agnostic networking interface

- **Status:** Draft
- **Target:** [facebook/immersive-web-sdk](https://github.com/facebook/immersive-web-sdk)
- **Reference implementation:** [`@iwsdk/plugin-phoenix`](../../packages/client)

## Summary

Add a small package, `@iwsdk/network`, defining a transport-agnostic interface
(`INetworkAdapter`) plus the ECS components that multiplayer WebXR applications
invariably need. It ships **no transport**. Backends live outside the core as
independent packages.

## Motivation

IWSDK provides rendering, input, locomotion, grabbing, physics and spatial UI,
but nothing for the network. Every team building shared WebXR therefore rebuilds
the same layer: a wire format, an interpolation buffer, an ownership model, a
prediction loop.

They are rebuilding it *differently*, which is the real cost. Two IWSDK
applications cannot share avatar code, and no ecosystem of networked components
can form, because there is no common vocabulary for "this entity is replicated".

The obvious fix — pick a backend and ship it — is one Meta is reasonably
reluctant to make. Elixir, Node, Go and C++ backends all have legitimate
constituencies, and blessing one is a large, opinionated commitment.

**This proposal avoids that choice.** Standardising the *interface* and the
*components* is enough to unlock the ecosystem; the transport stays a
third-party concern.

## Guide-level explanation

An application talks to components and systems, never to a socket:

```ts
import { World } from '@iwsdk/core';
import { Networked, NetworkedTransform } from '@iwsdk/network';
import { PhoenixAdapter } from '@iwsdk/plugin-phoenix';

const world = await World.create(container, { xr: { sessionMode: SessionMode.ImmersiveVR } });

const adapter = new PhoenixAdapter();
await adapter.connect('wss://example.com/socket', { roomId: 'lobby' });

installNetworking(world, { adapter });
```

Swapping backend is a one-line change, because nothing above the adapter knows
what a Phoenix channel is.

## Reference-level explanation

### The adapter interface

```ts
export interface NetworkMessage {
  opCode: number;
  senderId: string;
  payload: ArrayBuffer;
}

export type ConnectionState =
  | 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'errored';

export interface INetworkAdapter {
  readonly state: ConnectionState;
  readonly peerId: string;

  connect(endpoint: string, options?: ConnectOptions): Promise<void>;
  disconnect(): void;

  send(data: ArrayBuffer): void;
  broadcast(data: ArrayBuffer): void;

  onMessage(callback: (msg: NetworkMessage) => void): Unsubscribe;
  onPeerJoin(callback: (peerId: string) => void): Unsubscribe;
  onPeerLeave(callback: (peerId: string) => void): Unsubscribe;
  onStateChange?(callback: (state: ConnectionState) => void): Unsubscribe;
}
```

Notes on the specifics, each of which came from building the reference
implementation rather than from taste:

- **`ArrayBuffer`, not objects.** Serialization is the backend's business. A
  buffer is also directly transferable across a worker boundary.
- **`send` takes ownership.** The adapter may neuter the buffer while
  transferring it to a worker. Callers must not read it afterwards.
- **`send` on a disconnected adapter drops the frame** rather than throwing. It
  is called from the render loop, which must never fault because a socket
  blipped.
- **`state` is explicit, with `reconnecting` distinct from `errored`.** Sockets
  reconnect on their own; an application wants to show a transient indicator,
  not an error.
- **Every `on*` returns an unsubscribe function**, so systems can clean up in
  `destroy()`.
- **`onStateChange` is optional**, so a trivial adapter stays trivial.

### Components

These are the part with real ecosystem value: agreeing on `Networked` is what
lets an avatar package from one author work with a transport from another.

```ts
export const Networked = createComponent('Networked', {
  networkId:    { type: Types.Int32,   default: 0 },
  isLocalOwner: { type: Types.Boolean, default: false },
  ownerId:      { type: Types.Int32,   default: 0 },
  prefabId:     { type: Types.Int32,   default: 0 },
  sendRateHz:   { type: Types.Float32, default: 30 },
  lastSentAt:   { type: Types.Float64, default: 0 },
});

export const NetworkedTransform = createComponent('NetworkedTransform', {
  targetPosition:       { type: Types.Vec3,    default: [0, 0, 0] },
  targetOrientation:    { type: Types.Vec4,    default: [0, 0, 0, 1] },
  previousPosition:     { type: Types.Vec3,    default: [0, 0, 0] },
  previousOrientation:  { type: Types.Vec4,    default: [0, 0, 0, 1] },
  velocity:             { type: Types.Vec3,    default: [0, 0, 0] },
  targetTime:           { type: Types.Float64, default: 0 },
  previousTime:         { type: Types.Float64, default: 0 },
  interpolationDelayMs: { type: Types.Float32, default: 100 },
  maxExtrapolationMs:   { type: Types.Float32, default: 250 },
  hasSnapshot:          { type: Types.Boolean, default: false },
});
```

> `networkId` is `Int32` because elics has no unsigned 32-bit storage type.
> Servers should allocate from `[1, 2147483647]`, with `0` meaning unassigned.
> If `@iwsdk/network` is adopted, adding a `Uint32` type to elics would be a
> worthwhile companion change.

### Systems worth standardising

`NetworkInterpolationSystem` is the one with the strongest case. Rendering at
`now − delay` and interpolating between two held samples — rather than lerping
toward the newest — is the difference between smooth and jittery remote avatars,
and it is re-derived (often incorrectly) by every team that writes it. Shipping
it once, correctly, is a genuine service.

## Prior art

- **Networked A-Frame** proves the component vocabulary works for WebXR, but
  binds tightly to A-Frame and to its own transport.
- **Colyseus** has an excellent schema/state-sync model, and a fixed Node
  backend.
- **Unity NGO** and **Unreal replication** both standardise the *interface* and
  let transports vary — the model proposed here.
- **Photon** and **Normcore** are proprietary and vertically integrated.

Nothing in the WebXR ecosystem currently offers a transport-agnostic
networking interface tied to an ECS.

## Drawbacks

- Another package to maintain, with a compatibility surface.
- An interface without a bundled transport is not immediately runnable, which is
  a worse first-run experience than a batteries-included choice.
- Agreeing on component *semantics* (ownership transfer, authority, spawn
  lifecycle) is harder than agreeing on their *shape*, and this RFC only fully
  settles the latter.

## Alternatives

1. **Do nothing.** Every team keeps rebuilding the layer; no shared avatar or
   networked-object packages emerge.
2. **Bless one backend.** Best first-run experience, but the commitment Meta has
   reason to avoid, and it strands every other stack.
3. **Documentation only.** Cheap, but conventions without a compiler behind them
   do not converge.

## Unresolved questions

1. **Ownership transfer.** Should `@iwsdk/network` define a handoff protocol, or
   leave it to backends? Picking something up in a shared space is a genuinely
   common need, and it pairs directly with IWSDK's existing grabbing feature.
   The reference implementation now ships one — a server-arbitrated
   request/grant pair, first-come-first-served, with the verdict broadcast to
   the whole room — which is offered as a concrete starting point. The
   load-bearing detail is that clients must *not* claim ownership
   optimistically: two players grabbing simultaneously would both predict
   success and the object would visibly fight between them.
2. **Spawn lifecycle.** `prefabId` implies a registry mapping ids to factories.
   Should that be standardised, or left to the application?
3. **Serialization.** Should a default binary format ship, or should it stay
   backend-defined? `@iwsdk/plugin-phoenix` uses a 33-byte transform frame
   documented in [`docs/PROTOCOL.md`](../PROTOCOL.md), offered as a starting
   point rather than a proposal.
4. **Worker ownership.** Should IWSDK own a shared network worker, given that
   locomotion already has a `useWorker` option? A single worker serving both
   would avoid a second thread.

## Reference implementation

`@iwsdk/plugin-phoenix` implements this interface today with three adapters —
Phoenix (worker-backed), Offline, and Loopback (simulated latency and loss) —
which is the evidence that the abstraction holds for transports that are not
even networked.
