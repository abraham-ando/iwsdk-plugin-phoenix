import { Color, type Object3D } from '@iwsdk/core';
import type { CompiledCharacter } from '@iwsdk/cardinal-character';
import type { CharacterApplicator } from './types';

export interface PuppetApplicatorOptions {
  rigRoot: Object3D;
  nodes: Map<string, Object3D>;
  surfaceTargets: Readonly<Record<string, readonly string[]>>;
  ramps: Readonly<Record<string, readonly [string, string]>>;
}

/**
 * Applique la même morphologie à une hiérarchie non skinnée — la marionnette
 * que `createRPMAvatar` produit aujourd'hui. Aucune matrice inverse n'entre en
 * jeu : déplacer un nœud déplace ce qui pend dessous, et c'est tout.
 */
export class PuppetApplicator implements CharacterApplicator {
  private readonly colour = new Color();

  constructor(private readonly opts: PuppetApplicatorOptions) {}

  applyRestPose(compiled: CompiledCharacter): void {
    for (const bone of compiled.restPose) {
      const node = this.opts.nodes.get(bone.role);
      if (node === undefined) continue;
      node.position.set(bone.position[0], bone.position[1], bone.position[2]);
      node.scale.setScalar(bone.scale);
    }
    this.opts.rigRoot.updateMatrixWorld(true);
    this.opts.rigRoot.position.y = compiled.stats.groundOffsetMeters;
  }

  /**
   * No-op délibéré : une marionnette n'a pas de morph targets. Le fait a déjà
   * été dit UNE fois, par le résolveur, qui a rempli `missingMorphs` en ne
   * trouvant aucun `morphTargetDictionary`. Le répéter par frame serait du
   * bruit, et lever transformerait un import jugé acceptable en plantage.
   */
  applyMorphs(_morphs: Readonly<Record<string, number>>): void {}

  applySurface(surface: Readonly<Record<string, number>>): void {
    for (const [key, value] of Object.entries(surface)) {
      const ramp = this.opts.ramps[key];
      const targets = this.opts.surfaceTargets[key];
      if (ramp === undefined || targets === undefined) continue;
      this.colour.set(ramp[0]).lerp(new Color(ramp[1]), value);
      this.opts.rigRoot.traverse((node) => {
        if (!targets.includes(node.name)) return;
        const material = (node as { material?: { color?: Color } }).material;
        material?.color?.copy(this.colour);
      });
    }
  }

  dispose(): void {}
}
