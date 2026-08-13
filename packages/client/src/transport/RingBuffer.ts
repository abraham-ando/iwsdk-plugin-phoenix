/**
 * Lock-free single-producer/single-consumer byte ring over a `SharedArrayBuffer`.
 *
 * The network worker is the sole producer and the render thread is the sole
 * consumer, which is what makes a lock-free design correct here: with exactly
 * one writer and one reader, `readPos` and `writePos` each have a single owner,
 * so a pair of atomic loads/stores is enough to publish progress safely.
 *
 * ## Why not just `postMessage`?
 *
 * `postMessage` with a transferable is already zero-copy for the *payload*, but
 * it allocates a message object per frame and delivers it as a task on the main
 * thread's event loop. At 30 Hz per entity across dozens of entities that is
 * thousands of tasks per second competing with rendering, and the resulting GC
 * churn is exactly what produces the micro-stutter that is fatal at 90 FPS in
 * VR. Draining a ring buffer once per frame replaces all of it with a bounded,
 * allocation-free read.
 *
 * The consumer never calls `Atomics.wait` — that would block the render thread
 * and is forbidden on the main thread anyway. It polls once per frame, which is
 * the natural cadence for a render loop.
 *
 * ## Layout
 *
 * ```text
 * bytes 0..15   Int32 header: [readPos, writePos, dropped, capacity]
 * bytes 16..    data region (capacity bytes)
 * ```
 *
 * Every record is `[Int32 length][payload][padding to 4 bytes]`. A length of
 * {@link SKIP_MARKER} means "the tail is too short for the next record, resume
 * from the start of the data region". Keeping all offsets 4-byte aligned
 * guarantees there is always room for a skip marker at the tail.
 */

const HEADER_SLOTS = 4;
const HEADER_BYTES = HEADER_SLOTS * 4;

const READ_POS = 0;
const WRITE_POS = 1;
const DROPPED = 2;
const CAPACITY = 3;

/** Sentinel length meaning "wrap to the start of the data region". */
const SKIP_MARKER = -1;

/** Ring positions are kept 4-byte aligned so an Int32 header always fits. */
const align4 = (n: number): number => (n + 3) & ~3;

/** True when the current context can allocate a `SharedArrayBuffer`. */
export function isSharedMemoryAvailable(): boolean {
  return (
    typeof SharedArrayBuffer !== 'undefined' &&
    // Cross-origin isolation (COOP + COEP) is required before browsers hand out
    // a functioning SharedArrayBuffer. `crossOriginIsolated` is undefined in
    // Node, where SharedArrayBuffer is always usable.
    (typeof globalThis.crossOriginIsolated === 'undefined' ||
      globalThis.crossOriginIsolated)
  );
}

export class RingBuffer {
  private readonly header: Int32Array;
  private readonly data: Uint8Array;
  private readonly dataView: DataView;
  private readonly capacity: number;

  private constructor(public readonly sab: SharedArrayBuffer) {
    this.header = new Int32Array(sab, 0, HEADER_SLOTS);
    this.capacity = this.header[CAPACITY] as number;
    this.data = new Uint8Array(sab, HEADER_BYTES, this.capacity);
    this.dataView = new DataView(sab, HEADER_BYTES, this.capacity);
  }

  /**
   * Allocate a new ring. `capacityBytes` is rounded up to a multiple of 4.
   *
   * @param capacityBytes Size of the data region. 1 MiB holds roughly 30k
   *   uncompressed transform records — several seconds of traffic for a busy
   *   room, which is far more slack than a once-per-frame drain needs.
   */
  static create(capacityBytes = 1024 * 1024): RingBuffer {
    const capacity = align4(capacityBytes);
    const sab = new SharedArrayBuffer(HEADER_BYTES + capacity);
    new Int32Array(sab, 0, HEADER_SLOTS)[CAPACITY] = capacity;
    return new RingBuffer(sab);
  }

  /** Attach to a ring allocated elsewhere and passed across a worker boundary. */
  static attach(sab: SharedArrayBuffer): RingBuffer {
    return new RingBuffer(sab);
  }

  /** Bytes currently occupied by unread records. */
  get used(): number {
    const readPos = Atomics.load(this.header, READ_POS);
    const writePos = Atomics.load(this.header, WRITE_POS);
    return (writePos - readPos + this.capacity) % this.capacity;
  }

  /** Bytes available to writers, excluding the 4-byte full/empty guard. */
  get available(): number {
    return this.capacity - this.used - 4;
  }

  /** Records discarded because the ring was full. */
  get dropped(): number {
    return Atomics.load(this.header, DROPPED);
  }

  /** True when there is nothing to read. */
  get isEmpty(): boolean {
    return (
      Atomics.load(this.header, READ_POS) === Atomics.load(this.header, WRITE_POS)
    );
  }

  /**
   * Producer side. Append one record.
   *
   * @returns `false` when the ring is full; the record is dropped and the
   *   {@link dropped} counter is incremented. Dropping is the right failure
   *   mode for a real-time transform stream — a stale snapshot has no value
   *   once a newer one exists, so back-pressure would only add latency.
   */
  push(payload: Uint8Array): boolean {
    const length = payload.byteLength;
    if (length === 0) return false;

    const recordSize = 4 + align4(length);
    // A record can never exceed the ring, guard so the maths below stays sane.
    if (recordSize > this.capacity - 4) {
      Atomics.add(this.header, DROPPED, 1);
      return false;
    }

    const writePos = Atomics.load(this.header, WRITE_POS);
    const readPos = Atomics.load(this.header, READ_POS);

    const used = (writePos - readPos + this.capacity) % this.capacity;
    const free = this.capacity - used - 4;

    const contiguous = this.capacity - writePos;
    // When the tail cannot hold the record we burn it with a skip marker, so
    // the true cost is the wasted tail plus the record itself.
    const needed = recordSize > contiguous ? contiguous + recordSize : recordSize;

    if (needed > free) {
      Atomics.add(this.header, DROPPED, 1);
      return false;
    }

    let cursor = writePos;
    if (recordSize > contiguous) {
      this.dataView.setInt32(cursor, SKIP_MARKER, true);
      cursor = 0;
    }

    this.dataView.setInt32(cursor, length, true);
    this.data.set(payload, cursor + 4);

    // Publish only after the payload is fully written: the consumer treats a
    // moved writePos as proof the bytes behind it are valid.
    Atomics.store(this.header, WRITE_POS, (cursor + recordSize) % this.capacity);
    return true;
  }

  /**
   * Consumer side. Read the next record.
   *
   * @param into Optional destination. When supplied and large enough the record
   *   is copied into it and a subarray is returned, avoiding an allocation per
   *   frame. Otherwise a fresh `Uint8Array` is allocated.
   * @returns The record, or `null` when the ring is empty.
   */
  pop(into?: Uint8Array): Uint8Array | null {
    let readPos = Atomics.load(this.header, READ_POS);
    const writePos = Atomics.load(this.header, WRITE_POS);

    if (readPos === writePos) return null;

    let length = this.dataView.getInt32(readPos, true);
    if (length === SKIP_MARKER) {
      readPos = 0;
      // The producer never emits a skip marker as the last record, so there is
      // always a real record waiting after the wrap.
      if (readPos === writePos) {
        Atomics.store(this.header, READ_POS, readPos);
        return null;
      }
      length = this.dataView.getInt32(readPos, true);
    }

    const start = readPos + 4;
    const result =
      into && into.byteLength >= length
        ? (into.set(this.data.subarray(start, start + length)), into.subarray(0, length))
        : this.data.slice(start, start + length);

    Atomics.store(
      this.header,
      READ_POS,
      (readPos + 4 + align4(length)) % this.capacity,
    );

    return result;
  }

  /**
   * Drain every pending record, invoking `handler` for each.
   *
   * The buffer handed to `handler` is only valid for the duration of the call
   * when `scratch` is reused — copy it if you need to retain it.
   *
   * @returns How many records were processed.
   */
  drain(handler: (record: Uint8Array) => void, scratch?: Uint8Array): number {
    let count = 0;
    for (;;) {
      const record = this.pop(scratch);
      if (record === null) break;
      handler(record);
      count++;
    }
    return count;
  }

  /** Reset the ring to empty. Only safe while neither side is mid-operation. */
  clear(): void {
    Atomics.store(this.header, READ_POS, 0);
    Atomics.store(this.header, WRITE_POS, 0);
    Atomics.store(this.header, DROPPED, 0);
  }
}
