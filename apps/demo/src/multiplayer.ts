/**
 * The application half of multiplayer.
 *
 * `@iwsdk/plugin-phoenix` replicates entities; it does not decide *which*
 * entities exist or what they look like. That is this system's job, and it is
 * the part every application has to write for itself:
 *
 *   1. publish the local player's head pose under the id the server assigned us
 *   2. instantiate an avatar when the server announces another peer, and remove
 *      it when that peer leaves
 *   3. ask the server for authority before letting the player move a shared
 *      object, and back off when the answer is no
 *
 * Step 3 is the one worth reading. Grabbing is optimistic locally — the object
 * follows your hand the instant you squeeze — but *authority* is not: we wait
 * for the server's verdict, and release the object if we lost the race. Two
 * players reaching for the same plant at the same moment is a race with exactly
 * one winner, and predicting a win would have both of them publishing
 * transforms for it until the correction lands.
 */
import {
  Grabbed,
  GrabSystem,
  Quaternion,
  Transform,
  Types,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import {
  Networked,
  NetworkedTransform,
  PhoenixNetworkSystem,
} from '@iwsdk/plugin-phoenix';
import type { PhoenixNetworkingHandle } from '@iwsdk/plugin-phoenix';
import { createAvatar, disposeAvatar } from './avatar.js';
import type { DemoHud } from './hud.js';
import { spawnPointFor } from './spawn.js';

/**
 * Network id of the shared plant.
 *
 * Scene-authored objects exist on every client before anyone connects, so
 * unlike players and server-spawned objects they get no id from the room —
 * every peer has to arrive at the same number independently. A constant is the
 * honest way to do that for a fixed scene. It is well clear of the room's
 * allocator, which counts up from 1, and the server happily arbitrates
 * ownership for an id it has never seen: the first request creates the record.
 *
 * A scene with content authored at runtime needs real id assignment instead —
 * see `docs/rfc/0001-iwsdk-network.md`.
 */
export const SHARED_PLANT_ID = 100_001;

/** Scene node id of that plant, from `public/scenes/main.iwsdk.scene.json`. */
const SHARED_PLANT_NODE = 'plant-sansevieria';

/** `prefab_id` the server stamps on player avatars. */
const AVATAR_PREFAB = 0;

export class MultiplayerSystem extends createSystem(
  {
    /** Shared objects currently held by this player's hands. */
    heldShared: { required: [Networked, Grabbed] },
  },
  {
    /** The handle returned by `installPhoenixNetworking`. */
    net: { type: Types.Object, default: null },
    /** On-screen status readout. */
    hud: { type: Types.Object, default: null },
  },
) {
  /** Remote peers, keyed by the network id the server gave them. */
  private readonly peers = new Map<number, Entity>();

  /** Our own head, republished every frame. */
  private localAvatar!: Entity;

  private plant: Entity | undefined;

  /** Preallocated: `update` runs 90 times a second inside a headset. */
  private headPosition!: Vector3;
  private headRotation!: Quaternion;
  private headScale!: Vector3;

  /** Ownership requests we have sent and not yet had answered. */
  private readonly awaitingOwnership = new Set<number>();

  /** Guards {@link takeSpawnPoint} against firing on every reconnect. */
  private hasSpawned = false;

  init(): void {
    this.headPosition = new Vector3();
    this.headRotation = new Quaternion();
    this.headScale = new Vector3();

    this.localAvatar = this.world.createTransformEntity();
    this.localAvatar.addComponent(Networked, { isLocalOwner: true });
    // Carried even on an owned entity: the network system stores the last pose
    // it published here, and uses it to suppress frames for a player standing
    // perfectly still.
    this.localAvatar.addComponent(NetworkedTransform);

    this.adoptSharedPlant();

    const net = this.net;
    const network = this.world.getSystem(PhoenixNetworkSystem);
    // Nothing to hook up when the demo was started without the plugin. The
    // local avatar and the shared plant above still exist, so the scene behaves
    // identically minus the traffic.
    if (!net || !network) return;

    // The server announces every peer already in the room, then every peer that
    // arrives later, as ordinary SPAWN frames. One code path covers both.
    network.onSpawn = (request) => {
      if (request.prefabId !== AVATAR_PREFAB) return;
      if (request.networkId === network.localOwnerId) return;
      this.addPeer(request.networkId, request.position);
    };

    network.onDespawn = (networkId) => this.removePeer(networkId);

    network.onOwnershipChange = ({ networkId, granted, isLocalOwner }) => {
      this.awaitingOwnership.delete(networkId);

      // We asked, and someone else got there first. Let go: the object is about
      // to start moving under the winner's transforms, and a hand still
      // attached to it would drag it in two directions at once.
      if (!granted || !isLocalOwner) this.releaseIfHeld(networkId);

      this.hud?.setHeld(isLocalOwner && granted ? networkId : 0);
    };

    // Grabbing a shared object is a request, not a decision.
    this.cleanupFuncs.push(
      this.queries.heldShared.subscribe('qualify', (entity) =>
        this.claim(network, entity),
      ),
    );

    this.cleanupFuncs.push(
      net.adapter.onStateChange?.((state) => {
        this.hud?.setConnection(state, network.localOwnerId);
        // Our id only exists once the join reply lands, so this is the earliest
        // point at which the local avatar can be published under it.
        this.localAvatar.setValue(Networked, 'networkId', network.localOwnerId);
        this.takeSpawnPoint(network.localOwnerId);
      }) ?? (() => {}),
    );

    // …and once now, in case the socket connected before this system started.
    this.hud?.setConnection(net.adapter.state, network.localOwnerId);
    this.localAvatar.setValue(Networked, 'networkId', network.localOwnerId);
    this.takeSpawnPoint(network.localOwnerId);
  }

  update(): void {
    // The head's own Transform is expressed relative to the player rig, so
    // locomotion would never show up in it. Replicate the world pose instead.
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    head.matrixWorld.decompose(this.headPosition, this.headRotation, this.headScale);

    const position = this.localAvatar.getVectorView(Transform, 'position');
    position[0] = this.headPosition.x;
    position[1] = this.headPosition.y;
    position[2] = this.headPosition.z;

    const orientation = this.localAvatar.getVectorView(Transform, 'orientation');
    orientation[0] = this.headRotation.x;
    orientation[1] = this.headRotation.y;
    orientation[2] = this.headRotation.z;
    orientation[3] = this.headRotation.w;

    this.hud?.setPeerCount(this.peers.size);
  }

  destroy(): void {
    for (const networkId of [...this.peers.keys()]) this.removePeer(networkId);
  }

  /**
   * Stand this player where its network id says it should stand.
   *
   * Once only. `onStateChange` fires again on every reconnect, and teleporting
   * a player back to their spawn because a socket blipped would be a worse bug
   * than the overlap this fixes. The room re-issues the same id to the same
   * peer anyway, so there is nothing to correct.
   */
  private takeSpawnPoint(networkId: number): void {
    if (networkId === 0 || this.hasSpawned) return;
    this.hasSpawned = true;

    const spawn = spawnPointFor(networkId);
    // The rig, not the head: the head's transform is relative to it, and
    // locomotion moves the same object afterwards.
    this.player.position.set(spawn.x, this.player.position.y, spawn.z);
    this.player.rotation.y = spawn.yaw;
  }

  /** The plugin handle, or `null` when the demo runs single player. */
  private get net(): PhoenixNetworkingHandle | null {
    return (this.config.net.value as PhoenixNetworkingHandle | null) ?? null;
  }

  private get hud(): DemoHud | null {
    return (this.config.hud.value as DemoHud | null) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Peers
  // ---------------------------------------------------------------------------

  private addPeer(
    networkId: number,
    position: { x: number; y: number; z: number },
  ): void {
    if (this.peers.has(networkId)) return;

    const entity = this.world.createTransformEntity(createAvatar(networkId));
    entity.addComponent(Networked, { networkId, isLocalOwner: false, ownerId: networkId });
    entity.addComponent(NetworkedTransform);

    // Seed the spawn pose so the avatar appears where the server says the peer
    // is, rather than sliding in from the origin on its first update.
    const view = entity.getVectorView(Transform, 'position');
    view[0] = position.x;
    view[1] = position.y;
    view[2] = position.z;

    this.peers.set(networkId, entity);
  }

  private removePeer(networkId: number): void {
    const entity = this.peers.get(networkId);
    if (!entity) return;

    this.peers.delete(networkId);

    const object = entity.object3D;
    // `dispose`, never `destroy`: the latter leaves the geometry and material
    // on the GPU.
    entity.dispose();
    if (object) disposeAvatar(object as never);
  }

  // ---------------------------------------------------------------------------
  // Shared objects
  // ---------------------------------------------------------------------------

  /**
   * Turn the scene's plant into a replicated object.
   *
   * It is already authored, already grabbable and already present on every
   * client; all it is missing is a network identity.
   */
  private adoptSharedPlant(): void {
    const plant = this.world.getSceneEntity(SHARED_PLANT_NODE);
    if (!plant) return;

    plant.addComponent(Networked, {
      networkId: SHARED_PLANT_ID,
      // Nobody owns it until someone picks it up. Until then every client just
      // renders it where the scene put it.
      isLocalOwner: false,
      ownerId: 0,
    });
    plant.addComponent(NetworkedTransform);

    this.plant = plant;
  }

  private claim(network: PhoenixNetworkSystem, entity: Entity): void {
    const networkId = entity.getValue(Networked, 'networkId') ?? 0;
    if (networkId === 0) return;
    if (entity.getValue(Networked, 'isLocalOwner')) return;
    if (this.awaitingOwnership.has(networkId)) return;

    if (network.requestOwnership(entity) !== 0) {
      this.awaitingOwnership.add(networkId);
    }
  }

  /** Take an object out of the player's hands after losing the authority race. */
  private releaseIfHeld(networkId: number): void {
    if (this.plant?.getValue(Networked, 'networkId') !== networkId) return;
    if (!this.plant.hasComponent(Grabbed)) return;

    this.world.getSystem(GrabSystem)?.forceRelease(this.plant);
  }
}
