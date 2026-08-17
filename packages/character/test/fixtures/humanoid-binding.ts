import type { RigBinding } from '../../src/compile/types';

/**
 * Liaison de test : un humanoïde d'un mètre soixante-quinze, bras et jambes
 * alignés sur des axes simples pour que les longueurs soient lisibles.
 *
 * Partagée par les tests du compilateur, des invariants, du cache et des
 * archétypes : la dupliquer dans chaque fichier ferait diverger quatre copies
 * du même squelette. La renvoyer par une FONCTION et non par une constante est
 * délibéré — plusieurs tests mutent la liaison (retirer un os, retirer un
 * morph) et doivent partir d'un exemplaire neuf.
 */
export function humanoidBinding(): RigBinding {
  const os = (role: string, parentRole: string | null, p: readonly [number, number, number]) =>
    [role, { role, parentRole, position: p }] as const;
  return {
    family: 'humanoid',
    restHeightMeters: 1.75,
    morphIndex: { jawWidth: 0, noseSize: 1, eyeScale: 2, cheekbone: 3, bodyMass: 4 },
    bones: Object.fromEntries([
      os('root', null, [0, 0.95, 0]),
      os('spine', 'root', [0, 0.12, 0]),
      os('chest', 'spine', [0, 0.14, 0]),
      os('neck', 'chest', [0, 0.16, 0]),
      os('head', 'neck', [0, 0.09, 0]),
      os('shoulderL', 'chest', [0.05, 0.05, 0]),
      os('upperArmL', 'shoulderL', [0.13, 0, 0]),
      os('foreArmL', 'upperArmL', [0.27, 0, 0]),
      os('handL', 'foreArmL', [0.25, 0, 0]),
      os('shoulderR', 'chest', [-0.05, 0.05, 0]),
      os('upperArmR', 'shoulderR', [-0.13, 0, 0]),
      os('foreArmR', 'upperArmR', [-0.27, 0, 0]),
      os('handR', 'foreArmR', [-0.25, 0, 0]),
      os('upLegL', 'root', [0.09, -0.05, 0]),
      os('legL', 'upLegL', [0, -0.44, 0]),
      os('footL', 'legL', [0, -0.42, 0]),
      os('upLegR', 'root', [-0.09, -0.05, 0]),
      os('legR', 'upLegR', [0, -0.44, 0]),
      os('footR', 'legR', [0, -0.42, 0]),
    ]),
  };
}
