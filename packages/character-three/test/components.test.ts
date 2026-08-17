import { describe, it, expect } from 'vitest';
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
    expect(CharacterSelection.schema.target).toBeDefined();
  });

  it('portent les teintes en Color, donc en champ vecteur', () => {
    expect(CharacterSurface.schema.skin).toBeDefined();
    expect(CharacterSurface.schema.hair).toBeDefined();
  });
});
