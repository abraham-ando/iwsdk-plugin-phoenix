import { describe, it, expect } from 'vitest';
import { Types } from '@iwsdk/core';
import {
  CharacterIdentity, CharacterStructure, CharacterFace,
  CharacterSurface, CharacterSelection,
} from '../src/components/index';

describe('composants', () => {
  it('exposent des bornes à l inspecteur pour chaque gène réglable', () => {
    for (const schema of [CharacterStructure.schema, CharacterFace.schema]) {
      for (const [key, field] of Object.entries(schema as Record<string, any>)) {
        expect(field.min, `${key} sans borne basse`).toBe(0);
        expect(field.max, `${key} sans borne haute`).toBe(1);
        expect(field.default).toBe(0.5);
      }
    }
  });

  it('donnent un âge par défaut adulte et une graine rejouable', () => {
    expect(CharacterIdentity.schema.age.default).toBe(25);
    expect(CharacterIdentity.schema.seed.default).toBe(0);
  });

  it('déclarent la sélection comme une entité, pas comme un identifiant', () => {
    // Le TYPE est l'affirmation, pas la présence du champ : un `Int32` passerait
    // un `toBeDefined()` et perdrait la référence d'entité que `Types.Entity`
    // emballe et déballe (`packEntityRef` / `getEntityByPackedRef`).
    expect(CharacterSelection.schema.target.type).toBe(Types.Entity);
  });

  it('portent les teintes en Color, donc en champ vecteur', () => {
    // Celui-ci compte plus encore : toute la règle `getVectorView` existe
    // PARCE QUE le type est `Types.Color`. `setValue` lève sur un champ
    // vecteur en elics 3.4.x ; sur un `Float32` il ne lèverait pas, et la
    // règle deviendrait un folklore sans cause.
    expect(CharacterSurface.schema.skin.type).toBe(Types.Color);
    expect(CharacterSurface.schema.hair.type).toBe(Types.Color);
  });
});
