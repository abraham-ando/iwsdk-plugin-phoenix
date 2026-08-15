import { describe, it, expect } from 'vitest';
import {
  defaultIntrinsics,
  checkIntrinsic,
  applyIntrinsic,
  invTotal,
  INVENTORY_CAPACITY,
} from '../src/agents/intrinsics';

describe('intrinsic actions', () => {
  it('declares eat_berries, eat_fish and nap', () => {
    expect(defaultIntrinsics().map((i) => i.verb).sort()).toEqual(['eat_berries', 'eat_fish', 'nap']);
  });

  it('eat_berries requires berries and restores hunger', () => {
    const eat = defaultIntrinsics().find((i) => i.verb === 'eat_berries')!;
    expect(checkIntrinsic(eat, {}).ok).toBe(false);
    const inv = { berries: 2 };
    expect(checkIntrinsic(eat, inv).ok).toBe(true);
    const needs = { hunger: 50 };
    applyIntrinsic(eat, inv, needs);
    expect(inv.berries).toBe(1);
    expect(needs.hunger).toBe(80);
  });

  it('applyIntrinsic clamps needs at 100', () => {
    const eat = defaultIntrinsics().find((i) => i.verb === 'eat_berries')!;
    const needs = { hunger: 90 };
    applyIntrinsic(eat, { berries: 1 }, needs);
    expect(needs.hunger).toBe(100);
  });

  it('invTotal sums items and capacity is 10', () => {
    expect(invTotal({ berries: 3, wood: 2 })).toBe(5);
    expect(INVENTORY_CAPACITY).toBe(10);
  });
});
