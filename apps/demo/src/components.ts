/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { defineComponents } from '@iwsdk/core';
import {
  CharacterIdentity, CharacterStructure, CharacterFace,
  CharacterSurface, CharacterSelection,
} from '@iwsdk/cardinal-character-three';
import { Robot } from './robot-component.js';

// Les cinq composants de personnage figurent ici pour que l'inspecteur de
// l'éditeur managé rende leurs curseurs : il lit CE manifeste, et les
// métadonnées `label`, `min`, `max`, `step` que `gene()` porte déjà suffisent
// à produire une ligne bornée et étiquetée. Sans cette déclaration, aucune des
// treize valeurs n'est éditable hors du panneau spatial.
export default defineComponents([
  Robot,
  CharacterIdentity,
  CharacterStructure,
  CharacterFace,
  CharacterSurface,
  CharacterSelection,
]);
