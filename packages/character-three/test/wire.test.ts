import { describe, it, expect } from 'vitest';
import { HUMANOID, createGenome, type RngLike } from '@iwsdk/cardinal-character';
import { genomeToBytes, bytesToGenome } from '../src/wire';

function rng(graine: number): RngLike {
  let etat = graine || 1;
  return { next: () => ((etat = (etat * 1664525 + 1013904223) >>> 0) / 4294967296) };
}

describe('la conversion Genome ↔ octets', () => {
  it('produit treize octets, un par gène', () => {
    const genome = createGenome(HUMANOID, rng(1));
    const octets = genomeToBytes(genome);
    expect(octets.length).toBe(13);
    for (const o of octets) {
      expect(Number.isInteger(o)).toBe(true);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(255);
    }
  });

  it('l octet à l index attendu correspond au bon gène, dans l ordre alphabétique', () => {
    // stature est le douzième gène de la liste alphabétique (index 11).
    const genome = createGenome(HUMANOID, rng(2));
    const octets = genomeToBytes(genome);
    const attendu = Math.round(genome.genes['stature']! * 255);
    expect(octets[11]).toBe(attendu);
  });

  it('round-trip à un pas de quantification près (256 pas sur [0,1])', () => {
    const genome = createGenome(HUMANOID, rng(3));
    const revenu = bytesToGenome(HUMANOID, genomeToBytes(genome));
    for (const cle of Object.keys(HUMANOID.genes)) {
      expect(revenu.genes[cle]).toBeCloseTo(genome.genes[cle]!, 2);
    }
  });

  it('un tableau incomplet en entrée ne lève pas — complète à 0.5', () => {
    // Défensif : un pair qui reçoit un COMPONENT_UPDATE d'un schéma plus
    // ancien ne doit pas planter sur un tableau tronqué.
    const genome = bytesToGenome(HUMANOID, [128, 128]);
    expect(genome.family).toBe(HUMANOID.id);
    expect(Object.keys(genome.genes).length).toBe(13);
  });
});
