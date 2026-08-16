import { describe, it, expect } from 'vitest';
import { buildVillageSim } from '../src/content/scenario';
import { EventLog } from '../src/kernel/EventLog';
import { TrajectoryRecorder } from '../src/telemetry/TrajectoryRecorder';
import { mockPlanResponse } from '../src/telemetry/MockPlanner';
import { PLAYER_ID } from '../src/agents/AgentRuntime';

describe('embodied player', () => {
  it('a registered player is perceived and remembered by nearby agents (with cooldown)', () => {
    const sim = buildVillageSim(3);
    sim.runtime.registerPlayer(0, -4); // inside camp_aube
    for (let t = 0; t < 25; t++) sim.kernel.step();
    const mira = sim.runtime.agents.get('mira')!;
    const sightings = mira.memories.all().filter((m) => m.text.includes('étranger'));
    expect(sightings.length).toBe(1); // cooldown: no duplicate spam
  });

  it('player_move relocates the presence', () => {
    const sim = buildVillageSim(3);
    sim.runtime.registerPlayer(25, 25); // far from everyone
    for (let t = 0; t < 25; t++) sim.kernel.step();
    const mira = sim.runtime.agents.get('mira')!;
    expect(mira.memories.all().some((m) => m.text.includes('étranger'))).toBe(false);
    sim.kernel.submitEvent('player_move', { x: 0, z: -4 });
    for (let t = 0; t < 25; t++) sim.kernel.step();
    expect(sim.runtime.playerPosition()).toEqual({ x: 0, z: -4 });
    expect(mira.memories.all().some((m) => m.text.includes('étranger'))).toBe(true);
  });

  it('player_speak reaches the nearest agent and emits a player_dialogue request', () => {
    const sim = buildVillageSim(3);
    sim.runtime.registerPlayer(-1.2, -3.8); // right next to mira
    sim.kernel.submitEvent('player_speak', { text: 'Bonjour, belle vallée !' });
    for (let t = 0; t < 3; t++) sim.kernel.step();
    const mira = sim.runtime.agents.get('mira')!;
    expect(mira.memories.all().some((m) => m.text.includes('Bonjour, belle vallée'))).toBe(true);
    const request = sim.runtime
      .drainPlanRequests()
      .find((r) => r.reason === 'player_dialogue');
    expect(request).toBeDefined();
    expect(request?.agentId).toBe('mira');
    expect(request?.participantIds).toEqual([PLAYER_ID, 'mira']);
    expect(request?.playerText).toBe('Bonjour, belle vallée !');
  });

  it('llm_player_reply produces a speech bubble, a memory and releases the pending flag', () => {
    const sim = buildVillageSim(3);
    sim.runtime.registerPlayer(-1.2, -3.8);
    sim.kernel.submitEvent('player_speak', { text: 'Bonjour !' });
    for (let t = 0; t < 3; t++) sim.kernel.step();
    const request = sim.runtime.drainPlanRequests().find((r) => r.reason === 'player_dialogue')!;
    sim.kernel.submitEvent('llm_player_reply', {
      requestId: request.requestId,
      agentId: 'mira',
      reply: 'Bienvenue près de notre feu, étranger.',
    });
    sim.kernel.step();
    const mira = sim.runtime.agents.get('mira')!;
    expect(sim.runtime.view('mira')?.dialogue).toContain('Bienvenue');
    expect(mira.memories.all().some((m) => m.text.includes("J'ai répondu"))).toBe(true);
    expect(mira.mode2.pendingRequestId).toBeNull();
  });

  it('player inputs ride the journal: replay reproduces the run', () => {
    const live = buildVillageSim(9);
    live.runtime.registerPlayer(-1.2, -3.8);
    for (let t = 0; t < 5; t++) live.kernel.step();
    live.kernel.submitEvent('player_speak', { text: 'Salut !' });
    live.kernel.submitEvent('player_move', { x: 2, z: -3 });
    for (let t = 0; t < 100; t++) live.kernel.step();

    const replay = buildVillageSim(9, EventLog.fromJSON(live.kernel.log.toJSON()));
    replay.runtime.registerPlayer(-1.2, -3.8);
    for (let t = 0; t < 105; t++) replay.kernel.step();

    const a = live.runtime.agents.get('mira')!;
    const b = replay.runtime.agents.get('mira')!;
    expect(b.memories.all()).toEqual(a.memories.all());
    expect(replay.runtime.playerPosition()).toEqual(live.runtime.playerPosition());
  });

  it('player_dialogue decisions are tagged source=player_text in the dataset', () => {
    const sim = buildVillageSim(3);
    const recorder = new TrajectoryRecorder(sim.runtime, 3, sim.weather);
    recorder.attachTo(sim.kernel);
    sim.runtime.registerPlayer(-1.2, -3.8);
    sim.kernel.submitEvent('player_speak', { text: 'Bonjour !' });
    for (let t = 0; t < 3; t++) sim.kernel.step();
    const request = sim.runtime.drainPlanRequests().find((r) => r.reason === 'player_dialogue')!;
    sim.kernel.submitEvent('llm_player_reply', mockPlanResponse(request));
    sim.kernel.step();
    const decisions = recorder.drain().decisions;
    const tagged = decisions.find(
      (d) => (d.meta as Record<string, unknown>).reason === 'player_dialogue'
    );
    expect(tagged).toBeDefined();
    expect((tagged?.meta as Record<string, unknown>).source).toBe('player_text');
  });
});
