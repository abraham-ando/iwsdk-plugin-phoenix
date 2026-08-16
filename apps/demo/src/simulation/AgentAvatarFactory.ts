/**
 * Visible stylized villager avatars (étape 3). Full RPM GLB rigs arrive with
 * étape 4 (dialogue + lipsync); this factory keeps the same semantic
 * animation contract (AgentView.animation) so the swap is renderer-only.
 */
import {
  Group,
  Mesh,
  CylinderGeometry,
  SphereGeometry,
  MeshStandardMaterial,
  Color,
} from '@iwsdk/core';
import type { AgentView } from '@iwsdk/cardinal-simulation';

export function createAgentAvatar(
  name: string,
  color: number,
  gender: 'masculine' | 'feminine'
): Group {
  const avatar = new Group();
  avatar.name = `Avatar_${name}`;
  const height = gender === 'feminine' ? 1.6 : 1.7;
  const bodyHeight = height * 0.62;
  const bodyRadius = gender === 'feminine' ? 0.16 : 0.19;

  const skinMat = new MeshStandardMaterial({ color: 0xc68863, roughness: 0.8 });
  const clothMat = new MeshStandardMaterial({ color, roughness: 0.85 });

  const body = new Mesh(new CylinderGeometry(bodyRadius, bodyRadius * 0.8, bodyHeight, 10), clothMat);
  body.name = 'body';
  body.position.y = bodyHeight * 0.5 + height * 0.08;
  avatar.add(body);

  const head = new Mesh(new SphereGeometry(height * 0.09, 12, 12), skinMat);
  head.name = 'head';
  head.position.y = bodyHeight + height * 0.08 + height * 0.1;
  avatar.add(head);

  const beltMat = new MeshStandardMaterial({
    color: new Color(color).multiplyScalar(0.6),
    roughness: 0.9,
  });
  const belt = new Mesh(new CylinderGeometry(bodyRadius * 1.05, bodyRadius * 1.05, 0.06, 10), beltMat);
  belt.position.y = bodyHeight * 0.55 + height * 0.08;
  avatar.add(belt);

  return avatar;
}

export function applyAvatarPose(
  avatar: Group,
  animation: AgentView['animation'],
  timeSeconds: number
): void {
  // Reset neutral pose first — poses must never accumulate frame to frame.
  avatar.rotation.x = 0;
  avatar.scale.set(1, 1, 1);
  let bob = 0;

  switch (animation) {
    case 'walk':
      bob = Math.sin(timeSeconds * 8) * 0.03;
      break;
    case 'gather':
    case 'craft':
      avatar.rotation.x = 0.5;
      avatar.scale.y = 0.92;
      break;
    case 'rest':
      avatar.scale.y = 0.7;
      break;
    case 'sleep':
      avatar.rotation.x = -Math.PI / 2;
      break;
    case 'idle':
      bob = Math.sin(timeSeconds * 1.5) * 0.008; // subtle breathing
      break;
  }
  avatar.position.y += bob;
}
