import type { GroundTruthWorld } from '../world/GroundTruthWorld';
import { hourOfDay } from '../kernel/SimKernel';
import { isNightHour } from './needs';

/**
 * Perception is the ONLY door between an agent and ground truth (spec §6.1).
 * Limited radii (shrunk at night), copies not references, no omniscience.
 */
export const DAY_VISION = 12;
export const NIGHT_VISION = 8;
export const HEARING_RADIUS = 20;

export interface PerceivedAgent {
  id: string;
  x: number;
  z: number;
  verb: string | null;
  distance: number;
}

export interface ObservedObject {
  id: string;
  type: string;
  x: number;
  z: number;
  distance: number;
  state: Record<string, number>;
  verbs: string[];
}

export interface Observation {
  tick: number;
  hour: number;
  night: boolean;
  place: string | null;
  visionRadius: number;
  objects: ObservedObject[];
  agents: PerceivedAgent[];
  heard: PerceivedAgent[];
}

export function perceive(
  world: GroundTruthWorld,
  self: { id: string; x: number; z: number },
  others: PerceivedAgent[],
  tick: number
): Observation {
  const hour = hourOfDay(tick);
  const night = isNightHour(hour);
  const visionRadius = night ? NIGHT_VISION : DAY_VISION;

  const objects: ObservedObject[] = world.objectsNear(self.x, self.z, visionRadius).map((o) => ({
    id: o.id,
    type: o.type,
    x: o.x,
    z: o.z,
    distance: Math.hypot(o.x - self.x, o.z - self.z),
    state: { ...o.state },
    verbs: world.affordancesOf(o.type).map((a) => a.verb),
  }));

  const agents: PerceivedAgent[] = [];
  const heard: PerceivedAgent[] = [];
  for (const other of others) {
    if (other.id === self.id) continue;
    const distance = Math.hypot(other.x - self.x, other.z - self.z);
    const entry = { ...other, distance };
    if (distance <= visionRadius) agents.push(entry);
    else if (distance <= HEARING_RADIUS) heard.push(entry);
  }
  agents.sort((a, b) => a.id.localeCompare(b.id));
  heard.sort((a, b) => a.id.localeCompare(b.id));

  return {
    tick,
    hour,
    night,
    place: world.placeAt(self.x, self.z),
    visionRadius,
    objects,
    agents,
    heard,
  };
}
