import { describe, it, expect } from 'vitest';
import { World } from '@iwsdk/core';
import { SmartObjectVisual } from '../src/objects/components';
import { SmartObjectVisualSystem } from '../src/objects/SmartObjectVisualSystem';

/** Un objet de scène minimal, avec les enfants que la convention prévoit. */
function makeObject(names: string[]) {
  const children = names.map((name) => ({
    name,
    visible: true,
    scale: {
      x: 1,
      y: 1,
      z: 1,
      set(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
      },
    },
  }));
  return {
    children,
    traverse(fn: (o: unknown) => void) {
      fn(this);
      for (const c of children) fn(c);
    },
  };
}

function makeRig(names: string[], type: string) {
  const world = new World();
  world.registerComponent(SmartObjectVisual);
  world.registerSystem(SmartObjectVisualSystem);
  const system = world.getSystem(SmartObjectVisualSystem) as SmartObjectVisualSystem;
  const object = makeObject(names);
  const entity = world.createEntity();
  (entity as unknown as { object3D: unknown }).object3D = object;
  entity.addComponent(SmartObjectVisual, {
    objectType: type,
    stage: 0,
    fill: 1,
    flame: 0,
    lit: false,
  });
  return { world, system, entity, object };
}

describe('SmartObjectVisualSystem', () => {
  it('MONTRE CE QUI EST DÉJÀ BÂTI, ET RIEN DE PLUS', () => {
    // Une construction est cumulative : les perches restent quand le toit
    // arrive. Montrer une seule étape à la fois ferait disparaître le bas de
    // l'abri à mesure qu'on le termine.
    const rig = makeRig(['from1', 'from3', 'from5'], 'shelter');
    rig.entity.setValue(SmartObjectVisual, 'stage', 3);
    rig.system.update(0.016, 0);
    expect(rig.object.children.map((c) => c.visible)).toEqual([true, true, false]);
  });

  it("ne montre rien d'un chantier pas commencé", () => {
    const rig = makeRig(['from1', 'from3', 'from5'], 'shelter');
    rig.entity.setValue(SmartObjectVisual, 'stage', 0);
    rig.system.update(0.016, 0);
    expect(rig.object.children.map((c) => c.visible)).toEqual([false, false, false]);
  });

  it("montre tout l'abri une fois terminé", () => {
    const rig = makeRig(['from1', 'from3', 'from5'], 'shelter');
    rig.entity.setValue(SmartObjectVisual, 'stage', 5);
    rig.system.update(0.016, 0);
    expect(rig.object.children.map((c) => c.visible)).toEqual([true, true, true]);
  });

  it("met l'enfant `fill` à l'échelle de la réserve", () => {
    const rig = makeRig(['fill'], 'berry_bush');
    rig.entity.setValue(SmartObjectVisual, 'fill', 0.25);
    rig.system.update(0.016, 0);
    expect(rig.object.children[0]!.scale.y).toBeCloseTo(0.25, 6);
  });

  it('MASQUE le remplissage quand il ne reste rien', () => {
    // Un buisson vide qui garde ses baies à l'échelle zéro reste un artefact
    // visible d'un pixel ; mieux vaut le cacher franchement.
    const rig = makeRig(['fill'], 'berry_bush');
    rig.entity.setValue(SmartObjectVisual, 'fill', 0);
    rig.system.update(0.016, 0);
    expect(rig.object.children[0]!.visible).toBe(false);
  });

  it("n'allume la flamme que lorsque le foyer est allumé", () => {
    const rig = makeRig(['flame'], 'campfire');
    rig.system.update(0.016, 0);
    expect(rig.object.children[0]!.visible).toBe(false);

    rig.entity.setValue(SmartObjectVisual, 'lit', true);
    rig.entity.setValue(SmartObjectVisual, 'flame', 0.8);
    rig.system.update(0.016, 0.016);
    expect(rig.object.children[0]!.visible).toBe(true);
    expect(rig.object.children[0]!.scale.y).toBeCloseTo(0.8, 6);
  });

  it('survit à un objet dépourvu des enfants attendus', () => {
    // Tous les objets de la scène ne suivent pas la convention, et ce n'est
    // pas une raison pour faire tomber la frame.
    const rig = makeRig(['autre_chose'], 'shelter');
    expect(() => rig.system.update(0.016, 0)).not.toThrow();
    expect(rig.system.appliedCount).toBe(1);
  });

  it('survit à une entité sans objet de scène', () => {
    const world = new World();
    world.registerComponent(SmartObjectVisual);
    world.registerSystem(SmartObjectVisualSystem);
    const system = world.getSystem(SmartObjectVisualSystem) as SmartObjectVisualSystem;
    const entity = world.createEntity();
    entity.addComponent(SmartObjectVisual, { objectType: 'shelter' });
    expect(() => system.update(0.016, 0)).not.toThrow();
  });
});
