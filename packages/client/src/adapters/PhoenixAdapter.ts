/**
 * Worker-backed Phoenix adapter — the production transport.
 */
import {
  ListenerSet,
  type ConnectOptions,
  type ConnectionState,
  type INetworkAdapter,
  type NetworkMessage,
  type Unsubscribe,
} from '../interfaces/INetworkAdapter.js';
import { combineWorkerOffset } from '../math/clock-sync.js';
import type { ClockReading } from '../transport/clock-loop.js';
import { RingBuffer, isSharedMemoryAvailable } from '../transport/RingBuffer.js';
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
} from '../transport/worker-messages.js';

/** Tuning knobs for {@link PhoenixAdapter}. */
export interface PhoenixAdapterOptions {
  /**
   * Override how the worker is constructed. Needed when a bundler cannot
   * resolve `new URL('./network.worker.js', import.meta.url)` — for instance in
   * a CommonJS test harness or a non-Vite build.
   */
  workerFactory?: () => Worker;
  /**
   * Size of the inbound shared ring, in bytes. Ignored when the page is not
   * cross-origin isolated. @defaultValue 1 MiB
   */
  ringCapacityBytes?: number;
  /**
   * Force the `postMessage` path even when `SharedArrayBuffer` is available.
   * Useful for A/B testing the two transports. @defaultValue false
   */
  disableSharedMemory?: boolean;
}

/**
 * Runs a Phoenix socket inside a dedicated worker and surfaces it through
 * {@link INetworkAdapter}.
 *
 * Inbound frames arrive either through a `SharedArrayBuffer` ring (drained by
 * {@link drainInbound} once per frame) or through `postMessage`. Both paths
 * ultimately fan out to the same `onMessage` listeners, so systems never need
 * to know which one is active.
 */
export class PhoenixAdapter implements INetworkAdapter {
  private worker: Worker | null = null;
  private ring: RingBuffer | null = null;
  private currentState: ConnectionState = 'disconnected';
  private currentPeerId = '';
  private currentNetworkId = 0;
  private clockReading: ClockReading | null = null;

  private readonly messageListeners = new ListenerSet<NetworkMessage>();
  private readonly joinListeners = new ListenerSet<string>();
  private readonly leaveListeners = new ListenerSet<string>();
  private readonly stateListeners = new ListenerSet<ConnectionState>();

  /** Reused across drains so the hot path allocates nothing. */
  private readonly scratch = new Uint8Array(64 * 1024);

  private pendingConnect: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(private readonly options: PhoenixAdapterOptions = {}) {}

  get state(): ConnectionState {
    return this.currentState;
  }

  get peerId(): string {
    return this.currentPeerId;
  }

  get networkId(): number {
    return this.currentNetworkId;
  }

  /** See {@link INetworkAdapter.clockEstimate}; already on this thread's clock. */
  get clockEstimate(): ClockReading | null {
    return this.clockReading;
  }

  /** True when the shared-memory fast path is active. */
  get usesSharedMemory(): boolean {
    return this.ring !== null;
  }

  /** Inbound frames dropped because the ring was full. */
  get droppedFrames(): number {
    return this.ring?.dropped ?? 0;
  }

  connect(endpoint: string, options: ConnectOptions = {}): Promise<void> {
    this.disconnect();

    const worker = this.options.workerFactory
      ? this.options.workerFactory()
      : defaultWorkerFactory();
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) =>
      this.handleWorkerMessage(event.data);
    worker.onerror = (event) => {
      this.failConnect(new Error(`network worker error: ${event.message}`));
      this.setState('errored');
    };

    const useSharedMemory =
      !this.options.disableSharedMemory && isSharedMemoryAvailable();
    this.ring = useSharedMemory
      ? RingBuffer.create(this.options.ringCapacityBytes ?? 1024 * 1024)
      : null;

    const message: MainToWorkerMessage = {
      type: 'CONNECT',
      endpoint,
      options,
      ...(this.ring ? { inboundRing: this.ring.sab } : {}),
    };
    worker.postMessage(message);

    return new Promise<void>((resolve, reject) => {
      this.pendingConnect = { resolve, reject };
    });
  }

  disconnect(): void {
    this.failConnect(new Error('connection cancelled'));

    if (this.worker) {
      const message: MainToWorkerMessage = { type: 'DISCONNECT' };
      this.worker.postMessage(message);
      this.worker.terminate();
      this.worker = null;
    }

    this.ring = null;
    this.currentPeerId = '';
    this.currentNetworkId = 0;
    this.setState('disconnected');
  }

  send(data: ArrayBuffer): void {
    if (!this.worker) return;
    const message: MainToWorkerMessage = { type: 'SEND', payload: data };
    // Transfer rather than copy: the caller has already handed over ownership.
    this.worker.postMessage(message, [data]);
  }

  /** Relayed rooms make broadcast and send the same operation. */
  broadcast(data: ArrayBuffer): void {
    this.send(data);
  }

  onMessage(callback: (msg: NetworkMessage) => void): Unsubscribe {
    return this.messageListeners.add(callback);
  }

  onPeerJoin(callback: (peerId: string) => void): Unsubscribe {
    return this.joinListeners.add(callback);
  }

  onPeerLeave(callback: (peerId: string) => void): Unsubscribe {
    return this.leaveListeners.add(callback);
  }

  onStateChange(callback: (state: ConnectionState) => void): Unsubscribe {
    return this.stateListeners.add(callback);
  }

  /**
   * Drain the shared ring, emitting one `onMessage` per frame received.
   *
   * Call once per render tick — {@link PhoenixNetworkSystem} does this
   * automatically. A no-op when running on the `postMessage` fallback, since
   * those frames are delivered as they arrive.
   *
   * @returns Number of frames drained.
   */
  drainInbound(): number {
    const ring = this.ring;
    if (!ring) return 0;

    return ring.drain((record) => {
      // The scratch buffer is reused, so hand listeners their own copy: a
      // system may legitimately hold onto a frame past this callback.
      const payload = record.slice().buffer as ArrayBuffer;
      this.messageListeners.emit({
        opCode: new DataView(payload).getUint8(0),
        senderId: '',
        payload,
      });
    }, this.scratch);
  }

  private handleWorkerMessage(message: WorkerToMainMessage): void {
    switch (message.type) {
      case 'STATE': {
        this.currentPeerId = message.peerId;
        this.currentNetworkId = message.networkId;
        // Identity first, then the state change: a listener that reacts to
        // 'connected' by stamping its own entities must not observe id 0.
        this.setState(message.state);
        if (message.state === 'connected') {
          this.pendingConnect?.resolve();
          this.pendingConnect = null;
        }
        break;
      }

      case 'FRAME': {
        if (message.payload.byteLength === 0) break;
        this.messageListeners.emit({
          opCode: new DataView(message.payload).getUint8(0),
          senderId: message.senderId,
          payload: message.payload,
        });
        break;
      }

      case 'CLOCK': {
        const { offsetMs, rttMs, epoch, workerTimeOrigin } = message;
        this.clockReading = {
          // The worker measured against its own clock. Folding the origin
          // difference in here means no consumer on this thread ever has to
          // know the measurement happened somewhere else.
          offsetMs:
            offsetMs === null
              ? null
              : combineWorkerOffset(offsetMs, workerTimeOrigin, performance.timeOrigin),
          rttMs,
          epoch,
        };
        break;
      }

      case 'PEER_JOIN':
        this.joinListeners.emit(message.peerId);
        break;

      case 'PEER_LEAVE':
        this.leaveListeners.emit(message.peerId);
        break;

      case 'ERROR':
        this.failConnect(new Error(message.message));
        console.error('[plugin-phoenix]', message.message);
        break;
    }
  }

  private failConnect(error: Error): void {
    if (!this.pendingConnect) return;
    const { reject } = this.pendingConnect;
    this.pendingConnect = null;
    reject(error);
  }

  private setState(state: ConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.stateListeners.emit(state);
  }
}

/**
 * Resolve the bundled worker.
 *
 * `new URL(..., import.meta.url)` is the form every modern bundler (Vite,
 * Rollup, webpack 5, esbuild) recognises as a worker reference, so the emitted
 * `dist/network.worker.js` is picked up and fingerprinted automatically.
 *
 * The path is relative to the **built** file, not to this source file. tsup
 * bundles `src/**` down to a single `dist/index.js` and copies this string
 * through untouched, so what matters is that `dist/index.js` and
 * `dist/network.worker.js` are siblings. Getting this wrong does not fail the
 * library build — it fails in the *consuming* application's build, which is why
 * `test/packaging.test.ts` asserts it against the real emitted files.
 */
function defaultWorkerFactory(): Worker {
  return new Worker(new URL('./network.worker.js', import.meta.url), {
    type: 'module',
    name: 'iwsdk-phoenix-network',
  });
}
