/**
 * "Smallest three" quaternion compression: 128 bits -> 32 bits.
 *
 * A unit quaternion has only three degrees of freedom, so one component is
 * always recoverable from the other three. We drop the component with the
 * largest magnitude (the one whose reconstruction is numerically most stable)
 * and store its index in 2 bits, then store the remaining three components in
 * 10 bits each.
 *
 * Because `q` and `-q` describe the same rotation, we always flip the
 * quaternion so the dropped component is non-negative. That removes the need to
 * store its sign.
 *
 * ## Bit layout (little-endian `Uint32` on the wire)
 *
 * ```text
 *  bits 31..30 | bits 29..20 | bits 19..10 | bits 9..0
 *  largestIdx  |     c0      |     c1      |    c2
 * ```
 *
 * `c0..c2` are the surviving components in ascending component order (x, y, z,
 * w) with `largestIdx` skipped.
 *
 * ## Accuracy
 *
 * Each stored component covers `[-1/sqrt(2), +1/sqrt(2)]` in steps of
 * `1/sqrt(2)/511 ~= 0.00138`. Measured over 20,000 uniformly distributed random
 * rotations the worst-case angular error is ~0.21 degrees, and identity round
 * trips exactly. For reference, a Quest 3 pixel subtends roughly 0.05 degrees,
 * but that is the bound on *rotation of the avatar's own frame* — at a typical
 * 1 m viewing distance a 0.21 degree error displaces a hand by ~3.7 mm, well
 * inside the interpolation smoothing applied downstream.
 *
 * This module is mirrored byte-for-byte by
 * `IwsdkPhoenix.Protocol.Quantization` on the Elixir side.
 */

/** Maximum magnitude any non-largest component of a unit quaternion can have. */
export const SMALLEST_THREE_RANGE = Math.SQRT1_2; // 1 / sqrt(2)

/**
 * Half-range of the 10-bit code space.
 *
 * A component is stored as `round(v / RANGE * 511) + 512`, which spans codes
 * `[1, 1023]`. Deliberately giving up code `0` buys a mapping that is exactly
 * symmetric about zero, so an unrotated component encodes to 512 and decodes
 * back to exactly 0. That matters: identity is by far the most common rotation
 * on the wire, and a naive `round(t * 1023)` mapping over `[0, 1]` puts zero at
 * 511.5 — permanently off by half a step, which shows up as a visible ~0.14
 * degree bias on every idle remote avatar.
 */
const QUANT_SCALE = 511;

/** Code that represents an exact zero component. */
const QUANT_OFFSET = 512;

/** Quaternion expressed as a plain object. */
export interface QuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Compress a quaternion into a single unsigned 32-bit integer.
 *
 * The input does not need to be normalized; it is normalized internally. A
 * zero-length quaternion degrades to identity rather than producing `NaN`.
 */
export function compressQuaternion(q: QuaternionLike): number {
  let { x, y, z, w } = q;

  const lengthSq = x * x + y * y + z * z + w * w;
  if (lengthSq > 0) {
    const inv = 1 / Math.sqrt(lengthSq);
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

  const components = [x, y, z, w];

  let largestIndex = 0;
  let largestAbs = Math.abs(components[0] as number);
  for (let i = 1; i < 4; i++) {
    const abs = Math.abs(components[i] as number);
    if (abs > largestAbs) {
      largestAbs = abs;
      largestIndex = i;
    }
  }

  // Canonicalize the sign so the dropped component is always non-negative.
  const sign = (components[largestIndex] as number) < 0 ? -1 : 1;

  let packed = largestIndex * 2 ** 30;
  let shift = 20;
  for (let i = 0; i < 4; i++) {
    if (i === largestIndex) continue;
    const value = (components[i] as number) * sign;
    packed += quantizeComponent(value) * 2 ** shift;
    shift -= 10;
  }

  return packed >>> 0;
}

/**
 * Decompress a value produced by {@link compressQuaternion} back into a unit
 * quaternion. The result is always normalized.
 */
export function decompressQuaternion(packed: number): QuaternionLike {
  const value = packed >>> 0;

  const largestIndex = (value >>> 30) & 0b11;
  const raw = [(value >>> 20) & 0x3ff, (value >>> 10) & 0x3ff, value & 0x3ff];

  const components = [0, 0, 0, 0];
  let sumOfSquares = 0;
  let cursor = 0;

  for (let i = 0; i < 4; i++) {
    if (i === largestIndex) continue;
    const component = dequantizeComponent(raw[cursor++] as number);
    components[i] = component;
    sumOfSquares += component * component;
  }

  // The dropped component is non-negative by construction. Clamp before the
  // square root so accumulated quantization error can never yield NaN.
  components[largestIndex] = Math.sqrt(Math.max(0, 1 - sumOfSquares));

  const [x, y, z, w] = components as [number, number, number, number];

  // Re-normalize: quantization perturbs the length slightly.
  const length = Math.sqrt(x * x + y * y + z * z + w * w);
  if (length === 0) return { x: 0, y: 0, z: 0, w: 1 };

  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

/** Map `[-1/sqrt(2), +1/sqrt(2)]` onto the integer range `[1, 1023]`. */
function quantizeComponent(value: number): number {
  const scaled = Math.round((value / SMALLEST_THREE_RANGE) * QUANT_SCALE);
  const clamped =
    scaled < -QUANT_SCALE ? -QUANT_SCALE : scaled > QUANT_SCALE ? QUANT_SCALE : scaled;
  return clamped + QUANT_OFFSET;
}

/** Inverse of {@link quantizeComponent}. */
function dequantizeComponent(raw: number): number {
  return ((raw - QUANT_OFFSET) / QUANT_SCALE) * SMALLEST_THREE_RANGE;
}

/**
 * Angular difference between two quaternions in radians. Used by tests and by
 * {@link NetworkLODSystem}-style change detection.
 */
export function angleBetween(a: QuaternionLike, b: QuaternionLike): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  const clamped = dot > 1 ? 1 : dot < -1 ? -1 : dot;
  return 2 * Math.acos(clamped);
}
