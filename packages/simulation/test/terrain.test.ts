import { describe, it, expect } from 'vitest';
import { WORLD_SIZE, getTerrainHeight, isRiverAt, isShoreAt } from '../src/world/terrain';

describe('analytic terrain', () => {
  it('world is 64 m wide', () => {
    expect(WORLD_SIZE).toBe(64);
  });

  it('keeps the central settlement plateau perfectly flat at y=0', () => {
    // Plateau: radius 5 around (0, -2.5) — spec inherited from ProceduralTerrain.
    expect(getTerrainHeight(0, -2.5)).toBe(0);
    expect(getTerrainHeight(2, 0)).toBe(0);
    expect(getTerrainHeight(-3, -4)).toBe(0);
  });

  it('is non-negative and finite across the map', () => {
    for (let x = -32; x <= 32; x += 2) {
      for (let z = -32; z <= 32; z += 2) {
        const y = getTerrainHeight(x, z);
        expect(Number.isFinite(y)).toBe(true);
        expect(y).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is continuous (no cliffs over a 10 cm step)', () => {
    for (let x = -30; x <= 30; x += 1.7) {
      for (let z = -30; z <= 30; z += 1.7) {
        const dy = Math.abs(getTerrainHeight(x + 0.1, z) - getTerrainHeight(x, z));
        expect(dy).toBeLessThan(1);
      }
    }
  });

  it('marks the riverbed and the shore consistently', () => {
    // River center at z=0 is x = 4.0 + sin(0)*3.5 = 4.0.
    expect(isRiverAt(4.0, 0)).toBe(true);
    expect(isShoreAt(4.0, 0)).toBe(false);
    expect(isRiverAt(4.0 + 3.0, 0)).toBe(false);
    expect(isShoreAt(4.0 + 3.0, 0)).toBe(true);
    expect(isRiverAt(20, 0)).toBe(false);
    expect(isShoreAt(20, 0)).toBe(false);
  });
});
