---
name: cardinal-network-protocol
description: Domain reference for the @iwsdk/plugin-phoenix wire protocol and backend Elixir services (packages/server, apps/bff-server, apps/demo_server). Use when reviewing networking, room/server authority, the binary protocol, or backend Elixir code.
---

# Cardinal Network Protocol Domain

## Purpose
Two implementations share one wire format: `@iwsdk/plugin-phoenix` (TypeScript client, `packages/client`) and `iwsdk_phoenix` (Elixir server, `packages/server`). `docs/PROTOCOL.md` is the normative spec; `fixtures/protocol_vectors.tsv` (generated from the TypeScript side) is checked byte-for-byte by both test suites — a protocol change not reflected in that fixture is not a real change.

## Wire format (`docs/PROTOCOL.md`)
- Every frame: one unsigned byte opcode, little-endian multi-byte fields, IEEE-754 `binary32` floats, zero-based byte offsets, self-delimiting (one frame per Phoenix message).
- 12 opcodes: `TRANSFORM_UPDATE`(1, 33B), `INPUT_UPDATE`(2, 22B, client→server), `SPAWN_ENTITY`(3, 41B, server→client), `DESPAWN_ENTITY`(4, 5B), `SNAPSHOT`(5, variable), `RECONCILE`(6, 21B), `PING`/`PONG`(7/8), `OWNERSHIP_REQUEST`/`OWNERSHIP_GRANT`(9/10), `SIGNAL`(11, relayed peer-to-peer), `COMPONENT_UPDATE`(12, variable).
- Any new or changed opcode needs the exact byte-offset table in `docs/PROTOCOL.md` updated first, then `fixtures/protocol_vectors.tsv` regenerated from the TypeScript side and diffed — never hand-edited.

## Interface design (`docs/rfc/0001-iwsdk-network.md`)
Proposes `@iwsdk/network`: a transport-agnostic `INetworkAdapter` interface plus `Networked`/`NetworkedTransform` ECS components, so application code talks to components and systems, never to a socket. `@iwsdk/plugin-phoenix` is the reference implementation of that adapter — review changes to the adapter surface against whether they'd still let a non-Phoenix backend implement the same interface.

## Server authority model
Grabbing/ownership is optimistic client-side (the object follows the hand instantly) but authoritative server-side (`OWNERSHIP_REQUEST`/`OWNERSHIP_GRANT` arbitrates; a losing client releases and snaps back via `RECONCILE`). `Room.Server.handle_frame/3` is a synchronous `GenServer.call` — every frame from every peer in a room serializes through one process, which is why rate limiting exists (see `docs/superpowers/specs/2026-08-15-rate-limiting-design.md`): an unbounded peer degrades every other peer in the same room, not just itself.

## Backend layout
- `packages/server` — the Elixir `iwsdk_phoenix` library: `RoomChannel`, `Room.Server`, `Physics.Kinematic` (server-side movement validation), `Persistence.Buffer`.
- `apps/bff-server` — a separate TypeScript BFF app; not part of the realtime room protocol, review it against its own API contract rather than the wire format above.
- `apps/demo_server` — the smallest Phoenix app hosting a room, and the channel's end-to-end tests.

## Review checklist
- A changed opcode or field width: `docs/PROTOCOL.md` table, `fixtures/protocol_vectors.tsv`, and both TS/Elixir encoders/decoders all move together, or the change isn't real.
- New message types crossing the `Room.Server` synchronous call: consider the amplification risk (one slow/malicious peer blocking 79 others) before approving.
- Ownership transitions stay: optimistic locally, authoritative on `OWNERSHIP_GRANT`, reconciled via `RECONCILE` on loss — a "predict the win" shortcut reintroduces the two-position fight the current design avoids.
