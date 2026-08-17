import { Color, type Bone, type Object3D, type SkinnedMesh } from '@iwsdk/core';
import type { CompiledCharacter } from '@iwsdk/cardinal-character';
import type { CharacterApplicator } from './types';

export interface SkinnedApplicatorOptions {
  rigRoot: Object3D;
  /** `Object3D` et non `Bone` : l'applicateur n'écrit que `position` et
   *  `scale`, que tout nœud possède. Exiger un `Bone` forcerait un cast chez
   *  l'appelant sans rien garantir de plus. */
  bones: Map<string, Object3D>;
  meshes: SkinnedMesh[];
  morphIndex: Readonly<Record<string, number>>;
  surfaceTargets: Readonly<Record<string, readonly string[]>>;
  ramps: Readonly<Record<string, readonly [string, string]>>;
}

/**
 * Applique une morphologie compilée à un vrai squelette.
 *
 * DEUX gestes, et un troisième à ne surtout pas faire. Déplacer un os EST la
 * déformation : la peau suit parce que la matrice d'os diffère de la matrice de
 * liaison, ce qui est exactement le travail du skinning. Appeler
 * `skeleton.calculateInverses()` rendrait la pose courante neutre et ANNULERAIT
 * la morphologie — mesuré, pas supposé. Les deux premières rédactions de la
 * conception prescrivaient ce rebake ; elles avaient tort.
 */
export class SkinnedApplicator implements CharacterApplicator {
  private readonly lastMorphs = new Map<string, number>();
  private readonly colour = new Color();

  constructor(private readonly opts: SkinnedApplicatorOptions) {}

  applyRestPose(compiled: CompiledCharacter): void {
    for (const bone of compiled.restPose) {
      const target = this.opts.bones.get(bone.role);
      // Un rôle absent n'est pas une erreur ici : le résolveur a déjà rendu son
      // verdict, et lever maintenant transformerait un import déjà jugé
      // acceptable en plantage à l'instanciation.
      if (target === undefined) continue;
      target.position.set(bone.position[0], bone.position[1], bone.position[2]);
      // Scalaire : une similitude ne cisaille pas, une échelle par axe si.
      target.scale.setScalar(bone.scale);
    }

    this.opts.rigRoot.updateMatrixWorld(true);

    // L'ancrage se pose sur le conteneur, pas sur l'os racine : la morphologie
    // du personnage et l'endroit où il se tient sont deux choses distinctes.
    this.opts.rigRoot.position.y = compiled.stats.groundOffsetMeters;
  }

  applyMorphs(morphs: Readonly<Record<string, number>>): void {
    for (const [key, value] of Object.entries(morphs)) {
      if (this.lastMorphs.get(key) === value) continue;
      const index = this.opts.morphIndex[key];
      if (index === undefined) continue;
      for (const mesh of this.opts.meshes) {
        if (mesh.morphTargetInfluences !== undefined) {
          mesh.morphTargetInfluences[index] = value;
        }
      }
      this.lastMorphs.set(key, value);
    }
  }

  applySurface(surface: Readonly<Record<string, number>>): void {
    for (const [key, value] of Object.entries(surface)) {
      const ramp = this.opts.ramps[key];
      const targets = this.opts.surfaceTargets[key];
      if (ramp === undefined || targets === undefined) continue;
      this.colour.set(ramp[0]).lerp(new Color(ramp[1]), value);
      for (const mesh of this.opts.meshes) {
        if (!targets.includes(mesh.name)) continue;
        const material = mesh.material as { color?: Color };
        material.color?.copy(this.colour);
      }
    }
  }

  dispose(): void {
    // Rien à libérer : cet applicateur ne clone aucun matériau, il écrit dans
    // ceux que l'asset porte déjà. Le clonage par individu appartient à
    // l'étape 3, quand plusieurs villageois partageront un même asset — et
    // c'est là qu'il faudra vraiment disposer quelque chose.
    this.lastMorphs.clear();
  }
}
