import { describe, it, expect, beforeEach, vi } from 'vitest';
import { World } from '@iwsdk/core';
import { NPCBanter } from '../src/components/NPCBanter';
import { SmartNPC } from '../src/components/SmartNPC';
import { NPCBanterSystem } from '../src/social/NPCBanterSystem';
import type { CardinalIntelligenceSystem } from '../src/systems/CardinalIntelligenceSystem';

describe('NPCBanterSystem', () => {
  let world: World;
  let banterSystem: NPCBanterSystem;

  beforeEach(() => {
    world = new World();
    world.registerComponent(NPCBanter).registerComponent(SmartNPC);
    world.registerSystem(NPCBanterSystem);
    banterSystem = world.getSystem(NPCBanterSystem)!;
  });

  it('triggers spontaneous banter between nearby NPCs', async () => {
    const npcA = world.createEntity();
    npcA.addComponent(NPCBanter, { talkativeness: 1.0, cooldownMs: 1000 });
    npcA.addComponent(SmartNPC, { personalityId: 1 });

    const npcB = world.createEntity();
    npcB.addComponent(NPCBanter, { talkativeness: 1.0, cooldownMs: 1000 });
    npcB.addComponent(SmartNPC, { personalityId: 2 });

    const lines: string[] = [];
    banterSystem.onBanter((_speaker, _listener, line) => {
      lines.push(line);
    });

    await banterSystem.triggerBanter(npcA, npcB);

    expect(lines.length).toBe(2);
    expect(npcA.getValue(NPCBanter, 'isBantering')).toBe(false);
    expect(npcB.getValue(NPCBanter, 'isBantering')).toBe(false);
  });

  it('falls back to canned lines and does not throw when the BFF/inference is unreachable', async () => {
    const npcA = world.createEntity();
    npcA.addComponent(NPCBanter, { talkativeness: 1.0, cooldownMs: 1000 });
    npcA.addComponent(SmartNPC, { personalityId: 1 });

    const npcB = world.createEntity();
    npcB.addComponent(NPCBanter, { talkativeness: 1.0, cooldownMs: 1000 });
    npcB.addComponent(SmartNPC, { personalityId: 2 });

    const unreachableIntelligence = {
      queryNPC: vi.fn().mockRejectedValue(new Error('network error: BFF unreachable')),
    } as unknown as CardinalIntelligenceSystem;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const lines: string[] = [];
    banterSystem.onBanter((_speaker, _listener, line) => {
      lines.push(line);
    });

    await expect(
      banterSystem.triggerBanter(npcA, npcB, unreachableIntelligence)
    ).resolves.toBeUndefined();

    expect(lines.length).toBe(2);
    expect(lines[0]).not.toBe('');
    expect(lines[1]).not.toBe('');
    expect(npcA.getValue(NPCBanter, 'isBantering')).toBe(false);
    expect(npcB.getValue(NPCBanter, 'isBantering')).toBe(false);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('gates its cooldowns on real elapsed milliseconds, not on the ECS clock\'s `time` argument (elapsedTime, in seconds)', () => {
    // Regression test for a unit mismatch: the render loop calls
    // `system.update(delta, elapsedTime)` with `elapsedTime` in SECONDS
    // (THREE.Clock convention — see @iwsdk/core's world-initializer), but
    // `checkIntervalMs`/`cooldownMs` are millisecond fields. Comparing them
    // straight against `time` meant a real playthrough needed `elapsedTime`
    // to reach thousands of *seconds* (hours) before banter could ever
    // fire — measured empirically via Playwright: zero banter in 60s.
    const scopedWorld = new World();
    scopedWorld.registerComponent(NPCBanter).registerComponent(SmartNPC);
    scopedWorld.registerSystem(NPCBanterSystem, { configData: { checkIntervalMs: 50 } });
    const scopedBanterSystem = scopedWorld.getSystem(NPCBanterSystem)!;

    const npcA = scopedWorld.createEntity();
    npcA.addComponent(NPCBanter, { talkativeness: 1.0, cooldownMs: 100 });
    npcA.addComponent(SmartNPC, { personalityId: 1 });

    const npcB = scopedWorld.createEntity();
    npcB.addComponent(NPCBanter, { talkativeness: 1.0, cooldownMs: 100 });
    npcB.addComponent(SmartNPC, { personalityId: 2 });

    const lines: string[] = [];
    scopedBanterSystem.onBanter((_speaker, _listener, line) => lines.push(line));

    let fakeNowMs = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNowMs);

    // 20 simulated frames at ~60fps: `time` (elapsedTime) only reaches
    // ~0.32s, far below the 50ms/100ms thresholds if read as seconds — but
    // 20 real milliseconds pass per frame, 400ms total, well past both.
    for (let frame = 0; frame < 20; frame++) {
      fakeNowMs += 20;
      scopedBanterSystem.update(0.016, frame * 0.016);
    }

    nowSpy.mockRestore();

    expect(lines.length).toBeGreaterThan(0);
  });
});
