import type { SimKernel } from '../kernel/SimKernel';
import type { GroundTruthWorld } from './GroundTruthWorld';
import type { AgentRuntime } from '../agents/AgentRuntime';
import { getTerrainHeight } from './terrain';

/**
 * The wolf — a deterministic Mode-1 predator (spec §10.4): its own hunger,
 * hunts game populations first, stalks the villagers when starving, and
 * fears fire and numbers. All randomness flows through the kernel's rng
 * (tick handler), so seed + journal still replay exactly.
 */
export type WolfMode = 'roam' | 'hunt' | 'stalk' | 'flee';

export interface WolfState {
  x: number;
  z: number;
  hunger: number;
  mode: WolfMode;
  targetX: number;
  targetZ: number;
  fleeUntilTick: number;
}

export const WOLF_SPEED = 1.8; // m/s
export const WOLF_HUNGER_DECAY = 0.03; // per tick
export const WOLF_HUNT_THRESHOLD = 55;
export const WOLF_FLEE_FIRE_RADIUS = 6;
export const WOLF_FLEE_CROWD = 2;
export const WOLF_FLEE_DURATION = 100;

const EAT_RADIUS = 2;
const ARRIVE = 0.5;

export class WolfSystem {
  private wolf: WolfState = {
    x: 0,
    z: -14,
    hunger: 80,
    mode: 'roam',
    targetX: 0,
    targetZ: -14,
    fleeUntilTick: 0,
  };

  constructor(
    private world: GroundTruthWorld,
    private runtime: AgentRuntime
  ) {}

  state(): Readonly<WolfState> {
    return { ...this.wolf };
  }

  /** Test/setup helper: override parts of the state deterministically. */
  forceState(partial: Partial<WolfState>): void {
    this.wolf = { ...this.wolf, ...partial };
  }

  view(): { x: number; y: number; z: number; heading: number; mode: WolfMode } {
    const heading = Math.atan2(this.wolf.targetX - this.wolf.x, this.wolf.targetZ - this.wolf.z);
    return {
      x: this.wolf.x,
      y: getTerrainHeight(this.wolf.x, this.wolf.z),
      z: this.wolf.z,
      heading,
      mode: this.wolf.mode,
    };
  }

  attachTo(kernel: SimKernel): () => void {
    return kernel.onTick((ctx) => {
      const wolf = this.wolf;
      wolf.hunger = Math.max(0, wolf.hunger - WOLF_HUNGER_DECAY);

      // Fear first: lit fire close by, or too many villagers.
      const nearLitFire = this.world
        .objectsNear(wolf.x, wolf.z, WOLF_FLEE_FIRE_RADIUS)
        .some((o) => o.type === 'campfire' && (o.state.lit ?? 0) === 1);
      const crowd = [...this.runtime.agents.values()].filter(
        (a) => Math.hypot(a.x - wolf.x, a.z - wolf.z) <= WOLF_FLEE_FIRE_RADIUS
      ).length;
      if (wolf.mode !== 'flee' && (nearLitFire || crowd >= WOLF_FLEE_CROWD)) {
        wolf.mode = 'flee';
        wolf.fleeUntilTick = ctx.tick + WOLF_FLEE_DURATION;
        // Run opposite to the nearest threat (fire position or crowd centroid ~ own position).
        wolf.targetX = wolf.x + (wolf.x >= 0 ? 15 : -15);
        wolf.targetZ = wolf.z + (wolf.z >= 0 ? 15 : -15);
      }

      switch (wolf.mode) {
        case 'flee': {
          this.stepToward(wolf.targetX, wolf.targetZ);
          if (ctx.tick >= wolf.fleeUntilTick) wolf.mode = 'roam';
          break;
        }
        case 'roam': {
          if (this.stepToward(wolf.targetX, wolf.targetZ)) {
            wolf.targetX = ctx.rng.int(-20, 21);
            wolf.targetZ = ctx.rng.int(-20, 21);
          }
          if (wolf.hunger < WOLF_HUNT_THRESHOLD) wolf.mode = 'hunt';
          break;
        }
        case 'hunt': {
          const ground = this.nearestGameGround();
          if (ground === null) {
            wolf.mode = 'stalk';
            break;
          }
          wolf.targetX = ground.x;
          wolf.targetZ = ground.z;
          this.stepToward(ground.x, ground.z);
          if (Math.hypot(ground.x - wolf.x, ground.z - wolf.z) <= EAT_RADIUS) {
            ground.state.gameLeft = Math.max(0, (ground.state.gameLeft ?? 0) - 1);
            wolf.hunger = 100;
            wolf.mode = 'roam';
          }
          break;
        }
        case 'stalk': {
          const prey = this.nearestAgent();
          if (prey !== null) {
            wolf.targetX = prey.x;
            wolf.targetZ = prey.z;
            this.stepToward(prey.x, prey.z);
          }
          if (this.nearestGameGround() !== null) wolf.mode = 'hunt';
          break;
        }
      }
    });
  }

  private stepToward(tx: number, tz: number): boolean {
    const dx = tx - this.wolf.x;
    const dz = tz - this.wolf.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= ARRIVE) return true;
    const step = Math.min(dist, WOLF_SPEED * 0.1);
    this.wolf.x += (dx / dist) * step;
    this.wolf.z += (dz / dist) * step;
    return false;
  }

  private nearestGameGround(): { x: number; z: number; state: Record<string, number> } | null {
    const grounds = this.world
      .objectsNear(0, 0, 1000)
      .filter((o) => o.type === 'hunting_ground' && (o.state.gameLeft ?? 0) > 0)
      .sort(
        (a, b) =>
          Math.hypot(a.x - this.wolf.x, a.z - this.wolf.z) -
          Math.hypot(b.x - this.wolf.x, b.z - this.wolf.z)
      );
    return grounds[0] ?? null;
  }

  private nearestAgent(): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestDistance = Infinity;
    for (const agent of [...this.runtime.agents.values()].sort((a, b) =>
      a.profile.id.localeCompare(b.profile.id)
    )) {
      const distance = Math.hypot(agent.x - this.wolf.x, agent.z - this.wolf.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: agent.x, z: agent.z };
      }
    }
    return best;
  }

  toJSON(): WolfState {
    return { ...this.wolf };
  }

  static fromJSON(json: WolfState, world: GroundTruthWorld, runtime: AgentRuntime): WolfSystem {
    const system = new WolfSystem(world, runtime);
    system.wolf = { ...json };
    return system;
  }
}
