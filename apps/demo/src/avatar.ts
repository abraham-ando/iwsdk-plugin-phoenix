/**
 * The stand-in body drawn for another person in the room.
 *
 * Deliberately geometry, not a GLTF: an avatar that streams in asynchronously
 * would appear some frames after the peer's first transform arrives, and the
 * thing this demo is showing off is exactly how those first frames behave.
 *
 * Three.js is imported from `@iwsdk/core`, never from `three` — importing the
 * latter directly pulls in a second copy of the library.
 */
import {
  BoxGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  Group,
  SphereGeometry,
} from '@iwsdk/core';

/** Distinct hues so two peers are told apart at a glance. */
const PALETTE = [0x4f9dde, 0xe8833a, 0x6fc26b, 0xc86fd1, 0xd9534f, 0x4fc9c0];

/**
 * Build a head-and-visor avatar.
 *
 * @param networkId Used to pick a stable colour, so a peer keeps the same one
 *   for as long as the session lasts and across everyone else's screens.
 */
export function createAvatar(networkId: number): Group {
  const group = new Group();
  group.name = `peer-${networkId}`;

  const tint = new Color(PALETTE[networkId % PALETTE.length]);

  const head = new Mesh(
    new BoxGeometry(0.22, 0.24, 0.24),
    new MeshStandardMaterial({ color: tint, roughness: 0.55, metalness: 0.05 }),
  );
  group.add(head);

  // A dark band across the front. Without something asymmetric it is impossible
  // to tell which way a remote head is facing, which makes rotation
  // replication — the half most likely to be subtly wrong — invisible.
  const visor = new Mesh(
    new BoxGeometry(0.2, 0.075, 0.02),
    new MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.2, metalness: 0.4 }),
  );
  visor.position.set(0, 0.02, -0.12);
  group.add(visor);

  const nose = new Mesh(
    new SphereGeometry(0.022, 12, 8),
    new MeshStandardMaterial({ color: tint.clone().offsetHSL(0, 0, -0.2) }),
  );
  nose.position.set(0, -0.05, -0.13);
  group.add(nose);

  return group;
}

/** Release the GPU resources `createAvatar` allocated. */
export function disposeAvatar(group: Group): void {
  group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const material = child.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material.dispose();
  });
}
