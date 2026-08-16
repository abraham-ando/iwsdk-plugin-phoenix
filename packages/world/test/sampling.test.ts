import { describe, it, expect } from 'vitest';
import { sampleTile, BIOME_RGB } from '../src/terrain/sampling';
import { heightAt, BIOME_IDS } from '@iwsdk/cardinal-simulation';

describe('sampleTile', () => {
  it('remplit des tableaux à la bonne taille', () => {
    const s = sampleTile(0, 0, 32, 8);
    const verts = 9 * 9;
    expect(s.segments).toBe(8);
    expect(s.size).toBe(32);
    expect(s.height).toHaveLength(verts);
    expect(s.slope).toHaveLength(verts);
    expect(s.color).toHaveLength(verts * 3);
  });

  it('EST EXACTEMENT le champ du moteur, jamais une réimplémentation', () => {
    // Si le rendu divergeait du moteur, les agents marcheraient sur un relief
    // que le joueur ne voit pas. C'est l'invariant central du projet.
    const segments = 8;
    const s = sampleTile(64, -32, 32, segments);
    const step = 32 / segments;
    for (let j = 0; j <= segments; j++) {
      for (let i = 0; i <= segments; i++) {
        const expected = heightAt(64 + i * step, -32 + j * step);
        expect(s.height[j * (segments + 1) + i]).toBeCloseTo(expected, 5);
      }
    }
  });

  it('dérive une pente positive et bornée', () => {
    const s = sampleTile(300, 300, 32, 16);
    for (const v of s.slope) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(Math.PI / 2);
    }
  });

  it('accorde la pente dérivée avec le relief réel', () => {
    const flat = sampleTile(-16, -16, 32, 8); // contient le plateau du village
    const rough = sampleTile(320, 320, 32, 8);
    const mean = (a: Float32Array): number => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(flat.slope)).toBeLessThan(mean(rough.slope));
  });

  it('produit des couleurs dans [0, 1]', () => {
    const s = sampleTile(0, 0, 32, 8);
    for (const c of s.color) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('est déterministe', () => {
    const a = sampleTile(96, -64, 32, 8);
    const b = sampleTile(96, -64, 32, 8);
    expect(Array.from(a.height)).toEqual(Array.from(b.height));
    expect(Array.from(a.color)).toEqual(Array.from(b.color));
  });

  it('RACCORDE les tuiles voisines : le bord partagé est identique', () => {
    // Sans cela, deux tuiles adjacentes de même niveau montreraient une fente.
    const segments = 8;
    const left = sampleTile(0, 0, 32, segments);
    const right = sampleTile(32, 0, 32, segments);
    const n = segments + 1;
    for (let j = 0; j <= segments; j++) {
      expect(left.height[j * n + segments]).toBeCloseTo(right.height[j * n]!, 5);
    }
  });

  it('déclare une couleur pour chaque biome', () => {
    for (const id of BIOME_IDS) {
      const rgb = BIOME_RGB[id];
      expect(rgb, id).toBeDefined();
      expect(rgb).toHaveLength(3);
    }
  });
});
