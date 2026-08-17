export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];

/** Un os tel que mesuré dans le rig source, avant toute morphologie. */
export interface BoneRest {
  role: string;
  /** Translation locale par rapport au parent, en mètres. */
  position: Vec3;
  /** Quaternion de repos, mesuré par le résolveur. Nécessaire pour composer
   *  la chaîne : sans lui, l'ancrage serait juste pour un rig aligné sur Y et
   *  faux pour tout autre. */
  rotation: Vec4;
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
  morphs: Record<string, number>;
  /**
   * Un ton par gène du groupe `surface`, scalaires normalisés. Le type ne
   * connaît donc aucun nom de gène : une famille à fourrure déclare `furTone`
   * et le compilateur le porte sans rien savoir de lui. La conversion en
   * couleur appartient au pont.
   */
  surface: Record<string, number>;
  stats: {
    /**
     * Hauteur NOMINALE : `restHeightMeters × bodyScale × stature`. Elle ne rend
     * compte que de l'âge et de la stature.
     */
    nominalHeightMeters: number;
    /**
     * Décalage vertical à appliquer au rig pour que l'os d'appui repose à zéro.
     * Vaut 0 si la famille ne déclare pas de `groundRole`.
     */
    groundOffsetMeters: number;
  };
}
