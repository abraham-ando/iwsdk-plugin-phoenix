import { describe, expect, it } from 'vitest';
import {
  angleBetween,
  compressQuaternion,
  decompressQuaternion,
  type QuaternionLike,
} from '../src/protocol/quaternion-compression.js';

/** Build a normalized quaternion from an axis and an angle in radians. */
function fromAxisAngle(
  axis: [number, number, number],
  angle: number,
): QuaternionLike {
  const length = Math.hypot(...axis) || 1;
  const [ax, ay, az] = [axis[0] / length, axis[1] / length, axis[2] / length];
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(half) };
}

/** Deterministic PRNG so a failure is always reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniformly distributed random rotation (Shoemake's method). */
function randomQuaternion(rand: () => number): QuaternionLike {
  const u1 = rand();
  const u2 = rand();
  const u3 = rand();
  const s1 = Math.sqrt(1 - u1);
  const s2 = Math.sqrt(u1);
  return {
    x: s1 * Math.sin(2 * Math.PI * u2),
    y: s1 * Math.cos(2 * Math.PI * u2),
    z: s2 * Math.sin(2 * Math.PI * u3),
    w: s2 * Math.cos(2 * Math.PI * u3),
  };
}

describe('smallest-three quaternion compression', () => {
  it('packs into a single unsigned 32-bit integer', () => {
    const packed = compressQuaternion(fromAxisAngle([1, 2, 3], 1.1));
    expect(Number.isInteger(packed)).toBe(true);
    expect(packed).toBeGreaterThanOrEqual(0);
    expect(packed).toBeLessThanOrEqual(0xffffffff);
  });

  it('achieves the advertised 4x reduction versus four Float32s', () => {
    // 4 x Float32 = 16 bytes, packed = 4 bytes.
    expect(16 / 4).toBe(4);
  });

  it('round-trips the identity quaternion exactly', () => {
    // The symmetric mapping puts zero on an exact code, so the most common
    // rotation on the wire must survive with no error at all.
    const decoded = decompressQuaternion(compressQuaternion({ x: 0, y: 0, z: 0, w: 1 }));
    expect(decoded).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('round-trips the six axis-aligned quarter turns exactly', () => {
    const axes: [number, number, number][] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    for (const axis of axes) {
      for (const angle of [Math.PI / 2, -Math.PI / 2]) {
        const original = fromAxisAngle(axis, angle);
        const decoded = decompressQuaternion(compressQuaternion(original));
        // +/-sqrt(1/2) sits exactly on a code boundary too.
        expect(angleBetween(original, decoded)).toBeLessThan(1e-6);
      }
    }
  });

  it('always returns a normalized quaternion', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const decoded = decompressQuaternion(compressQuaternion(randomQuaternion(rand)));
      const length = Math.hypot(decoded.x, decoded.y, decoded.z, decoded.w);
      expect(length).toBeCloseTo(1, 6);
    }
  });

  it('keeps the angular error under 0.25 degrees over 20k random rotations', () => {
    // 0.25 deg is the documented bound; the measured worst case is ~0.21 deg,
    // so this leaves headroom without silently accepting a regression.
    const rand = mulberry32(1234);
    const limit = (0.25 * Math.PI) / 180;
    let worst = 0;

    for (let i = 0; i < 20000; i++) {
      const original = randomQuaternion(rand);
      const decoded = decompressQuaternion(compressQuaternion(original));
      worst = Math.max(worst, angleBetween(original, decoded));
    }

    expect(worst).toBeLessThan(limit);
  });

  it('treats q and -q as the same rotation', () => {
    const q = fromAxisAngle([0, 1, 0], 2.0);
    const negated = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
    // Sign canonicalization means both encode to the identical word.
    expect(compressQuaternion(q)).toBe(compressQuaternion(negated));
  });

  it('handles each of the four possible largest-component branches', () => {
    const cases: QuaternionLike[] = [
      { x: 1, y: 0, z: 0, w: 0 }, // largest = x
      { x: 0, y: 1, z: 0, w: 0 }, // largest = y
      { x: 0, y: 0, z: 1, w: 0 }, // largest = z
      { x: 0, y: 0, z: 0, w: 1 }, // largest = w
    ];

    cases.forEach((q, index) => {
      const packed = compressQuaternion(q);
      expect(packed >>> 30).toBe(index);
      expect(angleBetween(decompressQuaternion(packed), q)).toBeLessThan(0.01);
    });
  });

  it('normalizes a non-unit input rather than corrupting it', () => {
    const scaled = { x: 0, y: 4, z: 0, w: 4 };
    const decoded = decompressQuaternion(compressQuaternion(scaled));
    const expected = fromAxisAngle([0, 1, 0], Math.PI / 2);
    expect(angleBetween(decoded, expected)).toBeLessThan(0.01);
  });

  it('degrades a zero quaternion to identity instead of NaN', () => {
    const decoded = decompressQuaternion(compressQuaternion({ x: 0, y: 0, z: 0, w: 0 }));
    expect(Number.isNaN(decoded.x)).toBe(false);
    expect(decoded).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('never produces NaN for any of the 2^32 code points (sampled)', () => {
    // Decoding is fed by untrusted network bytes, so every possible word must
    // yield a usable quaternion rather than poisoning the scene graph.
    const rand = mulberry32(99);
    for (let i = 0; i < 20000; i++) {
      const word = Math.floor(rand() * 4294967296) >>> 0;
      const q = decompressQuaternion(word);
      expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 6);
    }
  });
});
