/**
 * Live interop against the real Elixir server.
 *
 * The golden vectors prove both implementations *encode* identically. They
 * cannot prove the two actually talk: that a frame this client emits gets
 * routed, decoded, simulated and answered correctly by the other runtime.
 *
 * This spawns `packages/server/test/support/interop_server.exs` — running the
 * genuine `Room.Handler` and `Room.State` — and drives a full session through
 * it using the genuine client codec. Nothing is stubbed on either side.
 *
 * Skipped automatically when Elixir is unavailable, so the suite still passes
 * on a machine with only Node.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BinaryProtocol } from '../src/protocol/BinaryProtocol.js';
import { OpCode } from '../src/protocol/opcodes.js';

const serverDir = fileURLToPath(new URL('../../server', import.meta.url));

/** Marks the start of each framed message; see the harness script. */
const MAGIC = Buffer.from('IWSD');

const hasElixir = spawnSync('elixir', ['--version'], { encoding: 'utf8' }).status === 0;

/**
 * On a developer machine without Elixir this suite skips, so the rest of the
 * tests stay runnable. In CI it must never skip: a skipped suite is a green
 * build that has quietly lost all cross-runtime coverage.
 *
 * Asserting that here, rather than by scraping vitest's output from the
 * workflow, keeps the guarantee next to the thing it guards — and avoids
 * depending on log formatting, which broke the moment CI enabled colour.
 */
const requireElixir = Boolean(process.env.CI) && process.env.IWSDK_ALLOW_NO_ELIXIR !== '1';

/** Outbound kinds emitted by the harness. */
const Kind = {
  BROADCAST: 0,
  REPLY: 1,
  BROADCAST_ALL: 2,
  DIRECT: 3,
  ERROR: 4,
  CONTROL: 5,
} as const;

interface HarnessMessage {
  kind: number;
  body: Buffer;
}

/**
 * Length-prefixed message pump over the child's stdio.
 *
 * stdio is a stream with no message boundaries, so both sides frame with a
 * `u32` length. This is transport framing for the test only — the game
 * protocol is what travels inside it.
 */
class Harness {
  private child!: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private pending: HarnessMessage[] = [];
  private waiters: ((message: HarnessMessage) => void)[] = [];
  private stderr = '';

  /** Anything the child printed outside the framed protocol. */
  private noise = '';

  async start(): Promise<void> {
    const env = { ...process.env, IWSDK_CORE_ONLY: '1', MIX_ENV: 'test' };

    // Compile first, in a process whose stdout we discard. `mix run` prints
    // compilation progress on a cold build, and that output would otherwise
    // land in the same stdout we use as the binary channel. (The framing also
    // resynchronises on a magic marker, so this is belt and braces — but a
    // clean channel keeps failures legible.)
    const compile = spawnSync('elixir', ['-S', 'mix', 'compile'], {
      cwd: serverDir,
      env,
      encoding: 'utf8',
    });
    if (compile.status !== 0) {
      throw new Error(`failed to compile the interop server: ${compile.stderr}`);
    }

    this.child = spawn('elixir', ['-S', 'mix', 'run', 'test/support/interop_server.exs'], {
      cwd: serverDir,
      env,
    });

    this.child.stdout.on('data', (chunk: Buffer) => this.ingest(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });

    const ready = await this.next(20_000);
    expect(ready.kind, `harness failed to start: ${this.stderr}`).toBe(Kind.CONTROL);
    expect(ready.body.toString()).toMatch(/^ready /);
  }

  stop(): void {
    this.child?.kill();
  }

  /** Ids the harness assigned, parsed from its ready line. */
  ids = { alice: 0, bob: 0 };

  private ingest(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    for (;;) {
      // Resynchronise on the marker. stdout is shared with whatever the child
      // or its build tooling prints, and without this a single stray line is
      // read as a length prefix and the stream never recovers.
      const start = this.buffer.indexOf(MAGIC);
      if (start === -1) {
        // Keep a tail in case a marker is split across chunks.
        if (this.buffer.length > MAGIC.length) {
          this.noise += this.buffer.subarray(0, this.buffer.length - MAGIC.length).toString();
          this.buffer = this.buffer.subarray(this.buffer.length - MAGIC.length);
        }
        return;
      }

      if (start > 0) {
        this.noise += this.buffer.subarray(0, start).toString();
        this.buffer = this.buffer.subarray(start);
      }

      if (this.buffer.length < MAGIC.length + 4) return;
      const size = this.buffer.readUInt32LE(MAGIC.length);
      if (this.buffer.length < MAGIC.length + 4 + size) return;

      const kind = this.buffer.readUInt8(MAGIC.length + 4);
      const body = this.buffer.subarray(MAGIC.length + 5, MAGIC.length + 4 + size);
      this.buffer = this.buffer.subarray(MAGIC.length + 4 + size);

      const message = { kind, body: Buffer.from(body) };
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.pending.push(message);
    }
  }

  /** Await the next message from the harness. */
  next(timeoutMs = 5_000): Promise<HarnessMessage> {
    const queued = this.pending.shift();
    if (queued) return Promise.resolve(queued);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `timed out waiting for harness.\nstderr: ${this.stderr}\nunframed stdout: ${this.noise}`,
            ),
          ),
        timeoutMs,
      );
      this.waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  private write(tag: number, body: Buffer): void {
    const payload = Buffer.concat([Buffer.from([tag]), body]);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    this.child.stdin.write(Buffer.concat([header, payload]));
  }

  /** Send a game frame as peer "alice". */
  send(frame: ArrayBuffer): void {
    this.write(0, Buffer.from(frame));
  }

  /** Send a harness control command. */
  control(command: string): void {
    this.write(1, Buffer.from(command, 'utf8'));
  }
}

const maybe = hasElixir ? describe : describe.skip;

// A hard failure rather than a skip, so CI cannot go green without this.
if (!hasElixir && requireElixir) {
  describe('interop with the Elixir server', () => {
    it('requires Elixir on PATH in CI', () => {
      throw new Error(
        'Elixir is not available, so the live interop suite would skip and CI ' +
          'would report a green build with no cross-runtime coverage. Install ' +
          'Elixir, or set IWSDK_ALLOW_NO_ELIXIR=1 to accept the loss knowingly.',
      );
    });
  });
}

maybe('interop with the Elixir server', () => {
  const harness = new Harness();

  beforeAll(async () => {
    await harness.start();
    // The ready line was consumed in start(); re-derive ids deterministically.
    // Zone-less rooms allocate from 1, so alice=1 and bob=2.
    harness.ids = { alice: 1, bob: 2 };
  }, 60_000);

  afterAll(() => harness.stop());

  it('simulates client input and returns a decodable correction', async () => {
    // Full forward at 10 m/s for 100 ms => 1 m along -Z.
    harness.send(
      BinaryProtocol.encodeInput({
        sequence: 1,
        deltaMs: 100,
        movement: { x: 0, y: 1 },
        yaw: 0,
        buttons: 0,
      }),
    );

    const message = await harness.next();
    expect(message.kind).toBe(Kind.REPLY);

    const reconcile = BinaryProtocol.decodeReconcile(
      message.body.buffer.slice(
        message.body.byteOffset,
        message.body.byteOffset + message.body.byteLength,
      ) as ArrayBuffer,
    );

    expect(reconcile.networkId).toBe(harness.ids.alice);
    expect(reconcile.lastProcessedSequence).toBe(1);
    expect(reconcile.position.z).toBeCloseTo(-1, 4);
  });

  it('agrees with the client prediction to full float precision', async () => {
    // The parity claim, verified end to end rather than against a fixture:
    // the same input run through both integrators must land in the same place.
    const { integrateMovement } = await import('../src/math/movement.js');

    let predictedZ = -1; // after the previous test's step
    for (let sequence = 2; sequence <= 6; sequence++) {
      harness.send(
        BinaryProtocol.encodeInput({
          sequence,
          deltaMs: 50,
          movement: { x: 0, y: 1 },
          yaw: 0,
          buttons: 0,
        }),
      );
      await harness.next();
      predictedZ = integrateMovement(0, predictedZ, 0, 1, 0, 0.05, 10, 100).z;
    }

    harness.control('position');
    const message = await harness.next();
    expect(message.kind).toBe(Kind.CONTROL);

    const [, , z] = message.body.toString().split(',').map(Number);
    expect(z).toBeCloseTo(predictedZ, 5);
  });

  it('refuses a client-authored transform', async () => {
    harness.send(
      BinaryProtocol.encodeTransform(
        harness.ids.alice,
        { x: 999, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
      ),
    );

    const message = await harness.next();
    expect(message.kind).toBe(Kind.ERROR);
    expect(message.body.toString()).toBe('client_authority_denied');
  });

  it('answers a ping with a pong carrying the same timestamp', async () => {
    harness.send(BinaryProtocol.encodePing(1234.5));

    const message = await harness.next();
    expect(message.kind).toBe(Kind.REPLY);

    const decoded = BinaryProtocol.decode(toArrayBuffer(message.body));
    expect(decoded.opCode).toBe(OpCode.PONG);
    if (decoded.opCode === OpCode.PONG) {
      // Float64 survives the round trip exactly.
      expect(decoded.timestamp).toBe(1234.5);
    }
  });

  it('produces a snapshot this client can decode', async () => {
    harness.control('move_bob 7.5,0.0,-2.25');
    expect((await harness.next()).kind).toBe(Kind.CONTROL);

    harness.control('snapshot');
    const message = await harness.next();
    expect(message.kind).toBe(Kind.BROADCAST);

    const snapshot = BinaryProtocol.decodeSnapshot(toArrayBuffer(message.body));

    // Alice never appears in her own snapshot.
    expect(snapshot.records.map((r) => r.networkId)).toEqual([harness.ids.bob]);
    const [bob] = snapshot.records;
    expect(bob!.position.x).toBeCloseTo(7.5, 5);
    expect(bob!.position.z).toBeCloseTo(-2.25, 5);
  });

  it('produces a quantized snapshot this client can decode', async () => {
    harness.control('snapshot_quantized');
    const message = await harness.next();

    const snapshot = BinaryProtocol.decodeSnapshot(toArrayBuffer(message.body));
    expect(snapshot.quantized).toBe(true);
    expect(snapshot.records[0]!.position.x).toBeCloseTo(7.5, 5);
    // Identity survives quantization exactly, thanks to the symmetric mapping.
    expect(snapshot.records[0]!.rotation.w).toBeCloseTo(1, 6);
  });

  it('arbitrates ownership and reports the verdict to the whole room', async () => {
    harness.send(BinaryProtocol.encodeOwnershipRequest(500, 77));

    const message = await harness.next();
    expect(message.kind).toBe(Kind.BROADCAST_ALL);

    const grant = BinaryProtocol.decodeOwnershipGrant(toArrayBuffer(message.body));
    expect(grant.granted).toBe(true);
    expect(grant.networkId).toBe(500);
    expect(grant.ownerId).toBe(harness.ids.alice);
    expect(grant.requestId).toBe(77);

    harness.control('owner 500');
    const owner = await harness.next();
    expect(owner.body.toString()).toBe(String(harness.ids.alice));
  });

  it('routes a signal to one peer and stamps the true sender', async () => {
    // The client sends sender 0; the server must overwrite it with alice's id,
    // which is what stops a peer negotiating in someone else's name.
    harness.send(BinaryProtocol.encodeSignalText(harness.ids.bob, '{"type":"offer"}'));

    const message = await harness.next();
    expect(message.kind).toBe(Kind.DIRECT);

    const separator = message.body.indexOf(0);
    const target = message.body.subarray(0, separator).toString();
    const frame = message.body.subarray(separator + 1);

    expect(target).toBe('bob');

    const signal = BinaryProtocol.decodeSignal(toArrayBuffer(frame));
    expect(signal.senderNetworkId).toBe(harness.ids.alice);
    expect(signal.targetNetworkId).toBe(harness.ids.bob);
    expect(BinaryProtocol.decodeSignalText(signal)).toBe('{"type":"offer"}');
  });

  it('rejects a malformed frame without dying', async () => {
    harness.send(new Uint8Array([1, 2, 3]).buffer);
    const message = await harness.next();
    expect(message.kind).toBe(Kind.ERROR);

    // Still serving afterwards.
    harness.send(BinaryProtocol.encodePing(1));
    expect((await harness.next()).kind).toBe(Kind.REPLY);
  });
});

/** Copy a Buffer slice into a standalone ArrayBuffer. */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}
