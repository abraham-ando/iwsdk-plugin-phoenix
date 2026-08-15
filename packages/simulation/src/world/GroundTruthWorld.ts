import { SpatialGrid } from './SpatialGrid';
import {
  SmartObjectRegistry,
  type AffordanceDef,
  type SmartObjectInstance,
} from './SmartObject';
import { checkAffordance, type ActorContext } from './affordances';
import type { SimKernel } from '../kernel/SimKernel';

export interface NamedPlace {
  name: string;
  x: number;
  z: number;
  radius: number;
}

export interface WorldSnapshot {
  counter: number;
  objects: SmartObjectInstance[];
  places: NamedPlace[];
}

/**
 * The simulation's ground truth (spec §4): every smart object instance, the
 * spatial index over them, named places, and daily resource regrowth. Agents
 * never read this directly — perception (étape 2) mediates all access.
 */
export class GroundTruthWorld {
  readonly grid = new SpatialGrid();
  private objects = new Map<string, SmartObjectInstance>();
  private places = new Map<string, NamedPlace>();
  private counter = 0;

  constructor(private registry: SmartObjectRegistry) {}

  spawn(type: string, x: number, z: number): SmartObjectInstance {
    const def = this.registry.get(type);
    this.counter++;
    const instance: SmartObjectInstance = {
      id: `${type}_${this.counter}`,
      type,
      x,
      z,
      state: { ...def.state },
    };
    this.objects.set(instance.id, instance);
    this.grid.insert(instance.id, x, z);
    return instance;
  }

  get(id: string): SmartObjectInstance | undefined {
    return this.objects.get(id);
  }

  objectsNear(x: number, z: number, radius: number): SmartObjectInstance[] {
    const result: SmartObjectInstance[] = [];
    for (const id of this.grid.queryRadius(x, z, radius)) {
      const obj = this.objects.get(id);
      if (obj !== undefined) result.push(obj);
    }
    return result;
  }

  /** All affordances near the actor whose preconditions currently pass. */
  availableAffordances(
    actor: ActorContext,
    radius: number
  ): Array<{ object: SmartObjectInstance; affordance: AffordanceDef }> {
    const result: Array<{ object: SmartObjectInstance; affordance: AffordanceDef }> = [];
    for (const object of this.objectsNear(actor.x, actor.z, radius)) {
      const def = this.registry.get(object.type);
      for (const affordance of def.affordances) {
        // Distance preconditions are checked against the actor's *current*
        // position; callers planning ahead should re-check after moving.
        if (checkAffordance(affordance, object, actor).ok) {
          result.push({ object, affordance });
        }
      }
    }
    return result;
  }

  /** Content-declared affordances for a type (perception & Mode-1 read defs here). */
  affordancesOf(type: string): AffordanceDef[] {
    return this.registry.get(type).affordances;
  }

  definePlace(name: string, x: number, z: number, radius: number): void {
    if (this.places.has(name)) {
      throw new Error(`GroundTruthWorld.definePlace: duplicate place ${name}`);
    }
    this.places.set(name, { name, x, z, radius });
  }

  placeAt(x: number, z: number): string | null {
    for (const place of this.places.values()) {
      const dx = x - place.x;
      const dz = z - place.z;
      if (dx * dx + dz * dz <= place.radius * place.radius) return place.name;
    }
    return null;
  }

  getPlace(name: string): NamedPlace | undefined {
    return this.places.get(name);
  }

  applyDayRegrowth(): void {
    for (const obj of this.objects.values()) {
      const def = this.registry.get(obj.type);
      for (const rule of def.regrowth ?? []) {
        obj.state[rule.field] = Math.min(rule.max, (obj.state[rule.field] ?? 0) + rule.perDay);
      }
    }
  }

  /** Wire regrowth to the kernel's day boundaries. Returns an unsubscribe. */
  attachTo(kernel: SimKernel): () => void {
    return kernel.onTick((ctx) => {
      if (ctx.isDayStart) this.applyDayRegrowth();
    });
  }

  toJSON(): WorldSnapshot {
    return {
      counter: this.counter,
      objects: [...this.objects.values()].map((o) => ({ ...o, state: { ...o.state } })),
      places: [...this.places.values()].map((p) => ({ ...p })),
    };
  }

  static fromJSON(snapshot: WorldSnapshot, registry: SmartObjectRegistry): GroundTruthWorld {
    const world = new GroundTruthWorld(registry);
    world.counter = snapshot.counter;
    for (const obj of snapshot.objects) {
      const instance: SmartObjectInstance = { ...obj, state: { ...obj.state } };
      world.objects.set(instance.id, instance);
      world.grid.insert(instance.id, instance.x, instance.z);
    }
    for (const place of snapshot.places) {
      world.places.set(place.name, { ...place });
    }
    return world;
  }
}
