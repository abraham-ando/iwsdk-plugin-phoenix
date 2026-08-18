import { describe, it, expect } from 'vitest';
import { DEFAULT_VILLAGE } from '@iwsdk/cardinal-simulation';
import { SHARED_PLANT_ID } from '../src/multiplayer';
import { VILLAGER_NETWORK_IDS } from '../src/simulation/villagerNetworkIds';

describe('les identifiants réseau des villageois', () => {
  it('couvre exactement les onze agents du village', () => {
    const attendus = DEFAULT_VILLAGE.agents.map((a) => a.id).sort();
    expect(Object.keys(VILLAGER_NETWORK_IDS).sort()).toEqual(attendus);
  });

  it('sont tous uniques entre eux', () => {
    const valeurs = Object.values(VILLAGER_NETWORK_IDS);
    expect(new Set(valeurs).size).toBe(valeurs.length);
  });

  it('ne collisionnent jamais avec SHARED_PLANT_ID', () => {
    expect(Object.values(VILLAGER_NETWORK_IDS)).not.toContain(SHARED_PLANT_ID);
  });

  it('restent dans le positif Int32, comme l exige le protocole', () => {
    for (const id of Object.values(VILLAGER_NETWORK_IDS)) {
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThan(2_147_483_647);
    }
  });
});
