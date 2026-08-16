export type Vec3 = readonly [number, number, number];

/** Un os tel que mesuré dans le rig source, avant toute morphologie. */
export interface BoneRest {
  role: string;
  /** Translation locale par rapport au parent, en mètres. */
  position: Vec3;
  parentRole: string | null;
}

/**
 * Ce que le pont Three mesure sur un asset réel et passe au compilateur.
 * Aucun objet Three ne franchit cette frontière : c'est ce qui garde le
 * compilateur testable en Node et comparable par vecteurs dorés.
 */
export interface RigBinding {
  family: string;
  bones: Readonly<Record<string, BoneRest>>;
  /** Clé de morph de la famille → index dans morphTargetInfluences. */
  morphIndex: Readonly<Record<string, number>>;
  /** Hauteur du personnage adulte médian dans le rig source. */
  restHeightMeters: number;
}

export interface CompiledBone {
  role: string;
  position: Vec3;
  /** Échelle UNIFORME. Une similitude ne cisaille pas ; une échelle par axe si. */
  scale: number;
}

export interface CompiledCharacter {
  family: string;
  restPose: CompiledBone[];
  /** Toujours vrai : la pose de repos a changé, les matrices inverses aussi. */
  rebindSkeleton: boolean;
  morphs: Record<string, number>;
  /** Scalaires normalisés. La conversion en couleur appartient au pont. */
  surface: { skinTone: number; hairTone: number; hairStyle: number };
  stats: { heightMeters: number };
}
