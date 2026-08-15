export interface MROcclusionConfig {
  depthOcclusionEnabled: boolean;
  depthTest: boolean;
  depthWrite: boolean;
  renderOrderOffset?: number;
}

/**
 * Helper configuring NPC materials and gizmos for Meta Quest Mixed Reality (Passthrough & Depth Sensing).
 */
export class MRDepthOcclusionHelper {
  /**
   * Apply WebXR depth sensing occlusion flags to a Three.js material or Object3D hierarchy.
   */
  public static applyMROcclusion(object3D: any, config: Partial<MROcclusionConfig> = {}): void {
    if (!object3D || typeof object3D.traverse !== 'function') return;

    const opts: MROcclusionConfig = {
      depthOcclusionEnabled: true,
      depthTest: true,
      depthWrite: true,
      renderOrderOffset: 0,
      ...config,
    };

    object3D.traverse((child: any) => {
      if (child.isMesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of materials) {
          mat.depthTest = opts.depthTest;
          mat.depthWrite = opts.depthWrite;
          mat.transparent = true;
          mat.needsUpdate = true;
        }
        if (opts.renderOrderOffset) {
          child.renderOrder = (child.renderOrder ?? 0) + opts.renderOrderOffset;
        }
      }
    });
  }
}
