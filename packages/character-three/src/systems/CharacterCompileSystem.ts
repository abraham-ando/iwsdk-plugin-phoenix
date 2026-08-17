import { createSystem } from '@iwsdk/core';
import {
  CompileCache, genomeKey, getFamily,
  type FamilyDescriptor, type Genome, type RigBinding,
} from '@iwsdk/cardinal-character';
import { CharacterFace, CharacterIdentity, CharacterStructure, CharacterSurface } from '../components/index';
import type { CharacterApplicator } from '../apply/types';

/**
 * Recouvre le génome de départ par les seuls gènes de STRUCTURE.
 *
 * Le visage n'entre pas ici, et c'est le cœur de l'architecture à deux étages :
 * `restPose` n'en dépend pas, et `CharacterExpressionSystem` écrit les morphs
 * directement depuis `CharacterFace` à chaque image, sans jamais recompiler.
 * Les faire entrer ici ferait recompiler le squelette entier à chaque cran de
 * curseur de mâchoire, et remplirait le cache borné (`CompileCache`) d'une
 * entrée par position de curseur.
 *
 * Les gènes de SURFACE n'y sont pas non plus, pour une raison différente :
 * `CharacterSurface` porte des couleurs, qui sont la sortie de la rampe et non
 * son entrée. Ils ne peuvent donc venir que du génome posé à la création —
 * lequel reste la source de vérité pour tout ce qu'aucun curseur n'expose.
 */
export function genomeFromComponents(
  family: FamilyDescriptor,
  base: Genome,
  parts: { structure: Record<string, number> },
): Genome {
  const genes: Record<string, number> = {};
  for (const key of Object.keys(family.genes).sort()) {
    genes[key] = parts.structure[key] ?? base.genes[key] ?? 0.5;
  }
  return { family: family.id, genes };
}

/** Une clé absente veut dire « jamais compilé », donc il faut compiler. */
export function needsRecompile(previous: string | undefined, next: string): boolean {
  return previous !== next;
}

/**
 * Priorité 60 : la forme d'un personnage précède son LOD (90), sa prédiction
 * réseau (100) et sa cognition (115+). Ne travaille que sur changement de clé.
 */
export class CharacterCompileSystem extends createSystem({
  characters: { required: [CharacterIdentity, CharacterStructure, CharacterFace, CharacterSurface] },
}) {
  /** Liaison et applicateur vivent ici, pas dans un composant : ce sont des
   *  états runtime, pas des données d'auteur. Motif d'EntityIndex. */
  public readonly applicators = new Map<number, CharacterApplicator>();
  /** Toutes trois renseignées par `createCharacter`. */
  public readonly bindings = new Map<number, RigBinding>();
  public readonly genomes = new Map<number, Genome>();

  private readonly keys = new Map<number, string>();
  private readonly cache = new CompileCache();
  public compiledCount = 0;

  public override init(): void {
    // elics recycle les index d'entité : sans ce nettoyage, une entité neuve
    // qui hérite d'un index libéré verrait la clé — et donc le résultat de
    // compilation — de son PRÉDÉCESSEUR, et ne serait jamais recompilée. Ça
    // rendrait aussi indéfiniment vivants les maillages et matériaux d'un
    // personnage détruit, faute d'un `dispose()` jamais appelé.
    this.cleanupFuncs.push(
      this.queries.characters.subscribe('disqualify', (entity) => {
        this.applicators.get(entity.index)?.dispose();
        this.applicators.delete(entity.index);
        this.bindings.delete(entity.index);
        this.genomes.delete(entity.index);
        this.keys.delete(entity.index);
      }),
    );
  }

  public override update(): void {
    for (const entity of this.queries.characters.entities) {
      const applicator = this.applicators.get(entity.index);
      const binding = this.bindings.get(entity.index);
      const base = this.genomes.get(entity.index);
      // Une entité sans les trois n'a pas été créée par `createCharacter` :
      // on la laisse tranquille plutôt que de deviner.
      if (applicator === undefined || binding === undefined || base === undefined) continue;

      const family = getFamily(entity.getValue(CharacterIdentity, 'family') ?? 'humanoid');
      const age = entity.getValue(CharacterIdentity, 'age') ?? 25;
      const genome = genomeFromComponents(family, base, {
        structure: readGroup(entity, CharacterStructure),
      });

      const key = genomeKey(family, genome, age);
      if (!needsRecompile(this.keys.get(entity.index), key)) continue;
      this.keys.set(entity.index, key);

      const compiled = this.cache.get(family, genome, age, binding);
      applicator.applyRestPose(compiled);
      // Les tons de peau/cheveux viennent du génome posé à la création, donc
      // ne changent jamais entre deux compilations : la porte de recompilation
      // est le bon endroit pour les appliquer, pas une frame à part.
      applicator.applySurface(compiled.surface);
      this.compiledCount++;
    }
  }
}

/**
 * Lit tous les champs numériques d'un composant en un objet plat.
 *
 * Le type de `entity` ici est délibérément étroit, PAS le vrai `Entity` :
 * `Entity.getValue<C,K>` est générique sur `K extends keyof C['schema']`, et
 * ici `key` est un simple `string` issu de `Object.keys`. `null` (absent en
 * elics) et non `undefined` est ce que `getValue` rend réellement pour un
 * champ absent — la signature ci-dessous colle à l'usage réel, pas à un
 * défaut choisi au hasard.
 */
function readGroup(
  entity: { getValue: (c: never, f: string) => number | null | undefined },
  component: { schema: Record<string, unknown> },
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(component.schema)) {
    const value = entity.getValue(component as never, key);
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}
