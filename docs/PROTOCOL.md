# Wire protocol

Normative specification of the binary format shared by `@iwsdk/plugin-phoenix`
and `iwsdk_phoenix`.

Both implementations are pinned to `fixtures/protocol_vectors.tsv`, which is
generated from the TypeScript side and verified byte-for-byte by both test
suites. A change to this document that is not reflected in that fixture is not
a real change.

## Conventions

- Every frame begins with one unsigned byte: the **opcode**.
- All multi-byte fields are **little-endian**, matching the native byte order of
  every platform IWSDK targets, so neither side pays for a byte swap.
- Floats are IEEE-754 `binary32` unless stated otherwise.
- Offsets are zero-based and in bytes.
- Frames are self-delimiting; a Phoenix message carries exactly one frame.

## Opcodes

| Value | Name | Direction | Size |
|---|---|---|---|
| 1 | `TRANSFORM_UPDATE` | both | 33 |
| 2 | `INPUT_UPDATE` | client → server | 22 |
| 3 | `SPAWN_ENTITY` | server → client | 41 |
| 4 | `DESPAWN_ENTITY` | server → client | 5 |
| 5 | `SNAPSHOT` | both | 8 + n·32, or 8 + n·20 quantized |
| 6 | `RECONCILE` | server → client | 21 |
| 7 | `PING` | client → server | 9 |
| 8 | `PONG` | server → client | 9 |
| 9 | `OWNERSHIP_REQUEST` | client → server | 9 |
| 10 | `OWNERSHIP_GRANT` | server → all clients | 14 |
| 11 | `SIGNAL` | client → one peer, relayed | 11 + payload |

---

## `TRANSFORM_UPDATE` (1) — 33 bytes

The canonical single-entity frame, exactly as specified in the original design.

| Offset | Type | Field |
|---|---|---|
| 0 | `u8` | opcode = 1 |
| 1–4 | `u32` | `networkId` |
| 5–8 | `f32` | `position.x` |
| 9–12 | `f32` | `position.y` |
| 13–16 | `f32` | `position.z` |
| 17–20 | `f32` | `rotation.x` |
| 21–24 | `f32` | `rotation.y` |
| 25–28 | `f32` | `rotation.z` |
| 29–32 | `f32` | `rotation.w` |

> **Note on `networkId`.** It is encoded as `u32`, but elics has no unsigned
> 32-bit storage type, so the client stores it in an `Int32`. Servers must
> allocate ids from `[1, 2147483647]`; `0` means "not yet assigned".
> `IwsdkPhoenix.Room.State` does this and wraps rather than overflowing.

---

## `SNAPSHOT` (5) — batched transforms

Header:

| Offset | Type | Field |
|---|---|---|
| 0 | `u8` | opcode = 5 |
| 1 | `u8` | flags |
| 2–3 | `u16` | record count |
| 4–7 | `u32` | server tick |

Flags:

| Bit | Meaning |
|---|---|
| `0x01` | records use the 20-byte quantized layout |

### Full record — 32 bytes

| Offset | Type | Field |
|---|---|---|
| 0–3 | `u32` | `networkId` |
| 4–15 | `f32`×3 | position |
| 16–31 | `f32`×4 | rotation |

### Quantized record — 20 bytes

| Offset | Type | Field |
|---|---|---|
| 0–3 | `u32` | `networkId` |
| 4–15 | `f32`×3 | position |
| 16–19 | `u32` | rotation, smallest-three packed |

Position stays `f32`: positional error is directly visible as an avatar in the
wrong place, whereas rotation tolerates far more quantization before anyone
notices.

### When batching pays

A snapshot record is 32 bytes against 33 for a standalone `TRANSFORM_UPDATE`, so
on payload alone batching only wins from the **ninth** entity onward. It wins
much earlier in practice because per-message overhead — roughly 19 bytes of
Phoenix binary header for a topic like `room:lobby`, before WebSocket framing —
is paid once per message rather than once per entity.

---

## `INPUT_UPDATE` (2) — 22 bytes

| Offset | Type | Field |
|---|---|---|
| 0 | `u8` | opcode = 2 |
| 1–4 | `u32` | sequence |
| 5–6 | `u16` | delta milliseconds |
| 7–10 | `f32` | `movement.x` (strafe) |
| 11–14 | `f32` | `movement.y` (forward) |
| 15–18 | `f32` | yaw, radians |
| 19–21 | `u8`×3 | 24-bit button mask, little-endian |

The server clamps `delta` to its own maximum (100 ms by default) and clamps
`movement` to the unit disc. The client applies the identical clamps, so honest
input predicts the server exactly.

---

## `RECONCILE` (6) — 21 bytes

| Offset | Type | Field |
|---|---|---|
| 0 | `u8` | opcode = 6 |
| 1–4 | `u32` | `networkId` |
| 5–8 | `u32` | last processed input sequence |
| 9–20 | `f32`×3 | authoritative position |

The client discards every pending input up to and including that sequence, snaps
to the position, then replays the remainder.

---

## `SPAWN_ENTITY` (3) — 41 bytes

| Offset | Type | Field |
|---|---|---|
| 0 | `u8` | opcode = 3 |
| 1–4 | `u32` | `networkId` |
| 5–8 | `u32` | `prefabId` |
| 9–12 | `u32` | `ownerId` |
| 13–24 | `f32`×3 | position |
| 25–40 | `f32`×4 | rotation |

## `DESPAWN_ENTITY` (4) — 5 bytes

| Offset | Type | Field |
|---|---|---|
| 0 | `u8` | opcode = 4 |
| 1–4 | `u32` | `networkId` |

## `PING` (7) / `PONG` (8) — 9 bytes

| Offset | Type | Field |
|---|---|---|
| 0 | `u8` | opcode |
| 1–8 | `f64` | timestamp |

`f64` so `performance.now()` survives the round trip without losing sub-
millisecond resolution.

---

## `OWNERSHIP_REQUEST` (9) — 9 bytes

| Offset | Type | Field |
|---|---|---|
| 0 | `u8` | opcode = 9 |
| 1–4 | `u32` | `networkId` |
| 5–8 | `u32` | `requestId`, chosen by the client |

`requestId` is echoed in the grant so a client with several requests in flight
can match the answer without relying on ordering.

## `OWNERSHIP_GRANT` (10) — 14 bytes

| Offset | Type | Field |
|---|---|---|
| 0 | `u8` | opcode = 10 |
| 1–4 | `u32` | `networkId` |
| 5–8 | `u32` | `ownerId` after arbitration |
| 9–12 | `u32` | `requestId` |
| 13 | `u8` | 1 = granted, 0 = denied |

Broadcast to **every** peer including the requester, because ownership is
room-wide state: everyone needs to know who may now move the entity, and a
denied requester learns the actual owner from the same frame.

Arbitration is first-come, first-served and decided solely by the server — the
only place it *can* be decided correctly, since two players reaching for the
same object at the same instant will both believe they succeeded. Clients must
therefore not claim ownership optimistically: doing so makes the object visibly
fight between two positions until the verdict lands.

---

## `SIGNAL` (11) — 11 bytes + payload

| Offset | Type | Field |
|---|---|---|
| 0 | `u8` | opcode = 11 |
| 1–4 | `u32` | `targetNetworkId`, or 0 for everyone else |
| 5–8 | `u32` | `senderNetworkId`, **stamped by the server** |
| 9–10 | `u16` | payload length, max 16384 |
| 11… | bytes | opaque payload |

Carries WebRTC negotiation — SDP offers and answers, ICE candidates — without
the server parsing any of it. That opacity is the point: codecs, trickle ICE and
renegotiation can all change with no server-side change at all.

Two rules make the relay safe:

- **The sender field is overwritten server-side**, never trusted from the
  client. Otherwise a peer could answer a call in someone else's name and hijack
  the negotiation.
- **The payload is length-capped at 16 KiB.** This is the only frame where a
  client hands the server a length-prefixed blob to forward, and an unbounded
  length is precisely how a relay becomes an amplification vector.

A directed signal reaches exactly one peer; it is never fanned out to the room,
which would be both wasteful and a privacy leak. Target `0` broadcasts, which
peers use to announce themselves before they know anyone's id.

---

## Smallest-three quaternion compression

A unit quaternion has three degrees of freedom, so the largest-magnitude
component is recoverable from the other three. Its index is stored in 2 bits and
the remaining three in 10 bits each.

Because `q` and `−q` are the same rotation, the quaternion is flipped so the
dropped component is non-negative and its sign never needs storing.

```
 bits 31..30 | bits 29..20 | bits 19..10 | bits 9..0
 largest idx |     c0      |     c1      |    c2
```

`c0..c2` are the surviving components in ascending order (x, y, z, w) with the
largest index skipped.

### Component mapping

```
encode: clamp(round(v / (1/sqrt(2)) * 511), -511, 511) + 512   -> [1, 1023]
decode: (code - 512) / 511 * (1/sqrt(2))
```

Code `0` is deliberately unused. Giving it up buys a mapping that is exactly
symmetric about zero, so an unrotated component encodes to 512 and decodes back
to exactly `0.0`. The obvious alternative, `round(t * 1023)` over `[0, 1]`, puts
zero at 511.5 — permanently half a step off, which appears as a constant ~0.14°
bias on every idle avatar. Identity is the most common rotation on the wire, so
this is worth one code point.

### Accuracy

Measured over 20,000 uniformly distributed random rotations: worst-case angular
error **0.21°**; identity and the axis-aligned quarter turns round-trip exactly.
Both implementations test against a 0.25° bound.

Decoding must be total: every one of the 2³² possible words yields a normalized
quaternion, because this data arrives from the network and a `NaN` reaching the
scene graph would be far worse than an inaccurate rotation.

---

## Transport binding

Frames travel on the Phoenix channel event **`frame`**.

`phoenix.js` detects an `ArrayBuffer` payload and switches to its binary
encoding automatically, which arrives server-side as `{:binary, data}`. Replies
and broadcasts must be wrapped the same way or they will be JSON-encoded:

```elixir
broadcast_from!(socket, "frame", {:binary, payload})
{:reply, {:ok, {:binary, payload}}, socket}
```

## Error handling

Decoding is fed untrusted network data, so both implementations return errors
rather than raising:

- Elixir returns `{:error, :empty_frame | :unknown_opcode | :malformed_frame |
  :truncated_snapshot}`.
- TypeScript throws `ProtocolError`, which `PhoenixNetworkSystem` catches and
  logs so one bad frame cannot fault the render loop.

A known opcode with a bad body is reported distinctly from an unknown opcode:
the first means protocol drift, the second means unrelated traffic, and
conflating them makes version mismatches look like random corruption.

## Versioning

Any change to a layout, an opcode value or the quantization mapping is a
**breaking protocol change**, even when both sides still parse. A client and
server that disagree here do not crash — they quietly misplace everyone's
avatar, which is far more expensive to diagnose. Regenerate the fixture and
treat the diff as the change record:

```bash
pnpm build && node scripts/generate-fixtures.mjs
```
