import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `@pmndrs/uikit` engendre l'atlas MSDF d'une police à l'exécution, à partir
 * d'un jeu de caractères codé en dur — ASCII pur en amont. Toute interface
 * spatiale en français y perdait ses accents : « D■lib■ration locale ».
 *
 * Le correctif est déclaré dans `patchedDependencies`. Ce test vérifie qu'il
 * est bien APPLIQUÉ dans l'arbre installé : une montée de version qui le
 * ferait tomber doit se voir ici, pas dans un casque.
 */
const PNPM = 'node_modules/.pnpm';

function ttfLoaderSources() {
  return readdirSync(PNPM)
    .filter((d) => d.startsWith('@pmndrs+uikit@'))
    .map((d) => join(PNPM, d, 'node_modules/@pmndrs/uikit/dist/loaders/ttf.js'))
    .map((p) => {
      try {
        return { path: p, source: readFileSync(p, 'utf8') };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

test("le jeu de caractères de l'atlas MSDF porte les accents français", () => {
  const sources = ttfLoaderSources();
  assert.ok(sources.length > 0, '@pmndrs/uikit introuvable dans node_modules/.pnpm');

  // Le correctif crée une copie « _patch_hash= » ; c'est elle que résout le
  // workspace, et c'est donc elle qui doit porter les accents.
  const patched = sources.filter((s) => s.path.includes('_patch_hash='));
  assert.ok(
    patched.length > 0,
    'aucune copie corrigée de @pmndrs/uikit : le patch de patchedDependencies ne s’applique plus'
  );

  for (const { path, source } of patched) {
    for (const lettre of 'àâçèéêëîïôùûüÀÉÈÊÇ') {
      assert.ok(
        source.includes(lettre),
        `${path} : « ${lettre} » absent du jeu de caractères — les panneaux perdront leurs accents`
      );
    }
  }
});

test("l'atlas est assez grand pour les glyphes ajoutés", () => {
  // ~140 glyphes au lieu de 104 : à 512², les derniers débordaient.
  for (const { path, source } of ttfLoaderSources().filter((s) => s.path.includes('_patch_hash='))) {
    assert.ok(
      /textureSize:\s*\[1024,\s*1024\]/.test(source),
      `${path} : atlas resté en 512² alors que le jeu de caractères a grandi`
    );
  }
});

test('le correctif est déclaré dans le manifeste, pas seulement présent sur disque', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const patches = pkg.pnpm?.patchedDependencies ?? {};
  const clef = Object.keys(patches).find((k) => k.startsWith('@pmndrs/uikit@'));
  assert.ok(clef, 'patchedDependencies ne mentionne pas @pmndrs/uikit');
  assert.ok(
    readFileSync(patches[clef], 'utf8').includes('charset'),
    `${patches[clef]} ne touche pas au jeu de caractères`
  );
});
