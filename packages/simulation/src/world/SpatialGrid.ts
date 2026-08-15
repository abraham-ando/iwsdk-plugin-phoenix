/**
 * 2D hash grid over the ground plane (spec §4.2). Cells are 4 m by default;
 * queryRadius scans only the covered cells then filters by true euclidean
 * distance. Results are sorted by id so iteration order is deterministic.
 */
export class SpatialGrid {
  private cells = new Map<string, Set<string>>();
  private positions = new Map<string, { x: number; z: number }>();

  constructor(private cellSize: number = 4) {}

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  insert(id: string, x: number, z: number): void {
    if (this.positions.has(id)) {
      throw new Error(`SpatialGrid.insert: duplicate id ${id}`);
    }
    this.positions.set(id, { x, z });
    const key = this.cellKey(x, z);
    let cell = this.cells.get(key);
    if (cell === undefined) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    cell.add(id);
  }

  move(id: string, x: number, z: number): void {
    this.remove(id);
    this.insert(id, x, z);
  }

  remove(id: string): void {
    const pos = this.positions.get(id);
    if (pos === undefined) return;
    this.positions.delete(id);
    const key = this.cellKey(pos.x, pos.z);
    const cell = this.cells.get(key);
    if (cell !== undefined) {
      cell.delete(id);
      if (cell.size === 0) this.cells.delete(key);
    }
  }

  positionOf(id: string): { x: number; z: number } | undefined {
    const pos = this.positions.get(id);
    return pos === undefined ? undefined : { x: pos.x, z: pos.z };
  }

  queryRadius(x: number, z: number, radius: number): string[] {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCz = Math.floor((z - radius) / this.cellSize);
    const maxCz = Math.floor((z + radius) / this.cellSize);
    const r2 = radius * radius;
    const found: string[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const cell = this.cells.get(`${cx},${cz}`);
        if (cell === undefined) continue;
        for (const id of cell) {
          const pos = this.positions.get(id);
          if (pos === undefined) continue;
          const dx = pos.x - x;
          const dz = pos.z - z;
          if (dx * dx + dz * dz <= r2) found.push(id);
        }
      }
    }
    return found.sort();
  }
}
