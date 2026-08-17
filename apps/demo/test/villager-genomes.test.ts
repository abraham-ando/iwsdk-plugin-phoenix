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

  it('Lio et Aya ressemblent à leurs parents plus qu un inconnu', () => {
    const g = buildVillagerGenomes(AGENTS);
    const mira = g['mira']!;
    const haran = g['haran']!;

    // Cent inconnus, pour que la comparaison ne dépende pas d un tirage
    // chanceux.
    let seed = 12345;
    const rng: RngLike = { next: () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) };
    let strangerMean = 0;
    for (let i = 0; i < 100; i++) {
      strangerMean += distanceToMidparent(createGenome(HUMANOID, rng), mira, haran);
    }
    strangerMean /= 100;

    for (const childId of ['lio', 'aya']) {
      const d = distanceToMidparent(g[childId]!, mira, haran);
      expect(d, `${childId} doit ressembler à ses parents`).toBeLessThan(strangerMean);
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
