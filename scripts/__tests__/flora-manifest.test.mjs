import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const MANIFEST = 'apps/demo/public/flora/manifest.json';
const BIN = 'apps/demo/public/flora/geometry.bin';

test('le manifeste de flore existe et décrit le binaire', () => {
  assert.ok(existsSync(MANIFEST), `${MANIFEST} manquant : lancer pnpm flora:generate`);
  assert.ok(existsSync(BIN), `${BIN} manquant : lancer pnpm flora:generate`);

  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const bin = readFileSync(BIN);

  assert.equal(manifest.version, 1);
  assert.ok(manifest.species.length >= 3, 'au moins trois espèces');

  for (const species of manifest.species) {
    assert.ok(['oak', 'aspen', 'bush'].includes(species.id), `espèce inconnue ${species.id}`);
    assert.equal(species.lods.length, 3, `${species.id} doit porter trois niveaux`);

    let previous = Infinity;
    for (const lod of species.lods) {
      // Chaque niveau est plus léger que le précédent : c'est la raison d'être
      // d'un niveau de détail.
      assert.ok(
        lod.triangles < previous,
        `${species.id} niveau ${lod.level} : ${lod.triangles} triangles, pas moins que ${previous}`,
      );
      previous = lod.triangles;

      for (const field of ['position', 'normal', 'uv', 'index']) {
        const range = lod[field];
        assert.ok(range, `${species.id} niveau ${lod.level} : champ ${field} absent`);
        assert.ok(
          range.offset + range.count * range.bytes <= bin.length,
          `${species.id}.${field} déborde du binaire`,
        );
      }
    }
  }
});

test('les niveaux tiennent dans le budget de rendu', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  for (const species of manifest.species) {
    // 500 000 triangles visibles au total, dont 42 000 pris par le terrain.
    // Le niveau le plus FIN est déjà planté par dizaines dans l'anneau proche :
    // au-delà de 3 500 triangles, une poignée d'arbres mangerait le budget.
    const finest = species.lods[0];
    assert.ok(
      finest.triangles < 3500,
      `${species.id} au niveau le plus fin : ${finest.triangles} triangles`,
    );

    const coarsest = species.lods[species.lods.length - 1];
    assert.ok(
      coarsest.triangles < 1200,
      `${species.id} au niveau le plus grossier : ${coarsest.triangles} triangles`,
    );
  }
});
