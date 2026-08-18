# Cardinal Studio agent team — design

Approved 2026-08-18, brainstormed section by section. Defines the complete
roster of Claude Code subagents for "Simulation et Game Studio Three.js 3D
VR/AR spécialisé IWSDK", the new domain skills that back them, three
orchestrated Workflow pipelines, and how the nine `threejs-game-skills`
package skills map onto (or explicitly do not map onto) this roster.

## Context

This repo (`iwsdk-phoenix-monorepo`) is a WebXR multiplayer stack: IWSDK
(ECS on Three.js) + Phoenix Channels/BEAM networking, plus a "Cardinal"
engine — procedural genome/morphology (`packages/character`), a headless
deterministic civilization simulation (`packages/simulation`), procedural
world rendering (`packages/world`), and a 20-submodule edge-AI NPC stack
(`packages/ai`: RAG, perception, gaze, social, security, scheduler, cache,
LOD, streaming, workers, acoustics, avatar...). One custom subagent already
exists: `.claude/agents/iwsdk-project-code-reviewer.md`.

Two prior investigations feed this design:

1. A gap analysis across ~18 studio functions (design, engineering, art,
   UX, QA, production) found only code-review coverage — nothing for
   NPC/AI, simulation design, VR comfort, or product/BDD specification.
2. A check of the installed `majidmanzarpour/threejs-game-skills` package
   (9 skills: director, gameplay-systems, aaa-graphics-builder,
   game-ui-designer, debug-profiler, qa-release, 3d/image/audio-generator)
   found it assumes a standalone Vite+Three.js game with its own scaffold,
   screen-space HUD, and orchestrator — conflicting with IWSDK's ECS, its
   own `iwsdk-*` skills, and UIKitML spatial panels. Verified in this
   session against actual code (`apps/demo/src/hud.ts`,
   `packages/ai/src/avatar/RPMAvatarRig.ts`) — see §4 for the corrected,
   code-grounded mapping.

This spec answers: what is the complete agent roster, what new skills does
it require, how do the three highest-value workflows run end to end, and
precisely which parts of the `threejs-game-skills` package earn a place in
that roster.

## Architecture

**Approach: thin agents, shared reference skills.** Each role is a
`.claude/agents/<role>.md` file — name, description, tool grants, a short
system prompt — that points to skill files for domain knowledge, exactly
the pattern already used by `iwsdk-project-code-reviewer.md` (it loads
`iwsdk-planner/references/api-reference.md`). Knowledge lives once, in a
skill, reusable by any agent or by the main session directly. Two
rejected alternatives: thick self-contained agents (duplicates knowledge,
drifts from code) and one role-switching mega-agent (loses per-role tool
restriction and can't fan out in parallel).

**Operating model: hybrid.** Every role is independently invocable via
`Agent` at any time. Three of the eighteen roles additionally participate
in `Workflow` pipelines for sequences that are repetitive and high-value
enough to script deterministically (§5). Nothing else is orchestrated
automatically — the default is ad hoc invocation.

## §1 — Roster (18 agents)

Tool-grant convention: reviewer/analyst roles get `Read, Grep, Glob, Bash`
(read-only usage — running tests/lint, never committing), matching the
existing `iwsdk-project-code-reviewer`. Roles that produce artifacts add
`Write`. `studio-director` additionally gets `Agent, Workflow`.
`xr-visual-qa` additionally gets browser tools.

| Agent | Department | Domain | Tools | Primary skill(s) |
|---|---|---|---|---|
| `studio-director` | Direction | Routes tasks, runs the 3 pipelines | Read, Grep, Glob, Bash, Agent, Workflow | `iwsdk-planner` |
| `product-owner-bdd` | Production | User/technical stories + `.feature` Gherkin | Read, Grep, Glob, Write | *new* |
| `simulation-designer` | Design | Village economy/trades, civilization kernel, level/encounter design (no separate level role — this repo has no arena/level directories; world content is simulation-driven) | Read, Grep, Glob, Write | `cardinal-simulation-domain` *(new)*, secondary: `threejs-gameplay-systems` (`game-feel.md`, `game-design-level-design.md` only) |
| `iwsdk-project-code-reviewer` *(existing)* | Engineering | Generic ECS/IWSDK usage | Read, Grep, Glob, Bash | `iwsdk-planner` |
| `cardinal-genome-reviewer` | Engineering | Genome/heredity/compiled morphology | Read, Grep, Glob, Bash | `cardinal-character-domain` *(new)* |
| `cardinal-world-reviewer` | Engineering | Procedural rendering + perf (terrain/atmosphere/flora) | Read, Grep, Glob, Bash | `cardinal-simulation-domain`, `threejs-aaa-graphics-builder` |
| `npc-behavior-engineer` | Engineering | RAG, perception, gaze, social, intents, avatar rig | Read, Grep, Glob, Bash | `cardinal-ai-domain` *(new)* |
| `ai-runtime-engineer` | Engineering | scheduler, cache, LOD, streaming, speculative, workers, acoustics | Read, Grep, Glob, Bash | `cardinal-ai-domain` |
| `ai-security-engineer` | Engineering | `packages/ai/security` — prompt injection, guardrails, NPC memory leakage | Read, Grep, Glob, Bash | `cardinal-ai-domain` |
| `phoenix-networking-reviewer` | Engineering | Protocol, room/server authority (`packages/client`+`server`) | Read, Grep, Glob, Bash | `cardinal-network-protocol` *(new)* |
| `bff-backend-engineer` | Engineering | `apps/bff-server`, `apps/demo_server` | Read, Grep, Glob, Bash | `cardinal-network-protocol` |
| `security-reviewer` | Engineering | Auth/secrets/dependencies, cross-cutting (non-AI) | Read, Grep, Glob, Bash | — |
| `graphics-tech-artist` | Art | Shaders/materials/VFX/render budget | Read, Grep, Glob, Bash | `threejs-aaa-graphics-builder` |
| `asset-producer` | Art | Decides + triggers 3D/image/audio generation, keeps the sourcing ledger | Read, Grep, Glob, Bash, Write | `threejs-3d-generator`, `threejs-image-generator`, `threejs-audio-generator` |
| `vr-comfort-ux-reviewer` | UX | Comfort, locomotion, spatial-UI (UIKitML) legibility | Read, Grep, Glob | `hz-immersive-designer`, `iwsdk-ui`; secondary: `threejs-game-ui-designer` (scoped to `hud.ts`/`ai-hud.ts` desktop DOM overlays only, §4) |
| `xr-visual-qa` | QA | Browser/canvas verification, runs Gherkin scenarios | Read, Grep, Glob, Bash, Browser | `threejs-qa-release` |
| `perf-profiler` | QA | Frame budget (11.1 ms), profiling | Read, Grep, Glob, Bash | `iwsdk-debug`; secondary: `threejs-debug-profiler` |
| `store-release-reviewer` | QA | Meta Horizon Store compliance (pre-ship, occasional use) | Read, Grep, Glob | `hz-store-submit` |

`docs-rfc-writer` was considered and dropped: spec/RFC writing is already
owned by `superpowers:brainstorming`/`writing-plans`, and a dedicated role
would duplicate it without adding capability.

## §2 — New domain skills

No existing skill documents Cardinal-specific internals. Four new skills,
mirrored at `.claude/skills/<name>/` and `.agents/skills/<name>/` following
the same convention as the existing `iwsdk-*` skills:

- **`cardinal-simulation-domain`** — kernel, agents, world, telemetry
  (`packages/simulation`); consumed by `simulation-designer`,
  `cardinal-world-reviewer`.
- **`cardinal-character-domain`** — genome, compiled trait chains, trade
  presets (`packages/character`); consumed by `cardinal-genome-reviewer`.
- **`cardinal-ai-domain`** — a map of the 20 `packages/ai` submodules with
  one section per engineering role, so the three AI agents load only
  their relevant slice; consumed by `npc-behavior-engineer`,
  `ai-runtime-engineer`, `ai-security-engineer`.
- **`cardinal-network-protocol`** — summary of `docs/PROTOCOL.md` and
  `docs/rfc/0001-iwsdk-network.md`; consumed by `phoenix-networking-reviewer`,
  `bff-backend-engineer`.

Authoring these four skills is implementation work, sequenced by
`writing-plans`, not part of this design.

## §3 — BDD tooling

Root `devDependencies`: `@playwright/test`, `playwright-bdd`. New
`features/` directory (Gherkin `.feature` files plus `steps/*.steps.ts`),
granularity (root vs. per-package) decided during implementation.
`product-owner-bdd` writes the `.feature` files; `xr-visual-qa` implements
the verification steps and runs them — both share this one Playwright
stack, which `xr-visual-qa` needs regardless for browser/canvas checks.

## §4 — The nine `threejs-game-skills`, verified against this roster

Re-checked against actual code in this session (not assumption):

| Skill | Verdict | Where it plugs in |
|---|---|---|
| `threejs-game-director` | **Not invoked.** Assumes a from-scratch Vite scaffold and owns orchestration end to end — conflicts with `studio-director` + `iwsdk-planner`. | Pattern inspiration only: its ledger/reference-gate discipline (never skip a required reference, track it explicitly) is the model `studio-director` and `asset-producer` follow, without a runtime dependency on the skill itself. |
| `threejs-gameplay-systems` | **Secondary reference**, two files only. | `simulation-designer` loads `references/game-feel.md` (hitstop, screenshake, impact feedback) and `references/game-design-level-design.md` when tuning NPC-interaction or trade-interaction feel — not its scaffold or architecture sections, which don't apply under ECS. |
| `threejs-aaa-graphics-builder` | **Primary.** | `cardinal-world-reviewer` and `graphics-tech-artist` — shaders, materials, render budget, LOD/instancing apply directly since IWSDK renders through Three.js. |
| `threejs-game-ui-designer` | **Secondary, narrowly scoped.** | Verified `apps/demo/src/hud.ts`: a deliberate screen-space DOM overlay ("Plain DOM rather than a spatial UIKit panel on purpose... diagnostics for whoever is testing the demo on a desktop browser"), same for `ai-hud.ts`. This is a real surface HUD/menu patterns apply to — but only these two files. `vr-comfort-ux-reviewer` uses it there; everywhere else in-world UI is UIKitML, owned by `iwsdk-ui`/`hz-immersive-designer`, and this skill's screen-space assumptions do not apply. |
| `threejs-debug-profiler` | **Secondary.** | `perf-profiler`'s primary source is `iwsdk-debug` (IWSDK-aware); this skill's generic Three.js profiling checklists supplement it, not replace it. |
| `threejs-qa-release` | **Primary.** | `xr-visual-qa` — its `references/visual-test-harness.md` is the direct source of the Playwright-based verification pattern behind §3. |
| `threejs-3d-generator` (Tripo) | **Primary, bounded scope.** | `asset-producer`, for village props/buildings/environment pieces only. Verified `packages/ai/src/avatar/RPMAvatarRig.ts`: NPC avatars are built through a dedicated Ready Player Me rig pipeline, and hero characters compile through `cardinal-character`'s genome system — neither should be replaced by Tripo-generated meshes. |
| `threejs-image-generator` (Gemini) | **Primary.** | `asset-producer` — textures/skies for `cardinal-world`, icons, concept references. |
| `threejs-audio-generator` (ElevenLabs) | **Primary.** | `asset-producer` — village ambience and trade SFX (anvil, market), complementing `plugin-cardinal-ai`'s `SpatialVoice`, which spatializes at runtime but doesn't generate source audio. |

## §5 — Three orchestrated Workflow pipelines

**A. Pre-merge multi-specialist review**
`studio-director` maps changed files to relevant reviewer roles (e.g. a
diff touching `packages/ai/rag` → `npc-behavior-engineer` +
`ai-security-engineer`), fans them out with `parallel()`, then synthesizes
a single deduplicated report. Mirrors the pattern already seen in
`claude-security`. A reviewer that errors is reported as "reviewer X
unavailable" in the synthesis, never silently dropped.

**B. Feature delivery (PO → Engineer → QA)**
`pipeline()`, sequential: `product-owner-bdd` writes the story and
`.feature` scenario → `studio-director` routes to the matching engineering
role → implementation proceeds inline, no PR, local merge only (per
established project convention) → `xr-visual-qa` runs the Gherkin scenario
through `playwright-bdd` with a real browser, reporting pass/fail with
visual evidence — never a claim without it.

**C. Asset production**
`asset-producer` identifies a surface lacking an authored asset, runs the
credential probe, decides procedural/generated/hybrid per §4's bounded
scope, triggers the relevant generator skill → `graphics-tech-artist`
reviews the integration (materials, LOD, budget) → `xr-visual-qa` verifies
the final render visually.

## §6 — File layout

```
.claude/agents/           18 role files (.md)
.claude/skills/           4 new domain skills (mirrored to .agents/skills/)
.claude/workflows/        3 scripts: pre-merge-review, feature-delivery, asset-production
features/                 Gherkin: *.feature + steps/*.steps.ts
```

## §7 — Testing / validation

These are configuration artifacts (prompts), not executable application
code — no unit tests apply. Validation is a manual smoke test per new
role: one trivial read-only invocation confirming its referenced skill(s)
resolve without error, before the roster is considered ready. Each new
Workflow pipeline gets one dry run on a small real change before it's
trusted for regular use.

## Out of scope

- Actually authoring the 4 domain skills, 18 agent files, and 3 workflow
  scripts — implementation work, sequenced by `writing-plans`.
- Adding `@playwright/test`/`playwright-bdd` to `package.json` and
  scaffolding `features/` — implementation work.
- Any change to application code, `packages/*`, or `apps/*`.
