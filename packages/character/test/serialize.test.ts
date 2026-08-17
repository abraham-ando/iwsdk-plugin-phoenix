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
    // Le budget annoncé : 2 + un octet par gène, contre quatre octets par gène
    // en float32.
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

  it('encode les gènes dans l ordre ALPHABÉTIQUE, pas celui de la déclaration', () => {
    // Le seul test qui distingue les deux ordres. Un test qui se contente de
    // faire varier l'ordre d'INSERTION des clés du génome ne prouve rien :
    // `packGenome` dérive son ordre de `family.genes`, le même objet dans
    // toutes les variantes, donc retirer le `.sort()` laisserait un tel test
    // vert. Ici la valeur de chaque octet dépend de la position ALPHABÉTIQUE
    // de son gène, ce qui distingue vraiment les deux ordres possibles.
    const alphabétique = [
      'armLength', 'bodyMass', 'cheekbone', 'eyeScale', 'hairStyle', 'hairTone',
      'jawWidth', 'legLength', 'noseSize', 'shoulderWidth', 'skinTone', 'stature',
      'torsoLength',
    ];
    // Garde-fou sur la liste ci-dessus : si un gène est ajouté ou renommé sans
    // mettre `alphabétique` à jour, ceci échoue bruyamment plutôt que de
    // laisser le test principal devenir un faux négatif silencieux.
    expect(Object.keys(HUMANOID.genes).sort()).toEqual(alphabétique);

    const genes: Record<string, number> = {};
    alphabétique.forEach((clé, i) => {
      genes[clé] = i / 255;
    });
    const bytes = packGenome(HUMANOID, { family: 'humanoid', genes });
    expect(Array.from(bytes.slice(2))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
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
