import { describe, expect, it } from 'vitest';
import { RingBuffer, isSharedMemoryAvailable } from '../src/transport/RingBuffer.js';

const bytes = (...values: number[]) => new Uint8Array(values);

/** Deterministic PRNG for the fuzz case. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('RingBuffer', () => {
  it('reports shared memory availability in this environment', () => {
    expect(isSharedMemoryAvailable()).toBe(true);
  });

  it('round-trips a single record', () => {
    const ring = RingBuffer.create(1024);
    expect(ring.isEmpty).toBe(true);

    expect(ring.push(bytes(1, 2, 3, 4, 5))).toBe(true);
    expect(ring.isEmpty).toBe(false);

    expect(ring.pop()).toEqual(bytes(1, 2, 3, 4, 5));
    expect(ring.isEmpty).toBe(true);
    expect(ring.pop()).toBeNull();
  });

  it('preserves FIFO order', () => {
    const ring = RingBuffer.create(1024);
    for (let i = 1; i <= 10; i++) ring.push(bytes(i, i, i));

    for (let i = 1; i <= 10; i++) {
      expect(ring.pop()).toEqual(bytes(i, i, i));
    }
    expect(ring.pop()).toBeNull();
  });

  it('handles unaligned record lengths', () => {
    const ring = RingBuffer.create(1024);
    // 1, 2, 3 and 5 bytes all need different amounts of padding.
    for (const length of [1, 2, 3, 5, 7, 8]) {
      const payload = new Uint8Array(length).fill(length);
      expect(ring.push(payload)).toBe(true);
      expect(ring.pop()).toEqual(payload);
    }
  });

  it('wraps around the end of the data region', () => {
    // 64-byte region; a 20-byte payload costs 24 bytes per record, so the third
    // record cannot fit contiguously and must trigger the skip marker.
    const ring = RingBuffer.create(64);
    const payload = new Uint8Array(20).fill(9);

    for (let cycle = 0; cycle < 20; cycle++) {
      expect(ring.push(payload)).toBe(true);
      expect(ring.pop()).toEqual(payload);
    }

    expect(ring.dropped).toBe(0);
    expect(ring.isEmpty).toBe(true);
  });

  it('drops rather than blocking when full, and counts the drops', () => {
    const ring = RingBuffer.create(64);
    const payload = new Uint8Array(20).fill(1);

    let accepted = 0;
    for (let i = 0; i < 10; i++) if (ring.push(payload)) accepted++;

    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(10);
    expect(ring.dropped).toBe(10 - accepted);

    // Everything accepted must still be readable and intact.
    for (let i = 0; i < accepted; i++) expect(ring.pop()).toEqual(payload);
    expect(ring.pop()).toBeNull();
  });

  it('recovers capacity after draining', () => {
    const ring = RingBuffer.create(64);
    const payload = new Uint8Array(20).fill(3);

    while (ring.push(payload)) {
      /* fill */
    }
    ring.drain(() => {});
    expect(ring.isEmpty).toBe(true);
    expect(ring.push(payload)).toBe(true);
  });

  it('rejects a record larger than the ring itself', () => {
    const ring = RingBuffer.create(64);
    expect(ring.push(new Uint8Array(1000))).toBe(false);
    expect(ring.dropped).toBe(1);
    expect(ring.isEmpty).toBe(true);
  });

  it('ignores empty payloads', () => {
    const ring = RingBuffer.create(64);
    expect(ring.push(new Uint8Array(0))).toBe(false);
    expect(ring.isEmpty).toBe(true);
  });

  it('drains every pending record in one pass', () => {
    const ring = RingBuffer.create(4096);
    for (let i = 0; i < 50; i++) ring.push(new Uint8Array([i]));

    const seen: number[] = [];
    const count = ring.drain((record) => seen.push(record[0] as number));

    expect(count).toBe(50);
    expect(seen).toEqual([...Array(50).keys()]);
    expect(ring.isEmpty).toBe(true);
  });

  it('reuses a scratch buffer without allocating', () => {
    const ring = RingBuffer.create(1024);
    const scratch = new Uint8Array(256);

    ring.push(bytes(7, 8, 9));
    const record = ring.pop(scratch);

    expect(record).toEqual(bytes(7, 8, 9));
    // The returned view must be backed by the caller's scratch allocation.
    expect(record?.buffer).toBe(scratch.buffer);
  });

  it('shares state across two views of the same SharedArrayBuffer', () => {
    // This is exactly what happens across the worker boundary: the SAB is
    // posted once and each side attaches its own RingBuffer view.
    const producer = RingBuffer.create(1024);
    const consumer = RingBuffer.attach(producer.sab);

    producer.push(bytes(42, 43));
    expect(consumer.pop()).toEqual(bytes(42, 43));
    expect(producer.isEmpty).toBe(true);
  });

  it('survives an interleaved push/pop fuzz run without corruption', () => {
    const ring = RingBuffer.create(512);
    const rand = mulberry32(2024);

    const pending: number[][] = [];
    let nextId = 0;

    for (let step = 0; step < 20000; step++) {
      if (rand() < 0.5) {
        const length = 1 + Math.floor(rand() * 40);
        const id = nextId++ & 0xff;
        const payload = new Uint8Array(length).fill(id);
        if (ring.push(payload)) pending.push([id, length]);
      } else {
        const record = ring.pop();
        if (record) {
          const expected = pending.shift();
          expect(expected).toBeDefined();
          const [id, length] = expected as [number, number];
          expect(record.byteLength).toBe(length);
          // Every byte must carry the id: proves no record bled into another.
          expect(record.every((b) => b === id)).toBe(true);
        } else {
          expect(pending).toHaveLength(0);
        }
      }
    }

    // Drain the remainder and confirm it still matches, in order.
    ring.drain((record) => {
      const [id, length] = pending.shift() as [number, number];
      expect(record.byteLength).toBe(length);
      expect(record.every((b) => b === id)).toBe(true);
    });
    expect(pending).toHaveLength(0);
  });

  it('clears back to an empty state', () => {
    const ring = RingBuffer.create(256);
    ring.push(bytes(1, 2, 3));
    ring.clear();
    expect(ring.isEmpty).toBe(true);
    expect(ring.dropped).toBe(0);
  });
});
