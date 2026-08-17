import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { compile } from '../src/compile/compile';
import { METIERS, genomeFromPreset } from '../src/presets/metiers';
import { humanoidBinding } from './fixtures/humanoid-binding';

const BINDING = humanoidBinding();

const MÉTIERS_ATTENDUS = [
  'charbonnier', 'ferronnier', 'chasseur', 'pecheur',
  'chercheur', 'inventeur', 'enseignant', 'commercant',
];

describe('catalogue des métiers', () => {
  it('couvre les huit métiers du scénario', () => {
    expect(Object.keys(METIERS).sort()).toEqual([...MÉTIERS_ATTENDUS].sort());
  });

  it('ne déclare que des gènes que la famille connaît', () => {
    for (const preset of Object.values(METIERS)) {
      for (const key of Object.keys(preset.genes)) {
        expect(HUMANOID.genes[key]).toBeDefined();
      }
    }
  });

  it('borne chaque gène dans [0,1]', () => {
    for (const preset of Object.values(METIERS)) {
      for (const value of Object.values(preset.genes)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('déclare une plage d âge d adulte pour chaque métier', () => {
    for (const preset of Object.values(METIERS)) {
      expect(preset.ageRange[0]).toBeGreaterThanOrEqual(HUMANOID.adultAge);
      expect(preset.ageRange[1]).toBeGreaterThan(preset.ageRange[0]);
    }
  });
});

describe('les archétypes restent ce qu ils prétendent être', () => {
  const compileMétier = (id: string, age: number) =>
    compile(HUMANOID, genomeFromPreset(HUMANOID, METIERS[id]!), age, BINDING);

  it('le ferronnier est plus large d épaules et plus massif que le chercheur', () => {
    const ferronnier = METIERS['ferronnier']!;
    const chercheur = METIERS['chercheur']!;
    expect(ferronnier.genes['shoulderWidth']!).toBeGreaterThan(chercheur.genes['shoulderWidth']!);
    expect(ferronnier.genes['bodyMass']!).toBeGreaterThan(chercheur.genes['bodyMass']!);
  });

  it('aucun métier ne produit un adulte hors de la stature humaine', () => {
    for (const id of MÉTIERS_ATTENDUS) {
      for (const age of [18, 40, 60]) {
        const h = compileMétier(id, age).stats.nominalHeightMeters;
        expect(h).toBeGreaterThan(1.4);
        expect(h).toBeLessThan(2.1);
      }
    }
  });

  it('un métier compilé à sept ans reste un enfant, pas un adulte réduit', () => {
    const enfant = compileMétier('ferronnier', 7);
    const adulte = compileMétier('ferronnier', 40);
    expect(enfant.stats.nominalHeightMeters).toBeLessThan(adulte.stats.nominalHeightMeters * 0.8);
    const têteEnfant = enfant.restPose.find((b) => b.role === 'head')!.scale;
    const têteAdulte = adulte.restPose.find((b) => b.role === 'head')!.scale;
    expect(têteEnfant).toBeGreaterThan(têteAdulte);
  });
});

describe('genomeFromPreset', () => {
  it('complète les gènes absents par la valeur médiane', () => {
    const genome = genomeFromPreset(HUMANOID, METIERS['enseignant']!);
    expect(Object.keys(genome.genes).sort()).toEqual(Object.keys(HUMANOID.genes).sort());
  });

  it('refuse un preset d une autre famille', () => {
    const étranger = { ...METIERS['chasseur']!, family: 'canid' };
    expect(() => genomeFromPreset(HUMANOID, étranger)).toThrow('canid');
  });
});
