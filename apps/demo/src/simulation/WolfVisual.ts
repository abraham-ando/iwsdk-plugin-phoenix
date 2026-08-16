/**
 * Visible wolf mesh, projected each frame from the engine's WolfSystem view
 * (spec §13.6). Stylized primitives matching the villager avatars' look.
 */
import {
  Group,
  Mesh,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  Color,
} from '@iwsdk/core';
import type { WolfMode } from '@iwsdk/cardinal-simulation';

export class WolfVisual {
  private readonly wolf: Group;

  constructor(root: Group) {
    this.wolf = new Group();
    this.wolf.name = 'Predator_Wolf';

    const furMat = new MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
    const eyeMat = new MeshStandardMaterial({
      color: 0xef4444,
      emissive: new Color(0xff0000),
      roughness: 0.1,
    });

    const body = new Mesh(new BoxGeometry(0.4, 0.35, 0.8), furMat);
    body.position.set(0, 0.45, 0);
    this.wolf.add(body);

    const head = new Mesh(new BoxGeometry(0.25, 0.22, 0.35), furMat);
    head.position.set(0, 0.62, 0.45);
    this.wolf.add(head);

    const leftEye = new Mesh(new SphereGeometry(0.03, 6, 6), eyeMat);
    leftEye.position.set(-0.08, 0.66, 0.58);
    this.wolf.add(leftEye);

    const rightEye = new Mesh(new SphereGeometry(0.03, 6, 6), eyeMat);
    rightEye.position.set(0.08, 0.66, 0.58);
    this.wolf.add(rightEye);

    const ear1 = new Mesh(new CylinderGeometry(0, 0.04, 0.12, 4), furMat);
    ear1.position.set(-0.09, 0.76, 0.38);
    this.wolf.add(ear1);
    const ear2 = new Mesh(new CylinderGeometry(0, 0.04, 0.12, 4), furMat);
    ear2.position.set(0.09, 0.76, 0.38);
    this.wolf.add(ear2);

    root.add(this.wolf);
  }

  update(view: { x: number; y: number; z: number; heading: number; mode: WolfMode }): void {
    this.wolf.position.set(view.x, view.y, view.z);
    this.wolf.rotation.y = view.heading;
    // A stalking wolf crouches; a fleeing one leans forward.
    this.wolf.scale.y = view.mode === 'stalk' ? 0.85 : 1;
    this.wolf.rotation.x = view.mode === 'flee' ? 0.12 : 0;
  }
}
