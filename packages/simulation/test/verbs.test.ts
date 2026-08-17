import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { contentVerbs } from '../src/content/verbs';

describe('contentVerbs', () => {
  it('ÉNUMÈRE TOUT CE QUE LES AGENTS PEUVENT FAIRE, objets et gestes propres', () => {
    // La narration, les jeux de données et l'interface doivent pouvoir demander
    // « quels verbes existe-t-il ? » à une seule source. Sans elle, un verbe
    // neuf sort en anglais dans le HUD, comme `hunt` et `eat_meat` l'ont fait.
    const verbes = contentVerbs();
    for (const attendu of [
      'gather_wood',
      'fell_tree',
      'hunt',
      'hunt_spear',
      'craft_spear',
      'knap_flint',
      'eat_meat',
      'nap',
    ]) {
      expect(verbes, attendu).toContain(attendu);
    }
  });

  it('ne rend aucun doublon, et les rend triés', () => {
    const verbes = contentVerbs();
    expect(new Set(verbes).size).toBe(verbes.length);
    expect([...verbes].sort()).toEqual(verbes);
  });
});

describe('la narration française ne laisse aucun verbe derrière', () => {
  it('TRADUIT CHAQUE VERBE DU CONTENU', () => {
    // Le HUD affichait « Narek hunt. » et « Aya eat_meat. » : la table
    // française vivait de son côté et avait pris du retard sur le contenu.
    const source = readFileSync(
      new URL('../../../apps/demo/src/simulation/CardinalSimulationSystem.ts', import.meta.url),
      'utf8'
    );
    const bloc = source.slice(
      source.indexOf('const VERB_LABELS'),
      source.indexOf('const WEATHER_LABELS')
    );
    for (const verbe of contentVerbs()) {
      expect(bloc, `${verbe} n'a pas de phrase française`).toContain(`${verbe}:`);
    }
  });
});
