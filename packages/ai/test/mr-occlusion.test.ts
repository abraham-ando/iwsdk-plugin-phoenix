import { describe, it, expect } from 'vitest';
import { MRDepthOcclusionHelper } from '../src/mr/MRDepthOcclusionHelper';

describe('MRDepthOcclusionHelper', () => {
  it('applies depth testing and render order offsets to mesh materials', () => {
    const mockMesh = {
      isMesh: true,
      material: {
        depthTest: false,
        depthWrite: false,
        transparent: false,
        needsUpdate: false,
      },
      renderOrder: 1,
    };

    const mockRoot = {
      traverse: (cb: (child: any) => void) => {
        cb(mockMesh);
      },
    };

    MRDepthOcclusionHelper.applyMROcclusion(mockRoot, {
      depthTest: true,
      depthWrite: true,
      renderOrderOffset: 2,
    });

    expect(mockMesh.material.depthTest).toBe(true);
    expect(mockMesh.material.depthWrite).toBe(true);
    expect(mockMesh.material.transparent).toBe(true);
    expect(mockMesh.renderOrder).toBe(3);
  });
});
