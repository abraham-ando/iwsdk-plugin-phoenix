/**
 * Client-side prediction and server reconciliation.
 *
 * In a server-authoritative room the player would otherwise feel every
 * millisecond of round-trip latency before their own avatar moved — unacceptable
 * in VR, where input-to-photon lag is a comfort issue, not just a polish one.
 *
 * So the client applies input immediately and keeps a log of everything not yet
 * acknowledged. When the server's correction arrives it is authoritative for a
 * point in the *past*; we snap to it and then replay every input the server had
 * not yet seen. The result is that a correct prediction produces no visible
 * change at all, and only genuine divergence moves the player.
 *
 * The `movementModel` config must mirror the server's integration step exactly.
 * Any mismatch shows up as a constant stream of corrections — which is why
 * `IwsdkPhoenix.Physics.Kinematic` on the Elixir side implements precisely the
 * same formula, and why the two are covered by a shared parity fixture.
 */
import { Transform, Types, createSystem } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { Networked, NetworkInput } from '../components/index.js';
import type { INetworkAdapter } from '../interfaces/INetworkAdapter.js';
import { BinaryProtocol } from '../protocol/BinaryProtocol.js';
import { OpCode } from '../protocol/opcodes.js';
import { integrateMovement } from '../math/movement.js';

/** One unacknowledged input, retained for replay. */
interface PendingInput {
  sequence: number;
  movementX: number;
  movementY: number;
  yaw: number;
  deltaSeconds: number;
}

export class ClientPredictionSystem extends createSystem(
  {
    predicted: { required: [Networked, NetworkInput, Transform] },
  },
  {
    /** Transport, injected by `installPhoenixNetworking`. */
    adapter: { type: Types.Object, default: null },
    /** Horizontal movement speed in metres per second. */
    moveSpeed: { type: Types.Float32, default: 4.5 },
    /** Disable to run a purely client-authoritative room. */
    enabled: { type: Types.Boolean, default: true },
    /**
     * Cap on retained unacknowledged inputs. At 90 FPS this is ~2.8 s of
     * history — far more than any playable round trip. Exceeding it means the
     * server has stopped acknowledging, so the oldest entries are dropped
     * rather than growing without bound.
     */
    maxPendingInputs: { type: Types.Float32, default: 256 },
    /**
     * Positional error, in metres, below which a correction is ignored.
     * Prevents float noise from producing a visible snap every tick.
     */
    reconcileEpsilon: { type: Types.Float32, default: 0.001 },
    /**
     * Longest timestep a single input may integrate, in milliseconds.
     *
     * Must match `IwsdkPhoenix.Physics.Kinematic`'s `max_delta_ms`. The server
     * clamps this to stop a client claiming one ten-second frame and crossing
     * the map in a single packet; the client applies the same clamp so that a
     * render hitch does not by itself cause a divergence and a visible snap.
     */
    maxDeltaMs: { type: Types.Float32, default: 100 },
  },
) {
  private pending: PendingInput[] = [];
  private sequence = 0;
  private unsubscribe: (() => void) | null = null;

  /** Corrections applied since start; surfaced for diagnostics. */
  corrections = 0;

  /** Corrections that were within epsilon and therefore ignored. */
  correctionsIgnored = 0;

  override init(): void {
    const adapter = this.adapter;
    if (!adapter) return;

    this.unsubscribe = adapter.onMessage((message) => {
      if (message.opCode !== OpCode.RECONCILE) return;
      const frame = BinaryProtocol.decodeReconcile(message.payload);
      this.reconcile(frame.networkId, frame.lastProcessedSequence, frame.position);
    });
  }

  override destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pending.length = 0;
  }

  /** The configured adapter, or `null`. */
  get adapter(): INetworkAdapter | null {
    return (this.config.adapter.value as INetworkAdapter | null) ?? null;
  }

  /** Unacknowledged inputs currently retained. */
  get pendingCount(): number {
    return this.pending.length;
  }

  override update(delta: number, _time: number): void {
    if (!this.config.enabled.value) return;

    for (const entity of this.queries.predicted.entities) {
      if (!entity.getValue(Networked, 'isLocalOwner')) continue;

      const movement = entity.getVectorView(NetworkInput, 'movement');
      const movementX = movement[0] as number;
      const movementY = movement[1] as number;
      const yaw = entity.getValue(NetworkInput, 'yaw') ?? 0;
      const buttons = entity.getValue(NetworkInput, 'buttons') ?? 0;

      this.sequence = (this.sequence + 1) >>> 0;
      entity.setValue(NetworkInput, 'sequence', this.sequence);

      // Predict locally, right now — no waiting for the server.
      this.applyInput(entity, movementX, movementY, yaw, delta);

      this.pending.push({
        sequence: this.sequence,
        movementX,
        movementY,
        yaw,
        deltaSeconds: delta,
      });

      const limit = this.config.maxPendingInputs.value;
      if (this.pending.length > limit) {
        this.pending.splice(0, this.pending.length - limit);
      }

      this.adapter?.send(
        BinaryProtocol.encodeInput({
          sequence: this.sequence,
          deltaMs: delta * 1000,
          movement: { x: movementX, y: movementY },
          yaw,
          buttons,
        }),
      );
    }
  }

  /**
   * Integrate one input step.
   *
   * Movement is applied in the entity's yaw frame so "forward" means forward
   * relative to where the player is facing. This must stay behaviourally
   * identical to `IwsdkPhoenix.Physics.Kinematic.apply_input/3`, including the
   * clamping below — the shared `test/fixtures/protocol_vectors.json` pins the
   * equivalence so the two cannot drift apart unnoticed.
   */
  private applyInput(
    entity: Entity,
    movementX: number,
    movementY: number,
    yaw: number,
    deltaSeconds: number,
  ): void {
    const position = entity.getVectorView(Transform, 'position');

    const next = integrateMovement(
      position[0] as number,
      position[2] as number,
      movementX,
      movementY,
      yaw,
      deltaSeconds,
      this.config.moveSpeed.value,
      this.config.maxDeltaMs.value,
    );

    position[0] = next.x;
    position[2] = next.z;
  }

  /**
   * Apply an authoritative correction, then replay unacknowledged input.
   *
   * @param networkId Entity the correction targets.
   * @param lastProcessedSequence Highest input sequence the server has consumed.
   * @param serverPosition Authoritative position as of that sequence.
   */
  reconcile(
    networkId: number,
    lastProcessedSequence: number,
    serverPosition: { x: number; y: number; z: number },
  ): void {
    const entity = this.findOwnedEntity(networkId);
    if (!entity) return;

    // Discard everything the server has already accounted for.
    this.pending = this.pending.filter(
      (input) => input.sequence > lastProcessedSequence,
    );

    const position = entity.getVectorView(Transform, 'position');

    // Where our own prediction says we were at that same moment: the current
    // position minus every input the server has not yet seen.
    const predictedX = position[0] as number;
    const predictedY = position[1] as number;
    const predictedZ = position[2] as number;

    position[0] = serverPosition.x;
    position[1] = serverPosition.y;
    position[2] = serverPosition.z;

    for (const input of this.pending) {
      this.applyInput(
        entity,
        input.movementX,
        input.movementY,
        input.yaw,
        input.deltaSeconds,
      );
    }

    const dx = (position[0] as number) - predictedX;
    const dy = (position[1] as number) - predictedY;
    const dz = (position[2] as number) - predictedZ;
    const errorSquared = dx * dx + dy * dy + dz * dz;
    const epsilon = this.config.reconcileEpsilon.value;

    if (errorSquared < epsilon * epsilon) {
      // The prediction was right. Restore the predicted position verbatim so a
      // sub-millimetre difference cannot accumulate into visible micro-jitter.
      position[0] = predictedX;
      position[1] = predictedY;
      position[2] = predictedZ;
      this.correctionsIgnored++;
      return;
    }

    this.corrections++;
  }

  private findOwnedEntity(networkId: number): Entity | undefined {
    for (const entity of this.queries.predicted.entities) {
      if (!entity.getValue(Networked, 'isLocalOwner')) continue;
      if ((entity.getValue(Networked, 'networkId') ?? 0) === networkId) return entity;
    }
    return undefined;
  }
}
