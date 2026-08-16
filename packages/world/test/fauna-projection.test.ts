import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { AnimalVisual } from '../src/objects/components';
import { FaunaSystem } from '../src/objects/FaunaSystem';

function makeRig() {
  const world = new World();
  world.registerComponent(AnimalVisual);
  world.registerSystem(FaunaSystem);
  const system = world.getSystem(FaunaSystem) as FaunaSystem;
  const object = {
    position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    rotation: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
  };
  const entity = world.createEntity();
  (entity as unknown as { object3D: unknown }).object3D = object;
  entity.addComponent(AnimalVisual, { x: 3, y: 1.5, z: -4, heading: 1.2, animation: 'walk' });
  return { world, system, entity, object };
}

describe('FaunaSystem', () => {
  it("POSE L'ANIMAL LÀ OÙ LE MOTEUR LE DIT", () => {
    // Si le rendu plaçait l'animal ailleurs, le joueur verrait un loup qui
    // n'est pas celui que la simulation fait agir.
    const rig = makeRig();
    rig.system.update(0.016, 0);
    expect(rig.object.position.x).toBeCloseTo(3, 6);
    expect(rig.object.position.y).toBeCloseTo(1.5, 6);
    expect(rig.object.position.z).toBeCloseTo(-4, 6);
  });

  it("oriente l'animal selon son cap", () => {
    const rig = makeRig();
    rig.system.update(0.016, 0);
    expect(rig.object.rotation.y).toBeCloseTo(1.2, 6);
  });

  it('suit les mises à jour du moteur', () => {
    const rig = makeRig();
    rig.system.update(0.016, 0);
    rig.entity.setValue(AnimalVisual, 'x', -12);
    rig.system.update(0.016, 0.016);
    expect(rig.object.position.x).toBeCloseTo(-12, 6);
  });

  it('compte les animaux projetés', () => {
    const rig = makeRig();
    rig.system.update(0.016, 0);
    expect(rig.system.projectedCount).toBe(1);
  });

  it('NE CONNAÎT AUCUNE ESPÈCE', () => {
    // La spec §8 borne le périmètre à l'interface : un animal quelconque doit
    // se projeter sans que le rendu sache ce qu'il est.
    const source = FaunaSystem.toString();
    expect(source.toLowerCase()).not.toContain('wolf');
    expect(source.toLowerCase()).not.toContain('loup');
  });

  it('survit à une entité sans objet de scène', () => {
    const world = new World();
    world.registerComponent(AnimalVisual);
    world.registerSystem(FaunaSystem);
    const system = world.getSystem(FaunaSystem) as FaunaSystem;
    const entity = world.createEntity();
    entity.addComponent(AnimalVisual, {});
    expect(() => system.update(0.016, 0)).not.toThrow();
  });
});
