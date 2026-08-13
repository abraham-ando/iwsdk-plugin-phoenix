/**
 * Small, allocation-free math helpers operating directly on the `Float32Array`
 * views handed out by `Entity.getVectorView`.
 *
 * Nothing here allocates: every function writes into a caller-owned view. That
 * matters because these run for every replicated entity on every one of the 90
 * frames per second a headset renders.
 */

/**
 * Any indexable, writable numeric buffer.
 *
 * `Entity.getVectorView` is typed as elics' `TypedArray` union rather than
 * `Float32Array` specifically, so accepting this structural type lets the views
 * be passed straight in without a cast at every call site. These functions
 * genuinely only need indexed read/write, so the wider type is also the more
 * truthful one.
 */
export interface MutableVector {
  [index: number]: number;
  readonly length: number;
}

/** Component-wise linear interpolation of two 3-vectors into `out`. */
export function lerpVec3(
  out: MutableVector,
  from: ArrayLike<number>,
  to: ArrayLike<number>,
  alpha: number,
): void {
  out[0] = (from[0] as number) + ((to[0] as number) - (from[0] as number)) * alpha;
  out[1] = (from[1] as number) + ((to[1] as number) - (from[1] as number)) * alpha;
  out[2] = (from[2] as number) + ((to[2] as number) - (from[2] as number)) * alpha;
}

/**
 * Spherical linear interpolation between two quaternions, written into `out`.
 *
 * Falls back to normalized linear interpolation when the inputs are nearly
 * parallel, where `sin(theta)` approaches zero and the spherical form loses
 * precision. Also flips the sign of `to` when the dot product is negative so
 * the interpolation always takes the short way around — without that, a remote
 * avatar occasionally spins 340 degrees to reach a pose 20 degrees away.
 */
export function slerpQuat(
  out: MutableVector,
  from: ArrayLike<number>,
  to: ArrayLike<number>,
  alpha: number,
): void {
  const ax = from[0] as number;
  const ay = from[1] as number;
  const az = from[2] as number;
  const aw = from[3] as number;

  let bx = to[0] as number;
  let by = to[1] as number;
  let bz = to[2] as number;
  let bw = to[3] as number;

  let cosom = ax * bx + ay * by + az * bz + aw * bw;

  if (cosom < 0) {
    cosom = -cosom;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  let scale0: number;
  let scale1: number;

  if (1 - cosom > 1e-6) {
    const omega = Math.acos(cosom);
    const sinom = Math.sin(omega);
    scale0 = Math.sin((1 - alpha) * omega) / sinom;
    scale1 = Math.sin(alpha * omega) / sinom;
  } else {
    scale0 = 1 - alpha;
    scale1 = alpha;
  }

  let x = scale0 * ax + scale1 * bx;
  let y = scale0 * ay + scale1 * by;
  let z = scale0 * az + scale1 * bz;
  let w = scale0 * aw + scale1 * bw;

  // Renormalize: the linear fallback above does not preserve unit length.
  const length = Math.sqrt(x * x + y * y + z * z + w * w);
  if (length > 0) {
    const inv = 1 / length;
    x *= inv;
    y *= inv;
    z *= inv;
    w *= inv;
  } else {
    x = 0;
    y = 0;
    z = 0;
    w = 1;
  }

  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
}

/** Squared distance between two 3-vectors; avoids a square root on hot paths. */
export function distanceSquared(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const dx = (a[0] as number) - (b[0] as number);
  const dy = (a[1] as number) - (b[1] as number);
  const dz = (a[2] as number) - (b[2] as number);
  return dx * dx + dy * dy + dz * dz;
}

/** Clamp `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
