/**
 * Contrat structurel minimal, comme `RngLike` l'est pour l'aléatoire : tout
 * `Object3D` le satisfait sans le savoir, et le résolveur reste testable sans
 * navigateur — ce qui est le point, puisque c'est ici que vit la différence
 * entre un asset rejeté proprement et un personnage silencieusement difforme.
 */
export interface RigNode {
  readonly name: string;
  readonly children: readonly RigNode[];
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly quaternion: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  /** Présent sur un maillage porteur de morphs, absent sinon. */
  readonly morphTargetDictionary?: Readonly<Record<string, number>>;
}

export interface ImportReport {
  family: string;
  matched: Array<{ role: string; nodeName: string; viaAlias: string }>;
  missingBones: string[];
  missingMorphs: string[];
  missingSurfaces: string[];
  accepted: boolean;
}
