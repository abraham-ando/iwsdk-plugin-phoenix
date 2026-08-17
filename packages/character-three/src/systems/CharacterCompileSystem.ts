import { createSystem } from '@iwsdk/core';
import {
  CompileCache, genomeKey, getFamily,
  type FamilyDescriptor, type Genome, type RigBinding,
} from '@iwsdk/cardinal-character';
import { CharacterFace, CharacterIdentity, CharacterStructure, CharacterSurface } from '../components/index';
import type { CharacterApplicator } from '../apply/types';

/**
 * Clés de gènes de la famille, triées, mémoïsées PAR famille.
 *
 * `Object.keys(...).sort()` alloue deux tableaux ; le faire par entité et par
 * image, pour une donnée qui ne change jamais de la vie du processus, est
 * exactement ce que `apps/demo/CLAUDE.md` appelle un bug (« Treat per-frame
 * allocation as a bug », « Never allocate in `update()` ») et ce que le §10 de
 * la conception budgète à « coût par frame nul pour la structure ».
 *
 * Le tableau rendu est PARTAGÉ : ne jamais le muter.
 */
const geneKeysByFamily = new Map<FamilyDescriptor, string[]>();

function geneKeys(family: FamilyDescriptor): readonly string[] {
  let keys = geneKeysByFamily.get(family);
  if (keys === undefined) {
    keys = Object.keys(family.genes).sort();
    geneKeysByFamily.set(family, keys);
  }
  return keys;
}

/**
 * Les gènes que `CharacterStructure` expose, et eux seuls.
 *
 * Calculé une fois : c'est la liste des champs du schéma, qui ne bouge pas.
 */
const STRUCTURE_KEYS = new Set(Object.keys(CharacterStructure.schema));

/**
 * Le type de `entity` est délibérément étroit, PAS le vrai `Entity` :
 * `Entity.getValue<C,K>` est générique sur `K extends keyof C['schema']`, et
 * ici la clé est un simple `string` issu du schéma. `null` (absent en elics) et
 * non `undefined` est ce que `getValue` rend réellement pour un champ absent.
 */
type ValueReader = { getValue: (c: never, f: string) => number | null | undefined };

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
 *
 * Cette fonction ALLOUE un génome : c'est la forme de référence de la règle,
 * appelable depuis un test ou un outil. Le système, lui, applique la même règle
 * sur place (`refreshGenes`) parce qu'il tourne par image. Les deux doivent
 * dire la même chose, et se lisent côte à côte pour cette raison.
 */
export function genomeFromComponents(
  family: FamilyDescriptor,
  base: Genome,
  parts: { structure: Record<string, number> },
): Genome {
  const genes: Record<string, number> = {};
  for (const key of geneKeys(family)) {
    genes[key] = parts.structure[key] ?? base.genes[key] ?? 0.5;
  }
  return { family: family.id, genes };
}

/**
 * `Genome` est en lecture seule, à raison : personne ne doit muter le génome
 * d'un personnage. Le brouillon du système, lui, EXISTE pour être réécrit sur
 * place — c'est tout l'intérêt. Il reste assignable à `Genome` partout où on le
 * passe (`genomeKey`, `CompileCache.get`), donc rien ne fuit de mutable.
 */
interface MutableGenome {
  family: string;
  genes: Record<string, number>;
}

/**
 * Même règle que `genomeFromComponents`, mais écrite SUR PLACE dans `genome`,
 * et qui rend « quelque chose a-t-il bougé ».
 *
 * C'est la porte de recompilation elle-même : comparer les valeurs de gènes à
 * celles déjà appliquées ne coûte rien, là où construire un génome neuf puis sa
 * clé `genomeKey` (une chaîne hexadécimale fraîche) coûtait trois allocations
 * par entité et par image, AVANT même de savoir s'il y avait quoi que ce soit à
 * faire.
 */
function refreshGenes(
  family: FamilyDescriptor,
  base: Genome,
  entity: ValueReader,
  genome: MutableGenome,
): boolean {
  let changed = false;
  for (const key of geneKeys(family)) {
    // Un gène de structure vient du composant ; tout le reste (visage,
    // surface) vient du génome posé à la création.
    const own = STRUCTURE_KEYS.has(key)
      ? entity.getValue(CharacterStructure as never, key)
      : null;
    const next = own ?? base.genes[key] ?? 0.5;
    if (genome.genes[key] !== next) {
      genome.genes[key] = next;
      changed = true;
    }
  }
  return changed;
}

/** Une clé absente veut dire « jamais compilé », donc il faut compiler. */
export function needsRecompile(previous: string | undefined, next: string): boolean {
  return previous !== next;
}

/** Un exemplaire par entité, réécrit sur place. Jamais réalloué. */
interface Scratch {
  genome: MutableGenome;
  /** Âge QUANTIFIÉ à l'année, comme `genomeKey` le quantifie. */
  age: number;
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
  private readonly scratches = new Map<number, Scratch>();
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
        this.scratches.delete(entity.index);
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

      let scratch = this.scratches.get(entity.index);
      if (scratch === undefined || scratch.genome.family !== family.id) {
        // Créé à la première vue de l'entité — ou si elle a changé d'espèce,
        // auquel cas les gènes du génome précédent ne veulent plus rien dire.
        // `genes: {}` garantit que le premier passage voit tout comme modifié.
        scratch = { genome: { family: family.id, genes: {} }, age: Number.NaN };
        this.scratches.set(entity.index, scratch);
      }

      let changed = refreshGenes(family, base, entity, scratch.genome);
      // L'âge est quantifié à l'année exactement comme `genomeKey` le fait
      // (`AGE_STEP = 1`) : un villageois qui vieillit d'un jour ne doit même
      // pas faire calculer une clé. Si les deux quantifications divergeaient,
      // la clé ci-dessous resterait l'arbitre.
      const quantizedAge = Math.round(age);
      if (quantizedAge !== scratch.age) {
        scratch.age = quantizedAge;
        changed = true;
      }
      // LA porte. Le chemin d'une entité au repos s'arrête ici, sans avoir
      // alloué un seul objet.
      if (!changed) continue;

      const key = genomeKey(family, scratch.genome, age);
      if (!needsRecompile(this.keys.get(entity.index), key)) continue;
      this.keys.set(entity.index, key);

      const compiled = this.cache.get(family, scratch.genome, age, binding);
      applicator.applyRestPose(compiled);
      // Les tons de peau/cheveux viennent du génome posé à la création, donc
      // ne changent jamais entre deux compilations : la porte de recompilation
      // est le bon endroit pour les appliquer, pas une frame à part.
      applicator.applySurface(compiled.surface);
      this.compiledCount++;
    }
  }
}
