import type { FamilyDescriptor } from '../family/types';
import { packGenome } from '../genome/serialize';
import type { Genome } from '../genome/types';
import { compile } from './compile';
import type { CompiledCharacter, RigBinding } from './types';

/** Pas de quantification de l'âge, en années. */
const AGE_STEP = 1;

/**
 * Clé de mémoïsation. L'âge est quantifié : un villageois qui vieillit d'un
 * jour n'a aucune raison de recompiler, et les courbes de proportion ne
 * bougent pas de façon perceptible sous l'année.
 */
export function genomeKey(family: FamilyDescriptor, genome: Genome, age: number): string {
  const bytes = packGenome(family, genome);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `${family.id}:${Math.round(age / AGE_STEP)}:${hex}`;
}

/**
 * Cache borné, éviction du plus anciennement inséré.
 *
 * Deux jumeaux ne compilent qu'une fois. Une fratrie qui partage 80 % de ses
 * gènes ne partage rien du tout, et c'est correct : 80 % d'un génome n'est pas
 * 80 % d'un personnage.
 */
export class CompileCache {
  private readonly entries = new Map<string, CompiledCharacter>();
  private hitCount = 0;

  constructor(private readonly maxEntries = 128) {}

  get size(): number {
    return this.entries.size;
  }

  get hits(): number {
    return this.hitCount;
  }

  get(
    family: FamilyDescriptor,
    genome: Genome,
    age: number,
    binding: RigBinding,
  ): CompiledCharacter {
    const key = genomeKey(family, genome, age);
    const found = this.entries.get(key);
    if (found !== undefined) {
      this.hitCount++;
      return found;
    }

    const compiled = compile(family, genome, age, binding);
    this.entries.set(key, compiled);

    if (this.entries.size > this.maxEntries) {
      // Map itère dans l'ordre d'insertion : la première clé est la plus ancienne.
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }

    return compiled;
  }
}
