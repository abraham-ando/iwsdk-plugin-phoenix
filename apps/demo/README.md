# Multiplayer demo

An IWSDK app wired to [`@iwsdk/plugin-phoenix`](../../packages/client).

Scaffolded with the official generator and left as close to stock as possible,
so what is *added* for multiplayer is easy to read off the diff:

```sh
npm create @iwsdk@latest demo -- --target vr --language ts --locomotion --grabbing
```

Everything else in this directory — `iwsdk.config.json`, the scene, the robot
and panel systems, the agent instruction files — came out of that command.

## Running it

```sh
pnpm install          # from the repo root
pnpm --filter @iwsdk/plugin-phoenix build
pnpm --filter @iwsdk/plugin-phoenix-demo dev
```

With no configuration it runs **single player**: the plugin installs its offline
adapter, every system runs its normal code path, and nothing is published. The
scene loads its models from a CDN, so the first run needs network access.

To connect to a room, copy `.env.example` to `.env.local` and set an endpoint:

```sh
VITE_PHOENIX_ENDPOINT=ws://localhost:4000/socket
```

Then open the page in two tabs. Each gets its own network id, and each renders
the other as a coloured head.

## What it demonstrates

| Behaviour | Where |
|---|---|
| Publishing the local head pose under the server-assigned id | `src/multiplayer.ts` — `update()` |
| Instantiating and removing remote peers from SPAWN/DESPAWN | `src/multiplayer.ts` — `addPeer` / `removePeer` |
| Server-arbitrated ownership when two players grab one object | `src/multiplayer.ts` — `claim` / `onOwnershipChange` |
| Offline, host-relayed and server-authoritative from one build | `src/networking.ts` |
| Cross-origin isolation for the shared-memory ring | `vite.config.ts` |

The part worth reading is ownership. Grabbing is optimistic — the plant follows
your hand the instant you squeeze — but *authority* is not: the app asks the
server and releases the object if it lost the race. Predicting a win instead
would have both players publishing transforms for the same object until the
correction landed, and the plant would visibly fight between two positions.

## Two things this demo has to work around

**Cross-origin isolation.** The plugin reads inbound frames through a
`SharedArrayBuffer` ring, which browsers only hand to a cross-origin isolated
page. `vite.config.ts` sends `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` for both `dev` and `preview`; a
deployment must send the same pair. Without them the plugin quietly falls back
to `postMessage`, which works but costs a copy and a task per frame.

**Ids for scene-authored objects.** Players and server-spawned objects get their
network id from the room. The plant does not: it exists on every client before
anyone connects, so all of them have to arrive at the same id independently.
`SHARED_PLANT_ID` is a constant well clear of the room's allocator. That is the
right answer for a fixed scene and the wrong one for content authored at
runtime — see [RFC 0001](../../docs/rfc/0001-iwsdk-network.md).

## Verified

Both peers below are real Chromium instances against a stand-in Phoenix socket:

- the network worker loads and connects from the built bundle
- `crossOriginIsolated` is true, so the shared-memory ring is the active path
- the server-assigned id reaches the application (`connected · you are #1`)
- a second peer appears in the first peer's room, and vice versa
- closing the second tab removes its avatar from the first

Not verified: an actual headset, and the CDN-hosted scene assets (blocked in the
environment this was built in).
