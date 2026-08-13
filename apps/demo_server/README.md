# Demo server

The smallest Phoenix application that hosts an IWSDK room: one socket, one
channel, one health check. No Ecto, no templates, no assets, no mailer — what is
left is exactly what `iwsdk_phoenix` needs from Phoenix.

It pairs with [`apps/demo`](../demo).

## Running it

```sh
cd apps/demo_server
mix deps.get
mix phx.server            # http://localhost:4000
```

Then point the client at it:

```sh
# apps/demo/.env.local
VITE_PHOENIX_ENDPOINT=ws://localhost:4000/socket
```

```sh
pnpm demo                 # from the repo root
```

Open two tabs. Each is assigned a network id, each renders the other as a
coloured head, and both argue over who is holding the plant.

`GET /health` reports the rooms currently running, which is the quickest way to
tell "the server is not up" apart from "the server is up and my client never
joined".

## Why this app is worth its weight

It is not only a thing to connect to. `iwsdk_phoenix` deliberately keeps every
decision in dependency-free modules so the room logic can be tested without
Phoenix — which leaves the channel itself, the part that translates those
decisions into `Phoenix.Channel` callbacks, resting on reasoning rather than on
a test.

`test/demo_server_web/room_channel_test.exs` closes that gap. It drives the real
channel through a real socket and asserts on the behaviour that had already been
wrong once in each of three different ways:

| Behaviour | The bug it guards against |
|---|---|
| Two peers in a room get different network ids | Per-socket room state handed both of them id 1 |
| Both peers are told about each other | Nothing announced an arrival; nobody ever saw anybody |
| A directed signal reaches one peer, not the room | `peer_topic/1` returned a constant, fanning every signal out |
| A departing peer is despawned | — |
| A transform is relayed to others but not echoed back | An echo fights the sender's own prediction |
| The signal sender is stamped by the server | A peer could otherwise answer a call in someone else's name |
| A second claim on a held object is refused, and names the winner | — |
| A client transform is rejected under server authority | The whole point of the mode |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `SECRET_KEY_BASE` | a literal in `config/dev.exs` | Signing key; this app has no sessions and stores nothing |

## Not production

Two deliberate shortcuts, both wrong outside a demo:

- **`connect/3` accepts everyone** and invents a peer id for anyone who does not
  supply one. The peer id is what the room uses to decide who owns an object, so
  a client that picks its own peer id can claim to be another player. Verify a
  token and derive the id from it — see the moduledoc on
  `DemoServerWeb.UserSocket`.
- **`check_origin: false`**, so the Vite dev server on another port can open a
  WebSocket. A deployment lists its own origins.
