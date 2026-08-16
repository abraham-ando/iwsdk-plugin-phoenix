/** Courbe affine par morceaux, en paires (abscisse, ordonnée) triées. */
export type Curve = ReadonlyArray<readonly [number, number]>;

export type GeneGroup = 'structure' | 'face' | 'surface';

export interface GeneDef {
  /** Ce que coûte l'application du gène : `structure` recompile, les autres non. */
  group: GeneGroup;
  /** Part de la valeur qui vient des parents. 0 = tirage indépendant. */
  heritability: number;
  /** Biais du mélange : 0 tire vers la mère, 1 vers le père, 0.5 est neutre. */
  dominance: number;
  /** Amplitude maximale de la mutation, en unités de gène. */
  mutationRate: number;
  /** Gène atténué chez l'autre sexe. Absent = non lié au sexe. */
  sexLinked?: 'f' | 'm';
}

export interface ChainDef {
  /** Os de départ, exclu de la mise à l'échelle : il porte la chaîne. */
  from: string;
  /** Os terminal, inclus. */
  to: string;
  /** Gène qui pilote la longueur de cette chaîne. */
  gene: string;
  /** Couple (départ, terminal) du côté opposé, mis à l'échelle à l'identique. */
  mirror?: readonly [string, string];
  /**
   * Vrai pour un membre, faux pour le tronc. Requis et non optionnel : le
   * compilateur applique le rapport membres/tronc selon ce champ, et un défaut
   * implicite ferait exactement l'erreur qu'on veut rendre impossible.
   */
  limb: boolean;
}

export interface MorphDef {
  aliases: readonly string[];
  range: readonly [number, number];
}

export interface FamilyDescriptor {
  id: string;
  /** Rôle sémantique → alias acceptés, dans l'ordre de préférence. */
  bones: Readonly<Record<string, readonly string[]>>;
  chains: Readonly<Record<string, ChainDef>>;
  morphs: Readonly<Record<string, MorphDef>>;
  proportions: {
    /** Rapport tête/corps selon l'âge. */
    headToBody: Curve;
    /** Rapport membres/tronc selon l'âge. */
    limbToTorso: Curve;
    /** Taille globale selon l'âge, 1 à l'âge adulte. */
    bodyScale: Curve;
  };
  slots: Readonly<Record<string, string>>;
  genes: Readonly<Record<string, GeneDef>>;
  /** Âge auquel les courbes valent leur référence adulte. */
  adultAge: number;
}
