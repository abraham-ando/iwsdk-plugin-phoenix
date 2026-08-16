/**
 * The VR demo's bridge to @iwsdk/cardinal-simulation (spec §13.3): owns the
 * kernel/world/runtime/weather, advances them with the REAL frame delta, and
 * republishes engine events as French narrative lines for the HUD. Rendering
 * projection (avatars, sky, fires) subscribes to this system.
 */
import { createSystem } from '@iwsdk/core';
import {
  SimKernel,
  GroundTruthWorld,
  SmartObjectRegistry,
  AgentRuntime,
  WeatherMachine,
  registerDefaultContent,
  hourOfDay,
  TICKS_PER_DAY,
  type ActionEvent,
} from '@iwsdk/cardinal-simulation';
import { VILLAGE_LAYOUT } from './layout';

export interface SimEvent {
  tick: number;
  kind: 'action' | 'weather' | 'day';
  agentName?: string;
  text: string;
}

const SIM_SEED = 20260815;

const VERB_LABELS: Record<string, string> = {
  gather_berries: 'cueille des baies',
  gather_wood: 'ramasse du bois mort',
  gather_flint: 'extrait un éclat de silex',
  light_fire: 'allume le feu de camp',
  add_wood: 'nourrit le feu',
  rest_nearby: 'se repose près du feu',
  sleep_inside: "dort à l'abri",
  build: "renforce l'abri",
  drink: 'boit à la rivière',
  fish: 'pêche dans la rivière',
  knap_flint: 'taille une lame de silex',
  deposit_berries: 'dépose des baies au campement',
  take_berries: 'prend des baies de la réserve',
  deposit_wood: 'dépose du bois au campement',
  take_wood: 'prend du bois de la réserve',
  eat_berries: 'mange des baies',
  eat_fish: 'mange un poisson',
  nap: 'fait une sieste',
};

const WEATHER_LABELS: Record<string, string> = {
  clear: '☀️ Le ciel se dégage, un soleil bienfaisant réchauffe la vallée.',
  cloudy: '☁️ Des nuages voilent le soleil.',
  rain: "🌧️ La pluie s'abat sur la vallée — les feux de camp s'éteignent !",
  storm: "⛈️ L'orage gronde ! Les tribus cherchent refuge.",
};

export class CardinalSimulationSystem extends createSystem({}) {
  public kernel!: SimKernel;
  public simWorld!: GroundTruthWorld;
  public runtime!: AgentRuntime;
  public weather!: WeatherMachine;
  public registry!: SmartObjectRegistry;

  private listeners: Array<(e: SimEvent) => void> = [];
  private lastDay = 0;

  init(): void {
    this.registry = new SmartObjectRegistry();
    registerDefaultContent(this.registry);
    this.kernel = new SimKernel({ seed: SIM_SEED });
    this.simWorld = new GroundTruthWorld(this.registry);
    this.simWorld.attachTo(this.kernel);
    this.weather = new WeatherMachine();
    this.weather.attachTo(this.kernel, this.simWorld);
    this.runtime = new AgentRuntime(this.simWorld, this.registry);
    this.runtime.attachTo(this.kernel);

    for (const place of VILLAGE_LAYOUT.places) {
      this.simWorld.definePlace(place.name, place.x, place.z, place.radius);
    }
    for (const obj of VILLAGE_LAYOUT.objects) {
      this.simWorld.spawn(obj.type, obj.x, obj.z);
    }
    for (const agent of VILLAGE_LAYOUT.agents) {
      this.runtime.addAgent(
        { id: agent.id, name: agent.name, tribe: agent.tribe, role: agent.role },
        agent.x,
        agent.z
      );
    }
    // Day one starts with the fires lit, as the village always did.
    for (const fire of this.simWorld.objectsNear(0, 0, 1000)) {
      if (fire.type === 'campfire') fire.state.lit = 1;
    }

    this.weather.onChange((state, tick) => {
      this.emit({ tick, kind: 'weather', text: WEATHER_LABELS[state] ?? state });
    });
  }

  update(delta: number): void {
    this.kernel.advance(Math.min(delta, 0.25));

    const day = Math.floor(this.kernel.tick / TICKS_PER_DAY);
    if (day !== this.lastDay) {
      this.lastDay = day;
      this.emit({
        tick: this.kernel.tick,
        kind: 'day',
        text: `🌅 L'aube du jour ${day + 1} se lève sur les trois tribus.`,
      });
    }

    for (const event of this.runtime.drainEvents()) {
      const narrated = this.narrate(event);
      if (narrated !== null) this.emit(narrated);
    }
  }

  private narrate(event: ActionEvent): SimEvent | null {
    if (event.type === 'started') return null; // completions tell the story
    const agent = this.runtime.agents.get(event.agentId);
    const name = agent?.profile.name ?? event.agentId;
    const label = VERB_LABELS[event.verb] ?? event.verb;
    if (event.type === 'failed') {
      return {
        tick: event.tick,
        kind: 'action',
        agentName: name,
        text: `⚠️ ${name} échoue (${label}) — le monde a changé derrière son dos.`,
      };
    }
    return { tick: event.tick, kind: 'action', agentName: name, text: `${name} ${label}.` };
  }

  private emit(event: SimEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  subscribe(cb: (e: SimEvent) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  // --- HUD actions (all wired to real engine state) ---

  forceRain(): void {
    this.weather.force('storm', this.kernel.tick, this.simWorld);
  }

  forceClear(): void {
    this.weather.force('clear', this.kernel.tick, this.simWorld);
  }

  grantBlessing(): void {
    for (const obj of this.simWorld.objectsNear(0, 0, 1000)) {
      const def = this.registry.get(obj.type);
      for (const rule of def.regrowth ?? []) {
        obj.state[rule.field] = rule.max;
      }
      if (obj.type === 'camp_storage') {
        obj.state.berries = (obj.state.berries ?? 0) + 8;
        obj.state.wood = (obj.state.wood ?? 0) + 4;
      }
    }
    this.emit({
      tick: this.kernel.tick,
      kind: 'action',
      text: '✨ Bénédiction : les buissons regorgent de baies, les réserves débordent.',
    });
  }

  hourOfDaySim(): number {
    return hourOfDay(this.kernel.tick);
  }

  dayIndex(): number {
    return Math.floor(this.kernel.tick / TICKS_PER_DAY) + 1;
  }
}
