import { describe, it, expect } from 'vitest';
import { parseFloraManifest } from '../src/flora/floraAssets';

/** Construit un manifeste minimal et son binaire, pour tester sans fichier. */
function makeFixture() {
  const position = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normal = Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uv = Float32Array.from([0, 0, 1, 0, 0, 1]);
  const index = Uint32Array.from([0, 1, 2]);

  const parts: (Float32Array | Uint32Array)[] = [position, normal, uv, index];
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const binary = new ArrayBuffer(total);
  const view = new Uint8Array(binary);
  let offset = 0;
  const ranges: { offset: number; count: number; bytes: number }[] = [];
  for (const part of parts) {
    view.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), offset);
    ranges.push({ offset, count: part.length, bytes: 4 });
    offset += part.byteLength;
  }

  const manifest = {
    version: 1,
    species: [
      {
        id: 'oak',
        lods: [
          {
            level: 0,
            triangles: 1,
            position: ranges[0]!,
            normal: ranges[1]!,
            uv: ranges[2]!,
            index: ranges[3]!,
          },
        ],
      },
    ],
  };
  return { manifest, binary };
}

describe('parseFloraManifest', () => {
  it('reconstitue une géométrie par niveau', () => {
    const { manifest, binary } = makeFixture();
    const assets = parseFloraManifest(manifest, binary);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.id).toBe('oak');
    expect(assets[0]!.lods).toHaveLength(1);
  });

  it('restitue EXACTEMENT les sommets écrits', () => {
    // Une erreur d'un octet dans les décalages passerait inaperçue à l'écran
    // sous forme d'arbres tordus ; ici elle échoue franchement.
    const { manifest, binary } = makeFixture();
    const geom = parseFloraManifest(manifest, binary)[0]!.lods[0]!.geometry;
    const pos = geom.getAttribute('position');
    expect(pos.count).toBe(3);
    expect(pos.getX(1)).toBeCloseTo(1, 6);
    expect(pos.getY(2)).toBeCloseTo(1, 6);
    expect(geom.getIndex()!.count).toBe(3);
  });

  it('porte les trois attributs et un index', () => {
    const { manifest, binary } = makeFixture();
    const geom = parseFloraManifest(manifest, binary)[0]!.lods[0]!.geometry;
    for (const name of ['position', 'normal', 'uv']) {
      expect(() => geom.getAttribute(name), name).not.toThrow();
    }
    expect(geom.getIndex()).not.toBeNull();
  });

  it('REFUSE un manifeste de version inconnue', () => {
    // Un format qui change sans que le lecteur le sache produirait des
    // géométries silencieusement fausses.
    const { manifest, binary } = makeFixture();
    expect(() => parseFloraManifest({ ...manifest, version: 99 }, binary)).toThrow(/version/i);
  });

  it('REFUSE une plage qui déborde du binaire', () => {
    const { manifest, binary } = makeFixture();
    const broken = structuredClone(manifest);
    broken.species[0]!.lods[0]!.position.offset = binary.byteLength;
    expect(() => parseFloraManifest(broken, binary)).toThrow(/déborde/i);
  });
});

describe('accord avec le générateur', () => {
  it('LIT LES FICHIERS RÉELLEMENT GÉNÉRÉS', async () => {
    // Les tests ci-dessus utilisent un montage fabriqué : ils vérifient le
    // lecteur, pas son accord avec l'écrivain. Un décalage de format entre le
    // script de génération et ce module ne se verrait qu'à l'écran, sous forme
    // d'arbres absents ou tordus.
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(
      readFileSync('../../apps/demo/public/flora/manifest.json', 'utf8'),
    ) as unknown;
    const file = readFileSync('../../apps/demo/public/flora/geometry.bin');
    const binary = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

    const assets = parseFloraManifest(manifest, binary as ArrayBuffer);
    expect(assets.map((a) => a.id).sort()).toEqual(['aspen', 'bush', 'oak']);
    for (const asset of assets) {
      expect(asset.lods, asset.id).toHaveLength(3);
      for (const lod of asset.lods) {
        const position = lod.geometry.getAttribute('position');
        expect(position.count, `${asset.id} niveau ${lod.level}`).toBeGreaterThan(0);
        // Le compte de triangles annoncé doit correspondre à l'index livré.
        expect(lod.geometry.getIndex()!.count / 3).toBe(lod.triangles);
      }
    }
  });
});
