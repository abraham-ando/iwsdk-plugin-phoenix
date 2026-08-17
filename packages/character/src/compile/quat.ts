import type { Vec3, Vec4 } from './types';

/**
 * Produit de deux quaternions, `a` puis `b`. Écrit ici et pas emprunté à Three :
 * le paquet n'a aucune dépendance, et c'est ce qui lui permet de composer une
 * chaîne d'os en Node comme dans un casque.
 */
export function quatMul(a: Vec4, b: Vec4): Vec4 {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Applique une rotation à un vecteur : v' = q · v · q⁻¹, forme développée. */
export function quatRotate(q: Vec4, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 · (q_vec × v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}
