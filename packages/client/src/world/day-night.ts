/**
 * The sun's position, as a pure function of world time.
 *
 * The mirror of `IwsdkPhoenix.World.DayNight`. Nothing about the day/night
 * cycle travels on the wire: both sides compute it from the same world time,
 * which costs zero bytes and means a client that reconnects after three days
 * is correct immediately with nothing to reconcile.
 *
 * The two implementations are pinned together by golden vectors in
 * `fixtures/protocol_vectors.tsv` — a shared formula, proven, which is the
 * pattern this package uses in place of shared binaries.
 */

/** Length of a full virtual day, in milliseconds. Two real hours. */
export const DEFAULT_CYCLE_MS = 7_200_000;

/** Fraction through the current day, `0..1`. */
export function timeOfDay(worldTimeMs: number, cycleMs = DEFAULT_CYCLE_MS): number {
  const cycle = usableCycle(cycleMs);
  return (Math.max(worldTimeMs, 0) % cycle) / cycle;
}

/** Sun angle in radians, `0` up to but not including `2π`. */
export function sunAngle(worldTimeMs: number, cycleMs = DEFAULT_CYCLE_MS): number {
  return timeOfDay(worldTimeMs, cycleMs) * 2 * Math.PI;
}

/** Sun height, `-1` (midnight) to `1` (noon). */
export function sunElevation(worldTimeMs: number, cycleMs = DEFAULT_CYCLE_MS): number {
  return Math.sin(sunAngle(worldTimeMs, cycleMs));
}

// A caller passing 0 wants the default, not a division by zero producing NaN
// and a black sky.
function usableCycle(cycleMs: number): number {
  return Number.isFinite(cycleMs) && cycleMs > 0 ? cycleMs : DEFAULT_CYCLE_MS;
}
