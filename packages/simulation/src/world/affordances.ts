import type { AffordanceDef, Comparison, SmartObjectInstance } from './SmartObject';

export interface ActorContext {
  x: number;
  z: number;
  inventory: Record<string, number>;
}

const COMPARISON_RE = /^(>=|<=|==|>|<)\s*(-?\d+(?:\.\d+)?)$/;

export function compare(value: number, expr: Comparison): boolean {
  const m = COMPARISON_RE.exec(expr.trim());
  if (m === null) throw new Error(`Invalid comparison: ${expr}`);
  const op = m[1];
  const rhs = Number(m[2]);
  switch (op) {
    case '>':
      return value > rhs;
    case '<':
      return value < rhs;
    case '>=':
      return value >= rhs;
    case '<=':
      return value <= rhs;
    case '==':
      return value === rhs;
    default:
      throw new Error(`Invalid comparison: ${expr}`);
  }
}

export type AffordanceCheck = { ok: true } | { ok: false; reason: string };

export function checkAffordance(
  def: AffordanceDef,
  obj: SmartObjectInstance,
  actor: ActorContext
): AffordanceCheck {
  const pre = def.preconditions;
  if (pre === undefined) return { ok: true };

  if (pre.objectState !== undefined) {
    for (const [field, expr] of Object.entries(pre.objectState)) {
      const value = obj.state[field] ?? 0;
      if (!compare(value, expr)) {
        return { ok: false, reason: `objectState.${field} (${value}) fails ${expr}` };
      }
    }
  }

  if (pre.actorDistance !== undefined) {
    const dx = actor.x - obj.x;
    const dz = actor.z - obj.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (!compare(dist, pre.actorDistance)) {
      return { ok: false, reason: `actorDistance (${dist.toFixed(2)}) fails ${pre.actorDistance}` };
    }
  }

  if (pre.actorInventory !== undefined) {
    for (const [item, expr] of Object.entries(pre.actorInventory)) {
      const count = actor.inventory[item] ?? 0;
      if (!compare(count, expr)) {
        return { ok: false, reason: `actorInventory.${item} (${count}) fails ${expr}` };
      }
    }
  }

  return { ok: true };
}

export function applyAffordance(
  def: AffordanceDef,
  obj: SmartObjectInstance,
  actor: ActorContext
): void {
  if (def.effects.object !== undefined) {
    for (const [field, delta] of Object.entries(def.effects.object)) {
      obj.state[field] = Math.max(0, (obj.state[field] ?? 0) + delta);
    }
  }
  if (def.effects.actorInventory !== undefined) {
    for (const [item, delta] of Object.entries(def.effects.actorInventory)) {
      actor.inventory[item] = Math.max(0, (actor.inventory[item] ?? 0) + delta);
    }
  }
}
