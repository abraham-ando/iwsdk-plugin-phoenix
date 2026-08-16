import { compare } from '../world/affordances';
import type { Comparison } from '../world/SmartObject';
import { clampNeed } from './needs';
import type { NeedId } from './needs';

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
  preconditions?: {
    actorInventory?: Record<string, Comparison>;
    /** Symétrique de celles des affordances : on ne somnole pas frais et dispos. */
    actorNeeds?: Record<string, Comparison>;
  };
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
      verb: 'eat_meat',
      durationTicks: 30,
      preconditions: { actorInventory: { meat: '>=1' } },
      effects: { actorInventory: { meat: -1 }, actorNeeds: { hunger: 50 } },
    },
    {
      verb: 'nap',
      durationTicks: 200,
      // La sieste à même le sol est un pis-aller, pas un régime. Sans cette
      // condition elle se déclenchait dès 70 d'énergie, si bien que l'agent ne
      // descendait jamais sous les 60 qu'exige `sleep_inside` : les abris se
      // bâtissaient et ne servaient plus jamais.
      preconditions: { actorNeeds: { energy: '<40' } },
      effects: { actorNeeds: { energy: 15 } },
    },
  ];
}

export function checkIntrinsic(
  def: IntrinsicActionDef,
  inventory: Record<string, number>,
  // `AgentNeeds` est une interface : TypeScript ne l'accepte pas comme
  // `Record<string, number>`, faute de signature d'index. Un mappage sur les
  // besoins connus, lui, la reçoit sans conversion à l'appel.
  needs: Readonly<Partial<Record<NeedId, number>>> = {}
): { ok: true } | { ok: false; reason: string } {
  for (const [item, expr] of Object.entries(def.preconditions?.actorInventory ?? {})) {
    const count = inventory[item] ?? 0;
    if (!compare(count, expr)) {
      return { ok: false, reason: `actorInventory.${item} (${count}) fails ${expr}` };
    }
  }
  for (const [need, expr] of Object.entries(def.preconditions?.actorNeeds ?? {})) {
    const value = needs[need as NeedId] ?? 0;
    if (!compare(value, expr)) {
      return { ok: false, reason: `actorNeeds.${need} (${value}) fails ${expr}` };
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
