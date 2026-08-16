import { Types, createComponent } from '@iwsdk/core';

/** La flore d'une tuile de terrain (spec §8). */
export const FloraTile = createComponent(
  'FloraTile',
  {
    tx: { type: Types.Int16, default: 0 },
    tz: { type: Types.Int16, default: 0 },
    _needsPlant: { type: Types.Boolean, default: true },
  },
  'Instanced flora for one terrain tile',
);
