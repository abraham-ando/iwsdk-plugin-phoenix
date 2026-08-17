import { createSystem } from '@iwsdk/core';
import { getFamily } from '@iwsdk/cardinal-character';
import { CharacterFace, CharacterIdentity, CharacterSurface } from '../components/index';
import { CharacterCompileSystem } from './CharacterCompileSystem';

/**
 * Priorité 70 : les canaux continus, écrits chaque frame mais seulement quand
 * ils ont changé. Les applicateurs mémorisent la dernière valeur écrite.
 */
export class CharacterExpressionSystem extends createSystem({
  characters: { required: [CharacterIdentity, CharacterFace, CharacterSurface] },
}) {
  public override update(): void {
    const compiler = this.world.getSystem(CharacterCompileSystem) as CharacterCompileSystem | undefined;
    if (compiler === undefined) return;

    for (const entity of this.queries.characters.entities) {
      const applicator = compiler.applicators.get(entity.index);
      if (applicator === undefined) continue;

      const family = getFamily(entity.getValue(CharacterIdentity, 'family') ?? 'humanoid');
      const morphs: Record<string, number> = {};
      for (const [key, def] of Object.entries(family.morphs)) {
        // Même contournement que `readGroup` dans CharacterCompileSystem :
        // `key` est un `string` simple, pas `keyof CharacterFace['schema']`.
        const gene = (entity as { getValue: (c: never, f: string) => number | null | undefined })
          .getValue(CharacterFace as never, key);
        if (gene === null || gene === undefined) continue;
        // Même projection que `compile()` : un gène vit dans [0,1], une
        // influence de morph dans la plage que la famille déclare (souvent
        // [-1,1]). Sans cette projection, toute la moitié négative de chaque
        // morph symétrique est inatteignable — un gène à 0 devrait donner
        // -1, pas 0.
        const [lo, hi] = def.range;
        morphs[key] = lo + gene * (hi - lo);
      }
      applicator.applyMorphs(morphs);
    }
  }
}
