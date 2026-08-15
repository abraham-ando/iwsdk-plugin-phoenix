import { describe, it, expect } from 'vitest';
import { SimKernel, TICK_MS, TICKS_PER_DAY, hourOfDay } from '../src/kernel/SimKernel';
import { EventLog } from '../src/kernel/EventLog';

describe('clock constants', () => {
  it('fixes the timestep at 100 ms and the day at 2400 ticks', () => {
    expect(TICK_MS).toBe(100);
    expect(TICKS_PER_DAY).toBe(2400);
  });

  it('maps ticks to a 0-24 hour of day', () => {
    expect(hourOfDay(0)).toBe(0);
    expect(hourOfDay(TICKS_PER_DAY / 2)).toBe(12);
    expect(hourOfDay(TICKS_PER_DAY)).toBe(0);
    expect(hourOfDay(TICKS_PER_DAY + TICKS_PER_DAY / 4)).toBe(6);
  });
});

describe('SimKernel.advance', () => {
  it('accumulates real time into whole fixed ticks without drift', () => {
    const kernel = new SimKernel({ seed: 1 });
    expect(kernel.advance(0.05)).toBe(0);   // 50 ms buffered
    expect(kernel.advance(0.05)).toBe(1);   // 100 ms total -> 1 tick
    expect(kernel.advance(0.35)).toBe(3);   // 350 ms -> 3 ticks, 50 ms left
    expect(kernel.tick).toBe(4);
  });

  it('respects timeScale, including pause', () => {
    const kernel = new SimKernel({ seed: 1 });
    kernel.timeScale = 0;
    expect(kernel.advance(10)).toBe(0);
    kernel.timeScale = 10;
    expect(kernel.advance(0.1)).toBe(10);   // 100 ms réels × 10 = 10 ticks
  });

  it('caps a single advance() to 1000 ticks to avoid a death spiral', () => {
    const kernel = new SimKernel({ seed: 1 });
    expect(kernel.advance(1_000_000)).toBe(1000);
  });
});

describe('SimKernel ticks and events', () => {
  it('invokes handlers with tick context and flags day starts', () => {
    const kernel = new SimKernel({ seed: 1 });
    const dayStarts: number[] = [];
    kernel.onTick((ctx) => {
      if (ctx.isDayStart) dayStarts.push(ctx.tick);
    });
    for (let i = 0; i < TICKS_PER_DAY * 2 + 1; i++) kernel.step();
    expect(dayStarts).toEqual([TICKS_PER_DAY, TICKS_PER_DAY * 2]);
  });

  it('delivers submitted events on the next tick and journals them', () => {
    const kernel = new SimKernel({ seed: 1 });
    const seen: Array<{ tick: number; type: string }> = [];
    kernel.onTick((ctx) => {
      for (const e of ctx.events) seen.push({ tick: ctx.tick, type: e.type });
    });
    kernel.step(); // tick 1, no events
    kernel.submitEvent('llm_plan', { agent: 'mira' });
    kernel.step(); // tick 2, delivers the event
    kernel.step(); // tick 3, nothing
    expect(seen).toEqual([{ tick: 2, type: 'llm_plan' }]);
    expect(kernel.log.all()).toEqual([{ tick: 2, type: 'llm_plan', payload: { agent: 'mira' } }]);
  });

  it('unsubscribe stops a handler', () => {
    const kernel = new SimKernel({ seed: 1 });
    let calls = 0;
    const off = kernel.onTick(() => {
      calls++;
    });
    kernel.step();
    off();
    kernel.step();
    expect(calls).toBe(1);
  });

  it('replay mode re-injects a journal instead of live submissions', () => {
    // Live run: submit an event before tick 3.
    const live = new SimKernel({ seed: 5 });
    const liveDraws: number[] = [];
    live.onTick((ctx) => {
      if (ctx.events.length > 0) liveDraws.push(ctx.rng.int(0, 1000));
    });
    live.step();
    live.step();
    live.submitEvent('poke', { n: 1 });
    live.step();

    // Replay run: same seed, journal injected, no submissions.
    const replay = new SimKernel({ seed: 5, replayLog: EventLog.fromJSON(live.log.toJSON()) });
    const replayDraws: number[] = [];
    replay.onTick((ctx) => {
      if (ctx.events.length > 0) replayDraws.push(ctx.rng.int(0, 1000));
    });
    replay.step();
    replay.step();
    replay.step();

    expect(replayDraws).toEqual(liveDraws);
    expect(replay.tick).toBe(live.tick);
  });
});
