import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { defaultGenome } from '../src/genome/create';
import { GENOME_FORMAT_VERSION, packGenome, unpackGenome } from '../src/genome/serialize';

describe('packGenome', () => {
  it('produit deux octets d en-tête plus un octet par gène', () => {
    const bytes = packGenome(HUMANOID, defaultGenome(HUMANOID));
    expect(bytes.length).toBe(2 + Object.keys(HUMANOID.genes).length);
  });

  it('place la version puis le nombre de gènes en tête', () => {
    const bytes = packGenome(HUMANOID, defaultGenome(HUMANOID));
    expect(bytes[0]).toBe(GENOME_FORMAT_VERSION);
    expect(bytes[1]).toBe(Object.keys(HUMANOID.genes).length);
  });

  it('tient sous cinquante octets pour un humain', () => {
    // Le budget annoncé : trente octets contre cent vingt en float32.
    expect(packGenome(HUMANOID, defaultGenome(HUMANOID)).length).toBeLessThan(50);
  });
});

describe('aller-retour', () => {
  it('restitue chaque gène à moins d un pas de quantification', () => {
    const original = {
      family: 'humanoid',
      genes: Object.fromEntries(
        Object.keys(HUMANOID.genes).map((k, i) => [k, (i * 7919) % 1000 / 1000]),
      ),
    };
    const restored = unpackGenome(HUMANOID, packGenome(HUMANOID, original));
    for (const key of Object.keys(HUMANOID.genes)) {
      expect(restored.genes[key]!).toBeCloseTo(original.genes[key]!, 2);
      expect(Math.abs(restored.genes[key]! - original.genes[key]!)).toBeLessThanOrEqual(1 / 255);
    }
  });

  it('restitue exactement les bornes', () => {
    const extrêmes = {
      family: 'humanoid',
      genes: Object.fromEntries(Object.keys(HUMANOID.genes).map((k, i) => [k, i % 2])),
    };
    const restored = unpackGenome(HUMANOID, packGenome(HUMANOID, extrêmes));
    for (const [key, value] of Object.entries(extrêmes.genes)) {
      expect(restored.genes[key]!).toBe(value);
    }
  });

  it('est stable quel que soit l ordre d insertion des clés', () => {
    const clés = Object.keys(HUMANOID.genes);
    const avant = { family: 'humanoid', genes: Object.fromEntries(clés.map((k) => [k, 0.25])) };
    const après = {
      family: 'humanoid',
      genes: Object.fromEntries([...clés].reverse().map((k) => [k, 0.25])),
    };
    expect(packGenome(HUMANOID, avant)).toEqual(packGenome(HUMANOID, après));
  });
});

describe('rejets', () => {
  it('refuse une version inconnue', () => {
    const bytes = packGenome(HUMANOID, defaultGenome(HUMANOID));
    bytes[0] = 99;
    expect(() => unpackGenome(HUMANOID, bytes)).toThrow('version');
  });

  it('refuse un nombre de gènes qui ne correspond pas à la famille', () => {
    const bytes = packGenome(HUMANOID, defaultGenome(HUMANOID));
    bytes[1] = 3;
    expect(() => unpackGenome(HUMANOID, bytes)).toThrow('gènes');
  });
});
