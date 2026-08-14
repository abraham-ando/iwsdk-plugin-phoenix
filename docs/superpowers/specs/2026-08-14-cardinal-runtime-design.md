# Cardinal — unified component runtime, design

Approved 2026-08-14, brainstormed section by section. Layer 0 of the Cardinal
programme: a single schema defines every replicated component once, and code
generation gives both runtimes — the elics ECS in the browser, the room
process on the BEAM — the same types, the same bytes, and machine-checked
parity. Systems stay hand-written and idiomatic on each side; only the data
is defined once.

## Context and scope

The client has a full entity-component model; the server holds a flat
`defstruct`. The two halves share nothing but the hand-written binary
protocol and one formula (`Physics.Kinematic`), pinned by golden vectors.
That one shared formula is the prototype this design generalizes: agreement
through a shared *definition* plus generated proof, never through a shared
binary (see `docs/FEASIBILITY.md` for why binary sharing is a dead end).

Cardinal's later layers — the simulation engine, the predictive netcode
already half-built, AI workloads — all sit on this one. They are explicitly
out of scope here, as are: string/map field types, per-field delta encoding,
component persistence, and any change to the existing hand-written frames.

A constraint recorded for the AI layer, established during this design:
WebGPU inside immersive WebXR sessions is **not implemented on Meta Quest**
(three.js issue #32858, filed by Meta's own WebXR spec editor; `@iwsdk/core`
0.5.3 instantiates only `WebGLRenderer`). Client-side GPU compute can only be
a non-per-frame side channel next to WebGL rendering, paying a CPU round
trip. Nothing in Cardinal layer 0 depends on this; it is recorded so layer 3
starts from facts.

## Section 1 — The schema

The source of truth is a JavaScript module, `cardinal/components.mjs`,
exporting a literal the generator validates strictly. Not JSON: the format
needs comments (the file *is* the protocol documentation), the repo already
loads schemas this way (`generate-fixtures.mjs`), and a malformed file fails
at load instead of silently.

```js
// cardinal/components.mjs
export const components = [
  {
    id: 1,                        // wire identity — never reassigned
    name: 'Health',
    fields: [
      { name: 'current', type: 'f32' },
      { name: 'max',     type: 'f32' },
    ],
  },
  {
    id: 2,
    name: 'Grabbable',
    fields: [
      { name: 'holderId',  type: 'u32' },  // 0 = nobody
      { name: 'grabPoint', type: 'vec3' },
    ],
  },
];
```

Decisions:

- **`id` is explicit and permanent.** Never derived from file order:
  reordering must not renumber, and a removed id leaves the domain rather
  than being recycled. The generator rejects duplicates. This is the
  protocol's opcode rule applied to components.
- **The v1 type system is deliberately closed**: `bool, u8, u16, u32, i32,
  f32, f64, vec3, quat`, plus fixed-length arrays
  (`{ type: 'array', of: 'u32', length: 16 }`). `quat` reuses the existing
  smallest-three u32 compression — module and parity vectors already exist.
  **No strings, no maps**: variable length would complicate every encoder,
  and the SIGNAL frame already carries blobs. They arrive when a real
  component needs them, not before.
- **Every field has a type-derived default** (zero everywhere), so a
  component is always constructible on both sides with no data — the
  property that makes generic spawn possible.

## Section 2 — The generation pipeline

One generator, `scripts/generate-cardinal.mjs`, in the style of
`generate-fixtures.mjs`. It loads the schema, validates it (unique ids,
known types, names legal in both languages), and emits three artifacts:

```
cardinal/components.mjs                    ← hand-written source
        │
        ├─→ packages/client/src/cardinal/components.generated.ts
        │     · typed elics createComponent definitions
        │     · encodeHealth(view, offset, data) / decodeHealth(view, offset)
        │     · CARDINAL_REGISTRY : id → { name, bytes, encode, decode }
        │     · SCHEMA_HASH constant
        │
        ├─→ packages/server/lib/iwsdk_phoenix/cardinal/components.generated.ex
        │     · one module per component: defstruct + @type t + encode/1 + decode/1
        │     · IwsdkPhoenix.Cardinal.Registry : id → module, id → byte_size
        │     · schema_hash/0
        │
        └─→ `cardinal …` rows in fixtures/protocol_vectors.tsv
              · per component: test values → exact bytes
              · both parity suites iterate them generically
```

Decisions:

- **Generated files are committed**, not produced at build time. This is
  PROTOCOL.md's versioning philosophy: regenerate and treat the diff as the
  change record — a reviewer sees exactly what changes on the wire. A
  tripwire in `pnpm test` (same pattern as `check-single-three.mjs`)
  regenerates and fails on drift: the schema cannot change without
  regeneration, and generated code cannot be edited by hand.
- **Deterministic output**: sorted by id, no timestamps, `GENERATED — do not
  edit` headers. Two runs are byte-identical, so the tripwire is a plain
  diff.
- **Fixed sizes by construction.** With only fixed-size types, every
  component has a constant `byteSize` known to both registries — what makes
  Section 3's sequential decode trivial, and why strings wait.
- **Validation lives in the generator, not the runtimes.** What ships is
  correct by construction; the hot path re-validates nothing.

## Section 3 — The wire format

One new batched opcode in the SNAPSHOT family:

```
COMPONENT_UPDATE (12)
  u8   op = 12
  u16  count                       record count
  u32  serverTick                  same base as SNAPSHOT
  records, count times:
    u32  networkId                 the entity
    u16  componentId               schema id
    u8[] payload                   byteSize(componentId) bytes, generated layout
```

Sequential decode is trivial *because* Section 2 fixed the sizes: read
`componentId`, the registry gives the length, advance. There is no per-record
length field — size is a property of the schema, not of the message.

Decisions:

- **Always batched, never one frame per component.** A lone record would be
  ~15 bytes — under the BEAM's 64-byte heap-binary threshold, hence *copied*
  to every recipient instead of shared by reference. A tick's batch crosses
  the threshold at two or three records and joins SNAPSHOT's refc regime.
- **Dirty tracking by byte comparison, generic.** The client network system
  encodes each Cardinal component of owned entities and publishes only if
  the bytes differ from the last send. Fixed sizes make this a memcmp — no
  per-field tracking, no elics hooks. A quiet component costs zero wire
  bytes.
- **Same authority rule as transforms.** Only the owner of `networkId`
  publishes its components; `server_authoritative` rejects a record aimed at
  someone else's entity through the existing `client_authority_denied` path;
  `host_relayed` relays.
- **Late join without breaking the fast path.** The server caches the latest
  payload per `(networkId, componentId)`: raw bytes in `host_relayed` — the
  documented zero-decode relay stays intact; the single validation pass only
  scans `networkId`s for authority, then relays the frame verbatim and
  copies the slices — and decoded generated structs in
  `server_authoritative`, because server logic (layer 1, later) reads them.
  On join, the newcomer receives spawns, then `COMPONENT_UPDATE` frames
  replaying the cache: current state, not just future changes.

## Section 4 — The two runtimes

**Server — `Room.State` finally gets components.** The flat struct grows one
field:

```elixir
components: %{network_id => %{component_id => payload}}
```

where `payload` is a raw binary in `host_relayed` and a generated struct in
`server_authoritative` (decoded via `Cardinal.Registry`). The handler gains
an op-12 clause with the same ownership verdicts as transforms. On peer
arrival, `after_join` replays the cache as `COMPONENT_UPDATE` frames after
the spawns.

**Client — Cardinal joins the single ingestion point.**
`PhoenixNetworkSystem`'s moduledoc rules that a frame is decoded exactly
once; op 12 is added there: `EntityIndex` lookup (networkId → entity), then
value writes through the generated elics definitions. Outbound, the same
system at `sendRateHz`: encode owned entities' Cardinal components, memcmp
against the last send, batch what changed. Installation is one generated
call — `registerCardinalComponents(world)` — invoked by
`installPhoenixNetworking`.

**Schema disagreement is caught at join, not on the wire.** A direct
consequence of Section 3: with no length field, an unknown `componentId`
makes sequential decode impossible — the record cannot even be skipped.
Rather than pay a byte per record for a case that is *always* a deployment
bug, the generator emits a `SCHEMA_HASH` into both registries; the client
sends it in the join params, the server compares, and **refuses loudly** on
divergence. This is PROTOCOL.md's versioning philosophy — a silent
disagreement "quietly misplaces everyone's avatar", a refused join is
diagnosed in a minute. After that check an unknown id can only be a bug:
frame rejected, warning logged.

## Section 5 — Verification and parity

Four tiers, all following from the generator knowing what it generated:

1. **Per-component vectors, auto-generated.** For each component the
   generator emits `cardinal <id> <values> <hex>` rows — values chosen per
   field type (zeros, extremes, negatives, non-trivial quaternions). Both
   parity suites iterate them generically: adding a component to the schema
   creates its parity proof without writing a test. The schema hash itself
   is pinned by a `cardinal_schema_hash <hex>` row both generated registries
   must equal — if TS and Elixir ever computed it differently, the TSV
   arbitrates.
2. **Frame-level vectors.** Complete `COMPONENT_UPDATE` batches (header plus
   heterogeneous records) as golden vectors, like the existing frames.
3. **Round-trip properties.** On both sides, `decode(encode(x)) == x` over
   seeded random values — vitest and ExUnit. Vectors prove cross-language
   parity; round-trips prove internal consistency over a far larger space.
4. **End to end in `apps/demo_server`** — the only place with a real socket,
   as with clock sync: a join with a divergent hash is refused; one peer
   publishes a component, the other receives it; a late joiner receives the
   cache replay; in `server_authoritative`, publishing onto someone else's
   entity is rejected.

Plus Section 2's drift tripwire in `pnpm test`, which guarantees everything
above tests the committed schema.

## Out of scope

- Layers 1–3 (simulation engine, further netcode, AI workloads) — each gets
  its own spec on top of this one.
- String/map field types, per-field deltas, quantized variants beyond `quat`.
- Persisting component caches through `IwsdkPhoenix.Persistence` (natural
  later extension; the cache shape is already persistence-friendly).
- Any change to existing hand-written frames or their vectors.
