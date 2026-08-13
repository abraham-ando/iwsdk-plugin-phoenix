/**
 * Backend-agnostic networking surface.
 *
 * This is the interface proposed to Meta as `@iwsdk/network` (see
 * `docs/rfc/0001-iwsdk-network.md`). Nothing in it mentions Phoenix, Elixir or
 * WebSockets: `PhoenixAdapter` is simply the reference implementation, and
 * `LoopbackAdapter` / `OfflineAdapter` prove the abstraction holds for
 * transports that are not networked at all.
 */

/** A frame received from the transport. */
export interface NetworkMessage {
  /** First byte of {@link payload}, lifted out so listeners can route cheaply. */
  opCode: number;
  /** Opaque identifier of the sender, or `''` when the server is authoritative. */
  senderId: string;
  /** The raw frame. Treat as borrowed: copy it if you retain it past the callback. */
  payload: ArrayBuffer;
}

/** Lifecycle of an adapter's underlying connection. */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'errored';

/** Options accepted by {@link INetworkAdapter.connect}. */
export interface ConnectOptions {
  /** Room/topic to join, e.g. `lobby` for the Phoenix topic `room:lobby`. */
  roomId?: string;
  /** Authentication token forwarded to the server's `connect/3` callback. */
  token?: string;
  /** Authority model requested at join time. */
  mode?: 'host_relayed' | 'server_authoritative';
  /** Arbitrary extra params merged into the join payload. */
  params?: Record<string, unknown>;
}

/** Unsubscribe handle returned by every `on*` registration. */
export type Unsubscribe = () => void;

/**
 * Transport abstraction consumed by the plugin's systems.
 *
 * Implementations must be safe to call before {@link connect} resolves:
 * {@link send} on a disconnected adapter drops the frame rather than throwing,
 * because the render loop must never fault on a network hiccup.
 */
export interface INetworkAdapter {
  /** Current connection lifecycle state. */
  readonly state: ConnectionState;

  /** Identifier assigned to this peer by the server, or `''` before joining. */
  readonly peerId: string;

  /**
   * Numeric id the server assigned this peer, or `0` before it is known.
   *
   * Distinct from {@link peerId}, which is an opaque string for authentication
   * and routing. This is the id that appears *on the wire*: it stamps the
   * peer's own replicated entities and identifies it in ownership grants and
   * signalling frames. An application cannot replicate anything until it knows
   * this value, so an adapter that joins a room is expected to surface it.
   *
   * Optional because transports without a server — {@link OfflineAdapter} — have
   * no one to assign it.
   */
  readonly networkId?: number;

  /** Open the connection and join the requested room. */
  connect(endpoint: string, options?: ConnectOptions): Promise<void>;

  /** Close the connection. Safe to call when already disconnected. */
  disconnect(): void;

  /**
   * Publish a frame to the server. Ownership of `data` transfers to the
   * adapter, which may neuter the buffer while moving it across a worker
   * boundary — do not read it after calling.
   */
  send(data: ArrayBuffer): void;

  /**
   * Publish a frame to every other peer in the room. On a relayed transport
   * this is the same as {@link send}; the distinction exists for transports
   * where server-directed and peer-directed traffic take different paths.
   */
  broadcast(data: ArrayBuffer): void;

  /** Register a frame listener. */
  onMessage(callback: (msg: NetworkMessage) => void): Unsubscribe;

  /** Register a peer-arrival listener. */
  onPeerJoin(callback: (peerId: string) => void): Unsubscribe;

  /** Register a peer-departure listener. */
  onPeerLeave(callback: (peerId: string) => void): Unsubscribe;

  /** Register a connection-state listener. */
  onStateChange?(callback: (state: ConnectionState) => void): Unsubscribe;
}

/**
 * Minimal listener bookkeeping shared by the bundled adapters.
 *
 * Kept as a standalone class rather than a base class so adapters stay free to
 * extend something else; they compose one of these per event type.
 */
export class ListenerSet<T> {
  private readonly listeners = new Set<(value: T) => void>();

  add(callback: (value: T) => void): Unsubscribe {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  emit(value: T): void {
    // Iterate a copy: a listener may unsubscribe itself while being notified.
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (error) {
        // One misbehaving listener must not stop the others, and must never
        // propagate into the render loop.
        console.error('[plugin-phoenix] listener threw', error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }

  get size(): number {
    return this.listeners.size;
  }
}
