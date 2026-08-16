/**
 * The VR demo's bridge to @iwsdk/cardinal-simulation (spec §13.3): owns the
 * kernel/world/runtime/weather, advances them with the REAL frame delta, and
 * republishes engine events as French narrative lines for the HUD. Rendering
 * projection (avatars, sky, fires) subscribes to this system.
 */
import { createSystem, type Group } from '@iwsdk/core';
import {
  SimKernel,
  GroundTruthWorld,
  SmartObjectRegistry,
  AgentRuntime,
  WeatherMachine,
  WolfSystem,
  TrajectoryRecorder,
  registerDefaultContent,
  hourOfDay,
  TICKS_PER_DAY,
  type ActionEvent,
} from '@iwsdk/cardinal-simulation';
import { VILLAGE_LAYOUT } from './layout';
import { applyAvatarPose } from './AgentAvatarFactory';
import { PrehistoricEnvironment3D, type PrehistoricSceneResult } from './PrehistoricEnvironment3D';
import { CelestialVisuals } from './CelestialVisuals';
import { WolfVisual } from './WolfVisual';
import { VillagerVoices } from './VillagerVoices';

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
  public recorder!: TrajectoryRecorder;
  public wolf!: WolfSystem;

  private wolfVisual: WolfVisual | null = null;
  private voices: VillagerVoices | null = null;
  private playerFeedAccumulator = 0;
  private lastPlayerX = 0;
  private lastPlayerZ = 2;

  private readonly listeners: Array<(e: SimEvent) => void> = [];
  private lastDay = 0;
  private readonly lastSpeech = new Map<string, string>();
  private sceneData: PrehistoricSceneResult | null = null;
  private elapsed = 0;
  private readonly campfireBindings: Array<{ group: Group; objectId: string }> = [];
  private celestial: CelestialVisuals | null = null;

  /** Bind the rendered scene once; per-frame projection targets it. */
  attachScene(sceneData: PrehistoricSceneResult): void {
    this.sceneData = sceneData;
    this.celestial = new CelestialVisuals(sceneData.root);
    this.wolfVisual = new WolfVisual(sceneData.root);
    this.campfireBindings.length = 0;
    for (const [, group] of sceneData.campfires) {
      const worldX = group.position.x + (group.parent?.position.x ?? 0);
      const worldZ = group.position.z + (group.parent?.position.z ?? 0);
      const near = this.simWorld
        .objectsNear(worldX, worldZ, 3)
        .find((o) => o.type === 'campfire');
      if (near) this.campfireBindings.push({ group, objectId: near.id });
    }
  }

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
        {
          id: agent.id,
          name: agent.name,
          tribe: agent.tribe,
          role: agent.role,
          persona: agent.persona,
        },
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

    // Dataset capture (spec §9.1) — drained periodically by TrajectoryUploader.
    this.recorder = new TrajectoryRecorder(this.runtime, SIM_SEED, this.weather);
    this.recorder.attachTo(this.kernel);

    // The human player is a living being of the world (spec §10.5)…
    this.runtime.registerPlayer(0, 2);
    // …and the villagers get spatial Piper voices (étape 7).
    this.voices = new VillagerVoices(this.world);
    for (const agent of VILLAGE_LAYOUT.agents) {
      this.voices.register(agent.id, agent.gender);
    }
    // …and the wolf prowls the valley (spec §10.4).
    this.wolf = new WolfSystem(this.simWorld, this.runtime);
    this.runtime.attachWolf(this.wolf);
    this.wolf.attachTo(this.kernel);
  }

  /** Speak to the villagers (text v1 — voice STT arrives with étape 7). */
  playerSpeak(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    this.kernel.submitEvent('player_speak', { text: trimmed });
    this.emit({ tick: this.kernel.tick, kind: 'action', text: `🗣️ Vous : « ${trimmed} »` });
  }

  private feedPlayerPosition(delta: number): void {
    this.playerFeedAccumulator += delta;
    if (this.playerFeedAccumulator < 1) return;
    this.playerFeedAccumulator = 0;
    const camera = (this.world as unknown as { camera?: { position?: { x: number; z: number } } })
      .camera;
    const position = camera?.position;
    if (position === undefined) return;
    if (Math.hypot(position.x - this.lastPlayerX, position.z - this.lastPlayerZ) < 0.5) return;
    this.lastPlayerX = position.x;
    this.lastPlayerZ = position.z;
    this.kernel.submitEvent('player_move', { x: position.x, z: position.z });
  }

  update(delta: number): void {
    this.feedPlayerPosition(delta);
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

    // Per-frame projection of engine views onto the rendered scene.
    this.elapsed += delta;
    if (this.sceneData !== null) {
      this.projectScene(this.sceneData);
    }
  }

  private projectScene(sceneData: PrehistoricSceneResult): void {
    for (const view of this.runtime.views()) {
      const avatar = sceneData.agentAvatars.get(view.id);
      if (avatar === undefined) continue;
      avatar.position.set(view.x, view.y, view.z);
      avatar.rotation.y = view.heading;
      applyAvatarPose(avatar, view.animation, this.elapsed);
      this.voices?.updatePosition(view.id, view.x, view.y, view.z);
      // Surface fresh dialogue lines to the HUD chronicle and speak them.
      if (view.dialogue !== null && this.lastSpeech.get(view.id) !== view.dialogue) {
        this.lastSpeech.set(view.id, view.dialogue);
        this.emit({
          tick: this.kernel.tick,
          kind: 'action',
          agentName: view.name,
          text: `💬 ${view.name} : « ${view.dialogue} »`,
        });
        this.voices?.speak(view.id, view.dialogue);
      }
    }
    for (const binding of this.campfireBindings) {
      const fire = this.simWorld.get(binding.objectId);
      if (fire) {
        PrehistoricEnvironment3D.setCampfireLit(binding.group, (fire.state.lit ?? 0) === 1);
      }
    }
    // Scenery animation (wind, water) lives with rendering, not simulation.
    sceneData.grassField.updateWind(this.elapsed);
    sceneData.river.updateWater(this.elapsed);
    this.celestial?.update(this.hourOfDaySim(), this.weather.current, this.elapsed);
    this.wolfVisual?.update(this.wolf.view());
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
    for (const listener of this.listeners) listener(event);
  }

  subscribe(cb: (e: SimEvent) => void): () => void {
    this.listeners.push(cb);
    return () => {
      const index = this.listeners.indexOf(cb);
      if (index >= 0) this.listeners.splice(index, 1);
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
