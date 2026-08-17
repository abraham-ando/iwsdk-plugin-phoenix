import { createSystem } from '@iwsdk/core';
import { getFamily, type FamilyDescriptor } from '@iwsdk/cardinal-character';
import { CharacterFace, CharacterIdentity, CharacterSurface } from '../components/index';
import { CharacterCompileSystem } from './CharacterCompileSystem';

/** Une projection de morph, aplatie : clé, borne basse, borne haute. */
interface MorphProjection {
  key: string;
  lo: number;
  hi: number;
}

/**
 * Projections mémoïsées par famille.
 *
 * `Object.entries(family.morphs)` allouait un tableau de paires par entité et
 * par image, pour une donnée qui ne change jamais. Même règle que le système de
 * compilation : « Never allocate in `update()` ». Le tableau rendu est PARTAGÉ,
 * ne jamais le muter.
 */
const projectionsByFamily = new Map<FamilyDescriptor, MorphProjection[]>();

function projections(family: FamilyDescriptor): readonly MorphProjection[] {
  let list = projectionsByFamily.get(family);
  if (list === undefined) {
    list = Object.entries(family.morphs).map(([key, def]) => ({
      key, lo: def.range[0], hi: def.range[1],
    }));
    projectionsByFamily.set(family, list);
  }
  return list;
}

/**
 * Priorité 70 : les canaux continus, écrits chaque frame mais seulement quand
 * ils ont changé. Les applicateurs mémorisent la dernière valeur écrite.
 */
export class CharacterExpressionSystem extends createSystem({
  characters: { required: [CharacterIdentity, CharacterFace, CharacterSurface] },
}) {
  /**
   * Un enregistrement de morphs par entité, réécrit sur place à chaque image.
   * C'est ce même objet qui est passé à l'applicateur : un test vérifie
   * l'identité d'un appel à l'autre, parce que c'est la seule façon d'observer
   * l'absence d'allocation autrement que par un profileur.
   */
  private readonly morphs = new Map<number, Record<string, number>>();

  public override init(): void {
    this.cleanupFuncs.push(
      this.queries.characters.subscribe('disqualify', (entity) => {
        this.morphs.delete(entity.index);
      }),
    );
  }

  public override update(): void {
    const compiler = this.world.getSystem(CharacterCompileSystem) as CharacterCompileSystem | undefined;
    if (compiler === undefined) return;

    for (const entity of this.queries.characters.entities) {
      const applicator = compiler.applicators.get(entity.index);
      if (applicator === undefined) continue;

      const family = getFamily(entity.getValue(CharacterIdentity, 'family') ?? 'humanoid');
      let morphs = this.morphs.get(entity.index);
      if (morphs === undefined) {
        morphs = {};
        this.morphs.set(entity.index, morphs);
      }

      for (const projection of projections(family)) {
        // Même contournement que dans CharacterCompileSystem : la clé est un
        // `string` simple, pas `keyof CharacterFace['schema']`.
        const gene = (entity as { getValue: (c: never, f: string) => number | null | undefined })
          .getValue(CharacterFace as never, projection.key);
        if (gene === null || gene === undefined) continue;
        // Même projection que `compile()` : un gène vit dans [0,1], une
        // influence de morph dans la plage que la famille déclare (souvent
        // [-1,1]). Sans cette projection, toute la moitié négative de chaque
        // morph symétrique est inatteignable — un gène à 0 devrait donner
        // -1, pas 0.
        morphs[projection.key] = projection.lo + gene * (projection.hi - projection.lo);
      }
      applicator.applyMorphs(morphs);
    }
  }
}
