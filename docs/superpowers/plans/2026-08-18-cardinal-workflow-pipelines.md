# Cardinal Workflow Pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author the three orchestrated Workflow scripts (`docs/superpowers/specs/2026-08-18-cardinal-studio-agent-team-design.md` §5) that `studio-director` runs for pre-merge review, feature delivery, and asset production.

**Architecture:** Each script is a `.claude/workflows/<name>.mjs` file matching the Workflow tool's contract: a literal `export const meta = {...}` header, then plain JS using `agent()`/`parallel()`/`pipeline()`/`phase()`/`log()`. Every `agent()` call uses `opts.agentType` set to one of the 19 roster role names (Plan 2) — these are real custom subagent types once that plan is executed, resolved from the same registry the `Agent` tool uses. Workflow scripts have no filesystem or Bash access themselves; anything that needs to read the repo (e.g. `git diff`) is delegated to an `agent()` call.

**Tech Stack:** Plain JavaScript (not TypeScript — the Workflow runtime does not parse type annotations), the Workflow tool's `agent()`/`parallel()`/`pipeline()` API.

**Spec:** `docs/superpowers/specs/2026-08-18-cardinal-studio-agent-team-design.md` (§5 — Three orchestrated Workflow pipelines)

## Prerequisite

All 18 tasks in `docs/superpowers/plans/2026-08-18-cardinal-agent-roster.md` are complete — with the pre-existing `iwsdk-project-code-reviewer`, all 19 roster roles then resolve — every `agentType` value below must resolve to a real registered subagent.

## Global Constraints

- No `Date.now()`, `Math.random()`, or argless `new Date()` anywhere in a script body (the Workflow runtime forbids them — they would break resume).
- `meta.phases` titles match `phase()` call titles exactly, string-for-string.
- A `parallel()` thunk that returns `null` (agent errored) is handled explicitly (`?? { ...unavailable }`), never left to propagate as a silent gap — per spec §5's "never dropped silently" rule for the pre-merge pipeline.
- `meta.name` is the exact string `studio-director` (Plan 2, Task 1) must pass as `Workflow`'s `name` argument to invoke each pipeline — keep the three names below and studio-director.md's pipeline descriptions in sync by hand if either changes. Each script's filename matches its `meta.name` exactly (`cardinal-pre-merge-review.mjs` etc.) so name-based resolution from `.claude/workflows/` cannot diverge from the meta header.
- One commit per task, message format `feat(workflows): <summary>`, trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: `cardinal-pre-merge-review`

**Files:**
- Create: `.claude/workflows/cardinal-pre-merge-review.mjs`

**Interfaces:**
- Consumes: `agentType` values `cardinal-genome-reviewer`, `simulation-designer`, `cardinal-world-reviewer`, `npc-behavior-engineer`, `ai-security-engineer`, `ai-runtime-engineer`, `phoenix-networking-reviewer`, `bff-backend-engineer`, `vr-comfort-ux-reviewer`, `iwsdk-project-code-reviewer` (all from `cardinal-agent-roster.md`).
- Produces: workflow name `cardinal-pre-merge-review`, returning `{ files, reviews, synthesis }`.

- [ ] **Step 1: Write the script**

Create `.claude/workflows/cardinal-pre-merge-review.mjs`:

```javascript
export const meta = {
  name: 'cardinal-pre-merge-review',
  description: 'Fans out changed files to the matching Cardinal Studio specialist reviewers and synthesizes one report',
  phases: [
    { title: 'Discover changes' },
    { title: 'Review' },
    { title: 'Synthesize' },
  ],
}

// Mirrors studio-director.md's routing table. Kept in sync by hand — this
// script has no filesystem access to read that file at run time.
const ROUTES = [
  { prefix: 'packages/character/', role: 'cardinal-genome-reviewer' },
  // Deliberate simplification of studio-director's table, which splits
  // packages/simulation/ between simulation-designer (design intent) and
  // cardinal-world-reviewer (rendering/perf): in this automated pipeline
  // every simulation change goes to simulation-designer, whose report
  // flags rendering/perf concerns for cardinal-world-reviewer follow-up.
  { prefix: 'packages/simulation/', role: 'simulation-designer' },
  { prefix: 'packages/world/', role: 'cardinal-world-reviewer' },
  { prefix: 'packages/ai/src/rag/', role: 'npc-behavior-engineer' },
  { prefix: 'packages/ai/src/perception/', role: 'npc-behavior-engineer' },
  { prefix: 'packages/ai/src/gaze/', role: 'npc-behavior-engineer' },
  { prefix: 'packages/ai/src/social/', role: 'npc-behavior-engineer' },
  { prefix: 'packages/ai/src/intents/', role: 'npc-behavior-engineer' },
  { prefix: 'packages/ai/src/avatar/', role: 'npc-behavior-engineer' },
  { prefix: 'packages/ai/src/ui/', role: 'npc-behavior-engineer' },
  { prefix: 'packages/ai/src/mr/', role: 'npc-behavior-engineer' },
  { prefix: 'packages/ai/src/security/', role: 'ai-security-engineer' },
  { prefix: 'packages/ai/src/', role: 'ai-runtime-engineer' }, // catch-all for the rest of packages/ai
  { prefix: 'packages/client/', role: 'phoenix-networking-reviewer' },
  { prefix: 'packages/server/', role: 'phoenix-networking-reviewer' },
  { prefix: 'apps/bff-server/', role: 'bff-backend-engineer' },
  { prefix: 'apps/demo_server/', role: 'bff-backend-engineer' },
  { prefix: 'apps/demo/src/hud.ts', role: 'vr-comfort-ux-reviewer' },
  { prefix: 'apps/demo/src/ai-hud.ts', role: 'vr-comfort-ux-reviewer' },
  // Order matters in the three docs rows: PROTOCOL.md is protocol work
  // first, rendering second (smoke-test ruling, roster ledger); process
  // docs belong to the superpowers workflow, not the docs site.
  { prefix: 'docs/PROTOCOL.md', role: 'phoenix-networking-reviewer' },
  { prefix: 'docs/superpowers/', role: 'iwsdk-project-code-reviewer' },
  { prefix: 'docs/', role: 'docs-writer' },
]

function routeFile(file) {
  const hit = ROUTES.find((r) => file.startsWith(r.prefix))
  return hit ? hit.role : 'iwsdk-project-code-reviewer'
}

const DIFF_SCHEMA = {
  type: 'object',
  properties: { files: { type: 'array', items: { type: 'string' } } },
  required: ['files'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'warning', 'suggestion'] },
          summary: { type: 'string' },
        },
        required: ['file', 'severity', 'summary'],
      },
    },
  },
  required: ['role', 'findings'],
}

phase('Discover changes')
const diff = await agent(
  'Run `git diff --name-only main...HEAD` in the repo root and return every changed file path, one per array entry. If there is no `main` to diff against, use `git diff --name-only HEAD~1`.',
  { schema: DIFF_SCHEMA, label: 'git-diff' },
)

const files = diff?.files ?? []
if (files.length === 0) {
  log('No changed files found — nothing to review.')
} else {
  log(`${files.length} changed file(s) found.`)
}

const roleToFiles = new Map()
for (const file of files) {
  const role = routeFile(file)
  if (!roleToFiles.has(role)) roleToFiles.set(role, [])
  roleToFiles.get(role).push(file)
}

phase('Review')
const reviews = await parallel(
  Array.from(roleToFiles.entries()).map(([role, roleFiles]) => () =>
    agent(
      `Review these changed files against your domain checklist: ${roleFiles.join(', ')}. Return your findings. Additionally: if any fact stated in your domain skill (a constant, export, or invariant) no longer matches the code you just read, report that drift as a 'warning' finding naming the skill file — the skill update belongs in the same change.`,
      { agentType: role, schema: FINDINGS_SCHEMA, phase: 'Review', label: role },
    ).then((result) => result ?? { role, findings: [], unavailable: true }),
  ),
)

phase('Synthesize')
const synthesis = await agent(
  `Synthesize this pre-merge review into one report, most severe first. Explicitly name any role that returned no result (unavailable) rather than omitting it. Reviews: ${JSON.stringify(reviews)}`,
  { phase: 'Synthesize', label: 'synthesis' },
)

return { files, reviews, synthesis }
```

- [ ] **Step 2: Verify the script content**

Do NOT use `node --check` — the Workflow runtime wraps the script body
in an async function itself, so the top-level `return` is valid for the
runtime but a syntax error for plain node, and any wrapper added to
appease node (an IIFE) breaks the runtime's return contract. Verify
instead by byte-comparing the committed file against the brief's fenced
block (extract the block and `diff -` it).

- [ ] **Step 3: Note the dry-run** (performed once Plan 2's roster exists,
  not part of this task's automated steps)

Once all 18 roles are registered, dry-run with:
`Workflow({ name: 'cardinal-pre-merge-review' })` on a branch with at
least one real change under `packages/character/` — confirm the
synthesis names `cardinal-genome-reviewer` specifically, not a generic
fallback.

- [ ] **Step 4: Commit**

```bash
git add .claude/workflows/cardinal-pre-merge-review.mjs
git commit -m "feat(workflows): add cardinal-pre-merge-review pipeline

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `cardinal-feature-delivery`

**Files:**
- Create: `.claude/workflows/cardinal-feature-delivery.mjs`

**Interfaces:**
- Consumes: `agentType` values `product-owner-bdd` and `xr-visual-qa`; per domain, an implementer (`npc-behavior-engineer`, `ai-runtime-engineer`, `bff-backend-engineer`, `graphics-tech-artist` — the four roles with `Edit, Write` — or `general-purpose` otherwise) and, for `general-purpose`-implemented domains, the domain's read-only reviewer. Requires caller to pass `args.request` (the feature description in product terms).
- Produces: workflow name `cardinal-feature-delivery`, returning `{ story, implementer, implementation, review, verification }` (`review` is `null` for domains with a specialist implementer).

- [ ] **Step 1: Write the script**

Create `.claude/workflows/cardinal-feature-delivery.mjs`:

```javascript
export const meta = {
  name: 'cardinal-feature-delivery',
  description: 'Runs one feature from story + Gherkin through implementation, domain review, and visual QA verification',
  phases: [
    { title: 'Story' },
    { title: 'Route' },
    { title: 'Implement' },
    { title: 'Review' },
    { title: 'Verify' },
  ],
}

const STORY_SCHEMA = {
  type: 'object',
  properties: {
    storySlug: { type: 'string' },
    featurePath: { type: 'string' },
    domain: {
      type: 'string',
      enum: [
        'simulation',
        'character',
        'ai-behavior',
        'ai-runtime',
        'ai-security',
        'networking',
        'backend',
        'graphics',
        'comfort-ux',
        'generic',
      ],
    },
  },
  required: ['storySlug', 'featurePath', 'domain'],
}

// Only the four roles granted Edit/Write implement directly. Domains whose
// specialist is a read-only reviewer are implemented by a general-purpose
// agent, then reviewed by that specialist — a reviewer role is never asked
// to write code it has no tools to write (spec §5 B).
const DOMAINS = {
  simulation: { implementer: 'general-purpose', reviewer: 'simulation-designer' },
  character: { implementer: 'general-purpose', reviewer: 'cardinal-genome-reviewer' },
  'ai-behavior': { implementer: 'npc-behavior-engineer', reviewer: null },
  'ai-runtime': { implementer: 'ai-runtime-engineer', reviewer: null },
  'ai-security': { implementer: 'general-purpose', reviewer: 'ai-security-engineer' },
  networking: { implementer: 'general-purpose', reviewer: 'phoenix-networking-reviewer' },
  backend: { implementer: 'bff-backend-engineer', reviewer: null },
  graphics: { implementer: 'graphics-tech-artist', reviewer: null },
  'comfort-ux': { implementer: 'general-purpose', reviewer: 'vr-comfort-ux-reviewer' },
  generic: { implementer: 'general-purpose', reviewer: 'iwsdk-project-code-reviewer' },
}

const request = args?.request
if (!request) {
  throw new Error(
    'cardinal-feature-delivery requires args.request — the feature description in product terms.',
  )
}

phase('Story')
const story = await agent(
  `Write the user story, technical story, and Gherkin .feature file for this request, per your process. Request: ${request}`,
  { agentType: 'product-owner-bdd', schema: STORY_SCHEMA, label: 'story' },
)

phase('Route')
const domain = DOMAINS[story.domain] ?? DOMAINS.generic
log(`Routing "${story.storySlug}" to ${domain.implementer}${domain.reviewer ? ` (reviewed by ${domain.reviewer})` : ''}.`)

phase('Implement')
const implementation = await agent(
  `Implement the story and Gherkin scenario at ${story.featurePath}. Work inline in the current branch — no PR, no push, local commit only once the scenario's steps can pass.`,
  { agentType: domain.implementer, phase: 'Implement', label: 'implement' },
)

let review = null
if (domain.reviewer) {
  phase('Review')
  review = await agent(
    `A general-purpose agent implemented the story at ${story.featurePath}. Review the uncommitted/last-committed changes for that story against your domain checklist before QA runs. Findings block QA only if critical.`,
    { agentType: domain.reviewer, phase: 'Review', label: domain.reviewer },
  )
}

phase('Verify')
const verification = await agent(
  `Run the Gherkin scenario at ${story.featurePath} via playwright-bdd and report pass/fail with visual evidence, per your process.`,
  { agentType: 'xr-visual-qa', phase: 'Verify', label: 'verify' },
)

return { story, implementer: domain.implementer, implementation, review, verification }
```

- [ ] **Step 2: Verify the script content**

Same rule as Task 1: no `node --check` (top-level `return` is runtime-valid, node-invalid); byte-compare the file against the brief's fenced block instead.

- [ ] **Step 3: Note the dry-run**

Once Plan 2's roster and `cardinal-bdd-tooling.md` are both complete, dry-run with `Workflow({ name: 'cardinal-feature-delivery', args: { request: '<a small real feature>' } })` and confirm `verification` reports an actual pass/fail, not a restated assumption.

- [ ] **Step 4: Commit**

```bash
git add .claude/workflows/cardinal-feature-delivery.mjs
git commit -m "feat(workflows): add cardinal-feature-delivery pipeline

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `cardinal-asset-production`

**Files:**
- Create: `.claude/workflows/cardinal-asset-production.mjs`

**Interfaces:**
- Consumes: `agentType` values `asset-producer`, `graphics-tech-artist`, `xr-visual-qa`. Requires caller to pass `args.surface` (the surface needing an asset).
- Produces: workflow name `cardinal-asset-production`, returning `{ sourcing, review, verification }` (or `{ sourcing }` alone if skipped).

- [ ] **Step 1: Write the script**

Create `.claude/workflows/cardinal-asset-production.mjs`:

```javascript
export const meta = {
  name: 'cardinal-asset-production',
  description: 'Runs one asset-production request from sourcing decision through generation, integration review, and visual QA',
  phases: [
    { title: 'Source' },
    { title: 'Review' },
    { title: 'Verify' },
  ],
}

const SOURCING_SCHEMA = {
  type: 'object',
  properties: {
    surface: { type: 'string' },
    decision: {
      type: 'string',
      enum: [
        'procedural',
        'threejs-3d-generator',
        'threejs-image-generator',
        'threejs-audio-generator',
        'hybrid',
        'skip',
      ],
    },
    outputPath: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['surface', 'decision', 'reason'],
}

const request = args?.surface
if (!request) {
  throw new Error(
    'cardinal-asset-production requires args.surface — the surface needing an asset (e.g. "ferronnier anvil prop").',
  )
}

phase('Source')
const sourcing = await agent(
  `Decide procedural vs. generated vs. hybrid for this surface, per your scope boundary, and if generation is chosen, trigger the relevant generator script. Surface: ${request}`,
  { agentType: 'asset-producer', schema: SOURCING_SCHEMA, label: 'source' },
)

if (sourcing.decision === 'skip') {
  log(`Skipped: ${sourcing.reason}`)
} else {
  phase('Review')
  var review = await agent(
    `Review the integration of this newly sourced asset for materials, LOD, and render budget. Surface: ${sourcing.surface}. Output: ${sourcing.outputPath ?? '(procedural, no external output)'}`,
    { agentType: 'graphics-tech-artist', phase: 'Review', label: 'review' },
  )

  phase('Verify')
  var verification = await agent(
    `Verify the final render of this surface visually — open the browser, screenshot, confirm it renders without console/network errors. Surface: ${sourcing.surface}`,
    { agentType: 'xr-visual-qa', phase: 'Verify', label: 'verify' },
  )
}

return { sourcing, review, verification }
```

- [ ] **Step 2: Verify the script content**

Same rule as Task 1: no `node --check` (top-level `return` is runtime-valid, node-invalid); byte-compare the file against the brief's fenced block instead.

- [ ] **Step 3: Note the dry-run**

Once Plan 2's roster is complete, dry-run with
`Workflow({ name: 'cardinal-asset-production', args: { surface: 'ferronnier anvil prop' } })`
and confirm `sourcing.decision` is `threejs-3d-generator` or `hybrid` —
never a hero-avatar target, per `asset-producer`'s scope boundary.

- [ ] **Step 4: Commit**

```bash
git add .claude/workflows/cardinal-asset-production.mjs
git commit -m "feat(workflows): add cardinal-asset-production pipeline

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
