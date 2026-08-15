import { describe, it, expect } from 'vitest';
import { SimKernel, TICKS_PER_DAY } from '../src/kernel/SimKernel';
import { EventLog } from '../src/kernel/EventLog';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { applyAffordance, checkAffordance } from '../src/world/affordances';
import { snapshotSim, restoreSim } from '../src/kernel/snapshot';

function makeRegistry(): SmartObjectRegistry {
  const reg = new SmartObjectRegistry();
  registerDefaultContent(reg);
  return reg;
}

/**
 * A tiny scripted scenario exercising rng, events, affordances and regrowth.
 * It stands in for the future AgentRuntime: a "gatherer" consumes bushes at
 * random and external events trigger fire-lighting.
 */
function buildScenario(seed: number, replayLog?: EventLog) {
  const reg = makeRegistry();
  const kernel = replayLog ? new SimKernel({ seed, replayLog }) : new SimKernel({ seed });
  const world = new GroundTruthWorld(reg);
  world.attachTo(kernel);
  world.definePlace('camp_aube', 0, 0, 6);
  const bushes = [world.spawn('berry_bush', 1, 1), world.spawn('berry_bush', -2, 2)];
  const fire = world.spawn('campfire', 0, 0);
  const actor = { x: 0.5, z: 0.5, inventory: { wood: 3, flint: 2 } as Record<string, number> };
  const gather = reg.get('berry_bush').affordances[0]!;
  const light = reg.get('campfire').affordances[0]!;

  kernel.onTick((ctx) => {
    // Random gathering every 10 ticks.
    if (ctx.tick % 10 === 0) {
      const bush = bushes[ctx.rng.int(0, bushes.length)]!;
      const near = { ...actor, x: bush.x + 0.5, z: bush.z };
      if (checkAffordance(gather, bush, near).ok) {
        applyAffordance(gather, bush, near);
      }
    }
    // External events light the fire.
    for (const e of ctx.events) {
      if (e.type === 'light_fire' && checkAffordance(light, fire, actor).ok) {
        applyAffordance(light, fire, actor);
      }
    }
  });

  return { kernel, world, reg };
}

describe('end-to-end determinism', () => {
  it('same seed + same external events => identical state after 3 days', () => {
    const runA = buildScenario(42);
    const runB = buildScenario(42);

    for (let t = 1; t <= TICKS_PER_DAY * 3; t++) {
      if (t === 500) {
        runA.kernel.submitEvent('light_fire', {});
        runB.kernel.submitEvent('light_fire', {});
      }
      runA.kernel.step();
      runB.kernel.step();
    }

    expect(snapshotSim(runA.kernel, runA.world)).toEqual(snapshotSim(runB.kernel, runB.world));
  });

  it('advance() chunking does not change the outcome', () => {
    const runA = buildScenario(7);
    const runB = buildScenario(7);
    // A: one big chunk; B: many irregular chunks. Both reach 1000 ticks.
    runA.kernel.advance(100); // 1000 ticks (capped exactly at 1000)
    let advanced = 0;
    const chunks = [0.13, 0.07, 0.4, 1.1, 0.25];
    let i = 0;
    while (advanced < 1000) {
      const chunk = chunks[i % chunks.length]!;
      advanced += runB.kernel.advance(Math.min(chunk, (1000 - advanced) * 0.1));
      i++;
    }
    expect(runA.kernel.tick).toBe(1000);
    expect(runB.kernel.tick).toBe(1000);
    expect(snapshotSim(runA.kernel, runA.world)).toEqual(snapshotSim(runB.kernel, runB.world));
  });

  it('replaying the journal reproduces a live run exactly', () => {
    const live = buildScenario(99);
    for (let t = 1; t <= 2000; t++) {
      if (t === 300) live.kernel.submitEvent('light_fire', {});
      if (t === 900) live.kernel.submitEvent('light_fire', {});
      live.kernel.step();
    }

    const replay = buildScenario(99, EventLog.fromJSON(live.kernel.log.toJSON()));
    for (let t = 1; t <= 2000; t++) replay.kernel.step();

    const liveSnap = snapshotSim(live.kernel, live.world);
    const replaySnap = snapshotSim(replay.kernel, replay.world);
    expect(replaySnap.world).toEqual(liveSnap.world);
    expect(replaySnap.rngState).toEqual(liveSnap.rngState);
    expect(replaySnap.tick).toEqual(liveSnap.tick);
  });

  it('snapshot/restore round-trips and the restored sim continues', () => {
    // The restored side only re-attaches world regrowth (restoreSim calls
    // attachTo); the scripted gathering handler is not restored. So the
    // continuation check asserts kernel clock + day-start regrowth, not a
    // side-by-side comparison with the live run.
    const run = buildScenario(1234);
    for (let t = 1; t <= 1500; t++) run.kernel.step();
    const snap = JSON.parse(JSON.stringify(snapshotSim(run.kernel, run.world)));

    const { kernel: restoredKernel, world: restoredWorld } = restoreSim(snap, makeRegistry());
    expect(snapshotSim(restoredKernel, restoredWorld)).toEqual(snap);

    const bushBefore = restoredWorld.get('berry_bush_1')?.state.berriesLeft ?? -1;
    for (let t = 0; t < TICKS_PER_DAY; t++) restoredKernel.step();
    const bushAfter = restoredWorld.get('berry_bush_1')?.state.berriesLeft ?? -1;
    expect(restoredKernel.tick).toBe(1500 + TICKS_PER_DAY);
    expect(bushAfter).toBeGreaterThan(bushBefore); // day-start regrowth fired
  });
});
