/**
 * Agent needs = LeCun intrinsic cost (spec §5, §6.3). 100 = satisfied
 * (except stress: 0 = calm). Decay is per 100 ms tick; rates are tuned for
 * a 2400-tick day: ~2 meals/day, one night ruins warmth without a fire.
 */
export type NeedId = 'hunger' | 'warmth' | 'energy' | 'affection' | 'stress';

export interface AgentNeeds {
  hunger: number;
  warmth: number;
  energy: number;
  affection: number;
  stress: number;
}

export function createDefaultNeeds(): AgentNeeds {
  return { hunger: 80, warmth: 80, energy: 80, affection: 80, stress: 10 };
}

export interface NeedContext {
  hour: number;
  isMoving: boolean;
  nearLitFire: boolean;
  isSleeping: boolean;
}

export function isNightHour(hour: number): boolean {
  return hour < 6 || hour >= 20;
}

export function clampNeed(v: number): number {
  return Math.min(100, Math.max(0, v));
}

export function decayNeeds(needs: AgentNeeds, ctx: NeedContext): void {
  needs.hunger = clampNeed(needs.hunger - (ctx.isMoving ? 0.03 : 0.02));
  needs.energy = clampNeed(needs.energy + (ctx.isSleeping ? 0.05 : ctx.isMoving ? -0.02 : -0.01));
  const warmthDelta = ctx.nearLitFire ? 0.15 : isNightHour(ctx.hour) ? -0.05 : -0.01;
  needs.warmth = clampNeed(needs.warmth + warmthDelta);
  needs.affection = clampNeed(needs.affection - 0.005);
  needs.stress = clampNeed(needs.stress - 0.02);
}

/** Quadratic urgency in [0, 1]. Stress is inverted (high stress = urgent). */
export function urgency(needs: AgentNeeds, id: NeedId): number {
  const v = needs[id];
  const deficit = id === 'stress' ? v : 100 - v;
  return (deficit / 100) ** 2;
}

const ALL_NEEDS: NeedId[] = ['hunger', 'warmth', 'energy', 'affection', 'stress'];

/** LeCun intrinsic cost: what Mode-1 minimizes by reflex, Mode-2 by rollout. */
export function wellbeingCost(needs: AgentNeeds): number {
  return ALL_NEEDS.reduce((sum, id) => sum + urgency(needs, id), 0);
}

/** The single most pressing drive — Mode-1/Mode-2 arbitration reads this. */
export function maxUrgency(needs: AgentNeeds): number {
  return ALL_NEEDS.reduce((max, id) => Math.max(max, urgency(needs, id)), 0);
}
