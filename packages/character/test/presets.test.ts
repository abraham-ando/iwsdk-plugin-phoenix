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

  it('le ferronnier a réellement les épaules plus larges que le chercheur', () => {
    // Sur la sortie COMPILÉE et non sur la fiche : comparer les gènes entre eux
    // ne teste que la cohérence du fichier de données, et laisserait passer un
    // compilateur qui ignore le gène — ce qui était le cas avant l'ajout de la
    // chaîne d'épaules.
    const épaule = (id: string) => {
      const b = compileMétier(id, 40).restPose.find((x) => x.role === 'shoulderL')!;
      return Math.hypot(b.position[0], b.position[1], b.position[2]);
    };
    expect(épaule('ferronnier')).toBeGreaterThan(épaule('chercheur'));
  });

  it('le ferronnier est réellement plus massif que le chercheur', () => {
    // `bodyMass` devient un morph : la même logique s'applique — comparer la
    // sortie compilée et non la fiche.
    const masse = (id: string) => compileMétier(id, 40).morphs['bodyMass']!;
    expect(masse('ferronnier')).toBeGreaterThan(masse('chercheur'));
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
    // `enseignant` ne déclare ni armLength ni skinTone : ils doivent tomber
    // sur la valeur médiane de la famille, pas sur un autre remplissage.
    expect(genome.genes['armLength']).toBe(0.5);
    expect(genome.genes['skinTone']).toBe(0.5);
  });

  it('refuse un preset d une autre famille', () => {
    const étranger = { ...METIERS['chasseur']!, family: 'canid' };
    expect(() => genomeFromPreset(HUMANOID, étranger)).toThrow('canid');
  });
});
