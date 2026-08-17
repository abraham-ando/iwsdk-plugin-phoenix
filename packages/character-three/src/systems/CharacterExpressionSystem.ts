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
      for (const key of Object.keys(family.morphs)) {
        // Même contournement que `readGroup` dans CharacterCompileSystem :
        // `key` est un `string` simple, pas `keyof CharacterFace['schema']`.
        const v = (entity as { getValue: (c: never, f: string) => number | null | undefined })
          .getValue(CharacterFace as never, key);
        if (v !== null && v !== undefined) morphs[key] = v;
      }
      applicator.applyMorphs(morphs);
    }
  }
}
