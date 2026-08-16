import type { PlanRequest } from '../agents/Mode2';

const MOCK_PLAN_VERB_PREFERENCE = ['gather_berries', 'gather_wood', 'gather_flint', 'light_fire'];

/** Deterministic offline planner mirroring the BFF mock — lets headless runs
 * produce full trajectories with zero network. */
export function mockPlanResponse(request: PlanRequest): Record<string, unknown> {
  const base = {
    requestId: request.requestId,
    reason: request.reason,
    agentId: request.agentId,
    ...(request.participantIds ? { participantIds: request.participantIds } : {}),
  };
  if (request.reason === 'dialogue') {
    const [a, b] = request.participantIds ?? [request.agentId, 'inconnu'];
    const firstBelief = request.beliefs[0];
    const topic = firstBelief ? firstBelief.type.replace('_', ' ') : 'la journée';
    return {
      ...base,
      lines: [
        { speaker: a, text: `As-tu vu ? Près d'ici, ${topic} nous attend.` },
        { speaker: b, text: 'Bien vu — la tribu en profitera.' },
      ],
      sharedFacts: firstBelief
        ? [{ objectId: firstBelief.objectId, type: firstBelief.type, x: 0, z: 0, state: firstBelief.state }]
        : [],
    };
  }
  if (request.reason === 'reflection') {
    return { ...base, insights: ['Jour vécu: besoins gérés, tribu soudée.'] };
  }
  if (request.reason === 'player_dialogue') {
    return { ...base, reply: 'Bienvenue près de notre feu, étranger.' };
  }
  const withObject = request.tools
    .filter((t) => t.objectId !== undefined)
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  const steps: Array<{ goal: string; verb: string; objectId?: string; predicted: string }> = [];
  for (const preferred of MOCK_PLAN_VERB_PREFERENCE) {
    if (steps.length >= 3) break;
    const tool = withObject.find((t) => t.verb === preferred);
    if (tool) {
      steps.push({
        goal: `faire ${tool.verb}`,
        verb: tool.verb,
        objectId: tool.objectId,
        predicted: `réussite de ${tool.verb}`,
      });
    }
  }
  if (request.tools.some((t) => t.verb === 'eat_berries')) {
    steps.push({ goal: 'me nourrir', verb: 'eat_berries', predicted: 'faim restaurée' });
  }
  return { ...base, steps };
}
