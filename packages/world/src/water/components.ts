import { Types, createComponent } from '@iwsdk/core';

/** Marque une entité comme surface d'eau animée (spec §7). */
export const WaterSurface = createComponent(
  'WaterSurface',
  {
    _needsBuild: { type: Types.Boolean, default: true },
  },
  'Animated water surface',
);
