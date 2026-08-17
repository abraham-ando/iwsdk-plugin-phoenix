import { describe, it, expect } from 'vitest';
import { HUMANOID } from '../src/family/humanoid';
import { getFamily, registerFamily, validateDescriptor } from '../src/family/registry';
import type { FamilyDescriptor } from '../src/family/types';

describe('HUMANOID', () => {
  it('est un descripteur valide', () => {
    expect(validateDescriptor(HUMANOID)).toEqual([]);
  });

  it('déclare un gène pour chaque chaîne', () => {
    for (const chain of Object.values(HUMANOID.chains)) {
      expect(HUMANOID.genes[chain.gene]).toBeDefined();
    }
  });

  it('ne déclare que des rôles d os connus dans ses chaînes', () => {
    for (const chain of Object.values(HUMANOID.chains)) {
      expect(HUMANOID.bones[chain.from]).toBeDefined();
      expect(HUMANOID.bones[chain.to]).toBeDefined();
    }
  });

  it('reconnaît les conventions RPM et Mixamo pour la tête', () => {
    const alias = HUMANOID.bones['head']!;
    expect(alias).toContain('Head');
    expect(alias).toContain('mixamorig:Head');
  });
});

/** Descripteur volontairement cassé : rôle d os inconnu ET gène inexistant. */
const broken: FamilyDescriptor = {
  ...HUMANOID,
  id: 'cassé',
  chains: { bras: { from: 'inconnu', to: 'handL', gene: 'absent', limb: true } },
};

/** Descripteur cassé sur les DEUX règles ajoutées à l'étape 2. */
const brokenEtape2: FamilyDescriptor = {
  ...HUMANOID,
  id: 'cassé-étape2',
  groundRole: 'nageoire',
  genes: {
    ...HUMANOID.genes,
    skinTone: { group: 'surface', heritability: 0.9, dominance: 0.5, mutationRate: 0.02 },
  },
};

describe('validateDescriptor', () => {
  it('nomme précisément ce qui manque, sans dégrader en silence', () => {
    const problems = validateDescriptor(broken);
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).toContain('inconnu');
    expect(problems.join(' ')).toContain('absent');
  });

  it('signale un groundRole inconnu et un gène de surface sans rampe', () => {
    const problems = validateDescriptor(brokenEtape2);
    expect(problems.join(' ')).toContain('nageoire');
    expect(problems.join(' ')).toContain('skinTone');
  });
});

describe('registre', () => {
  it('rend une famille enregistrée', () => {
    registerFamily(HUMANOID);
    expect(getFamily('humanoid')).toBe(HUMANOID);
  });

  it('refuse d enregistrer un descripteur invalide', () => {
    expect(() => registerFamily(broken)).toThrow('cassé');
  });

  it('lève sur une famille inconnue plutôt que de rendre undefined', () => {
    expect(() => getFamily('licorne')).toThrow('licorne');
  });
});
