# Cardinal Domain Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author the four domain-reference skills the Cardinal Studio agent roster depends on: simulation, character, AI, and network protocol.

**Architecture:** Each skill is a single `SKILL.md` file (no `references/` subfolder — these are domain maps, not multi-file skill packages) with YAML frontmatter (`name`, `description` only) followed by a domain map: purpose, key files/exports, invariants, and a review checklist. Content is grounded in the actual source files, not templated.

**Tech Stack:** Markdown, no code.

**Spec:** `docs/superpowers/specs/2026-08-18-cardinal-studio-agent-team-design.md` (§2 — New domain skills)

## Global Constraints

- Skill frontmatter is exactly `name` and `description` — no `tools` field (that belongs to agents, not skills), matching every existing `threejs-*`/`iwsdk-*` skill in this repo.
- Every skill is mirrored byte-for-byte at both `.claude/skills/<name>/SKILL.md` and `.agents/skills/<name>/SKILL.md` — the existing convention (verified: `iwsdk-debug`'s two copies are identical).
- One commit per task, message format `feat(skills): <summary>`, trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- No skill references application code by line number — line numbers drift; reference file/export names only.

---

### Task 1: `cardinal-simulation-domain`

**Files:**
- Create: `.claude/skills/cardinal-simulation-domain/SKILL.md`
- Create: `.agents/skills/cardinal-simulation-domain/SKILL.md` (mirror)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: skill name `cardinal-simulation-domain`, loadable at either path above. Task 4 of `cardinal-agent-roster.md` (`simulation-designer`) and one task in that same plan (`cardinal-world-reviewer`) reference this exact name.

- [ ] **Step 1: Write the skill file**

Create `.claude/skills/cardinal-simulation-domain/SKILL.md`:

```markdown
---
name: cardinal-simulation-domain
description: Domain reference for @iwsdk/cardinal-simulation — the headless deterministic civilization kernel, agent cognition, world content, and telemetry. Use when reviewing or designing simulation, village economy/trades, or NPC agent behavior at the simulation-kernel level (not the rendering or AI-dialogue level).
---

# Cardinal Simulation Domain

## Purpose
`@iwsdk/cardinal-simulation` (`packages/simulation`) is a headless, deterministic civilization simulation engine — a LeCun-style world-model substrate. It runs independently of rendering: `packages/world` renders terrain from the same functions this package exports, and `apps/demo`'s `ai-village.ts` wires simulated agents to `plugin-cardinal-ai` NPCs.

## Kernel (`src/kernel/`)
- `SimKernel.ts` — fixed-timestep kernel. `TICK_MS = 100`, `TICKS_PER_DAY = 2400` (one sim-day = 240 real seconds at 1x). `hourOfDay(tick)` maps a tick to `[0, 24)`. `advance(realDelta)` drives ticks; `MAX_TICKS_PER_ADVANCE = 1000` caps a single call so a stalled tab can't replay a huge backlog on resume. A `TickHandler` receives `TickContext { tick, hour, isDayStart, rng, events }`.
- `Rng.ts` — the kernel's seeded RNG. Every stochastic decision in the simulation must draw from `TickContext.rng`, never `Math.random()` — determinism is the point (same seed, same history, replayable).
- `EventLog.ts` — `ExternalEvent` queue; the bridge for injecting external input (player action, admin command) into an otherwise closed deterministic loop.
- `snapshot.ts` — serializes kernel state for save/replay.

## World content (`src/world/`, `src/content/`)
- `terrain.ts` — `heightAt`, `slopeAt`, `isWaterAt`, `depthAt`, `isRiverAt`, `isShoreAt`, `landMaskAt`, plus world constants `WORLD_SIZE`, `SEA_LEVEL`, `PLATEAU_RADIUS`, `BASIN_RADIUS`, `RIVER_CARVE_RADIUS`. `packages/world` calls these directly — terrain shape is defined once, here.
- `biomes.ts` — `BIOME_IDS`, `biomeAt`, `classifyBiome`, `humidityAt`.
- `SpatialGrid.ts` — spatial partitioning for agent/entity queries.
- `content/objects.ts`, `content/scenario.ts` — placeable world content and scenario definitions (what exists at simulation start).

## Agent cognition (`src/agents/`)
- `AgentRuntime.ts`, `AgentState.ts` — the per-agent update loop and its state shape.
- `BeliefState.ts`, `MemoryStream.ts` — what an agent believes and remembers; this is simulation-side memory, distinct from `packages/ai`'s `NPCMemory` (dialogue/RAG memory) — the two must not be conflated when reviewing.
- `Mode1.ts`, `Mode2.ts` — dual-process cognition (fast reactive vs. slow deliberative), the "LeCun-style" part of the design.
- `Perception.ts`, `navigation.ts`, `needs.ts`, `intrinsics.ts`, `actions.ts` — sensing, pathing, drives, and the action vocabulary an agent can execute.

## Character link
Village trades (`charbonnier`, `ferronnier`, `chasseur`, `pecheur`, `chercheur`, `inventeur`, `enseignant`, `commercant` — see `cardinal-character-domain`) are morphology presets; the *economic/behavioral* meaning of a trade (what a `ferronnier` agent actually does each tick) lives here in `agents/actions.ts` and `content/scenario.ts`, not in `packages/character`. Don't review one package assuming it owns both halves.

## Telemetry (`src/telemetry/`)
`MetricsCollector.ts`, `TrajectoryRecorder.ts`, `datasetExport.ts`, `MockPlanner.ts` — instrumentation and dataset export for offline analysis/training, not part of the runtime critical path.

## Entry points
`headless.ts` — run the simulation without a renderer. `dataset-cli.ts` — CLI for telemetry export. Both are what CI (`fixtures/cardinal_vectors.tsv`, `scripts/check-cardinal-drift.mjs`) checks against: a change to kernel or agent logic that isn't reflected in that fixture is not a real change — same discipline as `docs/PROTOCOL.md`'s protocol vectors.

## Review checklist
- Any new randomness draws from `TickContext.rng`, never `Math.random()`.
- Tick-handler work stays bounded — `MAX_TICKS_PER_ADVANCE` exists because a handler that's too slow per tick compounds after a tab is backgrounded.
- Simulation-side agent memory (`BeliefState`, `MemoryStream`) and AI-side NPC memory (`packages/ai`'s `NPCMemory`) are separate systems; a change that reads one to update the other needs an explicit bridge, not an assumption they're the same store.
- Terrain/biome functions are pure — `packages/world` depends on that purity to render deterministically from the same seed.
```

- [ ] **Step 2: Verify frontmatter and structure**

Run: `head -4 .claude/skills/cardinal-simulation-domain/SKILL.md`
Expected: exactly
```
---
name: cardinal-simulation-domain
description: Domain reference for @iwsdk/cardinal-simulation...
---
```

- [ ] **Step 3: Mirror to `.agents/skills/`**

```bash
mkdir -p .agents/skills/cardinal-simulation-domain
cp .claude/skills/cardinal-simulation-domain/SKILL.md .agents/skills/cardinal-simulation-domain/SKILL.md
diff -q .claude/skills/cardinal-simulation-domain/SKILL.md .agents/skills/cardinal-simulation-domain/SKILL.md
```
Expected: `diff` prints nothing (files identical).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/cardinal-simulation-domain .agents/skills/cardinal-simulation-domain
git commit -m "feat(skills): add cardinal-simulation-domain reference skill

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `cardinal-character-domain`

**Files:**
- Create: `.claude/skills/cardinal-character-domain/SKILL.md`
- Create: `.agents/skills/cardinal-character-domain/SKILL.md` (mirror)

**Interfaces:**
- Consumes: nothing (independent of Task 1).
- Produces: skill name `cardinal-character-domain`, referenced by `cardinal-genome-reviewer` in `cardinal-agent-roster.md`.

- [ ] **Step 1: Write the skill file**

Create `.claude/skills/cardinal-character-domain/SKILL.md`:

```markdown
---
name: cardinal-character-domain
description: Domain reference for @iwsdk/cardinal-character — genome, heredity, and compiled morphology of Cardinal's living beings, including the eight village-trade presets. Use when reviewing genome/genetics, family/species definitions, morphology compilation, or trade presets.
---

# Cardinal Character Domain

## Purpose
`@iwsdk/cardinal-character` (`packages/character`) turns a genome into a compiled, riggable character mesh through three layers: **family** (species/archetype rules), **genome** (an individual's genes), **compile** (genome → renderable geometry + rig).

## Family (`src/family/`)
- `types.ts` — `GeneDef`, `GeneGroup`, `Curve`, `ChainDef`, `MorphDef`, `FamilyDescriptor`. A `ChainDef` links a gene to a chain of dependent morph targets (e.g. `shoulderWidth` propagating through the torso/arm rig) — this is the mechanism the project's "give shoulderWidth a chain" history refers to.
- `humanoid.ts` — `HUMANOID`, the one registered family this repo currently defines.
- `registry.ts` — `registerFamily`, `getFamily`, `validateDescriptor`. New species/archetypes register here.
- `proportions.ts` — `evalCurve`, evaluates a `Curve` (gene value → proportion) at a given input.

## Genome (`src/genome/`)
- `types.ts` — `Genome`, `RngLike`, `clamp01`. A genome is a flat `Record<gene, number>` in `[0, 1]`.
- `create.ts` — `createGenome`, `defaultGenome`, `centeredDraw` (a genome generator biased toward the family's default center, not uniform random — new individuals look like plausible variation, not noise).
- `breed.ts` — `breed(parentA, parentB, rng)`, heredity — a child genome derived from two parents.
- `serialize.ts` — `GENOME_FORMAT_VERSION`, `packGenome`, `unpackGenome`. **Packed genomes are a versioned wire/save format** — bumping a gene's meaning without bumping `GENOME_FORMAT_VERSION` silently corrupts saved characters. `fixtures/character_vectors.tsv` (generated by `scripts/generate-character-vectors.mjs`) pins this byte-for-byte, the same discipline as the network protocol fixtures.

## Compile (`src/compile/`)
- `compile.ts` — `compile(genome, family) → CompiledCharacter` (`Vec3`, `BoneRest`, `RigBinding`, `CompiledBone` in `types.ts`). This is the expensive step; it turns 0-1 gene values into actual bone offsets and mesh morph weights via each `ChainDef`.
- `memo.ts` — `CompileCache`, `genomeKey(genome)`. Compilation is memoized by a stable key derived from the genome — review any change to `compile.ts` for whether `genomeKey` still captures every input that affects the output (a stale cache hides real changes).
- `clips.ts` — animation clip binding for the compiled rig.

## Presets — the eight village trades (`src/presets/metiers.ts`)
Not costumes: each preset is what twenty years of a trade does to a body — genes + a plausible `ageRange` + a one-line rationale, e.g. `ferronnier` (blacksmith): `shoulderWidth: 0.88, bodyMass: 0.75, armLength: 0.62` — "heavy frame, long forearms, the hammer over the chisel." The eight: `charbonnier`, `ferronnier`, `chasseur`, `pecheur`, `chercheur`, `inventeur`, `enseignant`, `commercant`. `genomeFromPreset(family, preset)` expands a preset's partial gene set to a full genome, defaulting any unspecified gene to `0.5`. **A preset is pinned data** — the whole point of "pinned so a blacksmith stays one" is that regenerating or reordering `METIERS` must not silently redraw an existing trade's body. Treat this map as append-only for existing keys.

## What lives elsewhere
Trade *behavior* (what a `ferronnier` agent does each simulated tick) is not here — see `agents/actions.ts` in `cardinal-simulation-domain`. This package owns morphology only.

## Review checklist
- Any new gene added to `HUMANOID.genes` needs a `ChainDef` if it should visibly affect the rig — an ungrafted gene compiles to nothing.
- `GENOME_FORMAT_VERSION` bumps whenever packed genome byte layout changes; `fixtures/character_vectors.tsv` must be regenerated and diffed, not hand-edited.
- New/changed trade presets in `metiers.ts` never silently reassign an existing trade's genes — that regresses a specific character's identity across saves.
- `compile()` changes are checked against `CompileCache`'s `genomeKey` — if compile now reads a new input, the key must include it.
```

- [ ] **Step 2: Verify frontmatter and structure**

Run: `head -4 .claude/skills/cardinal-character-domain/SKILL.md`
Expected: frontmatter block with `name: cardinal-character-domain`.

- [ ] **Step 3: Mirror to `.agents/skills/`**

```bash
mkdir -p .agents/skills/cardinal-character-domain
cp .claude/skills/cardinal-character-domain/SKILL.md .agents/skills/cardinal-character-domain/SKILL.md
diff -q .claude/skills/cardinal-character-domain/SKILL.md .agents/skills/cardinal-character-domain/SKILL.md
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/cardinal-character-domain .agents/skills/cardinal-character-domain
git commit -m "feat(skills): add cardinal-character-domain reference skill

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `cardinal-ai-domain`

**Files:**
- Create: `.claude/skills/cardinal-ai-domain/SKILL.md`
- Create: `.agents/skills/cardinal-ai-domain/SKILL.md` (mirror)

**Interfaces:**
- Consumes: nothing (independent of Tasks 1-2).
- Produces: skill name `cardinal-ai-domain`, referenced by `npc-behavior-engineer`, `ai-runtime-engineer`, and `ai-security-engineer` in `cardinal-agent-roster.md`.

- [ ] **Step 1: Write the skill file**

Create `.claude/skills/cardinal-ai-domain/SKILL.md`:

```markdown
---
name: cardinal-ai-domain
description: Domain reference for @iwsdk/plugin-cardinal-ai — the 20-submodule edge-AI NPC stack (memory, perception, RAG, security, runtime). Use when reviewing or building NPC behavior, AI runtime/performance, or AI security/guardrails; loads only the relevant section for your role.
---

# Cardinal AI Domain

## Purpose
`@iwsdk/plugin-cardinal-ai` (`packages/ai`) gives WebXR NPCs edge AI: episodic memory, action intents, gaze IK, banter, spatial RAG, and 3D spatialized voice — all local, no server round-trip for behavior. `apps/demo/src/ai-village.ts` is the reference integration (Eldrin, Garrick, Sylvia).

This skill is split into three sections. Load only the one matching your role — the module count is why three AI engineering roles exist separately rather than one.

## Behavior section — for `npc-behavior-engineer`
- `rag/` — Spatial RAG: retrieval grounded in the NPC's position/surroundings, not just text similarity.
- `perception/` — what an NPC currently senses (players, objects, other NPCs).
- `gaze/` — `NPCGazeTracker`-style IK: where the NPC looks, and why.
- `social/` — `GroupConversationSystem`, `NPCBanter` — multi-agent conversation dynamics.
- `intents/` — the action-intent vocabulary an NPC can decide to execute (parallel concept to simulation's `actions.ts` in `cardinal-simulation-domain`, but this is the dialogue/behavior layer, not the economic-simulation layer — don't conflate them).
- `avatar/` — `RPMAvatarRig` (procedural Ready Player Me rig construction), `RPMAnimationCatalog`, `AvatarMeshBinder`, `AvatarAnimationController`. **NPC avatars are built through this RPM pipeline — not through `cardinal-character`'s genome compiler, and not a target for `threejs-3d-generator` (Tripo) asset generation.** Review changes here for rig/animation correctness, not morphology.
- `ui/` — `SpatialDialogueUI` and other NPC-facing UI (in-world, UIKitML-adjacent — distinct from the desktop-only `hud.ts`/`ai-hud.ts` DOM overlays owned by `vr-comfort-ux-reviewer`).
- `mr/` — mixed-reality-specific perception/behavior adjustments.

## Runtime section — for `ai-runtime-engineer`
- `scheduler/` — when NPC AI work runs relative to the frame budget.
- `cache/`, `lod/` — level-of-detail for AI cost: distant/off-screen NPCs get cheaper cognition, not full RAG+perception every tick.
- `streaming/`, `speculative/` — incremental/predictive response generation, so an NPC can start speaking before a full response is ready.
- `workers/` — background-thread execution (not re-exported from the package's public `index.ts` barrel — internal to the runtime, still in scope for review since it's where the actual off-main-thread cost lives).
- `acoustics/` — audio propagation/spatialization support feeding `SpatialVoice`.
- `adapters/`, `context/`, `structured/`, `components/`, `systems/`, `debug/`, `plugin.ts` — the ECS glue: component definitions, systems that tick them, the `installCardinalAI` plugin entry point, and debug tooling.

## Security section — for `ai-security-engineer`
- `security/` — guardrails against prompt injection (a player's chat/voice input reaching an NPC's context), and controls on what an NPC's memory/RAG retrieval can leak back (e.g. one player's private conversation surfacing in another player's session with the same NPC). This is the one submodule that gets its own dedicated review role rather than folding into runtime or behavior — treat any change touching NPC input handling, memory storage, or RAG retrieval as security-relevant even when it isn't in this directory.

## Review checklist (all three roles)
- Every NPC surface that reaches this package started as untrusted input (player voice/text) at some point — trace it back to `security/`'s guardrails before approving new input paths.
- Frame-budget-sensitive changes (behavior or runtime) should note their expected cost per NPC per tick; the project's 11.1ms/frame budget doesn't scale with NPC count for free — cross-check with `perf-profiler`.
- `avatar/` changes never get redirected toward `cardinal-character` or generated-mesh replacement — the RPM rig pipeline is the settled pipeline for NPCs.
```

- [ ] **Step 2: Verify frontmatter and structure**

Run: `head -4 .claude/skills/cardinal-ai-domain/SKILL.md`
Expected: frontmatter block with `name: cardinal-ai-domain`.

- [ ] **Step 3: Mirror to `.agents/skills/`**

```bash
mkdir -p .agents/skills/cardinal-ai-domain
cp .claude/skills/cardinal-ai-domain/SKILL.md .agents/skills/cardinal-ai-domain/SKILL.md
diff -q .claude/skills/cardinal-ai-domain/SKILL.md .agents/skills/cardinal-ai-domain/SKILL.md
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/cardinal-ai-domain .agents/skills/cardinal-ai-domain
git commit -m "feat(skills): add cardinal-ai-domain reference skill

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `cardinal-network-protocol`

**Files:**
- Create: `.claude/skills/cardinal-network-protocol/SKILL.md`
- Create: `.agents/skills/cardinal-network-protocol/SKILL.md` (mirror)

**Interfaces:**
- Consumes: nothing (independent of Tasks 1-3).
- Produces: skill name `cardinal-network-protocol`, referenced by `phoenix-networking-reviewer` and `bff-backend-engineer` in `cardinal-agent-roster.md`.

- [ ] **Step 1: Write the skill file**

Create `.claude/skills/cardinal-network-protocol/SKILL.md`:

```markdown
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
```

- [ ] **Step 2: Verify frontmatter and structure**

Run: `head -4 .claude/skills/cardinal-network-protocol/SKILL.md`
Expected: frontmatter block with `name: cardinal-network-protocol`.

- [ ] **Step 3: Mirror to `.agents/skills/`**

```bash
mkdir -p .agents/skills/cardinal-network-protocol
cp .claude/skills/cardinal-network-protocol/SKILL.md .agents/skills/cardinal-network-protocol/SKILL.md
diff -q .claude/skills/cardinal-network-protocol/SKILL.md .agents/skills/cardinal-network-protocol/SKILL.md
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/cardinal-network-protocol .agents/skills/cardinal-network-protocol
git commit -m "feat(skills): add cardinal-network-protocol reference skill

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
