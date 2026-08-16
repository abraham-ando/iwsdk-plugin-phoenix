#!/usr/bin/env node
/**
 * Outil d'atelier : génère les géométries de flore hors ligne (spec §8).
 *
 * ez-tree ne part JAMAIS dans le bundle. Son module ES pèse 2,87 Mo gzip, dont
 * 3,8 Mo de vingt images en base64 dont nous n'avons aucun besoin — la
 * MaterialLibrary produit déjà écorce et feuillage. Ce script l'exécute une
 * fois et ne conserve que les tableaux de sommets.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// ez-tree charge ses textures DÈS L'IMPORT, via un TextureLoader qui appelle
// document.createElementNS. Nous ne voulons aucune de ces images : un leurre
// suffit à laisser passer l'import.
globalThis.document = {
  createElementNS: () => ({
    style: {},
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    width: 1,
    height: 1,
  }),
  createElement: () => ({ style: {}, getContext: () => null }),
};
globalThis.self = globalThis;
globalThis.window = globalThis;

const { Tree } = await import('@dgreenheck/ez-tree');

const OUT_DIR = 'apps/demo/public/flora';
const MANIFEST = `${OUT_DIR}/manifest.json`;
const BIN = `${OUT_DIR}/geometry.bin`;

/**
 * Espèce, préréglage, et sa propre échelle de niveaux.
 *
 * Les échelles diffèrent parce que les préréglages diffèrent : la masse d'un
 * chêne vient de son feuillage, celle d'un buisson de son branchage. Réduire
 * les feuilles d'un buisson ne lui fait rien perdre — mesuré : 4 400 triangles
 * à `levels: 2`, quel que soit le feuillage.
 */
const SPECIES = [
  {
    id: 'oak',
    preset: 'Oak Small',
    levels: [
      { branch: 2, leafScale: 0.38 },
      { branch: 1, leafScale: 0.6 },
      { branch: 1, leafScale: 0 },
    ],
  },
  {
    id: 'aspen',
    preset: 'Aspen Small',
    levels: [
      { branch: 2, leafScale: 0.38 },
      { branch: 1, leafScale: 0.6 },
      { branch: 1, leafScale: 0 },
    ],
  },
  {
    id: 'bush',
    preset: 'Bush 1',
    levels: [
      { branch: 1, leafScale: 1 },
      { branch: 1, leafScale: 0.4 },
      { branch: 1, leafScale: 0 },
    ],
  },
];


function buildTree(preset, level, seed) {
  const tree = new Tree();
  tree.loadPreset(preset);
  tree.options.seed = seed;
  tree.options.branch.levels = level.branch;
  // Le feuillage est le poste le plus lourd et le moins lisible de loin : il
  // est réduit avant le branchage, et supprimé au niveau le plus grossier.
  tree.options.leaves.count = Math.round(tree.options.leaves.count * level.leafScale);
  tree.generate();
  return tree;
}

/** Fusionne les maillages d'un arbre en un seul jeu d'attributs. */
function flatten(tree) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let base = 0;
  tree.traverse((object) => {
    const geometry = object.isMesh ? object.geometry : null;
    if (!geometry) return;
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    const u = geometry.attributes.uv;
    const idx = geometry.index;
    if (!p || !idx) return;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
      uvs.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + base);
    base += p.count;
  });
  return { positions, normals, uvs, indices };
}

const chunks = [];
let offset = 0;

function push(array, Ctor, bytes) {
  const typed = Ctor.from(array);
  const buffer = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  chunks.push(buffer);
  const range = { offset, count: typed.length, bytes };
  offset += buffer.length;
  return range;
}

const species = [];
for (const entry of SPECIES) {
  const lods = [];
  for (const [levelIndex, level] of entry.levels.entries()) {
    const tree = buildTree(entry.preset, level, 12345);
    const flat = flatten(tree);
    lods.push({
      level: levelIndex,
      triangles: flat.indices.length / 3,
      position: push(flat.positions, Float32Array, 4),
      normal: push(flat.normals, Float32Array, 4),
      uv: push(flat.uvs, Float32Array, 4),
      index: push(flat.indices, Uint32Array, 4),
    });
  }
  species.push({ id: entry.id, lods });
  console.log(`${entry.id.padEnd(8)} triangles par niveau : ${lods.map((l) => l.triangles).join(' / ')}`);
}

const binary = Buffer.concat(chunks);
mkdirSync(dirname(BIN), { recursive: true });
writeFileSync(BIN, binary);
writeFileSync(MANIFEST, `${JSON.stringify({ version: 1, species }, null, 2)}\n`);
console.log(`écrit ${BIN} (${(binary.length / 1024).toFixed(0)} Ko) et ${MANIFEST}`);
