import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  extractPlanJson,
  planEnvelope,
  planWithTiers,
} from '../src/agents/deliberation';
import type { PlanRequest } from '../src/agents/Mode2';

function request(over: Partial<PlanRequest> = {}): PlanRequest {
  return {
    requestId: 'haran:120:dawn',
    reason: 'dawn',
    agentId: 'haran',
    tick: 120,
    hour: 6,
    persona: 'Protecteur pragmatique',
    role: 'Père & Éclaireur',
    tribe: 'Aube',
    needs: { hunger: 40, warmth: 55, energy: 70, affection: 60, stress: 10 },
    place: 'camp_aube',
    beliefs: [{ objectId: 'oak_tree_7', type: 'oak_tree', distance: 11.2, state: { woodLeft: 8 } }],
    memories: ['Le feu a manqué de bois hier soir.'],
    tools: [{ verb: 'gather_wood', objectId: 'oak_tree_7', type: 'oak_tree', distance: 11.2 }],
    currentPlan: [],
    ...over,
  };
}

describe('buildSystemPrompt', () => {
  it("EXIGE DU JSON SEUL, quelle que soit la raison", () => {
    // Un modèle local de petite taille bavarde volontiers. Sans cette
    // consigne dans CHAQUE variante, l'extraction échoue et l'agent retombe
    // au réflexe sans qu'on sache pourquoi.
    for (const reason of ['dawn', 'surprise', 'dialogue', 'reflection', 'player_dialogue'] as const) {
      const prompt = buildSystemPrompt(request({ reason }));
      expect(prompt, reason).toContain('UNIQUEMENT en JSON');
      expect(prompt.length, reason).toBeGreaterThan(80);
    }
  });

  it('nomme les deux interlocuteurs dans un dialogue', () => {
    const prompt = buildSystemPrompt(
      request({ reason: 'dialogue', participantIds: ['haran', 'mira'] })
    );
    expect(prompt).toContain('haran');
    expect(prompt).toContain('mira');
    expect(prompt).toContain('sharedFacts');
  });

  it('demande des enseignements pour une réflexion', () => {
    expect(buildSystemPrompt(request({ reason: 'reflection' }))).toContain('insights');
  });

  it("REPREND LES MOTS DU JOUEUR quand il s'adresse au villageois", () => {
    // Sans eux, le villageois répond à côté : c'est la seule entrée qui vient
    // d'un humain plutôt que du monde.
    const prompt = buildSystemPrompt(
      request({ reason: 'player_dialogue', playerText: 'Où trouve-t-on du silex ?' })
    );
    expect(prompt).toContain('Où trouve-t-on du silex ?');
    expect(prompt).toContain('reply');
  });

  it('porte la persona et les besoins dans un plan de journée', () => {
    const prompt = buildSystemPrompt(request({ reason: 'dawn' }));
    expect(prompt).toContain('Protecteur pragmatique');
    expect(prompt).toContain('steps');
    expect(prompt).toContain('"hunger":40');
  });
});

describe('extractPlanJson', () => {
  it('extrait un objet noyé dans du bavardage', () => {
    const parsed = extractPlanJson('Voici mon plan :\n{"steps":[{"verb":"fish"}]}\nBonne journée.');
    expect(parsed).toEqual({ steps: [{ verb: 'fish' }] });
  });

  it('survit aux clôtures de code markdown', () => {
    const parsed = extractPlanJson('```json\n{"insights":["il faut du bois"]}\n```');
    expect(parsed).toEqual({ insights: ['il faut du bois'] });
  });

  it('rend les objets imbriqués entiers', () => {
    const parsed = extractPlanJson('{"steps":[{"verb":"build","meta":{"n":2}}]}');
    expect(parsed).toEqual({ steps: [{ verb: 'build', meta: { n: 2 } }] });
  });

  it('LÈVE PLUTÔT QUE DE RENDRE UNE MOITIÉ DE PLAN', () => {
    // Un modèle local de 1 milliard de paramètres tronque souvent. Mieux vaut
    // échouer franchement — l'étage suivant prend le relais — que de livrer
    // un plan incomplet que le moteur exécuterait.
    expect(() => extractPlanJson('{"steps":[{"verb":')).toThrow();
    expect(() => extractPlanJson("je n'ai pas compris")).toThrow();
    expect(() => extractPlanJson('')).toThrow();
  });
});

describe('planEnvelope', () => {
  it("REMET L'IDENTITÉ DE LA DEMANDE, que le modèle l'ait donnée ou non", () => {
    // Le moteur apparie la réponse à sa demande par requestId. Un modèle qui
    // l'oublie ou l'invente ferait perdre le plan en silence.
    const out = planEnvelope(request(), { steps: [{ verb: 'fish' }], requestId: 'inventé' });
    expect(out.requestId).toBe('haran:120:dawn');
    expect(out.reason).toBe('dawn');
    expect(out.agentId).toBe('haran');
    expect(out.steps).toEqual([{ verb: 'fish' }]);
  });

  it('emporte les participants quand il y en a, et rien sinon', () => {
    const avec = planEnvelope(request({ participantIds: ['haran', 'mira'] }), {});
    expect(avec.participantIds).toEqual(['haran', 'mira']);
    expect(planEnvelope(request(), {})).not.toHaveProperty('participantIds');
  });
});

describe('planWithTiers', () => {
  const tier = (name: string, fn: () => Promise<Record<string, unknown>>) => ({ name, plan: fn });

  it('rend le premier étage qui répond, et nomme lequel', async () => {
    const out = await planWithTiers(request(), [
      tier('bff', async () => ({ steps: ['a'] })),
    ]);
    expect(out).toEqual({ tier: 'bff', payload: { steps: ['a'] } });
  });

  it("DESCEND D'UN ÉTAGE quand celui du dessus échoue", async () => {
    // Le défaut vu en démo : BFF éteint, `peers 0`, et zéro délibération. Le
    // modèle local doit prendre le relais sans que personne n'intervienne.
    const appels: string[] = [];
    const out = await planWithTiers(request(), [
      tier('bff', async () => { appels.push('bff'); throw new Error('injoignable'); }),
      tier('local', async () => { appels.push('local'); return { steps: ['b'] }; }),
    ]);
    expect(appels).toEqual(['bff', 'local']);
    expect(out?.tier).toBe('local');
  });

  it("N'APPELLE PAS L'ÉTAGE DU DESSOUS quand celui du dessus a répondu", async () => {
    // Sinon une génération locale de dix secondes partirait à chaque tour,
    // GPU occupé pour rien, alors que le BFF avait déjà répondu.
    const appels: string[] = [];
    await planWithTiers(request(), [
      tier('bff', async () => { appels.push('bff'); return { steps: ['a'] }; }),
      tier('local', async () => { appels.push('local'); return { steps: ['b'] }; }),
    ]);
    expect(appels).toEqual(['bff']);
  });

  it('REND null QUAND TOUT ÉCHOUE, sans jamais lever', async () => {
    // L'appelant doit pouvoir libérer son drapeau d'attente : une exception
    // qui remonte laisserait l'agent bloqué en « je réfléchis » pour toujours.
    const out = await planWithTiers(request(), [
      tier('bff', async () => { throw new Error('502'); }),
      tier('local', async () => { throw new Error('pas de WebGPU'); }),
    ]);
    expect(out).toBeNull();
  });

  it('rend null sans étage configuré', async () => {
    expect(await planWithTiers(request(), [])).toBeNull();
  });
});
