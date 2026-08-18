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
