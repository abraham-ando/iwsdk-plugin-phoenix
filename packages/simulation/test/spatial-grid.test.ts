import { describe, it, expect } from 'vitest';
import { SpatialGrid } from '../src/world/SpatialGrid';

describe('SpatialGrid', () => {
  it('finds only entities within the radius, sorted by id', () => {
    const grid = new SpatialGrid(4);
    grid.insert('bush_b', 1, 0);
    grid.insert('bush_a', 2, 0);
    grid.insert('far_tree', 30, 30);
    expect(grid.queryRadius(0, 0, 5)).toEqual(['bush_a', 'bush_b']);
    expect(grid.queryRadius(0, 0, 1.5)).toEqual(['bush_b']);
    expect(grid.queryRadius(30, 30, 1)).toEqual(['far_tree']);
  });

  it('finds entities across cell boundaries', () => {
    const grid = new SpatialGrid(4);
    grid.insert('edge', 3.9, 0);      // cell (0,0)
    expect(grid.queryRadius(4.1, 0, 1)).toEqual(['edge']); // query from cell (1,0)
  });

  it('supports negative coordinates', () => {
    const grid = new SpatialGrid(4);
    grid.insert('west', -10, -10);
    expect(grid.queryRadius(-9, -9, 2)).toEqual(['west']);
  });

  it('move relocates an entity', () => {
    const grid = new SpatialGrid(4);
    grid.insert('walker', 0, 0);
    grid.move('walker', 20, 20);
    expect(grid.queryRadius(0, 0, 5)).toEqual([]);
    expect(grid.queryRadius(20, 20, 1)).toEqual(['walker']);
    expect(grid.positionOf('walker')).toEqual({ x: 20, z: 20 });
  });

  it('remove deletes an entity; duplicate insert throws', () => {
    const grid = new SpatialGrid(4);
    grid.insert('tmp', 0, 0);
    grid.remove('tmp');
    expect(grid.queryRadius(0, 0, 5)).toEqual([]);
    expect(grid.positionOf('tmp')).toBeUndefined();
    grid.insert('dup', 0, 0);
    expect(() => grid.insert('dup', 1, 1)).toThrow('SpatialGrid.insert: duplicate id dup');
  });
});
