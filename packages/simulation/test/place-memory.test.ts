import { describe, it, expect } from 'vitest';
import { PlaceMemory, placeKey, tileOf, MAX_PLACE_BELIEFS } from '../src/agents/PlaceMemory';
import { perceive } from '../src/agents/Perception';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { SCATTER_TILE } from '../src/world/scatter';

function makeWorld(): GroundTruthWorld {
  const registry = new SmartObjectRegistry();
  registerDefaultContent(registry);
  return new GroundTruthWorld(registry);
}

describe('PlaceMemory', () => {
  it("NE SAIT RIEN AVANT D'AVOIR MARCHÉ", () => {
    // Le cœur du modèle : la connaissance est acquise, jamais donnée.
    expect(new PlaceMemory().all()).toEqual([]);
    expect(new PlaceMemory().placesOf('forest', 0, 0)).toEqual([]);
  });

  it("APPREND LE LIEU QU'IL FOULE, et le date", () => {
    const world = makeWorld();
    const mem = new PlaceMemory();
    const obs = perceive(world, { id: 'a', x: 5, z: -7 }, [], 120);
    mem.record(obs, 5, -7);
    const known = mem.all();
    expect(known).toHaveLength(1);
    expect(known[0]!.biome).toBe(obs.groundBiome);
    expect(known[0]!.lastSeenTick).toBe(120);
  });

  it('RANGE LES LIEUX SUR LA MÊME GRILLE QUE LE SEMIS', () => {
    // Un lieu cru et un lieu semé doivent désigner exactement la même case,
    // sans quoi « il y a une forêt là » ne correspond à aucun arbre.
    const world = makeWorld();
    const mem = new PlaceMemory();
    const obs = perceive(world, { id: 'a', x: 1, z: 1 }, [], 0);
    mem.record(obs, 1, 1);
    const place = mem.all()[0]!;
    expect(place.key).toBe(placeKey(obs.groundBiome, tileOf(1), tileOf(1)));
    // Le centre mémorisé est celui de la case, non le pas de l'agent.
    expect(place.x).toBe(SCATTER_TILE / 2);
    expect(place.z).toBe(SCATTER_TILE / 2);

    // Un second pas dans la même case ne crée pas un second lieu du même
    // biome. (Une case de 32 m peut chevaucher deux biomes : on ne compare
    // donc que les lieux du biome observé au premier pas.)
    mem.record(perceive(world, { id: 'a', x: 3, z: 3 }, [], 1), 3, 3);
    expect(mem.all().filter((p) => p.biome === obs.groundBiome)).toHaveLength(1);
  });

  it('REVOIR UN LIEU LE REDATE au lieu de le dupliquer', () => {
    const world = makeWorld();
    const mem = new PlaceMemory();
    mem.record(perceive(world, { id: 'a', x: 2, z: 2 }, [], 10), 2, 2);
    mem.record(perceive(world, { id: 'a', x: 2, z: 2 }, [], 900), 2, 2);
    expect(mem.all()).toHaveLength(1);
    expect(mem.all()[0]!.lastSeenTick).toBe(900);
  });

  it('rend les lieux du biome demandé, du plus proche au plus lointain', () => {
    const mem = new PlaceMemory();
    mem.learnPlace({ key: placeKey('forest', 4, 0), biome: 'forest', x: 144, z: 16, lastSeenTick: 1 });
    mem.learnPlace({ key: placeKey('forest', 1, 0), biome: 'forest', x: 48, z: 16, lastSeenTick: 1 });
    mem.learnPlace({ key: placeKey('rock', 2, 0), biome: 'rock', x: 80, z: 16, lastSeenTick: 1 });
    const forests = mem.placesOf('forest', 0, 0);
    expect(forests.map((p) => p.x)).toEqual([48, 144]);
  });

  it("ADOPTE UN LIEU ENTENDU, DATÉ DU MOMENT OÙ ON L'ENTEND", () => {
    // Comme la rumeur des objets : ce qui est daté, c'est l'audition, pas le
    // fait. C'est ce qui rend la croyance faillible.
    const mem = new PlaceMemory();
    mem.learnPlace({ key: placeKey('forest', 3, 3), biome: 'forest', x: 112, z: 112, lastSeenTick: 700 });
    expect(mem.placesOf('forest', 0, 0)).toHaveLength(1);
    expect(mem.all()[0]!.lastSeenTick).toBe(700);
  });

  it("N'EXCÈDE JAMAIS SA BORNE, et oublie les lieux les plus anciens", () => {
    const mem = new PlaceMemory();
    for (let i = 0; i < MAX_PLACE_BELIEFS + 20; i++) {
      mem.learnPlace({ key: placeKey('forest', i, 0), biome: 'forest', x: i * 32, z: 0, lastSeenTick: i });
    }
    expect(mem.all()).toHaveLength(MAX_PLACE_BELIEFS);
    expect(mem.all().map((p) => p.key)).not.toContain(placeKey('forest', 0, 0));
  });

  it('MESURE SON PROPRE ÉCART À LA VÉRITÉ TERRAIN', () => {
    // Spec §8 : l'écart entre la croyance et le fait est la cible
    // d'entraînement. Une case de 32 m étiquetée d'après un seul pas est une
    // approximation assumée — et c'est précisément ce que cette métrique rend
    // mesurable, comme `BeliefState.divergenceFrom` le fait des objets.
    const mem = new PlaceMemory();
    mem.learnPlace({ key: placeKey('forest', 0, 0), biome: 'forest', x: 16, z: 16, lastSeenTick: 0 });
    mem.learnPlace({ key: placeKey('rock', 1, 0), biome: 'rock', x: 48, z: 16, lastSeenTick: 0 });
    expect(mem.divergenceFrom(() => 'forest')).toBeCloseTo(0.5, 9);
    expect(mem.divergenceFrom((x) => (x < 32 ? 'forest' : 'rock'))).toBe(0);
    expect(mem.divergenceFrom(() => 'alpine')).toBe(1);
  });

  it("ne s'écarte de rien quand il ne sait rien", () => {
    expect(new PlaceMemory().divergenceFrom(() => 'forest')).toBe(0);
  });

  it('reste déterministe : deux mêmes séquences donnent la même mémoire', () => {
    const build = () => {
      const mem = new PlaceMemory();
      for (let i = 0; i < MAX_PLACE_BELIEFS + 5; i++) {
        mem.learnPlace({ key: placeKey('forest', i, 0), biome: 'forest', x: i * 32, z: 0, lastSeenTick: 42 });
      }
      return mem.all().map((p) => p.key);
    };
    expect(build()).toEqual(build());
  });
});

describe('rumeur de lieu', () => {
  it("FAIT CROIRE À UN LIEU QU'ON N'A PAS VU", () => {
    // Un agent doit pouvoir apprendre « il y a une forêt au nord » sans y
    // être allé : c'est le seul moyen de partager la géographie, et cela
    // reste une croyance datée, donc révisable.
    const mem = new PlaceMemory();
    mem.learnPlace({ key: placeKey('forest', 2, -3), biome: 'forest', x: 80, z: -80, lastSeenTick: 55 });
    const heard = mem.placesOf('forest', 0, 0);
    expect(heard).toHaveLength(1);
    expect(heard[0]!.x).toBe(80);
    expect(heard[0]!.lastSeenTick).toBe(55);
  });
});
