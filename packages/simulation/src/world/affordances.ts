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

function checkFields(
  scope: string,
  values: Record<string, number>,
  conditions: Record<string, Comparison>
): AffordanceCheck {
  for (const [field, expr] of Object.entries(conditions)) {
    const value = values[field] ?? 0;
    if (!compare(value, expr)) {
      return { ok: false, reason: `${scope}.${field} (${value}) fails ${expr}` };
    }
  }
  return { ok: true };
}

export function checkAffordance(
  def: AffordanceDef,
  obj: SmartObjectInstance,
  actor: ActorContext
): AffordanceCheck {
  const pre = def.preconditions;
  if (pre === undefined) return { ok: true };

  if (pre.objectState !== undefined) {
    const res = checkFields('objectState', obj.state, pre.objectState);
    if (!res.ok) return res;
  }

  if (pre.actorDistance !== undefined) {
    const dist = Math.hypot(actor.x - obj.x, actor.z - obj.z);
    if (!compare(dist, pre.actorDistance)) {
      return { ok: false, reason: `actorDistance (${dist.toFixed(2)}) fails ${pre.actorDistance}` };
    }
  }

  if (pre.actorInventory !== undefined) {
    const res = checkFields('actorInventory', actor.inventory, pre.actorInventory);
    if (!res.ok) return res;
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
