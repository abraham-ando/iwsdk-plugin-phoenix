import { describe, it, expect } from 'vitest';
import { World, DomeGradient, IBLGradient } from '@iwsdk/core';
import { CelestialTime, SkyModel, StarField } from '../src/atmosphere/components';
import { CelestialTimeSystem } from '../src/atmosphere/CelestialTimeSystem';
import { SkyRenderSystem, IBL_REFRESH_ELEVATION_DEG } from '../src/atmosphere/SkyRenderSystem';
import { StarFieldSystem } from '../src/atmosphere/StarFieldSystem';

/**
 * Systems are driven explicitly, in order — the pattern already used by
 * packages/ai (see test/ai-lod.test.ts). It keeps the test deterministic and
 * independent of any scheduler in the mock.
 */
function makeWorld() {
  const world = new World();
  world
    .registerComponent(CelestialTime)
    .registerComponent(SkyModel)
    .registerComponent(StarField)
    .registerComponent(DomeGradient)
    .registerComponent(IBLGradient);
  world.registerSystem(CelestialTimeSystem);
  world.registerSystem(SkyRenderSystem);
  world.registerSystem(StarFieldSystem);
  return {
    world,
    time: world.getSystem(CelestialTimeSystem) as CelestialTimeSystem,
    sky: world.getSystem(SkyRenderSystem) as SkyRenderSystem,
    stars: world.getSystem(StarFieldSystem) as StarFieldSystem,
    /** One simulated frame: astronomy first, then rendering. */
    frame(): void {
      this.time.update(0.016, 0);
      this.sky.update(0.016, 0);
      this.stars.update(0.016, 0);
    },
  };
}

function makeSkyEntity(world: World, hour: number) {
  const entity = world.createEntity();
  entity.addComponent(CelestialTime, { hour, latitudeDeg: 45, dayOfYear: 80 });
  entity.addComponent(SkyModel, {});
  entity.addComponent(StarField, {});
  entity.addComponent(DomeGradient, {});
  entity.addComponent(IBLGradient, {});
  return entity;
}

describe('CelestialTimeSystem', () => {
  it('writes the solar position into SkyModel and raises _needsUpdate', () => {
    const rig = makeWorld();
    const entity = makeSkyEntity(rig.world, 12);
    entity.setValue(SkyModel, '_needsUpdate', false);
    rig.time.update(0.016, 0);
    expect(entity.getValue(SkyModel, 'sunElevationDeg')).toBeCloseTo(45, 0);
    expect(entity.getValue(SkyModel, '_needsUpdate')).toBe(true);
  });

  it('reports a sun below the horizon at midnight', () => {
    const rig = makeWorld();
    const entity = makeSkyEntity(rig.world, 0);
    rig.time.update(0.016, 0);
    expect(entity.getValue(SkyModel, 'sunElevationDeg')).toBeLessThan(0);
  });
});

describe('SkyRenderSystem', () => {
  it('drives the dome gradient from the sky model', () => {
    const rig = makeWorld();
    const entity = makeSkyEntity(rig.world, 12);
    rig.frame();
    const sky = entity.getVectorView(DomeGradient, 'sky');
    expect(sky[2]).toBeGreaterThan(sky[0]!); // midday sky is blue-dominant
    expect(entity.getValue(DomeGradient, '_needsUpdate')).toBe(true);
    expect(entity.getValue(DomeGradient, 'intensity') ?? 0).toBeGreaterThan(0);
  });

  it('clears _needsUpdate on the sky model once applied', () => {
    const rig = makeWorld();
    const entity = makeSkyEntity(rig.world, 12);
    rig.frame();
    expect(entity.getValue(SkyModel, '_needsUpdate')).toBe(false);
  });

  it('throttles IBL regeneration to meaningful sun movement', () => {
    const rig = makeWorld();
    const entity = makeSkyEntity(rig.world, 12);
    rig.frame();
    const afterFirst = rig.sky.iblRefreshCount;
    expect(afterFirst).toBe(1); // first application always refreshes

    // A tiny step moves the sun far less than the threshold.
    entity.setValue(CelestialTime, 'hour', 12.01);
    rig.frame();
    expect(rig.sky.iblRefreshCount).toBe(afterFirst);

    // A large jump exceeds the threshold and refreshes again.
    entity.setValue(CelestialTime, 'hour', 17);
    rig.frame();
    expect(rig.sky.iblRefreshCount).toBe(afterFirst + 1);
    expect(IBL_REFRESH_ELEVATION_DEG).toBe(1);
  });

  it('darkens the dome under a storm', () => {
    const rig = makeWorld();
    const clearEntity = makeSkyEntity(rig.world, 12);
    const stormEntity = makeSkyEntity(rig.world, 12);
    stormEntity.setValue(CelestialTime, 'weather', 3); // storm
    rig.frame();
    const clearSky = clearEntity.getVectorView(DomeGradient, 'sky');
    const stormSky = stormEntity.getVectorView(DomeGradient, 'sky');
    const luminance = (c: ArrayLike<number>) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    expect(luminance(stormSky)).toBeLessThan(luminance(clearSky));
  });
});

describe('StarFieldSystem', () => {
  it('shows stars at night and hides them by day', () => {
    const rig = makeWorld();
    const entity = makeSkyEntity(rig.world, 0);
    rig.frame();
    expect(entity.getValue(StarField, 'opacity')).toBeGreaterThan(0.5);

    entity.setValue(CelestialTime, 'hour', 12);
    rig.frame();
    expect(entity.getValue(StarField, 'opacity')).toBe(0);
  });
});
