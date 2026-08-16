import { describe, it, expect } from 'vitest';
import { DEFAULT_VILLAGE, buildVillageSim } from '../src/content/scenario';
import { TICKS_PER_DAY } from '../src/kernel/SimKernel';
import { snapshotSim } from '../src/kernel/snapshot';

describe('default village scenario', () => {
  it('declares 11 agents with personas, 21 objects and 4 places', () => {
    expect(DEFAULT_VILLAGE.agents).toHaveLength(11);
    expect(DEFAULT_VILLAGE.agents.every((a) => a.persona.length > 0)).toBe(true);
    expect(DEFAULT_VILLAGE.objects).toHaveLength(23);
    expect(DEFAULT_VILLAGE.objects.filter((o) => o.type === 'campfire')).toHaveLength(3);
    expect(DEFAULT_VILLAGE.places.map((p) => p.name)).toContain('camp_aube');
  });

  it('buildVillageSim wires a living deterministic village', () => {
    const a = buildVillageSim(42);
    const b = buildVillageSim(42);
    expect(a.runtime.agents.size).toBe(11);
    // Fires start lit, like the demo.
    const fires = a.world.objectsNear(0, 0, 1000).filter((o) => o.type === 'campfire');
    expect(fires.every((f) => f.state.lit === 1)).toBe(true);
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      a.kernel.step();
      b.kernel.step();
    }
    expect(snapshotSim(a.kernel, a.world, a.runtime, a.weather)).toEqual(
      snapshotSim(b.kernel, b.world, b.runtime, b.weather)
    );
  });
});
