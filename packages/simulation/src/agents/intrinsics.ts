import { compare } from '../world/affordances';
import type { Comparison } from '../world/SmartObject';
import { clampNeed } from './needs';

/**
 * Intrinsic actions are the agent's own repertoire — no smart object involved
 * (eating from inventory, napping). Same shape as affordances so Mode-1
 * scores both uniformly (spec §6.4, §7.1).
 */
export const INVENTORY_CAPACITY = 10;

export function invTotal(inv: Record<string, number>): number {
  return Object.values(inv).reduce((a, b) => a + b, 0);
}

export interface IntrinsicActionDef {
  verb: string;
  durationTicks: number;
  preconditions?: { actorInventory?: Record<string, Comparison> };
  effects: {
    actorInventory?: Record<string, number>;
    actorNeeds?: Record<string, number>;
  };
}

export function defaultIntrinsics(): IntrinsicActionDef[] {
  return [
    {
      verb: 'eat_berries',
      durationTicks: 20,
      preconditions: { actorInventory: { berries: '>=1' } },
      effects: { actorInventory: { berries: -1 }, actorNeeds: { hunger: 30 } },
    },
    {
      verb: 'eat_fish',
      durationTicks: 30,
      preconditions: { actorInventory: { fish: '>=1' } },
      effects: { actorInventory: { fish: -1 }, actorNeeds: { hunger: 40 } },
    },
    {
      verb: 'nap',
      durationTicks: 200,
      effects: { actorNeeds: { energy: 15 } },
    },
  ];
}

export function checkIntrinsic(
  def: IntrinsicActionDef,
  inventory: Record<string, number>
): { ok: true } | { ok: false; reason: string } {
  for (const [item, expr] of Object.entries(def.preconditions?.actorInventory ?? {})) {
    const count = inventory[item] ?? 0;
    if (!compare(count, expr)) {
      return { ok: false, reason: `actorInventory.${item} (${count}) fails ${expr}` };
    }
  }
  return { ok: true };
}

export function applyIntrinsic(
  def: IntrinsicActionDef,
  inventory: Record<string, number>,
  needs: Record<string, number>
): void {
  for (const [item, delta] of Object.entries(def.effects.actorInventory ?? {})) {
    inventory[item] = Math.max(0, (inventory[item] ?? 0) + delta);
  }
  for (const [need, delta] of Object.entries(def.effects.actorNeeds ?? {})) {
    needs[need] = clampNeed((needs[need] ?? 0) + delta);
  }
}
