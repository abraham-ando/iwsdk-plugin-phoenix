import type { SimKernel } from '../kernel/SimKernel';
import type { GroundTruthWorld } from './GroundTruthWorld';
import type { Rng } from '../kernel/Rng';

/**
 * Seeded Markov weather (spec §10.2). One transition roll every
 * WEATHER_CHECK_PERIOD ticks through the kernel's rng — fully deterministic.
 * Entering rain/storm extinguishes every campfire (v1: no sheltered fires).
 */
export type WeatherState = 'clear' | 'cloudy' | 'rain' | 'storm';

export const WEATHER_CHECK_PERIOD = 300;

const TRANSITIONS: Record<WeatherState, Array<[WeatherState, number]>> = {
  clear: [['clear', 0.7], ['cloudy', 0.3]],
  cloudy: [['clear', 0.3], ['cloudy', 0.4], ['rain', 0.3]],
  rain: [['cloudy', 0.5], ['rain', 0.35], ['storm', 0.15]],
  storm: [['rain', 0.6], ['storm', 0.4]],
};

function nextState(current: WeatherState, rng: Rng): WeatherState {
  const roll = rng.next();
  let cumulative = 0;
  for (const [state, p] of TRANSITIONS[current]) {
    cumulative += p;
    if (roll < cumulative) return state;
  }
  return current;
}

export class WeatherMachine {
  current: WeatherState = 'clear';
  sinceTick = 0;

  private listeners: Array<(state: WeatherState, tick: number) => void> = [];

  attachTo(kernel: SimKernel, world: GroundTruthWorld): () => void {
    return kernel.onTick((ctx) => {
      if (ctx.tick % WEATHER_CHECK_PERIOD !== 0) return;
      const next = nextState(this.current, ctx.rng);
      if (next !== this.current) this.transition(next, ctx.tick, world);
    });
  }

  force(state: WeatherState, tick: number, world: GroundTruthWorld): void {
    if (state !== this.current) this.transition(state, tick, world);
  }

  private transition(state: WeatherState, tick: number, world: GroundTruthWorld): void {
    const wasWet = this.current === 'rain' || this.current === 'storm';
    this.current = state;
    this.sinceTick = tick;
    const isWet = state === 'rain' || state === 'storm';
    if (isWet && !wasWet) {
      for (const fire of world.objectsOfType('campfire')) {
        fire.state.lit = 0;
      }
    }
    for (const listener of [...this.listeners]) listener(state, tick);
  }

  onChange(cb: (state: WeatherState, tick: number) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  toJSON(): { current: WeatherState; sinceTick: number } {
    return { current: this.current, sinceTick: this.sinceTick };
  }

  static fromJSON(json: { current: WeatherState; sinceTick: number }): WeatherMachine {
    const machine = new WeatherMachine();
    machine.current = json.current;
    machine.sinceTick = json.sinceTick;
    return machine;
  }
}
