import { SimKernel } from '../kernel/SimKernel';
import type { EventLog } from '../kernel/EventLog';
import { GroundTruthWorld } from '../world/GroundTruthWorld';
import { SmartObjectRegistry } from '../world/SmartObject';
import { WeatherMachine } from '../world/WeatherMachine';
import { AgentRuntime } from '../agents/AgentRuntime';
import { registerDefaultContent } from './objects';

/**
 * The default village scenario — the SINGLE source shared by the VR demo and
 * headless batch runs (spec §3 principe 2, §8.5): same objects, same agents,
 * same places, so a headset session and a dataset run live in the same world.
 */
export interface ScenarioObject {
  type: string;
  x: number;
  z: number;
}

export interface ScenarioAgent {
  id: string;
  name: string;
  persona: string;
  tribe: string;
  role: string;
  gender: 'masculine' | 'feminine';
  x: number;
  z: number;
}

export interface ScenarioPlace {
  name: string;
  x: number;
  z: number;
  radius: number;
}

interface Settlement {
  tribe: string;
  x: number;
  z: number;
}

const SETTLEMENTS: Settlement[] = [
  { tribe: 'Aube', x: 0, z: -4.5 },
  { tribe: 'Rive', x: 5.5, z: -3.0 },
  { tribe: 'Pic', x: -5.5, z: -3.0 },
];

function settlementObjects(s: Settlement): ScenarioObject[] {
  return [
    { type: 'campfire', x: s.x, z: s.z },
    { type: 'shelter', x: s.x, z: s.z - 1.3 },
    { type: 'berry_bush', x: s.x + 1.5, z: s.z + 0.6 },
    { type: 'flint_deposit', x: s.x - 1.4, z: s.z + 0.8 },
    { type: 'camp_storage', x: s.x + 0.9, z: s.z - 0.7 },
  ];
}

const SHARED_OBJECTS: ScenarioObject[] = [
  // Oaks close to the camps — wood sources.
  { type: 'oak_tree', x: -6.5, z: 2.0 },
  { type: 'oak_tree', x: 7.0, z: -1.0 },
  { type: 'oak_tree', x: -2.0, z: -13.0 },
  { type: 'oak_tree', x: 4.5, z: -14.0 },
  // River access points (river center x = 4 + sin(z*0.12)*3.5).
  { type: 'river_bank', x: 4.0, z: 0.0 },
  { type: 'river_bank', x: 2.9, z: -8.0 },
  // Hunting grounds — abstract game populations, shared with the wolf.
  { type: 'hunting_ground', x: 10, z: -12 },
  { type: 'hunting_ground', x: -11, z: -9 },
];

const AGENTS: ScenarioAgent[] = [
  // Tribu de l'Aube (famille)
  { id: 'haran', name: 'Haran', persona: "Protecteur pragmatique, pense d'abord à la sécurité des siens", tribe: 'Aube', role: 'Père & Éclaireur', gender: 'masculine', x: 1.0, z: -3.8 },
  { id: 'mira', name: 'Mira', persona: "Douce et prévoyante, partage toujours ce qu'elle cueille", tribe: 'Aube', role: 'Mère & Gardienne', gender: 'feminine', x: -1.0, z: -3.8 },
  { id: 'lio', name: 'Lio', persona: 'Curieux et impatient, veut prouver sa valeur', tribe: 'Aube', role: 'Fils Aîné', gender: 'masculine', x: 0.8, z: -5.4 },
  { id: 'aya', name: 'Aya', persona: 'Rêveuse espiègle, suit sa mère partout', tribe: 'Aube', role: 'Petite Fille', gender: 'feminine', x: -0.8, z: -5.4 },
  // Tribu de la Rive (chasseurs-artisans)
  { id: 'dagan', name: 'Dagan', persona: 'Chef exigeant, respecte la force et la loyauté', tribe: 'Rive', role: 'Chef & Chasseur', gender: 'masculine', x: 6.5, z: -2.4 },
  { id: 'sira', name: 'Sira', persona: 'Artisane méticuleuse, fière de ses outils', tribe: 'Rive', role: 'Artisane', gender: 'feminine', x: 4.6, z: -2.4 },
  { id: 'nia', name: 'Nia', persona: 'Apprentie vive, pose mille questions', tribe: 'Rive', role: 'Jeune Apprentie', gender: 'feminine', x: 6.2, z: -3.9 },
  { id: 'kan', name: 'Kan', persona: 'Solitaire fier, préfère agir seul mais protège les faibles', tribe: 'Rive', role: 'Guerrier Solitaire', gender: 'masculine', x: 4.8, z: -4.0 },
  // Tribu du Pic (survivants)
  { id: 'narek', name: 'Narek', persona: 'Pisteur taciturne, lit la vallée comme un livre', tribe: 'Pic', role: 'Pisteur Expérimenté', gender: 'masculine', x: -4.6, z: -2.4 },
  { id: 'ivan', name: 'Ivan', persona: 'Tailleur patient, croit au travail bien fait', tribe: 'Pic', role: 'Tailleur de Silex', gender: 'masculine', x: -6.4, z: -2.4 },
  { id: 'tao', name: 'Tao', persona: 'Sentinelle stoïque, endure le froid sans se plaindre', tribe: 'Pic', role: 'Sentinelle du Froid', gender: 'masculine', x: -5.5, z: -4.1 },
];

export const DEFAULT_VILLAGE: {
  objects: ScenarioObject[];
  agents: ScenarioAgent[];
  places: ScenarioPlace[];
} = {
  objects: [...SETTLEMENTS.flatMap(settlementObjects), ...SHARED_OBJECTS],
  agents: AGENTS,
  places: [
    { name: 'camp_aube', x: 0, z: -4.5, radius: 4 },
    { name: 'camp_rive', x: 5.5, z: -3.0, radius: 4 },
    { name: 'camp_pic', x: -5.5, z: -3.0, radius: 4 },
    { name: 'riviere', x: 4.0, z: 0.0, radius: 5 },
  ],
};

export interface VillageSim {
  kernel: SimKernel;
  world: GroundTruthWorld;
  runtime: AgentRuntime;
  weather: WeatherMachine;
  registry: SmartObjectRegistry;
}

export function buildVillageSim(seed: number, replayLog?: EventLog): VillageSim {
  const registry = new SmartObjectRegistry();
  registerDefaultContent(registry);
  const kernel = replayLog ? new SimKernel({ seed, replayLog }) : new SimKernel({ seed });
  const world = new GroundTruthWorld(registry);
  world.attachTo(kernel);
  const weather = new WeatherMachine();
  weather.attachTo(kernel, world);
  const runtime = new AgentRuntime(world, registry);
  runtime.attachTo(kernel);

  for (const place of DEFAULT_VILLAGE.places) {
    world.definePlace(place.name, place.x, place.z, place.radius);
  }
  for (const obj of DEFAULT_VILLAGE.objects) {
    world.spawn(obj.type, obj.x, obj.z);
  }
  for (const agent of DEFAULT_VILLAGE.agents) {
    runtime.addAgent(
      { id: agent.id, name: agent.name, tribe: agent.tribe, role: agent.role, persona: agent.persona },
      agent.x,
      agent.z
    );
  }
  // Day one starts with the fires lit, as the village always did.
  for (const fire of world.objectsNear(0, 0, 1000)) {
    if (fire.type === 'campfire') fire.state.lit = 1;
  }
  return { kernel, world, runtime, weather, registry };
}
