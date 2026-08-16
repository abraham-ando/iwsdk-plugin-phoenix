import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from '@iwsdk/core';
import type { FloraSpecies } from '@iwsdk/cardinal-simulation';

/**
 * Lecture des géométries de flore générées hors ligne (spec §8).
 *
 * Ce module ne connaît PAS ez-tree : il lit un manifeste et un binaire. C'est
 * ce qui permet de le tester sans navigateur, et de changer un jour de
 * générateur sans y toucher.
 */

const SUPPORTED_VERSION = 1;

interface Range {
  readonly offset: number;
  readonly count: number;
  readonly bytes: number;
}

interface LodEntry {
  readonly level: number;
  readonly triangles: number;
  readonly position: Range;
  readonly normal: Range;
  readonly uv: Range;
  readonly index: Range;
}

export interface FloraLod {
  readonly level: number;
  readonly triangles: number;
  readonly geometry: BufferGeometry;
}

export interface FloraAsset {
  readonly id: FloraSpecies;
  readonly lods: FloraLod[];
}

function bytesOf(binary: ArrayBuffer, range: Range, label: string): ArrayBuffer {
  const end = range.offset + range.count * range.bytes;
  if (end > binary.byteLength) {
    throw new Error(`flore : la plage ${label} déborde du binaire (${end} > ${binary.byteLength})`);
  }
  return binary.slice(range.offset, end);
}

export function parseFloraManifest(manifest: unknown, binary: ArrayBuffer): FloraAsset[] {
  const doc = manifest as { version?: number; species?: unknown[] };
  if (doc.version !== SUPPORTED_VERSION) {
    throw new Error(
      `flore : version de manifeste ${String(doc.version)} non prise en charge (attendu ${SUPPORTED_VERSION})`,
    );
  }

  const assets: FloraAsset[] = [];
  for (const raw of doc.species ?? []) {
    const entry = raw as { id: FloraSpecies; lods: LodEntry[] };
    const lods: FloraLod[] = [];
    for (const lod of entry.lods) {
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(
          new Float32Array(bytesOf(binary, lod.position, `${entry.id}.position`)),
          3,
        ),
      );
      geometry.setAttribute(
        'normal',
        new Float32BufferAttribute(
          new Float32Array(bytesOf(binary, lod.normal, `${entry.id}.normal`)),
          3,
        ),
      );
      geometry.setAttribute(
        'uv',
        new Float32BufferAttribute(new Float32Array(bytesOf(binary, lod.uv, `${entry.id}.uv`)), 2),
      );
      geometry.setIndex(
        new Uint32BufferAttribute(
          new Uint32Array(bytesOf(binary, lod.index, `${entry.id}.index`)),
          1,
        ),
      );
      geometry.computeBoundingSphere();
      lods.push({ level: lod.level, triangles: lod.triangles, geometry });
    }
    assets.push({ id: entry.id, lods });
  }
  return assets;
}

export async function loadFloraAssets(baseUrl = '/flora'): Promise<FloraAsset[]> {
  const [manifest, binary] = await Promise.all([
    fetch(`${baseUrl}/manifest.json`).then((r) => r.json()),
    fetch(`${baseUrl}/geometry.bin`).then((r) => r.arrayBuffer()),
  ]);
  return parseFloraManifest(manifest, binary);
}
