/**
 * Where each peer stands when it joins.
 *
 * Without this every client starts at the scene's authored camera position, so
 * all peers occupy the same point — each avatar sits exactly inside the other
 * viewer's head, and the room looks empty however many people are in it. The
 * network is working; you simply cannot see it.
 *
 * The placement has to be derived from the network id rather than negotiated,
 * because every client computes its own spawn independently and no two may land
 * on the same spot. Ids come from the room's allocator and count up from 1.
 */

/** A place to stand, in world space. The scene's floor is at y = 0. */
export interface SpawnPoint {
  x: number;
  z: number;
  /** Facing, in radians. 0 looks down -Z, matching Three's convention. */
  yaw: number;
}

/**
 * The point the scene is built around — the desk, its plant and the robot sit
 * here, and the authored camera looks at it. Spawns should face this.
 */
export const FOCAL_POINT = { x: 0, z: -1.8 };

/** The golden angle, in radians: `π(3 − √5)`. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Radius of the innermost spawn, in metres.
 *
 * The desk spans x ∈ [-1, 1], z ∈ [-2.6, -1] — a box centred exactly on
 * {@link FOCAL_POINT}, whose farthest corner is √(1² + 0.8²) ≈ 1.28 m away. Any
 * point at least that far from the focal point is outside the box, so holding
 * every spawn beyond this radius keeps them all off the desk with no rectangle
 * test at all. The margin over 1.28 is what stops peers standing nose to wood.
 */
const INNER_RADIUS = 2;

/**
 * Density control, in metres: each peer is given `π · SPACING²` of floor.
 *
 * Not the gap between neighbours, which is the number you actually care about
 * and is larger — a spiral packs better than a grid of this pitch. At 1.2 the
 * measured closest approach is **1.98 m**, and it stays there: the tightest
 * pair is the same one whether the room holds sixteen peers or a thousand, so
 * this is a floor on separation rather than an average. Raise it and the room
 * spreads out; the off-desk guarantee below is unaffected either way.
 */
const SPACING = 1.2;

/**
 * Spawns must stay in front of this z, in world space.
 *
 * The desk's back edge is at z = -2.6, and the environment's backdrop wall
 * stands immediately behind it. Staying off the desk is not enough: a peer
 * placed beyond the wall faces its back side and sees an empty grey slab, which
 * looks far more broken than sharing a spot would. Found by running the demo
 * with three clients — peer #2 landed at z = -3.52 and saw nothing at all.
 */
const BACK_LIMIT = -2.6;

/**
 * How far along the spiral to look before giving up.
 *
 * Roughly half of all candidates fall behind {@link BACK_LIMIT}, so the search
 * needs about twice the index it is looking for; the rest is slack. Reaching
 * the cap would need a room of hundreds, and the fallback below is still a
 * legal spawn, so this bounds the loop without introducing a failure case.
 */
const MAX_PROBE = 4096;

/**
 * Choose a spawn point for `networkId`.
 *
 * A sunflower (Vogel) spiral around {@link FOCAL_POINT}: each successive id
 * turns by the golden angle and steps outward just far enough to hold the area
 * per peer constant. Because the golden angle is irrationally related to a full
 * turn no two ids share a ray, and the radial growth keeps every pair at least
 * 1.98 m apart however many join. Nobody gets a hand-composed view of the desk
 * — that is the price of never colliding — but everyone faces it and everyone
 * can see everyone.
 *
 * Pure in `networkId`, which is the property that makes it safe: every client
 * runs this for itself and they never compare notes, so the answer may depend
 * on nothing else.
 */
export function spawnPointFor(networkId: number): SpawnPoint {
  // Ids from the room's allocator count up from 1; the spiral counts from 0.
  const wanted = Math.max(0, networkId - 1);

  let found = -1;
  let last = point(0);
  for (let n = 0; n < MAX_PROBE; n++) {
    last = point(n);
    if (last.z < BACK_LIMIT) continue;
    if (++found === wanted) return last;
  }
  // Unreachable for any plausible room; a real point rather than a special case.
  return last;
}

/** The `n`-th point of the raw spiral, before the region test. */
function point(n: number): SpawnPoint {
  // Wrapped only to keep the yaw readable in a debugger; sin and cos below do
  // not care, and neither does Three.
  const angle = (n * GOLDEN_ANGLE) % (2 * Math.PI);
  const radius = Math.sqrt(INNER_RADIUS ** 2 + n * SPACING ** 2);

  // Placing with (sin, cos) about the focal point makes the yaw fall out as
  // `angle` itself: the offset is r·(sin θ, cos θ), and Three's forward at yaw
  // θ is (−sin θ, −cos θ) — its exact opposite, i.e. pointing back at the desk.
  // Deriving the yaw separately would only be a chance to get the sign wrong.
  return {
    x: FOCAL_POINT.x + radius * Math.sin(angle),
    z: FOCAL_POINT.z + radius * Math.cos(angle),
    yaw: angle,
  };
}
