/**
 * `@iwsdk/plugin-phoenix`
 *
 * WebXR multiplayer for Meta's Immersive Web SDK, backed by Phoenix Channels
 * and the BEAM.
 *
 * @packageDocumentation
 */

// Components
export {
  NetworkInput,
  NetworkStats,
  Networked,
  NetworkedTransform,
} from './components/index.js';

// Protocol
export { BinaryProtocol, ProtocolError } from './protocol/BinaryProtocol.js';
export type {
  DecodedFrame,
  InputFrame,
  OwnershipGrantFrame,
  OwnershipRequestFrame,
  SignalFrame,
  ReconcileFrame,
  SnapshotFrame,
  SpawnFrame,
  TransformRecord,
  Vector3Like,
} from './protocol/BinaryProtocol.js';
export {
  INPUT_UPDATE_BYTES,
  LITTLE_ENDIAN,
  OWNERSHIP_GRANT_BYTES,
  OWNERSHIP_REQUEST_BYTES,
  OpCode,
  SIGNAL_HEADER_BYTES,
  SIGNAL_MAX_PAYLOAD_BYTES,
  RECONCILE_BYTES,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_RECORD_BYTES,
  SNAPSHOT_RECORD_QUANTIZED_BYTES,
  SnapshotFlags,
  TRANSFORM_UPDATE_BYTES,
} from './protocol/opcodes.js';
export type { SnapshotFlag } from './protocol/opcodes.js';
export {
  SMALLEST_THREE_RANGE,
  angleBetween,
  compressQuaternion,
  decompressQuaternion,
} from './protocol/quaternion-compression.js';
export type { QuaternionLike } from './protocol/quaternion-compression.js';

// Transport abstraction (the proposed @iwsdk/network surface)
export { ListenerSet } from './interfaces/INetworkAdapter.js';
export type {
  ConnectOptions,
  ConnectionState,
  INetworkAdapter,
  NetworkMessage,
  Unsubscribe,
} from './interfaces/INetworkAdapter.js';

// Adapters
export { OfflineAdapter } from './adapters/OfflineAdapter.js';
export { LoopbackAdapter, LoopbackNetwork } from './adapters/LoopbackAdapter.js';
export { PhoenixAdapter } from './adapters/PhoenixAdapter.js';
export type { PhoenixAdapterOptions } from './adapters/PhoenixAdapter.js';

// Transport internals, exported for advanced hosts and tests
export { RingBuffer, isSharedMemoryAvailable } from './transport/RingBuffer.js';
export { FRAME_EVENT, PhoenixConnection } from './transport/PhoenixConnection.js';
export type {
  ChannelLike,
  PhoenixConnectionEvents,
  SocketFactory,
  SocketLike,
} from './transport/PhoenixConnection.js';
export type {
  MainToWorkerMessage,
  WorkerToMainMessage,
} from './transport/worker-messages.js';

// Systems
export { ClientPredictionSystem } from './systems/ClientPredictionSystem.js';
export { EntityIndex } from './systems/EntityIndex.js';
export { NetworkInterpolationSystem } from './systems/NetworkInterpolationSystem.js';
export { NetworkLODSystem } from './systems/NetworkLODSystem.js';
export { PhoenixNetworkSystem } from './systems/PhoenixNetworkSystem.js';
export type { SpawnRequest } from './systems/PhoenixNetworkSystem.js';

// Math helpers
export { clamp, distanceSquared, lerpVec3, slerpQuat } from './math/interpolation.js';
export type { MutableVector } from './math/interpolation.js';
export { clampToUnitDisc, integrateMovement } from './math/movement.js';
export type { MovementStep } from './math/movement.js';

// Cardinal — generated component runtime
export {
  CARDINAL_REGISTRY,
  registerCardinalComponents,
} from './cardinal/components.generated.js';
export type { CardinalComponentSpec } from './cardinal/components.generated.js';
export { CARDINAL_CODECS, SCHEMA_HASH } from './cardinal/codecs.generated.js';
export type { CardinalCodec } from './cardinal/codecs.generated.js';
export { CardinalPublisher } from './cardinal/publish.js';
export type {
  ComponentRecord,
  ComponentUpdateFrame,
} from './protocol/BinaryProtocol.js';

// Clock synchronization
export {
  ClockSyncEstimator,
  SlewedOffset,
  combineWorkerOffset,
} from './math/clock-sync.js';
export type { ClockEstimate, ClockSample } from './math/clock-sync.js';
export { ClockLoop } from './transport/clock-loop.js';
export type { ClockLoopOptions, ClockReading } from './transport/clock-loop.js';

// Plugin entrypoint
export { SystemPriority, createNetworkClock, installPhoenixNetworking } from './plugin.js';
export type {
  NetworkClock,
  PhoenixNetworkingHandle,
  PhoenixNetworkingOptions,
} from './plugin.js';
