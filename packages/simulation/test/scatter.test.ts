import { describe, it, expect } from 'vitest';
import { scatterAt, SCATTER_TILE, FLORA_SPECIES } from '../src/world/scatter';
import { biomeAt } from '../src/world/biomes';
import { slopeAt } from '../src/world/terrain';
import { distanceToVillage } from '../src/world/relief';

describe('scatterAt', () => {
  it('est déterministe', () => {
    expect(scatterAt(3, -2)).toEqual(scatterAt(3, -2));
  });

  it('sépare les tuiles : deux tuiles voisines ne sèment pas la même chose', () => {
    expect(scatterAt(3, -2)).not.toEqual(scatterAt(4, -2));
  });

  it('POSE CHAQUE PLANT DANS SA PROPRE TUILE', () => {
    // Un plant qui déborde serait semé deux fois, ou pas du tout, selon la
    // tuile chargée — et la forêt vue divergerait de la forêt exploitable.
    for (const [tx, tz] of [
      [0, 2],
      [-3, 1],
      [5, -4],
    ]) {
      for (const item of scatterAt(tx!, tz!)) {
        expect(item.x, `tuile ${tx},${tz}`).toBeGreaterThanOrEqual(tx! * SCATTER_TILE);
        expect(item.x).toBeLessThan((tx! + 1) * SCATTER_TILE);
        expect(item.z).toBeGreaterThanOrEqual(tz! * SCATTER_TILE);
        expect(item.z).toBeLessThan((tz! + 1) * SCATTER_TILE);
      }
    }
  });

  it('ne déclare que des espèces connues, à échelle et rotation plausibles', () => {
    for (let tx = -4; tx <= 4; tx++) {
      for (const item of scatterAt(tx, 3)) {
        expect(FLORA_SPECIES).toContain(item.species);
        expect(item.scale).toBeGreaterThan(0.4);
        expect(item.scale).toBeLessThan(2.5);
        expect(item.rotationY).toBeGreaterThanOrEqual(0);
        expect(item.rotationY).toBeLessThan(Math.PI * 2);
      }
    }
  });

  it('NE SÈME RIEN dans le plateau du village', () => {
    // Les 23 objets de DEFAULT_VILLAGE y sont calés à la main, et le garde-fou
    // d'habitabilité en dépend. Un arbre semé au milieu du foyer casserait tout.
    for (const item of [...scatterAt(0, 0), ...scatterAt(-1, -1), ...scatterAt(0, -1)]) {
      expect(distanceToVillage(item.x, item.z), `plant en (${item.x}, ${item.z})`).toBeGreaterThan(
        12,
      );
    }
  });

  it('REFUSE les pentes fortes : un arbre ne pousse pas sur une falaise', () => {
    for (let tx = -6; tx <= 6; tx += 2) {
      for (let tz = -6; tz <= 6; tz += 2) {
        for (const item of scatterAt(tx, tz)) {
          expect(slopeAt(item.x, item.z), `plant en (${item.x}, ${item.z})`).toBeLessThan(0.7);
        }
      }
    }
  });

  it("SUIT LE BIOME : la forêt porte plus d'arbres que la prairie", () => {
    let forest = 0;
    let forestTiles = 0;
    let grass = 0;
    let grassTiles = 0;
    for (let tx = -8; tx <= 8; tx++) {
      for (let tz = -8; tz <= 8; tz++) {
        const cx = (tx + 0.5) * SCATTER_TILE;
        const cz = (tz + 0.5) * SCATTER_TILE;
        const primary = biomeAt(cx, cz).primary;
        if (primary === 'forest') {
          forest += scatterAt(tx, tz).length;
          forestTiles++;
        } else if (primary === 'grassland') {
          grass += scatterAt(tx, tz).length;
          grassTiles++;
        }
      }
    }
    expect(forestTiles, 'tuiles de forêt échantillonnées').toBeGreaterThan(3);
    expect(grassTiles, 'tuiles de prairie échantillonnées').toBeGreaterThan(3);
    expect(forest / forestTiles).toBeGreaterThan(grass / grassTiles);
  });

  it('reste dans un budget raisonnable par tuile', () => {
    // Une tuile de 32 m qui rendrait cent arbres ruinerait le budget de rendu.
    for (let tx = -8; tx <= 8; tx++) {
      for (let tz = -8; tz <= 8; tz++) {
        expect(scatterAt(tx, tz).length, `tuile ${tx},${tz}`).toBeLessThanOrEqual(24);
      }
    }
  });
});
