/**
 * Dedicated network worker.
 *
 * Everything WebSocket-related — socket lifecycle, Phoenix framing, heartbeats,
 * reconnect backoff, Presence bookkeeping — runs here, off the render thread.
 * That is the whole point: at 90 FPS a frame has ~11 ms of budget, and a
 * reconnect storm or a burst of channel messages on the main thread is enough
 * to blow through it and drop frames in a headset.
 *
 * Inbound frames prefer the shared ring buffer; `postMessage` with a
 * transferable is the fallback when the page is not cross-origin isolated.
 */
import { ClockLoop } from '../transport/clock-loop.js';
import { PhoenixConnection } from '../transport/PhoenixConnection.js';
import { RingBuffer } from '../transport/RingBuffer.js';
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
} from '../transport/worker-messages.js';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let inboundRing: RingBuffer | null = null;

const post = (message: WorkerToMainMessage, transfer?: Transferable[]): void => {
  if (transfer) scope.postMessage(message, transfer);
  else scope.postMessage(message);
};

const connection = new PhoenixConnection({
  onFrame(payload) {
    if (inboundRing) {
      // Fast path: copy into shared memory and let the render thread drain it
      // once per frame. No message task, no per-frame allocation on the main
      // thread. A full ring drops the frame, which is correct for a stream of
      // transforms where only the newest sample matters.
      inboundRing.push(new Uint8Array(payload));
      return;
    }
    post({ type: 'FRAME', payload, senderId: '' }, [payload]);
  },
  onPeerJoin(peerId) {
    post({ type: 'PEER_JOIN', peerId });
  },
  onPeerLeave(peerId) {
    post({ type: 'PEER_LEAVE', peerId });
  },
  onState(state) {
    // Clock sync lives and dies with the connection: pinging a socket that is
    // not up produces nothing, and samples taken across a reconnect would
    // straddle a server that may have restarted under us.
    if (state === 'connected') clockLoop.start();
    else clockLoop.stop();

    post({
      type: 'STATE',
      state,
      peerId: connection.peerId,
      networkId: connection.networkId,
    });
  },
  onError(message) {
    post({ type: 'ERROR', message });
  },
});

// Declared after `connection` because it drives it, and started only once the
// socket reports `connected` — see `onState` above.
const clockLoop = new ClockLoop({
  sendPing: (onPong) => connection.sendPing(onPong),
  onReading: (reading) =>
    post({ type: 'CLOCK', ...reading, workerTimeOrigin: performance.timeOrigin }),
});

scope.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'CONNECT': {
      inboundRing = message.inboundRing
        ? RingBuffer.attach(message.inboundRing)
        : null;

      connection.connect(message.endpoint, message.options).catch((error: unknown) => {
        post({
          type: 'ERROR',
          message: error instanceof Error ? error.message : String(error),
        });
      });
      break;
    }

    case 'SEND':
      connection.send(message.payload);
      break;

    case 'DISCONNECT':
      clockLoop.stop();
      connection.disconnect();
      inboundRing = null;
      break;
  }
};
