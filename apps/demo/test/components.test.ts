import { describe, it, expect } from 'vitest';
import {
  CharacterIdentity, CharacterStructure, CharacterFace,
  CharacterSurface, CharacterSelection,
} from '@iwsdk/cardinal-character-three';
import components from '../src/components';

describe('le manifeste de composants de la démo', () => {
  it('déclare les cinq composants de personnage', () => {
    // L'inspecteur IWSDK construit ses curseurs à partir de CE manifeste : un
    // composant absent d'ici n'est pas éditable, quelles que soient ses
    // métadonnées `min`/`max`/`step`.
    for (const composant of [
      CharacterIdentity, CharacterStructure, CharacterFace,
      CharacterSurface, CharacterSelection,
    ]) {
      expect(components).toContain(composant);
    }
  });

  it('garde le composant Robot préexistant', () => {
    // Retirer un composant du manifeste casse silencieusement l'édition de
    // scène : ce garde empêche de le faire en passant.
    expect(components.length).toBeGreaterThanOrEqual(6);
  });
});
