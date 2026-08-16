import { describe, it, expect } from 'vitest';
import { WeatherMachine, WEATHER_CHECK_PERIOD } from '../src/world/WeatherMachine';
import { SimKernel } from '../src/kernel/SimKernel';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { snapshotSim, restoreSim } from '../src/kernel/snapshot';

function setup(seed: number) {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  const kernel = new SimKernel({ seed });
  const world = new GroundTruthWorld(reg);
  world.attachTo(kernel);
  const weather = new WeatherMachine();
  weather.attachTo(kernel, world);
  return { reg, kernel, world, weather };
}

describe('WeatherMachine', () => {
  it('starts clear and only transitions on period boundaries', () => {
    const { kernel, weather } = setup(1);
    expect(weather.current).toBe('clear');
    for (let t = 0; t < WEATHER_CHECK_PERIOD - 1; t++) kernel.step();
    expect(weather.current).toBe('clear'); // no boundary crossed yet
  });

  it('is deterministic: same seed, same weather history', () => {
    const a = setup(7);
    const b = setup(7);
    const historyA: string[] = [];
    const historyB: string[] = [];
    a.weather.onChange((s) => historyA.push(s));
    b.weather.onChange((s) => historyB.push(s));
    for (let t = 0; t < WEATHER_CHECK_PERIOD * 40; t++) {
      a.kernel.step();
      b.kernel.step();
    }
    expect(historyA).toEqual(historyB);
    expect(historyA.length).toBeGreaterThan(0); // it did change at least once over 40 checks
  });

  it('entering rain extinguishes every lit campfire', () => {
    const { kernel, world, weather } = setup(1);
    const fire = world.spawn('campfire', 0, 0);
    fire.state.lit = 1;
    weather.force('rain', kernel.tick, world);
    expect(weather.current).toBe('rain');
    expect(fire.state.lit).toBe(0);
  });

  it('force notifies listeners and unsubscribe works', () => {
    const { kernel, world, weather } = setup(1);
    const seen: string[] = [];
    const off = weather.onChange((s) => seen.push(s));
    weather.force('storm', kernel.tick, world);
    off();
    weather.force('clear', kernel.tick, world);
    expect(seen).toEqual(['storm']);
  });

  it('rides along snapshots', () => {
    const { kernel, world, weather } = setup(3);
    weather.force('cloudy', kernel.tick, world);
    const snap = JSON.parse(JSON.stringify(snapshotSim(kernel, world, undefined, weather)));
    expect(snap.weather).toEqual({ current: 'cloudy', sinceTick: kernel.tick });

    const reg = new SmartObjectRegistry();
    registerDefaultContent(reg);
    const restored = restoreSim(snap, reg);
    expect(restored.weather?.current).toBe('cloudy');

    // v2 snapshots without weather still restore (weather null).
    const bare = JSON.parse(JSON.stringify(snapshotSim(kernel, world)));
    delete bare.weather;
    expect(restoreSim(bare, reg).weather).toBeNull();
  });
});
