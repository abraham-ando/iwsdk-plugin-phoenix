import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { SpatialRAGSystem } from '../src/rag/SpatialRAGSystem';

describe('SpatialRAGSystem', () => {
  let world: World;
  let ragSystem: SpatialRAGSystem;

  beforeEach(() => {
    world = new World();
    world.registerSystem(SpatialRAGSystem);
    ragSystem = world.getSystem(SpatialRAGSystem)!;
  });

  it('retrieves relevant lore fragments filtered by query and sector', () => {
    ragSystem.registerLore([
      {
        id: 'lore-1',
        title: 'La Tour des Arcanes',
        content: 'Un mage ancien y garde le cristal de téléportation.',
        sector: 'arcadia_north',
      },
      {
        id: 'lore-2',
        title: 'Mines de Fer',
        content: 'Des gobelins occupent les profondeurs depuis le séisme.',
        sector: 'arcadia_south',
      },
    ]);

    const context = ragSystem.getLoreContext('Où trouver le mage et son cristal ?', 'arcadia_north');

    expect(context).toContain('La Tour des Arcanes');
    expect(context).toContain('cristal de téléportation');
    expect(context).not.toContain('Mines de Fer');
  });
});
