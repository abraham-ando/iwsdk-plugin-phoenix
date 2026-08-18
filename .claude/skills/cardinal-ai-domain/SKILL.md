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
