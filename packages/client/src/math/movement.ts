/**
 * The single movement integration step, isolated as a pure function.
 *
 * This exists as its own module for one reason: it is the formula the client
 * predicts with *and* the formula the server re-simulates with, and the two
 * must agree exactly. `IwsdkPhoenix.Physics.Kinematic.integrate/6` is its
 * Elixir twin, and `fixtures/protocol_vectors.tsv` pins them together with
 * golden vectors that both test suites read.
 *
 * If a prediction is correct the player never sees a correction; a divergence
 * here would instead produce a permanent stream of small snaps that are
 * miserable to diagnose from the outside. Keeping the arithmetic in one
 * reviewable place is the cheapest defence against that.
 */

/** Result of one integration step. */
export interface MovementStep {
  x: number;
  z: number;
}

/**
 * Clamp a movement vector into the unit disc.
 *
 * Clamping each axis independently to `[-1, 1]` still permits `{1, 1}`, whose
 * magnitude is `sqrt(2)` — the classic diagonal speed exploit, worth a 41%
 * advantage to anyone holding two directions at once.
 *
 * Mirrors `IwsdkPhoenix.Physics.Kinematic.clamp_to_unit_disc/2`.
 */
export function clampToUnitDisc(x: number, y: number): [number, number] {
  const magnitude = Math.sqrt(x * x + y * y);
  return magnitude > 1 ? [x / magnitude, y / magnitude] : [x, y];
}

/**
 * Integrate one movement input in the player's yaw frame.
 *
 * @param x Current world X.
 * @param z Current world Z.
 * @param movementX Strafe axis, nominally `[-1, 1]`.
 * @param movementY Forward axis, nominally `[-1, 1]`.
 * @param yaw Player heading in radians.
 * @param deltaSeconds Timestep.
 * @param speed Metres per second.
 * @param maxDeltaMs Upper bound on the timestep; the server applies the same
 *   clamp to stop a client claiming one enormous frame.
 */
export function integrateMovement(
  x: number,
  z: number,
  movementX: number,
  movementY: number,
  yaw: number,
  deltaSeconds: number,
  speed: number,
  maxDeltaMs = 100,
): MovementStep {
  const [clampedX, clampedY] = clampToUnitDisc(movementX, movementY);
  const step = Math.min(deltaSeconds, maxDeltaMs / 1000);

  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);

  // Right/forward basis from yaw; movementY drives -Z, which is forward in
  // Three.js's right-handed, Y-up convention.
  const worldX = clampedX * cos + clampedY * sin;
  const worldZ = -clampedX * sin + clampedY * cos;

  return {
    x: x + worldX * speed * step,
    z: z - worldZ * speed * step,
  };
}
