import { describe, it, expect } from 'vitest';
import { MemoryStream, MEMORY_CAPACITY } from '../src/agents/MemoryStream';

describe('MemoryStream', () => {
  it('retrieves by combined recency, importance and relevance', () => {
    const mem = new MemoryStream();
    mem.add({ tick: 100, text: 'le buisson nord est vide', importance: 4, kind: 'event' });
    mem.add({ tick: 5000, text: 'Mira m’a donné des baies', importance: 6, kind: 'dialogue' });
    mem.add({ tick: 5200, text: 'le loup rôde près de la rivière', importance: 9, kind: 'event' });
    const now = 5400;
    const aboutBerries = mem.retrieve('baies buisson', now, 2);
    expect(aboutBerries[0]?.text).toContain('baies');
    const top = mem.retrieve('', now, 1);
    expect(top[0]?.text).toContain('loup'); // importance+récence dominent sans requête
  });

  it('relevance boosts old but on-topic memories over fresh noise', () => {
    const mem = new MemoryStream();
    mem.add({ tick: 0, text: 'grand gisement de silex à la crête', importance: 5, kind: 'event' });
    mem.add({ tick: 2000, text: 'belle sieste au soleil', importance: 5, kind: 'event' });
    const res = mem.retrieve('silex gisement crête', 2400, 1);
    expect(res[0]?.text).toContain('silex');
  });

  it('caps at MEMORY_CAPACITY by evicting weakest entries', () => {
    const mem = new MemoryStream();
    for (let i = 0; i < MEMORY_CAPACITY + 50; i++) {
      mem.add({ tick: i, text: `souvenir ${i}`, importance: i % 10, kind: 'event' });
    }
    expect(mem.all()).toHaveLength(MEMORY_CAPACITY);
  });

  it('JSON round-trips', () => {
    const mem = new MemoryStream();
    mem.add({ tick: 1, text: 'premier feu allumé', importance: 7, kind: 'event' });
    const restored = MemoryStream.fromJSON(JSON.parse(JSON.stringify(mem.toJSON())));
    expect(restored.all()).toEqual(mem.all());
  });
});
