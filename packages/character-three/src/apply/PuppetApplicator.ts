import { Color, type Material, type Object3D } from '@iwsdk/core';
import type { CompiledCharacter } from '@iwsdk/cardinal-character';
import { cloneMaterials, disposeMaterials } from './materials';
import { rampColour } from './ramp';
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
  /** Les matériaux qui NOUS appartiennent : les clones, et eux seuls. */
  private readonly owned: Material[] = [];

  constructor(private readonly opts: PuppetApplicatorOptions) {
    // Seuls les nœuds que cet applicateur va TEINTER sont clonés : le reste de
    // la marionnette n'est jamais muté, donc rien ne justifierait de lui
    // retirer le matériau partagé de l'asset.
    const tinted = new Set<string>();
    for (const names of Object.values(opts.surfaceTargets)) {
      for (const name of names) tinted.add(name);
    }
    if (tinted.size === 0) return;
    opts.rigRoot.traverse((node) => {
      if (tinted.has(node.name)) cloneMaterials(node, this.owned);
    });
  }

  applyRestPose(compiled: CompiledCharacter): void {
    for (const bone of compiled.restPose) {
      const node = this.opts.nodes.get(bone.role);
      if (node === undefined) continue;
      node.position.set(bone.position[0], bone.position[1], bone.position[2]);
      node.scale.setScalar(bone.scale);
    }
    // Même ordre que `SkinnedApplicator` : l'ancrage d'abord, la mise à jour
    // des matrices ensuite, pour que les matrices rendues à l'appelant portent
    // déjà le décalage au sol.
    this.opts.rigRoot.position.y = compiled.stats.groundOffsetMeters;
    this.opts.rigRoot.updateMatrixWorld(true);
  }

  /**
   * No-op délibéré : une marionnette n'a pas de morph targets. Le fait a déjà
   * été dit UNE fois, par le résolveur, qui a rempli `missingMorphs` en ne
   * trouvant aucun `morphTargetDictionary`. Le répéter par frame serait du
   * bruit, et lever transformerait un import jugé acceptable en plantage.
   */
  applyMorphs(_morphs: Readonly<Record<string, number>>): void {}

  applySurface(surface: Readonly<Record<string, number>>): void {
    for (const key in surface) {
      const ramp = this.opts.ramps[key];
      const targets = this.opts.surfaceTargets[key];
      if (ramp === undefined || targets === undefined) continue;
      rampColour(this.colour, ramp, surface[key]!);
      this.opts.rigRoot.traverse((node) => {
        if (!targets.includes(node.name)) return;
        // Notre CLONE, posé par le constructeur sur ces mêmes nœuds.
        const material = (node as { material?: { color?: Color } }).material;
        material?.color?.copy(this.colour);
      });
    }
  }

  dispose(): void {
    disposeMaterials(this.owned);
  }
}
