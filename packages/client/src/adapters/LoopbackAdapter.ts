/**
 * In-memory adapter that wires peers together without a server.
 *
 * Two uses:
 *
 * 1. Deterministic tests — drive a full replication scenario, including
 *    interpolation and reconciliation, with no sockets and no timers.
 * 2. Local development — run several simulated players in one tab before the
 *    Elixir server is up.
 *
 * The optional latency and packet-loss simulation is what makes it useful
 * beyond smoke tests: interpolation and prediction bugs only show up under
 * delay and reordering, which a naive loopback would never produce.
 */
import {
  ListenerSet,
  type ConnectOptions,
  type ConnectionState,
  type INetworkAdapter,
  type NetworkMessage,
  type Unsubscribe,
} from '../interfaces/INetworkAdapter.js';

/** Shared bus that relays frames between {@link LoopbackAdapter} instances. */
export class LoopbackNetwork {
  private readonly peers = new Set<LoopbackAdapter>();

  /** Frames held back until {@link advance} releases them. */
  private queue: { at: number; from: LoopbackAdapter; payload: ArrayBuffer }[] = [];

  private clock = 0;

  constructor(
    /** One-way delay applied to every frame, in milliseconds. */
    public latencyMs = 0,
    /** Fraction of frames to discard, in `[0, 1]`. */
    public packetLoss = 0,
    /** Deterministic source of randomness for loss decisions. */
    private readonly random: () => number = Math.random,
  ) {}

  /** Create a peer attached to this bus. */
  createPeer(peerId: string): LoopbackAdapter {
    const peer = new LoopbackAdapter(this, peerId);
    return peer;
  }

  /** @internal Called by an adapter when it joins. */
  register(peer: LoopbackAdapter): void {
    for (const existing of this.peers) {
      existing.emitPeerJoin(peer.peerId);
      peer.emitPeerJoin(existing.peerId);
    }
    this.peers.add(peer);
  }

  /** @internal Called by an adapter when it leaves. */
  unregister(peer: LoopbackAdapter): void {
    if (!this.peers.delete(peer)) return;
    for (const existing of this.peers) existing.emitPeerLeave(peer.peerId);
  }

  /** @internal Enqueue a frame for every peer except the sender. */
  publish(from: LoopbackAdapter, payload: ArrayBuffer): void {
    if (this.packetLoss > 0 && this.random() < this.packetLoss) return;
    this.queue.push({ at: this.clock + this.latencyMs, from, payload });
  }

  /**
   * Advance the simulated clock and deliver everything now due.
   *
   * @returns Number of frames delivered.
   */
  advance(deltaMs = 0): number {
    this.clock += deltaMs;

    const due = this.queue.filter((item) => item.at <= this.clock);
    this.queue = this.queue.filter((item) => item.at > this.clock);

    let delivered = 0;
    for (const item of due) {
      for (const peer of this.peers) {
        if (peer === item.from) continue;
        // Each receiver gets its own copy, matching real transport semantics
        // where no two peers ever share a buffer.
        peer.deliver(item.payload.slice(0), item.from.peerId);
        delivered++;
      }
    }
    return delivered;
  }

  /** Current simulated time in milliseconds. */
  get now(): number {
    return this.clock;
  }

  /** Frames still in flight. */
  get inFlight(): number {
    return this.queue.length;
  }
}

export class LoopbackAdapter implements INetworkAdapter {
  private readonly messageListeners = new ListenerSet<NetworkMessage>();
  private readonly joinListeners = new ListenerSet<string>();
  private readonly leaveListeners = new ListenerSet<string>();
  private readonly stateListeners = new ListenerSet<ConnectionState>();

  private currentState: ConnectionState = 'disconnected';

  constructor(
    private readonly network: LoopbackNetwork,
    public readonly peerId: string,
  ) {}

  get state(): ConnectionState {
    return this.currentState;
  }

  connect(_endpoint: string, _options?: ConnectOptions): Promise<void> {
    this.setState('connected');
    this.network.register(this);
    return Promise.resolve();
  }

  disconnect(): void {
    this.network.unregister(this);
    this.setState('disconnected');
  }

  send(data: ArrayBuffer): void {
    if (this.currentState !== 'connected') return;
    this.network.publish(this, data);
  }

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

  /** @internal */
  deliver(payload: ArrayBuffer, senderId: string): void {
    if (payload.byteLength === 0) return;
    this.messageListeners.emit({
      opCode: new DataView(payload).getUint8(0),
      senderId,
      payload,
    });
  }

  /** @internal */
  emitPeerJoin(peerId: string): void {
    this.joinListeners.emit(peerId);
  }

  /** @internal */
  emitPeerLeave(peerId: string): void {
    this.leaveListeners.emit(peerId);
  }

  private setState(state: ConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.stateListeners.emit(state);
  }
}
