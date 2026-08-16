import type { FamilyDescriptor } from './types';

const families = new Map<string, FamilyDescriptor>();

/**
 * Rend la liste des problèmes. Vide = valide.
 *
 * Une liste plutôt qu'un booléen : un asset rejeté doit dire précisément ce
 * qui manque. Un échec silencieux qui laisse la vérification verte coûte plus
 * cher qu'un rejet bruyant — c'est la leçon de RoomChannel compilé
 * conditionnellement.
 */
export function validateDescriptor(descriptor: FamilyDescriptor): string[] {
  const problems: string[] = [];

  for (const [name, chain] of Object.entries(descriptor.chains)) {
    for (const role of [chain.from, chain.to]) {
      if (descriptor.bones[role] === undefined) {
        problems.push(`chaîne "${name}" : rôle d'os "${role}" non déclaré`);
      }
    }
    if (descriptor.genes[chain.gene] === undefined) {
      problems.push(`chaîne "${name}" : gène "${chain.gene}" non déclaré`);
    }
    if (chain.mirror !== undefined) {
      for (const role of chain.mirror) {
        if (descriptor.bones[role] === undefined) {
          problems.push(`chaîne "${name}" : rôle miroir "${role}" non déclaré`);
        }
      }
    }
  }

  for (const [key, gene] of Object.entries(descriptor.genes)) {
    for (const [field, value] of [
      ['heritability', gene.heritability],
      ['dominance', gene.dominance],
      ['mutationRate', gene.mutationRate],
    ] as const) {
      if (!(value >= 0 && value <= 1)) {
        problems.push(`gène "${key}" : ${field} hors de [0,1] (${value})`);
      }
    }
  }

  return problems;
}

export function registerFamily(descriptor: FamilyDescriptor): void {
  const problems = validateDescriptor(descriptor);
  if (problems.length > 0) {
    throw new Error(
      `registerFamily: descripteur "${descriptor.id}" invalide —\n  ${problems.join('\n  ')}`,
    );
  }
  families.set(descriptor.id, descriptor);
}

export function getFamily(id: string): FamilyDescriptor {
  const found = families.get(id);
  if (found === undefined) {
    throw new Error(`getFamily: famille "${id}" inconnue — appelez registerFamily d'abord`);
  }
  return found;
}
