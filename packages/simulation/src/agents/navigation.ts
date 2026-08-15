import { isRiverAt, WORLD_SIZE } from '../world/terrain';

/**
 * Step-based navigation on the analytic terrain (spec §6.4). Straight-line
 * steps at walk speed, half speed wading through the river, clamped to the
 * map. One call per 100 ms tick.
 */
export const WALK_SPEED = 1.4; // m/s
export const ARRIVE_RADIUS = 0.3;

const HALF_WORLD = WORLD_SIZE / 2;

export function stepToward(
  pos: { x: number; z: number },
  target: { x: number; z: number },
  dtSeconds = 0.1
): boolean {
  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= ARRIVE_RADIUS) return true;

  const speed = isRiverAt(pos.x, pos.z) ? WALK_SPEED / 2 : WALK_SPEED;
  const step = Math.min(dist, speed * dtSeconds);
  pos.x += (dx / dist) * step;
  pos.z += (dz / dist) * step;
  pos.x = Math.min(HALF_WORLD, Math.max(-HALF_WORLD, pos.x));
  pos.z = Math.min(HALF_WORLD, Math.max(-HALF_WORLD, pos.z));
  return Math.hypot(target.x - pos.x, target.z - pos.z) <= ARRIVE_RADIUS;
}
