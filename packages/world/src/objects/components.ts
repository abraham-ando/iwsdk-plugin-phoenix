import { Types, createComponent } from '@iwsdk/core';

/**
 * L'état visible d'un smart object (spec §9). Les valeurs sont écrites par
 * l'application depuis l'état du moteur, via `visualStateFor`.
 */
export const SmartObjectVisual = createComponent(
  'SmartObjectVisual',
  {
    objectType: { type: Types.String, default: '' },
    stage: { type: Types.Float32, default: 0 },
    fill: { type: Types.Float32, default: 1 },
    flame: { type: Types.Float32, default: 0 },
    lit: { type: Types.Boolean, default: false },
  },
  'Visible state of a simulated object',
);

/**
 * Un animal projeté depuis le moteur (spec §8).
 *
 * Le rendu ne connaît AUCUNE espèce : il projette toute vue exposant une
 * position, un cap et une animation.
 */
export const AnimalVisual = createComponent(
  'AnimalVisual',
  {
    x: { type: Types.Float32, default: 0 },
    y: { type: Types.Float32, default: 0 },
    z: { type: Types.Float32, default: 0 },
    heading: { type: Types.Float32, default: 0 },
    animation: { type: Types.String, default: 'idle' },
  },
  'Projected view of an engine animal',
);
