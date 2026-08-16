import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { FloraTile } from '../src/flora/components';
import { FloraSystem } from '../src/flora/FloraSystem';
import { scatterAt } from '@iwsdk/cardinal-simulation';

function makeRig() {
  const world = new World();
  world.registerComponent(FloraTile);
  const created: { name: string }[] = [];
  const disposed: string[] = [];
  (world as unknown as { createTransformEntity: unknown }).createTransformEntity = (
    object: unknown,
  ) => {
    const entity = world.createEntity();
    (entity as unknown as { object3D: unknown }).object3D = object;
    const named = object as { name?: string };
    created.push({ name: named.name ?? '' });
    const raw = entity as unknown as { dispose?: () => void; destroy: () => void };
    raw.dispose = () => {
      disposed.push(named.name ?? '');
      raw.destroy();
    };
    return entity;
  };

  // Un jeu d'assets minimal : trois niveaux par espèce, géométries factices.
  const assets = ['oak', 'aspen', 'bush'].map((id) => ({
    id,
    lods: [0, 1, 2].map((level) => ({ level, triangles: 100, bark: {}, leaves: {} })),
  }));
  world.registerSystem(FloraSystem, {
    configData: { assets, barkMaterial: null, leafMaterial: null },
  });
  const system = world.getSystem(FloraSystem) as FloraSystem;
  (system as unknown as { player: unknown }).player = { position: { x: 0, y: 0, z: 0 } };
  return { world, system, created, disposed };
}

describe('FloraSystem', () => {
  it('plante une tuile marquée et baisse son drapeau', () => {
    const rig = makeRig();
    const entity = rig.world.createEntity();
    entity.addComponent(FloraTile, { tx: 4, tz: -3, _needsPlant: true });
    rig.system.update(0.016, 0);
    expect(entity.getValue(FloraTile, '_needsPlant')).toBe(false);
    expect(rig.system.plantedTiles).toBe(1);
  });

  it('PLANTE EXACTEMENT ce que le moteur a semé', () => {
    // Si le rendu semait autre chose que scatterAt, les agents bûcheronneraient
    // des arbres invisibles — c'est précisément ce que la spec §8 interdit.
    const rig = makeRig();
    const entity = rig.world.createEntity();
    entity.addComponent(FloraTile, { tx: 4, tz: -3, _needsPlant: true });
    rig.system.update(0.016, 0);
    expect(rig.system.instanceCount).toBe(scatterAt(4, -3).length);
  });

  it('ne replante pas une tuile déjà plantée', () => {
    const rig = makeRig();
    const entity = rig.world.createEntity();
    entity.addComponent(FloraTile, { tx: 1, tz: 1, _needsPlant: true });
    rig.system.update(0.016, 0);
    const after = rig.system.plantedTiles;
    rig.system.update(0.016, 0.016);
    rig.system.update(0.016, 0.032);
    expect(rig.system.plantedTiles).toBe(after);
  });

  it('CHOISIT UN NIVEAU PLUS GROSSIER AU LOIN', () => {
    // Sans cela, le budget de 500 000 triangles n'autoriserait que quelques
    // dizaines d'arbres dans tout le champ de vision.
    const rig = makeRig();
    const near = rig.world.createEntity();
    near.addComponent(FloraTile, { tx: 0, tz: 0, _needsPlant: true });
    const far = rig.world.createEntity();
    far.addComponent(FloraTile, { tx: 3, tz: 3, _needsPlant: true });
    rig.system.update(0.016, 0);
    expect(rig.system.lastLevelNear).toBeLessThan(rig.system.lastLevelFar);
  });

  it('NE LAISSE PAS SA FLORE SURVIVRE À LA TUILE', () => {
    // Le streaming libère l'entité de tuile au changement de niveau, mais les
    // InstancedMesh sont des entités séparées : sans registre, elles
    // s'accumulaient — 690 maillages devenus 960 sur une longue session, et
    // 361 000 triangles devenus 554 000, au-dessus du budget.
    const rig = makeRig();
    const entity = rig.world.createEntity();
    entity.addComponent(FloraTile, { tx: 4, tz: -3, _needsPlant: true });
    rig.system.update(0.016, 0);

    const planted = rig.created.filter((o) => o.name.startsWith('Flora')).length;
    expect(planted, 'des maillages ont bien été plantés').toBeGreaterThan(0);

    // Retirer le composant désinscrit l'entité de la requête, comme le fait le
    // streaming lorsqu'il libère une tuile.
    entity.removeComponent(FloraTile);

    const released = rig.disposed.filter((n) => n.startsWith('Flora')).length;
    expect(released, 'maillages de flore libérés avec leur tuile').toBe(planted);
  });

  it('survit à une tuile vide sans rien planter', () => {
    const rig = makeRig();
    const empty = [...Array(200).keys()]
      .map((i) => ({ tx: i - 100, tz: 60 }))
      .find((t) => scatterAt(t.tx, t.tz).length === 0);
    expect(empty, 'aucune tuile vide trouvée pour le test').toBeDefined();
    const entity = rig.world.createEntity();
    entity.addComponent(FloraTile, { tx: empty!.tx, tz: empty!.tz, _needsPlant: true });
    expect(() => rig.system.update(0.016, 0)).not.toThrow();
    expect(entity.getValue(FloraTile, '_needsPlant')).toBe(false);
  });

  it('reste inerte tant que les géométries ne sont pas chargées', () => {
    // Elles arrivent du réseau : une tuile non plantée le sera au passage suivant.
    const world = new World();
    world.registerComponent(FloraTile);
    world.registerSystem(FloraSystem, {
      configData: { assets: null, barkMaterial: null, leafMaterial: null },
    });
    const system = world.getSystem(FloraSystem) as FloraSystem;
    const entity = world.createEntity();
    entity.addComponent(FloraTile, { tx: 2, tz: 2, _needsPlant: true });
    system.update(0.016, 0);
    expect(entity.getValue(FloraTile, '_needsPlant')).toBe(true);
    expect(system.plantedTiles).toBe(0);
  });
});
