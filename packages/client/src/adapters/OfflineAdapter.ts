/**
 * No-op adapter for single-player mode.
 *
 * The spec calls for `isOffline: true` to disable networking "without altering
 * how IWSDK or local Havok behave". Modelling that as an adapter rather than as
 * a branch inside every system is what makes the guarantee real: the systems
 * keep running their normal code path, they simply publish into a sink. There
 * is no `if (offline)` scattered through the update loop to get out of sync.
 */
import {
  ListenerSet,
  type ConnectionState,
  type INetworkAdapter,
  type NetworkMessage,
  type Unsubscribe,
} from '../interfaces/INetworkAdapter.js';

export class OfflineAdapter implements INetworkAdapter {
  private readonly messageListeners = new ListenerSet<NetworkMessage>();
  private readonly joinListeners = new ListenerSet<string>();
  private readonly leaveListeners = new ListenerSet<string>();

  readonly peerId = 'local';

  /** Frames the application tried to publish. Useful in tests. */
  sentFrameCount = 0;

  get state(): ConnectionState {
    return 'connected';
  }

  /** Resolves immediately: there is nothing to connect to. */
  connect(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): void {}

  send(_data: ArrayBuffer): void {
    this.sentFrameCount++;
  }

  broadcast(_data: ArrayBuffer): void {
    this.sentFrameCount++;
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
}
