import { describe, it, expect } from 'vitest';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';

function makeWorld(): GroundTruthWorld {
  const registry = new SmartObjectRegistry();
  registerDefaultContent(registry);
  return new GroundTruthWorld(registry);
}

describe('GroundTruthWorld.objectsOfType', () => {
  it('rend exactement les objets du type demandé', () => {
    const world = makeWorld();
    world.spawn('campfire', 0, 0);
    world.spawn('oak_tree', 10, 10);
    world.spawn('campfire', -30, 40);
    const fires = world.objectsOfType('campfire');
    expect(fires).toHaveLength(2);
    expect(fires.every((o) => o.type === 'campfire')).toBe(true);
  });

  it('rend un tableau vide pour un type absent, sans lever', () => {
    expect(makeWorld().objectsOfType('campfire')).toEqual([]);
  });

  it('reste trié par identifiant, ordre dont dépend le déterminisme', () => {
    const world = makeWorld();
    for (let i = 0; i < 12; i++) world.spawn('oak_tree', i, 0);
    const ids = world.objectsOfType('oak_tree').map((o) => o.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('TROUVE LES OBJETS SITUÉS AU-DELÀ DE LA PORTÉE DES ANCIENNES REQUÊTES', () => {
    // C'est la raison d'être de l'index : à 400 m, objectsNear(0,0,1000)
    // balayait un quart de million de cellules pour trouver ces deux-là.
    const world = makeWorld();
    world.spawn('campfire', 195, -195);
    world.spawn('campfire', -195, 195);
    expect(world.objectsOfType('campfire')).toHaveLength(2);
  });

  it("SURVIT À UNE RESTAURATION D'INSTANTANÉ", () => {
    // fromJSON reconstruit la grille spatiale ; s'il oublie l'index, le loup
    // ne trouve plus aucune proie après un rechargement, en silence.
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    const world = new GroundTruthWorld(registry);
    world.spawn('hunting_ground', 10, -12);
    world.spawn('hunting_ground', -11, -9);
    const restored = GroundTruthWorld.fromJSON(world.toJSON(), registry);
    expect(restored.objectsOfType('hunting_ground')).toHaveLength(2);
  });
});
