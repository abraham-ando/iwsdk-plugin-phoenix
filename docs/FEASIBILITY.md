# Feasibility review of the design specification

This document records which parts of the original brainstorming specification
were implemented as written, which were implemented differently, and which could
not be built as described. It exists so the gap between the design and the
delivered package is explicit rather than something you discover at runtime.

Every claim below was checked against the actual `@iwsdk/core@0.5.3` and
`elics@3.4.2` packages, not from memory.

---

## 1. Corrections to the specification

### 1.1 The client package name and ECS API were wrong

The specification's sample code imports from `@meta/iwsdk` and defines
components and systems by subclassing:

```ts
import { Component, System } from '@meta/iwsdk';

export class Networked extends Component {
  public networkId: number = 0;
}
```

No such package exists, and that is not how IWSDK works. The real package is
**`@iwsdk/core`**, built on the **`elics`** ECS, where components are created by
a factory and stored in flat typed arrays:

```ts
import { Types, createComponent } from '@iwsdk/core';

export const Networked = createComponent('Networked', {
  networkId: { type: Types.Int32, default: 0 },
  isLocalOwner: { type: Types.Boolean, default: false },
});
```

Systems are likewise produced by `createSystem(queries, schema)` and subclassed
from the result. This is not a cosmetic difference: elics stores component data
column-wise in `TypedArray`s and hands out zero-copy per-entity views via
`entity.getVectorView(...)`, which is precisely what makes an allocation-free
network hot path possible. The specification's class-per-component design would
have allocated an object per entity per component.

**Consequence:** the entire component and system layer was written against the
real API. `pnpm typecheck` compiles `src` against the genuine `@iwsdk/core`, so
this cannot silently regress.

### 1.2 Vector fields cannot use `getValue` / `setValue`

elics raises on `getValue` for `Vec2`/`Vec3`/`Vec4`/`Color`; those must go
through `getVectorView`, which returns a cached subarray. This is a benefit —
it is the zero-copy path — but it dictates the shape of every system in the
package.

### 1.3 `Entity` has no `transform` property

The specification's code uses `entity.transform.position` and
`entity.transform.quaternion`. In IWSDK an entity has `entity.object3D` (a
Three.js `Object3D`) and a `Transform` component with `position: Vec3`,
`orientation: Vec4`, `scale: Vec3`, `parent: Entity`. The package reads and
writes the `Transform` component directly, which works headlessly and is what
`TransformSystem` binds `object3D` to anyway.

### 1.4 `world.getEntityByNetworkId` does not exist

The specification calls this method on the world. Nothing like it exists, so the
package provides `EntityIndex`, which maintains the mapping from query
qualify/disqualify events and rebuilds on a miss — at most once per frame, so an
unknown id cannot cause a rescan per frame.

### 1.5 The 33-byte packet is real, but batching matters more

The 33-byte `TRANSFORM_UPDATE` layout is implemented exactly as specified and is
covered by golden vectors. However, the specification's headline comparison
("33 bytes vs ~100–150 for competitors") measures only the payload.

Measured honestly: a snapshot record is 32 bytes against 33 for a standalone
frame, so **batching only wins on raw bytes from the ninth entity onward**. What
makes batching worthwhile long before that is per-message overhead — a Phoenix
binary message header for a topic like `room:lobby` is ~19 bytes before
WebSocket framing, and that is paid per message. The test
`only beats N individual frames on raw bytes once N > 8` states the real
crossover rather than the flattering one.

### 1.6 The quaternion compression scheme needed fixing

The specification calls for "smallest three" compression to 32 bits, which is
implemented. The obvious mapping — `round(t * 1023)` over `[0, 1]` — has a flaw
that only shows up in practice: zero lands on code 511.5 and is therefore never
exactly representable, leaving every unrotated component permanently off by half
a step. Identity is by far the most common rotation on the wire, so this shows
as a constant ~0.14° bias on every idle remote avatar.

The package instead maps `round(v / range * 511) + 512`, giving up code `0` to
gain an exactly symmetric mapping in which identity round-trips with zero error.

The specification does not state an accuracy figure. The measured worst case
over 20,000 uniformly distributed random rotations is **0.21°**, and the
documented and tested bound is 0.25°.

---

## 2. The significant one: Havok WASM on the BEAM via Wasmex

**Specification claim:** *"the Elixir server hosts the identical
`havok_physics.wasm` binary using Wasmex"*, giving *"strict 1:1 client/server
parity"* and *"Havok WASM 1:1 via Wasmex"* as an anti-cheat feature.

**Assessment: not achievable as described.** This is the one part of the design
that cannot be delivered by writing the code the specification implies.

`@babylonjs/havok` — the physics engine IWSDK actually uses — ships an
**Emscripten** build. An Emscripten `.wasm` is not a freestanding module. It
declares a large set of imports that Emscripten's generated JavaScript glue is
expected to provide, including:

- `env.emscripten_memcpy_big`, `env.emscripten_resize_heap`
- `env.abort`, `env.__assert_fail`
- a family of `__syscall_*` imports for its libc shim
- an imported/exported `WebAssembly.Memory` with dynamic growth
- a `WebAssembly.Table` for indirect calls, populated by the glue at startup

`Wasmex` can instantiate a module and let you supply host functions for imports,
so this is not categorically impossible — but implementing a faithful Emscripten
ABI, libc shim and memory-growth protocol in Elixir is a substantial project on
its own. Worse, it is self-defeating: **any inaccuracy in that shim reintroduces
exactly the client/server divergence the parity was meant to eliminate**, while
being far harder to detect than having no shared physics at all.

There is also a determinism caveat that would remain even with a perfect shim.
Havok is not guaranteed to produce bit-identical results across different
builds, and the BEAM's NIF scheduling would run the module on a dirty scheduler
with different floating-point environment assumptions than a browser's WASM
engine. "1:1 parity" is a stronger claim than the underlying engine offers.

### What was built instead

Authority is expressed as the `IwsdkPhoenix.Physics` **behaviour**, with:

- **`IwsdkPhoenix.Physics.Kinematic`** — the default, in pure Elixir. It
  re-runs the same movement integration the client predicts with, and rejects
  speed hacks, the diagonal-movement exploit, oversized timesteps, replayed
  input sequences and out-of-bounds motion.

  This achieves the *actual goal* — exact client/server agreement — by a route
  that works: rather than sharing a binary, the two sides share a **formula**,
  pinned by golden vectors in `fixtures/protocol_vectors.tsv` that both test
  suites verify. An honest client's prediction matches the server exactly and
  the player never sees a correction; a divergence therefore means real packet
  loss or a lying client, which is exactly the signal anti-cheat wants.

- **`IwsdkPhoenix.Physics.Wasm`** — documented as opt-in and experimental, for a
  module built with a freestanding target (`wasm32-unknown-unknown` or WASI)
  rather than Emscripten.

If full rigid-body authority is genuinely required, the realistic options are a
sidecar process running the engine natively and talking to the BEAM over a port,
or a Rust NIF wrapping a deterministic engine such as Rapier. Both are larger
efforts than this package, and both are honest about their cost.

---

## 3. Implemented as specified

| Specification item | Status |
|---|---|
| 33-byte `TRANSFORM_UPDATE`, little-endian, documented offsets | Implemented, golden-vector tested |
| Binary Phoenix Channels, no JSON on the hot path | Implemented; `phoenix.js` `ArrayBuffer` path confirmed in its serializer |
| Dedicated network Web Worker | Implemented |
| Zero-copy transfer to the render thread | Implemented as a lock-free SPSC `SharedArrayBuffer` ring, with a transferable `postMessage` fallback when the page is not cross-origin isolated |
| `Networked`, `NetworkedTransform`, `NetworkInput` components | Implemented (plus `NetworkStats`) |
| Interpolation and dead reckoning | Implemented, with a render delay and a capped extrapolation window |
| Offline / single-player mode | Implemented as an adapter, so no `if (offline)` branches exist in the systems |
| Host-relayed and server-authoritative modes | Implemented in `IwsdkPhoenix.Room.Handler` |
| Client prediction and reconciliation with input replay | Implemented |
| Spatial hashing / area of interest | Implemented in `IwsdkPhoenix.SpatialGrid` |
| Smallest-three quaternion compression | Implemented, with the zero-representation fix above |
| Network LOD (30/15/5 Hz bands) | Implemented on both sides; see the scope note below |
| `INetworkAdapter` RFC surface | Implemented, with three adapters proving the abstraction |
| Ownership transfer (server-arbitrated) | Implemented; not in the original spec, but required for grabbing shared objects |
| Asynchronous batched persistence | Implemented as a coalescing write-behind buffer and writer process, independent of Ecto |
| Zone handoff between processes | Implemented as a two-phase protocol; cross-*node* process placement is left to Horde |
| Cross-zone id allocation | Implemented; not in the original spec, but required for handoff to be correct at all |
| WebRTC signalling relay | Implemented as an opaque, sender-stamped, length-capped `SIGNAL` frame |
| Server-owned replicated objects | Implemented; the protocol had SPAWN/DESPAWN and the client had the hooks, but nothing could create one |

### Scope note on Network LOD

True level of detail is a **per-viewer** decision, and only the server knows
where every observer is. `IwsdkPhoenix.SpatialGrid.lod_rate/1` and the
area-of-interest filter in `IwsdkPhoenix.Room.State` do that properly.

The client's `NetworkLODSystem` can only measure distance from the *local*
camera, so it throttles publishing of objects the local player owns and has
carried away from the action. That is a real saving but a narrower claim than
the specification implies, and the module documents it as such rather than
presenting itself as the whole mechanism.

---

## 3b. A problem the specification does not mention: ids collide across zones

The design describes zone handoff via Horde as a scalability feature, and
network ids as a per-room concern. Those two are in direct conflict, and
implementing the first exposes it.

A single room can allocate ids from a plain counter — it is the only writer, so
uniqueness is free. As soon as a player can *move between* zones, that breaks:
zone A and zone B both start counting at 1, so a player arriving in B carrying
id 7 collides with whatever B already calls 7. Nothing errors. Two entities
share an id, transforms cross-apply, and two avatars smear into one another.

Renumbering on arrival is not a fix. The id is the address every other client
uses for that entity, so changing it is a visible despawn/respawn for the whole
room, and any frame still in flight naming the old id lands on the wrong entity.

`IwsdkPhoenix.Zone.IdAllocator` resolves it by making uniqueness *structural*:
`partitioned/2` puts the zone index in the high bits and a per-zone counter in
the low bits, so zones allocate concurrently and can never collide, with no
coordination and no allocator to become a bottleneck. The default 8/23 split
gives 256 zones of ~8.3M entities. A single-zone deployment keeps the plain
counter and pays nothing.

---

## 4. Specified but not implemented

These were part of the design and are deliberately not in this package. Each
would be a meaningful piece of work in its own right, and shipping a token
version would be worse than shipping none.

- **Cross-node process placement.** `horde` remains an optional dependency.
  `IwsdkPhoenix.Zone.Handoff` addresses zones through any `GenServer.server()`,
  so a `Horde.Registry` via-tuple works unchanged — but the package does not
  ship a supervisor that migrates zone processes between nodes on failure. What
  *is* implemented is the harder half: the player handoff protocol itself (see
  below).
- **Spatialised audio playback.** IWSDK already ships `AudioSource`,
  `DistanceModel` and `AudioSystem`, so positional audio is the host SDK's job,
  not this package's — reimplementing a `PannerNode` layer here would duplicate
  it. What *was* missing is the networking half, and that is now built: the
  `SIGNAL` frame relays WebRTC negotiation between peers (see below). Wiring a
  negotiated `MediaStream` into IWSDK's audio graph remains application code.
- **Ecto schemas.** `IwsdkPhoenix` still has no database dependency and ships
  no schema or migration — the application owns its tables. The batching and
  coalescing layer *is* implemented (see below); only the Ecto-specific glue is
  left to the caller, which is a four-line `insert_all`.
- **Phoenix Presence integration.** `PhoenixConnection` consumes Presence on the
  client and degrades gracefully when the server does not track it, but the
  package does not ship a `Phoenix.Presence` module for the server side.

---

## 5. Verification status

| Check | Result |
|---|---|
| Client unit + integration tests | 95 passing |
| Server tests (incl. 19 doctests) | 179 passing |
| Cross-language golden vectors | Verified in both languages |
| Live interop (TS client driving the real Elixir server) | 9 scenarios passing |
| TypeScript typecheck against real `@iwsdk/core@0.5.3` | Clean |
| Client build (ESM + `.d.ts` + bundled worker) | Succeeds |
| `mix format --check-formatted` | Clean |

**Not verified in this environment:** `IwsdkPhoenix.RoomChannel` has never been
compiled, because `repo.hex.pm` is unreachable from the build container and
Phoenix could not be fetched. This is exactly why the channel was made a thin
shim over `IwsdkPhoenix.Room.Handler` — every decision it makes lives in a
dependency-free module with full test coverage, and what remains in the channel
is the translation of those return values into `Phoenix.Channel` callback
tuples. The CI workflow in `.github/workflows/ci.yml` compiles and tests it
against a real Phoenix; treat that as the gate before relying on it.

Similarly, the Web Worker path has not been exercised in a browser. The
`RingBuffer` it depends on is tested directly, including a 20,000-step
interleaved fuzz run, and `PhoenixAdapter` accepts an injectable `workerFactory`
precisely so a host can substitute one.
