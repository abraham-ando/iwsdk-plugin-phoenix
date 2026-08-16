import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { MaterialLibrary } from '../src/materials/MaterialLibrary';
import { ProceduralMaterial } from '../src/materials/components';
import { MaterialSystem } from '../src/materials/MaterialSystem';
import { SkyModel } from '../src/atmosphere/components';
import { ExposureSystem } from '../src/atmosphere/ExposureSystem';
import { applyColorManagement } from '../src/core/colorManagement';

function makeWorld(library: MaterialLibrary) {
  const world = new World();
  world.registerComponent(ProceduralMaterial).registerComponent(SkyModel);
  world.registerSystem(MaterialSystem, { configData: { library } });
  world.registerSystem(ExposureSystem);
  return {
    world,
    materials: world.getSystem(MaterialSystem) as MaterialSystem,
    exposure: world.getSystem(ExposureSystem) as ExposureSystem,
  };
}

describe('MaterialSystem', () => {
  it('applies the library material to the entity object and clears the flag', () => {
    const library = new MaterialLibrary('low');
    const rig = makeWorld(library);
    const entity = rig.world.createEntity();
    const mesh = { material: null as unknown };
    (entity as unknown as { object3D: unknown }).object3D = mesh;
    entity.addComponent(ProceduralMaterial, { materialId: 'grass' });

    rig.materials.update(0.016, 0);
    expect(mesh.material).toBe(library.get('grass'));
    expect(entity.getValue(ProceduralMaterial, '_needsUpdate')).toBe(false);
    expect(rig.materials.appliedCount).toBe(1);
  });

  it('does not reapply on later frames', () => {
    const library = new MaterialLibrary('low');
    const rig = makeWorld(library);
    const entity = rig.world.createEntity();
    (entity as unknown as { object3D: unknown }).object3D = { material: null };
    entity.addComponent(ProceduralMaterial, { materialId: 'rock' });

    rig.materials.update(0.016, 0);
    rig.materials.update(0.016, 0);
    rig.materials.update(0.016, 0);
    expect(rig.materials.appliedCount).toBe(1);
  });

  it('ignores an unknown material id instead of throwing', () => {
    const library = new MaterialLibrary('low');
    const rig = makeWorld(library);
    const entity = rig.world.createEntity();
    (entity as unknown as { object3D: unknown }).object3D = { material: null };
    entity.addComponent(ProceduralMaterial, { materialId: 'unobtanium' });

    expect(() => rig.materials.update(0.016, 0)).not.toThrow();
    expect(rig.materials.appliedCount).toBe(0);
  });
});

describe('ExposureSystem', () => {
  it('drives tone mapping exposure from the sky model', () => {
    const library = new MaterialLibrary('low');
    const rig = makeWorld(library);
    const renderer = { toneMappingExposure: 1 };
    (rig.world as unknown as { renderer: unknown }).renderer = renderer;

    const entity = rig.world.createEntity();
    entity.addComponent(SkyModel, { exposure: 0.8 });
    rig.exposure.update(0.016, 0);
    expect(renderer.toneMappingExposure).toBeCloseTo(0.8);
    expect(rig.exposure.lastExposure).toBeCloseTo(0.8);
  });

  it('survives a world without a renderer (headless tests, workers)', () => {
    const library = new MaterialLibrary('low');
    const rig = makeWorld(library);
    const entity = rig.world.createEntity();
    entity.addComponent(SkyModel, { exposure: 1.2 });
    expect(() => rig.exposure.update(0.016, 0)).not.toThrow();
  });
});

describe('applyColorManagement', () => {
  it('sets the output colour space and ACES tone mapping', () => {
    const renderer = { outputColorSpace: '', toneMapping: 0 };
    expect(applyColorManagement(renderer)).toBe(true);
    expect(renderer.outputColorSpace).toBe('srgb');
    expect(renderer.toneMapping).toBe(4); // ACESFilmicToneMapping in the mock
  });

  it('reports when it did nothing, so a silent no-op stays visible', () => {
    expect(applyColorManagement(undefined)).toBe(false);
  });
});
