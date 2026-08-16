import { describe, it, expect } from 'vitest';
import { spawnScatter, SPECIES_OBJECT } from '../src/content/scatterSpawn';
import { GroundTruthWorld } from '../src/world/GroundTruthWorld';
import { SmartObjectRegistry } from '../src/world/SmartObject';
import { registerDefaultContent } from '../src/content/objects';
import { scatterAt, SCATTER_TILE, FLORA_SPECIES } from '../src/world/scatter';

function makeWorld(): GroundTruthWorld {
  const registry = new SmartObjectRegistry();
  registerDefaultContent(registry);
  return new GroundTruthWorld(registry);
}

describe('spawnScatter', () => {
  it('CHAQUE ESPÈCE SEMÉE A SON SMART OBJET, sans quoi la forêt reste inerte', () => {
    // Le défaut que cette phase corrige : le rendu plante des arbres que le
    // moteur ne connaît pas.
    for (const species of FLORA_SPECIES) {
      expect(SPECIES_OBJECT[species], `espèce ${species}`).toBeTruthy();
    }
  });

  it('les types produits sont tous déclarés par le contenu du moteur', () => {
    const registry = new SmartObjectRegistry();
    registerDefaultContent(registry);
    for (const type of Object.values(SPECIES_OBJECT)) {
      expect(registry.has(type), `type ${type}`).toBe(true);
    }
  });

  it('SÈME AUTANT QUE LE RENDU EN MONTRE, ni plus ni moins', () => {
    // Moteur et rendu lisent la même vérité terrain : un arbre visible doit
    // être un arbre récoltable, sinon les agents bûcheronnent du vide.
    const world = makeWorld();
    const side = 128;
    const planted = spawnScatter(world, side);

    let expected = 0;
    const half = side / 2;
    const n = Math.ceil(half / SCATTER_TILE);
    for (let tx = -n; tx <= n; tx++) {
      for (let tz = -n; tz <= n; tz++) {
        for (const item of scatterAt(tx, tz)) {
          if (Math.abs(item.x) <= half && Math.abs(item.z) <= half) expected++;
        }
      }
    }
    expect(planted).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it("NE SÈME RIEN DANS LE VILLAGE, dont les 23 objets sont calés à la main", () => {
    // scatterAt observe une réserve de 14 m ; si elle tombait, les huttes se
    // retrouveraient dans un bosquet et le garde-fou d'habitabilité sauterait.
    const world = makeWorld();
    spawnScatter(world, 128);
    const inside = world
      .objectsOfType('oak_tree')
      .concat(world.objectsOfType('berry_bush'))
      .filter((o) => Math.hypot(o.x, o.z) < 14);
    expect(inside).toEqual([]);
  });

  it('reste déterministe : deux mondes semés portent les mêmes objets', () => {
    const a = makeWorld();
    const b = makeWorld();
    spawnScatter(a, 128);
    spawnScatter(b, 128);
    const key = (w: GroundTruthWorld) =>
      w.objectsOfType('oak_tree').map((o) => `${o.id}:${o.x.toFixed(4)},${o.z.toFixed(4)}`);
    expect(key(a)).toEqual(key(b));
  });

  it('les objets semés sont récoltables, comme ceux du village', () => {
    const world = makeWorld();
    spawnScatter(world, 128);
    const oak = world.objectsOfType('oak_tree')[0]!;
    expect(oak.state.woodLeft).toBeGreaterThan(0);
    expect(world.affordancesOf('oak_tree').map((a) => a.verb)).toContain('gather_wood');
  });
});

describe('le scénario peuple le monde', () => {
  it('DONNE AUX AGENTS UN MONDE SUR LEQUEL AGIR, pas seulement 23 objets', async () => {
    // Le constat qui motive E1 : le moteur ne connaissait que le village.
    const { buildVillageSim } = await import('../src/content/scenario');
    const { world } = buildVillageSim(1);
    const trees = world.objectsOfType('oak_tree').length;
    const bushes = world.objectsOfType('berry_bush').length;
    expect(trees).toBeGreaterThan(500);
    expect(bushes).toBeGreaterThan(100);
  });

  it('GARDE LE VILLAGE INTACT : ses 19 objets sont toujours là', async () => {
    const { buildVillageSim, DEFAULT_VILLAGE } = await import('../src/content/scenario');
    const { world } = buildVillageSim(1);
    expect(DEFAULT_VILLAGE.objects).toHaveLength(19);
    // Aucun chêne calé à la main : le bois vient de la forêt semée.
    expect(DEFAULT_VILLAGE.objects.filter((o) => o.type === 'oak_tree')).toHaveLength(0);
    expect(world.objectsOfType('campfire')).toHaveLength(3);
    expect(world.objectsOfType('shelter')).toHaveLength(3);
    expect(world.objectsOfType('hunting_ground')).toHaveLength(2);
    // Les feux du premier jour sont allumés, comme le village l'a toujours fait.
    expect(world.objectsOfType('campfire').every((f) => f.state.lit === 1)).toBe(true);
  });

  it('reste déterministe de bout en bout', async () => {
    const { buildVillageSim } = await import('../src/content/scenario');
    const snap = () => JSON.stringify(buildVillageSim(7).world.toJSON());
    expect(snap()).toEqual(snap());
  });
});
