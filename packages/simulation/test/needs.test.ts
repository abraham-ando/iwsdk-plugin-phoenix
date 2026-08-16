import { describe, it, expect } from 'vitest';
import {
  createDefaultNeeds,
  decayNeeds,
  urgency,
  maxUrgency,
  wellbeingCost,
  isNightHour,
  clampNeed,
} from '../src/agents/needs';

describe('needs', () => {
  it('night hours span 20h-6h', () => {
    expect(isNightHour(2)).toBe(true);
    expect(isNightHour(6)).toBe(false);
    expect(isNightHour(12)).toBe(false);
    expect(isNightHour(20)).toBe(true);
  });

  it('hunger decays faster while moving', () => {
    const still = createDefaultNeeds();
    const moving = createDefaultNeeds();
    const day = { hour: 12, isMoving: false, nearLitFire: false, isSleeping: false };
    decayNeeds(still, day);
    decayNeeds(moving, { ...day, isMoving: true });
    expect(still.hunger).toBeLessThan(80);
    expect(moving.hunger).toBeLessThan(still.hunger);
  });

  it('warmth drops at night but recovers near a lit fire', () => {
    const cold = createDefaultNeeds();
    const warm = createDefaultNeeds();
    const night = { hour: 23, isMoving: false, nearLitFire: false, isSleeping: false };
    decayNeeds(cold, night);
    decayNeeds(warm, { ...night, nearLitFire: true });
    expect(cold.warmth).toBeLessThan(80);
    expect(warm.warmth).toBeGreaterThan(80);
  });

  it('energy recovers only while sleeping', () => {
    const awake = createDefaultNeeds();
    const asleep = createDefaultNeeds();
    const day = { hour: 12, isMoving: false, nearLitFire: false, isSleeping: false };
    decayNeeds(awake, day);
    decayNeeds(asleep, { ...day, isSleeping: true });
    expect(awake.energy).toBeLessThan(80);
    expect(asleep.energy).toBeGreaterThan(80);
  });

  it('stress relaxes toward zero over time', () => {
    const needs = createDefaultNeeds();
    needs.stress = 50;
    decayNeeds(needs, { hour: 12, isMoving: false, nearLitFire: false, isSleeping: false });
    expect(needs.stress).toBeLessThan(50);
  });

  it('urgency is quadratic: a starving agent dwarfs a peckish one', () => {
    const needs = createDefaultNeeds();
    needs.hunger = 90;
    const low = urgency(needs, 'hunger');
    needs.hunger = 10;
    const high = urgency(needs, 'hunger');
    expect(high).toBeGreaterThan(low * 10);
    // Stress is inverted: high stress = high urgency.
    needs.stress = 90;
    expect(urgency(needs, 'stress')).toBeGreaterThan(0.5);
  });

  it('maxUrgency returns the dominant drive', () => {
    const needs = createDefaultNeeds();
    needs.warmth = 10;
    expect(maxUrgency(needs)).toBeCloseTo(urgency(needs, 'warmth'));
  });

  it('wellbeingCost sums urgencies and clampNeed bounds values', () => {
    const perfect = { hunger: 100, warmth: 100, energy: 100, affection: 100, stress: 0 };
    expect(wellbeingCost(perfect)).toBe(0);
    const bad = { hunger: 0, warmth: 0, energy: 0, affection: 0, stress: 100 };
    expect(wellbeingCost(bad)).toBe(5);
    expect(clampNeed(150)).toBe(100);
    expect(clampNeed(-5)).toBe(0);
  });
});
