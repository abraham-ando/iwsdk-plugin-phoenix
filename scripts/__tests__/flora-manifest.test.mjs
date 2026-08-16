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

  assert.equal(manifest.version, 2);
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

      // L'écorce existe toujours ; le feuillage disparaît au niveau le plus
      // grossier, où il est délibérément supprimé.
      assert.ok(lod.bark, `${species.id} niveau ${lod.level} : écorce absente`);
      for (const part of ['bark', 'leaves']) {
        if (!lod[part]) continue;
        for (const field of ['position', 'normal', 'uv', 'index']) {
          const range = lod[part][field];
          assert.ok(range, `${species.id}.${part} : champ ${field} absent`);
          assert.ok(
            range.offset + range.count * range.bytes <= bin.length,
            `${species.id}.${part}.${field} déborde du binaire`,
          );
        }
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

test("SÉPARE l'écorce du feuillage", () => {
  // Fusionnées, les deux parties partageaient un matériau et les arbres
  // sortaient monochromes. La séparation est la raison d'être de la version 2.
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  let withLeaves = 0;
  for (const species of manifest.species) {
    for (const lod of species.lods) {
      if (lod.leaves) {
        withLeaves++;
        assert.ok(
          lod.leaves.triangles > 0,
          `${species.id} niveau ${lod.level} : feuillage déclaré mais vide`,
        );
      }
    }
  }
  assert.ok(withLeaves >= 3, `seulement ${withLeaves} niveaux portent du feuillage`);
});
