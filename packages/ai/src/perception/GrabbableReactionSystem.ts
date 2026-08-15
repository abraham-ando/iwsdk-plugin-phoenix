import { Types, createSystem, type Entity } from '@iwsdk/core';
import { NPCPerception } from '../components/NPCPerception';
import { NPCGazeTracker } from '../components/NPCGazeTracker';

export interface ItemOfferEvent {
  npc: Entity;
  itemEntity: Entity;
  itemName?: string;
}

export type ItemOfferListener = (event: ItemOfferEvent) => void;

export class GrabbableReactionSystem extends createSystem(
  {
    perceivers: { required: [NPCPerception] },
  },
  {
    enabled: { type: Types.Boolean, default: true },
  },
) {
  private offerListeners = new Set<ItemOfferListener>();

  /** Register a callback fired when a player offers an item to an NPC */
  public onItemOffered(listener: ItemOfferListener): () => void {
    this.offerListeners.add(listener);
    return () => this.offerListeners.delete(listener);
  }

  /**
   * Notify that an item is currently held near the NPC.
   */
  public presentItemToNPC(npc: Entity, itemEntity: Entity, itemName?: string): void {
    const itemIdx = itemEntity.index ?? (itemEntity as any).id ?? 0;
    npc.setValue(NPCPerception, 'noticedItemEntityIndex', itemIdx);
    npc.setValue(NPCPerception, 'isNoticingItem', true);
    npc.setValue(NPCPerception, 'noticedStartTime', performance.now());

    // Lock gaze tracker to item
    if (npc.hasComponent(NPCGazeTracker)) {
      npc.setValue(NPCGazeTracker, 'targetEntityIndex', itemIdx);
    }

    for (const listener of this.offerListeners) {
      listener({ npc, itemEntity, itemName });
    }
  }

  /**
   * Release item perception and return gaze to player camera.
   */
  public releaseItemPerception(npc: Entity): void {
    npc.setValue(NPCPerception, 'noticedItemEntityIndex', -1);
    npc.setValue(NPCPerception, 'isNoticingItem', false);

    if (npc.hasComponent(NPCGazeTracker)) {
      npc.setValue(NPCGazeTracker, 'targetEntityIndex', -1);
    }
  }

  override update(_delta: number, _time: number): void {
    // Physical proximity checks and active perception updates
  }
}
