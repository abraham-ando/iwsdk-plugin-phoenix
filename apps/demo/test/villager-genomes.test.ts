import { describe, it, expect } from 'vitest';
import { HUMANOID, createGenome, type Genome, type RngLike } from '@iwsdk/cardinal-character';
import { DEFAULT_VILLAGE } from '@iwsdk/cardinal-simulation';
import { buildVillagerGenomes } from '../src/simulation/villagerGenomes';

const AGENTS = DEFAULT_VILLAGE.agents;

// Distance moyenne entre les gènes de l'enfant et le milieu de ses parents.
function distanceToMidparent(child: Genome, mother: Genome, father: Genome): number {
  const keys = Object.keys(HUMANOID.genes);
  let total = 0;
  for (const k of keys) {
    const mid = ((mother.genes[k] ?? 0.5) + (father.genes[k] ?? 0.5)) / 2;
    total += Math.abs((child.genes[k] ?? 0.5) - mid);
  }
  return total / keys.length;
}

describe('les génomes du village', () => {
  it('en produit un par agent', () => {
    const genomes = buildVillagerGenomes(AGENTS);
    expect(Object.keys(genomes).length).toBe(AGENTS.length);
    for (const agent of AGENTS) expect(genomes[agent.id]).toBeDefined();
  });

  it('est déterministe : deux appels donnent exactement les mêmes génomes', () => {
    expect(buildVillagerGenomes(AGENTS)).toEqual(buildVillagerGenomes(AGENTS));
  });

  it('donne des génomes DIFFÉRENTS à des agents différents', () => {
    // Un hachage constant, ou un générateur partagé mal semé, rendrait onze
    // fois le même villageois — et le test précédent passerait quand même.
    const g = buildVillagerGenomes(AGENTS);
    const signatures = new Set(AGENTS.map((a) => JSON.stringify(g[a.id]!.genes)));
    expect(signatures.size).toBe(AGENTS.length);
  });

  it('Lio et Aya battent au moins 90 inconnus sur 100 (comparaison de rang)', () => {
    // Comparer la distance d'un enfant à la MOYENNE de 100 inconnus n'a
    // qu'un pouvoir de détection d'environ 50 % pour un enfant isolé : la
    // moyenne d'un grand échantillon flotte près de la médiane individuelle,
    // donc un seul tirage indépendant a une chance sur deux de tomber en
    // dessous par pur hasard — ça a été mesuré : muter Lio seul pour qu'il
    // soit tiré au hasard (au lieu d'être engendré) laissait ce test passer
    // quand même.
    //
    // Un seuil de RANG est stable : on compte combien des 100 inconnus
    // l'enfant BAT (distance au mi-parent plus petite), et on exige un
    // score élevé plutôt qu'une simple comparaison à une moyenne.
    //
    // Seuil retenu : 90/100, mesuré comme suit. Sur 30 enfants synthétiques
    // engendrés par `breed` à partir de Mira et Haran, le rang minimal
    // observé est 93/100. Sur 30 inconnus synthétiques tirés par
    // `createGenome` (indépendants des parents), le rang maximal observé
    // est 88/100. 90 tombe dans l'intervalle [89, 92] qui sépare
    // proprement les deux populations, avec marge des deux côtés. Rangs
    // réellement mesurés pour les enfants du village : lio 100/100,
    // aya 100/100 — largement au-dessus du seuil.
    const RANK_THRESHOLD = 90;

    const g = buildVillagerGenomes(AGENTS);
    const mira = g['mira']!;
    const haran = g['haran']!;

    // Cent inconnus, pour que la comparaison ne dépende pas d un tirage
    // chanceux.
    let seed = 12345;
    const rng: RngLike = { next: () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) };
    const strangerDistances: number[] = [];
    for (let i = 0; i < 100; i++) {
      strangerDistances.push(distanceToMidparent(createGenome(HUMANOID, rng), mira, haran));
    }

    for (const childId of ['lio', 'aya']) {
      const d = distanceToMidparent(g[childId]!, mira, haran);
      const beaten = strangerDistances.filter((s) => d < s).length;
      expect(
        beaten,
        `${childId} doit battre au moins ${RANK_THRESHOLD} inconnus sur 100 (en a battu ${beaten})`,
      ).toBeGreaterThanOrEqual(RANK_THRESHOLD);
    }
  });

  it('Lio et Aya ne sont pas le même enfant', () => {
    const g = buildVillagerGenomes(AGENTS);
    expect(g['lio']!.genes).not.toEqual(g['aya']!.genes);
  });

  it('tous les génomes appartiennent à la famille humanoïde', () => {
    const g = buildVillagerGenomes(AGENTS);
    for (const agent of AGENTS) expect(g[agent.id]!.family).toBe(HUMANOID.id);
  });
});
