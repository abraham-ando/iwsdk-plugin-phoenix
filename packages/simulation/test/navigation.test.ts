import { describe, it, expect } from 'vitest';
import { stepToward, WALK_SPEED, ARRIVE_RADIUS } from '../src/agents/navigation';

describe('stepToward', () => {
  it('moves at walk speed toward the target and arrives', () => {
    const pos = { x: -10, z: -10 };            // plateau area, far from river
    const target = { x: -10, z: -8 };          // 2 m away
    let steps = 0;
    while (!stepToward(pos, target) && steps < 300) steps++;
    // 2 m at 1.4 m/s with 0.1 s ticks ≈ 15 ticks.
    expect(steps).toBeGreaterThan(5);
    expect(steps).toBeLessThan(30);
    expect(Math.hypot(pos.x - target.x, pos.z - target.z)).toBeLessThanOrEqual(ARRIVE_RADIUS);
  });

  it('is immediately arrived when already close', () => {
    const pos = { x: 0, z: 0 };
    expect(stepToward(pos, { x: 0.1, z: 0 })).toBe(true);
  });

  it('wades slower through the river', () => {
    // River center at z=0 is x=4. Start in the riverbed.
    const inRiver = { x: 4, z: 0 };
    const onLand = { x: -10, z: -10 };
    stepToward(inRiver, { x: 4, z: 10 });
    stepToward(onLand, { x: -10, z: 0 });
    const riverStep = Math.abs(inRiver.z - 0);
    const landStep = Math.abs(onLand.z - -10);
    expect(riverStep).toBeCloseTo(landStep / 2, 5);
    expect(WALK_SPEED).toBe(1.4);
  });

  it('clamps to world bounds', () => {
    const pos = { x: 199.9, z: -15 };          // heading out of the 400 m map
    for (let i = 0; i < 100; i++) stepToward(pos, { x: 400, z: -15 });
    expect(pos.x).toBeLessThanOrEqual(200);
  });
});
