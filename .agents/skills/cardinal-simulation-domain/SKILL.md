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
