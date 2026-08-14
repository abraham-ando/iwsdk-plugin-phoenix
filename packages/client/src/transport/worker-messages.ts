/**
 * Message contract between the render thread and the network worker.
 *
 * Kept in its own module so both sides import the exact same types and a
 * mismatch becomes a compile error rather than a runtime surprise.
 */
import type { ConnectOptions, ConnectionState } from '../interfaces/INetworkAdapter.js';
import type { ClockReading } from './clock-loop.js';

/** Render thread -> worker. */
export type MainToWorkerMessage =
  | {
      type: 'CONNECT';
      endpoint: string;
      options: ConnectOptions;
      /**
       * Ring shared with the worker for inbound frames. When absent (no
       * cross-origin isolation) the worker falls back to `postMessage` with
       * transferables.
       */
      inboundRing?: SharedArrayBuffer;
    }
  | { type: 'SEND'; payload: ArrayBuffer }
  | { type: 'DISCONNECT' };

/** Worker -> render thread. */
export type WorkerToMainMessage =
  | {
      type: 'STATE';
      state: ConnectionState;
      peerId: string;
      /** Server-assigned network id; `0` until the room join succeeds. */
      networkId: number;
    }
  | { type: 'FRAME'; payload: ArrayBuffer; senderId: string }
  | { type: 'PEER_JOIN'; peerId: string }
  | { type: 'PEER_LEAVE'; peerId: string }
  | ({
      type: 'CLOCK';
      /**
       * The worker's own `performance.timeOrigin`. A worker's clock starts
       * when the worker does, not when the page did, so the offset measured
       * here is wrong by that difference anywhere else — the main thread needs
       * this value to correct for it.
       */
      workerTimeOrigin: number;
    } & ClockReading)
  | { type: 'ERROR'; message: string };
