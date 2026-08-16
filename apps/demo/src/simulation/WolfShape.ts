/**
 * La FORME du loup — du contenu de démo, rien de plus.
 *
 * Sa projection appartient désormais à `FaunaSystem` de @iwsdk/cardinal-world,
 * qui place tout animal exposant une vue sans savoir de quelle espèce il
 * s'agit (spec §8). Ce fichier ne connaît plus que des primitives.
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

export class WolfShape {
  /** Construit la forme, sans la placer : le placement vient du moteur. */
  public static create(): Group {
    const wolf = new Group();
    wolf.name = 'Predator_Wolf';

    const furMat = new MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
    const eyeMat = new MeshStandardMaterial({
      color: 0xef4444,
      emissive: new Color(0xff0000),
      roughness: 0.1,
    });

    const body = new Mesh(new BoxGeometry(0.4, 0.35, 0.8), furMat);
    body.position.set(0, 0.45, 0);
    wolf.add(body);

    const head = new Mesh(new BoxGeometry(0.25, 0.22, 0.35), furMat);
    head.position.set(0, 0.62, 0.45);
    wolf.add(head);

    const leftEye = new Mesh(new SphereGeometry(0.03, 6, 6), eyeMat);
    leftEye.position.set(-0.08, 0.66, 0.58);
    wolf.add(leftEye);

    const rightEye = new Mesh(new SphereGeometry(0.03, 6, 6), eyeMat);
    rightEye.position.set(0.08, 0.66, 0.58);
    wolf.add(rightEye);

    const ear1 = new Mesh(new CylinderGeometry(0, 0.04, 0.12, 4), furMat);
    ear1.position.set(-0.09, 0.76, 0.38);
    wolf.add(ear1);
    const ear2 = new Mesh(new CylinderGeometry(0, 0.04, 0.12, 4), furMat);
    ear2.position.set(0.09, 0.76, 0.38);
    wolf.add(ear2);

    return wolf;
  }
}
