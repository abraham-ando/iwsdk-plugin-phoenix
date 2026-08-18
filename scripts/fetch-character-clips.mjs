#!/usr/bin/env node
/**
 * Récupère les clips d'animation Ready Player Me dont l'étape 3 a besoin.
 *
 * Ils ne sont PAS commités, et ce n'est pas un choix d'encombrement : la
 * licence de readyplayerme/animation-library (LICENSE.md, clause 3) interdit
 * de « redistribute, sell, or otherwise transfer the Animations, in whole or
 * in part, to any third party ». Pousser ces fichiers dans un dépôt public
 * EST une redistribution. La clause 1 autorise en revanche l'usage, gratuit,
 * personnel comme commercial, et la clause 2 le restreint aux avatars Ready
 * Player Me — ce que la démo utilise précisément.
 *
 * Chaque développeur les récupère donc lui-même, sous sa propre acceptation.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(ROOT, 'apps/demo/public/characters');
const API = 'https://api.github.com/repos/readyplayerme/animation-library';

/** Chemin source dans le dépôt RPM → nom du fichier local. */
export const CLIPS = {
  'masculine/glb/idle/M_Standing_Idle_001.glb': 'idle-masculine.glb',
  'feminine/glb/idle/F_Standing_Idle_001.glb': 'idle-feminine.glb',
  'masculine/glb/locomotion/M_Walk_001.glb': 'walk-masculine.glb',
  // Les marches féminines de la bibliothèque commencent à 002 : F_Walk_001
  // N'EXISTE PAS. Vérifié sur l'arborescence complète.
  'feminine/glb/locomotion/F_Walk_002.glb': 'walk-feminine.glb',
  // Fixture de test, pas un asset de la démo : dix-sept pistes de translation
  // dont seize constantes.
  'feminine/glb/dance/F_Dances_001.glb': 'dance-fixture.glb',
};

/** Avatars T-pose : rigs complets, skinnés, 19/19 rôles d'os satisfaits. */
export const AVATARS = {
  'masculine/glb/Masculine_TPose.glb': 'avatar-tpose-masculine.glb',
  'feminine/glb/Feminine_TPose.glb': 'avatar-tpose-feminine.glb',
};

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'cardinal-fetch-clips' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log(
    'Clips Ready Player Me — licence propriétaire, usage autorisé, ' +
      'REDISTRIBUTION INTERDITE.\n' +
      'https://github.com/readyplayerme/animation-library/blob/master/LICENSE.md\n',
  );
  mkdirSync(DEST, { recursive: true });

  // Clips ET avatars T-pose partagent le même dossier, la même règle
  // `.gitignore`, et la même boucle de téléchargement : ni les uns ni les
  // autres ne sont redistribuables.
  const ALL = { ...CLIPS, ...AVATARS };
  const missing = Object.entries(ALL).filter(
    ([, local]) => !existsSync(join(DEST, local)),
  );
  if (missing.length === 0) {
    console.log(`Les ${Object.keys(ALL).length} fichiers sont déjà présents.`);
    return;
  }

  // L'arbre récursif donne le sha de chaque blob ; l'API de blobs répond là où
  // raw.githubusercontent renvoie par moments un 503 de son CDN.
  const tree = (await json(`${API}/git/trees/master?recursive=1`)).tree;
  const bySource = new Map(tree.map((e) => [e.path, e]));

  for (const [source, local] of missing) {
    const entry = bySource.get(source);
    if (entry === undefined) {
      throw new Error(
        `Clip absent de la bibliothèque : "${source}". La bibliothèque a ` +
          `peut-être changé ; vérifiez le §6.2 de la spec de l'étape 3.`,
      );
    }
    const blob = await json(entry.url);
    const data = Buffer.from(blob.content, 'base64');
    if (data.subarray(0, 4).toString() !== 'glTF') {
      throw new Error(`"${source}" ne commence pas par la signature glTF.`);
    }
    writeFileSync(join(DEST, local), data);
    console.log(`  ${local.padEnd(22)} ${(data.length / 1024) | 0} Ko`);
  }
}

main().catch((error) => {
  console.error(`\nRécupération des clips impossible : ${error.message}`);
  console.error(
    'Hors ligne, quatre tests de @iwsdk/cardinal-character-three se sauteront ' +
      'bruyamment et la démo restera en marionnettes. Ce sont des chemins ' +
      'nominaux, pas des pannes.',
  );
  process.exitCode = 1;
});
