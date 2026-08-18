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
//
// Matching is first-prefix-wins in array order with no most-specific
// tiebreak — keep subtype prefixes above their catch-alls (e.g.
// packages/ai/src/security/ above packages/ai/src/; docs/PROTOCOL.md
// above docs/) or files will silently misroute. Content-based routing
// rows from studio-director's table (shaders, asset needs) cannot be
// path-mapped and are handled ad hoc.
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
  // New-dependency review is security-reviewer's checklist item.
  { prefix: 'package.json', role: 'security-reviewer' },
  { prefix: 'pnpm-lock.yaml', role: 'security-reviewer' },
  { prefix: 'pnpm-workspace.yaml', role: 'security-reviewer' },
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
    )
      .then((result) => result ?? { role, findings: [], unavailable: true })
      .catch(() => ({ role, findings: [], unavailable: true })),
  ),
)

phase('Synthesize')
const synthesis = await agent(
  `Synthesize this pre-merge review into one report, most severe first. Explicitly name any role that returned no result (unavailable) rather than omitting it. Reviews: ${JSON.stringify(reviews)}`,
  { phase: 'Synthesize', label: 'synthesis' },
)

return { files, reviews, synthesis }
