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

export default (async () => {
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
})()
