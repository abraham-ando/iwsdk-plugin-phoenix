import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { WaterSurface } from '../src/water/components';
import { WaterSystem } from '../src/water/WaterSystem';
import { SkyModel } from '../src/atmosphere/components';
import { createWaterMaterial } from '../src/water/WaterMaterial';

function makeRig() {
  const world = new World();
  world.registerComponent(WaterSurface).registerComponent(SkyModel);
  world.registerSystem(WaterSystem);
  const system = world.getSystem(WaterSystem) as WaterSystem;
  const material = createWaterMaterial();
  const entity = world.createEntity();
  (entity as unknown as { object3D: unknown }).object3D = { material };
  entity.addComponent(WaterSurface, {});
  return { world, system, material, entity };
}

describe('WaterSystem', () => {
  it("AVANCE LE TEMPS : sans cela l'eau est un miroir figé", () => {
    const rig = makeRig();
    rig.system.update(0.016, 0);
    rig.system.update(0.016, 0.016);
    expect(rig.system.elapsed).toBeCloseTo(0.032, 6);
    expect(rig.material.uniforms.uTime!.value).toBeCloseTo(0.032, 6);
  });

  it("n'accumule pas un delta absurde si une image saute", () => {
    // Un onglet réveillé après une minute enverrait un delta géant, et l'eau
    // sauterait d'un coup au lieu de couler.
    const rig = makeRig();
    rig.system.update(45, 45);
    expect(rig.system.elapsed).toBeLessThan(1);
  });

  it('accorde la couleur réfléchie au ciel du moment', () => {
    // Une eau qui reste bleu ciel à minuit trahit toute la scène.
    const rig = makeRig();
    const sky = rig.world.createEntity();
    sky.addComponent(SkyModel, { exposure: 0.2 });
    rig.system.update(0.016, 0);
    const tint = rig.material.uniforms.uSkyColor!.value as { r: number };
    expect(tint.r).toBeCloseTo(0.53 * 0.2, 5);
  });

  it('survit à une entité sans matériau', () => {
    const world = new World();
    world.registerComponent(WaterSurface).registerComponent(SkyModel);
    world.registerSystem(WaterSystem);
    const system = world.getSystem(WaterSystem) as WaterSystem;
    const entity = world.createEntity();
    entity.addComponent(WaterSurface, {});
    expect(() => system.update(0.016, 0)).not.toThrow();
  });
});
