/**
 * Phoenix Channels connection, independent of where it runs.
 *
 * The same class backs both {@link PhoenixAdapter} (inside a dedicated worker)
 * and {@link PhoenixDirectAdapter} (on the main thread). Keeping the socket
 * logic in one transport-agnostic place means the worker file stays a thin
 * message pump, and the whole connection lifecycle stays unit-testable by
 * injecting a fake socket factory.
 */
import { Presence, Socket } from 'phoenix';
import type { ConnectOptions, ConnectionState } from '../interfaces/INetworkAdapter.js';

/** Channel event carrying binary frames in both directions. */
export const FRAME_EVENT = 'frame';

/** Minimal structural view of the bits of `phoenix`'s Socket we rely on. */
export interface SocketLike {
  connect(): void;
  disconnect(callback?: () => void): void;
  channel(topic: string, params?: object): ChannelLike;
  onError(callback: (error?: unknown) => void): void;
  onClose(callback: () => void): void;
  onOpen(callback: () => void): void;
}

/** Minimal structural view of a Phoenix channel. */
export interface ChannelLike {
  join(timeout?: number): PushLike;
  leave(timeout?: number): PushLike;
  on(event: string, callback: (payload: unknown) => void): number;
  push(event: string, payload: unknown, timeout?: number): PushLike;
  onError?(callback: (reason?: unknown) => void): void;
  onClose?(callback: () => void): void;
}

/** Minimal structural view of a Phoenix push. */
export interface PushLike {
  receive(status: string, callback: (response?: unknown) => void): PushLike;
}

/** Factory used to build the socket; overridable for tests. */
export type SocketFactory = (
  endpoint: string,
  options: { params: Record<string, unknown> },
) => SocketLike;

const defaultSocketFactory: SocketFactory = (endpoint, options) =>
  new Socket(endpoint, options) as unknown as SocketLike;

/** Callbacks a host supplies to observe the connection. */
export interface PhoenixConnectionEvents {
  onFrame(payload: ArrayBuffer, senderId: string): void;
  onPeerJoin(peerId: string): void;
  onPeerLeave(peerId: string): void;
  onState(state: ConnectionState): void;
  onError(message: string): void;
}

export class PhoenixConnection {
  private socket: SocketLike | null = null;
  private channel: ChannelLike | null = null;
  private presence: Presence | null = null;
  private currentState: ConnectionState = 'disconnected';

  /** Peer id assigned by the server in the join reply. */
  peerId = '';

  /**
   * Numeric network id assigned by the server in the join reply.
   *
   * `0` until a join succeeds. Everything the client publishes is addressed by
   * this id, so it has to travel back to the render thread before the
   * application can mark any entity as its own.
   */
  networkId = 0;

  constructor(
    private readonly events: PhoenixConnectionEvents,
    private readonly socketFactory: SocketFactory = defaultSocketFactory,
  ) {}

  get state(): ConnectionState {
    return this.currentState;
  }

  /**
   * Open the socket and join `room:<roomId>`.
   *
   * Resolves once the channel join is acknowledged, so callers can rely on the
   * room being live. Rejects if the server refuses the join.
   */
  connect(endpoint: string, options: ConnectOptions = {}): Promise<void> {
    this.disconnect();
    this.setState('connecting');

    const roomId = options.roomId ?? 'lobby';
    const params: Record<string, unknown> = { ...options.params };
    if (options.token) params.token = options.token;

    const socket = this.socketFactory(endpoint, { params });
    this.socket = socket;

    // A Phoenix socket reconnects on its own; surface the interim state so the
    // application can show a "reconnecting" indicator rather than a hard error.
    socket.onError(() => this.setState('reconnecting'));
    socket.onClose(() => {
      if (this.currentState !== 'disconnected') this.setState('reconnecting');
    });

    socket.connect();

    const channel = socket.channel(`room:${roomId}`, {
      mode: options.mode ?? 'host_relayed',
      ...options.params,
    });
    this.channel = channel;

    channel.on(FRAME_EVENT, (payload) => {
      // Phoenix hands binary payloads through as ArrayBuffer. Anything else on
      // this event is a server bug or a protocol mismatch; drop it rather than
      // letting a malformed frame reach the decoder.
      if (payload instanceof ArrayBuffer) {
        this.events.onFrame(payload, '');
      } else if (ArrayBuffer.isView(payload)) {
        const view = payload as ArrayBufferView;
        this.events.onFrame(
          view.buffer.slice(
            view.byteOffset,
            view.byteOffset + view.byteLength,
          ) as ArrayBuffer,
          '',
        );
      }
    });

    channel.onError?.(() => this.setState('reconnecting'));

    this.attachPresence(channel);

    return new Promise<void>((resolve, reject) => {
      channel
        .join()
        .receive('ok', (response) => {
          const reply = (response ?? {}) as { peer_id?: string; network_id?: number };
          this.peerId = reply.peer_id ?? '';
          // Both are set before the state change, so a listener reacting to
          // 'connected' already sees the identity rather than racing it.
          this.networkId =
            typeof reply.network_id === 'number' && Number.isInteger(reply.network_id)
              ? reply.network_id
              : 0;
          this.setState('connected');
          resolve();
        })
        .receive('error', (response) => {
          const reason = describeReason(response);
          this.setState('errored');
          this.events.onError(`join refused: ${reason}`);
          reject(new Error(`Phoenix join refused: ${reason}`));
        })
        .receive('timeout', () => {
          this.setState('errored');
          this.events.onError('join timed out');
          reject(new Error('Phoenix join timed out'));
        });
    });
  }

  /**
   * Publish a binary frame.
   *
   * Silently drops while disconnected: the render loop calls this every frame
   * and must never fault because the socket is momentarily down.
   */
  send(buffer: ArrayBuffer): void {
    if (!this.channel || this.currentState !== 'connected') return;
    this.channel.push(FRAME_EVENT, buffer);
  }

  /** Leave the channel and close the socket. */
  disconnect(): void {
    if (this.channel) {
      try {
        this.channel.leave();
      } catch {
        // Leaving a channel whose socket already died is not an error worth
        // propagating during teardown.
      }
      this.channel = null;
    }

    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch {
        // Same reasoning as above.
      }
      this.socket = null;
    }

    this.presence = null;
    this.peerId = '';
    this.networkId = 0;
    this.setState('disconnected');
  }

  /**
   * Wire Phoenix Presence so peer arrivals and departures surface as events.
   *
   * Presence is diff-based, so `onSync` would force us to diff by hand;
   * `onJoin`/`onLeave` already give exactly the transitions we need. We filter
   * on `currentPresence` so a metadata update on an existing peer does not
   * masquerade as a fresh join.
   */
  private attachPresence(channel: ChannelLike): void {
    try {
      const presence = new Presence(channel as never);
      this.presence = presence;

      presence.onJoin((id, currentPresence) => {
        if (!id || currentPresence) return;
        if (id === this.peerId) return;
        this.events.onPeerJoin(id);
      });

      presence.onLeave((id, currentPresence) => {
        if (!id) return;
        // A non-empty metas list means the peer still has another live
        // connection; only report a true departure.
        const metas = (currentPresence as { metas?: unknown[] } | undefined)?.metas;
        if (metas && metas.length > 0) return;
        this.events.onPeerLeave(id);
      });
    } catch (error) {
      // Presence is optional: a server that does not track it still works for
      // transform replication, so degrade instead of failing the connection.
      this.events.onError(
        `presence unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private setState(state: ConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.events.onState(state);
  }
}

/** Turn a Phoenix error reply into something loggable. */
function describeReason(response: unknown): string {
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    const reason = (response as { reason?: unknown }).reason;
    if (typeof reason === 'string') return reason;
    try {
      return JSON.stringify(response);
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}
