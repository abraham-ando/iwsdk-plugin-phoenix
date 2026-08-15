import { Types, createComponent } from '@iwsdk/core';

/**
 * ECS component configuring NPC perception of physical VR objects (Grabbables) and laser pointer targets.
 */
export const NPCPerception = createComponent(
  'NPCPerception',
  {
    /** Maximum radius in meters to perceive an offered physical grabbable item */
    offeredItemRadius: { type: Types.Float32, default: 1.8 },
    /** Maximum radius in meters to perceive a laser-pointed target */
    pointedTargetRadius: { type: Types.Float32, default: 3.5 },
    /** Entity index of the currently perceived item (-1 if none) */
    noticedItemEntityIndex: { type: Types.Int32, default: -1 },
    /** True when actively gazing at an offered object or laser pointer */
    isNoticingItem: { type: Types.Boolean, default: false },
    /** Timestamp when the item was first noticed */
    noticedStartTime: { type: Types.Float64, default: 0.0 },
  },
  'Physical VR object and grabbable perception for NPCs',
);
