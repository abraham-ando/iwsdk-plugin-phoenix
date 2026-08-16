import { describe, it, expect } from 'vitest';
import { perceive } from '../src/agents/Perception';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { slopeAt, heightAt } from '../src/world/terrain';
import { biomeAt } from '../src/world/biomes';

function makeWorld(): GroundTruthWorld {
  const registry = new SmartObjectRegistry();
  registerDefaultContent(registry);
  return new GroundTruthWorld(registry);
}

describe('perception du sol', () => {
  it("S'ACCORDE AVEC LA VÉRITÉ TERRAIN, à la position de l'agent", () => {
    // Le moteur et la perception doivent lire le MÊME sol : une divergence
    // ferait décider les agents sur un monde qui n'existe pas.
    const world = makeWorld();
    for (const [x, z] of [
      [0, 0],
      [40, -60],
      [-120, 90],
    ] as const) {
      const obs = perceive(world, { id: 'a', x, z }, [], 0);
      expect(obs.groundBiome).toBe(biomeAt(x, z).primary);
      expect(obs.groundSlope).toBeCloseTo(slopeAt(x, z), 9);
      expect(obs.groundHeight).toBeCloseTo(heightAt(x, z), 9);
    }
  });

  it("NE DÉCRIT QUE CE QUI EST SOUS LES PIEDS, pas ce qu'il y a derrière la colline", () => {
    // Aucune omniscience : chaque agent ne lit que SON sol, celui de sa
    // propre position, et rien du monde au-delà.
    const world = makeWorld();
    const ici = perceive(world, { id: 'a', x: 0, z: 0 }, [], 0);
    const ailleurs = perceive(world, { id: 'b', x: 150, z: 150 }, [], 0);
    expect(ici.groundHeight).toBeCloseTo(heightAt(0, 0), 9);
    expect(ailleurs.groundHeight).toBeCloseTo(heightAt(150, 150), 9);
    // Un seul biome, celui du pas : ni carte, ni liste de régions.
    expect(typeof ici.groundBiome).toBe('string');
  });

  it('reste stable dans le temps : le sol ne change pas avec le tick', () => {
    const world = makeWorld();
    const jour = perceive(world, { id: 'a', x: 12, z: -8 }, [], 0);
    const nuit = perceive(world, { id: 'a', x: 12, z: -8 }, [], 1300);
    expect(nuit.groundBiome).toBe(jour.groundBiome);
    expect(nuit.groundHeight).toBeCloseTo(jour.groundHeight, 9);
  });
});
