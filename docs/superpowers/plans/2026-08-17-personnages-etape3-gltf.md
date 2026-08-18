# Étape 3 — Le chemin glTF : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** faire entrer un rig Ready Player Me réel dans le pont de l'étape 2, le faire bouger sur des clips réels, et remplacer `AgentAvatarFactory` par un basculement avec repli.

**Architecture :** trois ajouts à `@iwsdk/cardinal-character-three` (politique de root motion, fabrique depuis le manifeste, système d'animation), puis un basculement côté démo derrière un contrat `VillagerBody` à deux implémentations — marionnette et rig. Les clips ne sont jamais commités : un script les récupère dans un dossier ignoré, parce que leur licence interdit la redistribution.

**Tech Stack :** TypeScript 5.9, pnpm workspace, vitest, tsup, `@iwsdk/core@0.5.3` (Three r181 réexporté), elics 3.4.2, Node ≥ 20.19.

**Spec :** `docs/superpowers/specs/2026-08-17-personnages-etape3-gltf-design.md`

## Global Constraints

- **Three s'importe depuis `@iwsdk/core`**, jamais depuis `three`. Seule exception : `import type { GLTF } from 'three/addons/...'`.
- **`skeleton.calculateInverses()` ne doit apparaître nulle part.** Déplacer un os *est* la déformation ; recalculer les inverses l'annule.
- **Les assets se chargent par `AssetManager` / le manifeste**, jamais par un `GLTFLoader` brut dans le code applicatif. (Le script de récupération et les tests Node en sont exclus : ils ne tournent pas dans le monde.)
- **Aucune allocation dans `update()`.** Allouer dans `init()` en propriétés de classe. Budget VR : 11–14 ms par frame.
- **`setValue` lève sur `Types.Color`, `Vec2/3/4`** en elics 3.4.x : passer par `entity.getVectorView(...)`.
- **`entity.dispose()`, jamais `entity.destroy()`** — le second fuit la mémoire GPU.
- **`noUncheckedIndexedAccess` est actif** : tout accès indexé est gardé ou suffixé de `!`.
- **Commentaires en français**, descriptions de tests comprises.
- **Les clips RPM ne sont JAMAIS commités** (licence, spec §6.2). `apps/demo/public/characters/` est dans `.gitignore`.
- Avant chaque commit : `pnpm --filter <paquet> test`, `pnpm typecheck`, `pnpm build`.

---

## Structure des fichiers

| fichier | responsabilité |
| :--- | :--- |
| `scripts/fetch-character-clips.mjs` | **créé** — télécharge les cinq GLB dans un dossier ignoré, imprime la licence |
| `packages/character-three/src/clips/rootMotion.ts` | **créé** — les trois politiques, isolées et testables sans clip |
| `packages/character-three/src/clips/sanitize.ts` | **modifié** — option `rootMotion`, clé de mémo étendue |
| `packages/character-three/src/create.ts` | **modifié** — `createCharacterFromAsset`, `installCharacterThree` gagne le système d'animation |
| `packages/character-three/src/clips/load.ts` | **créé** — `loadCharacterClips` |
| `packages/character-three/src/systems/CharacterAnimationSystem.ts` | **créé** — un mixer par personnage |
| `apps/demo/src/simulation/villagerGenomes.ts` | **créé** — les onze génomes, dont deux engendrés |
| `apps/demo/src/simulation/VillagerBody.ts` | **créé** — le contrat et ses deux implémentations |
| `apps/demo/src/simulation/PrehistoricEnvironment3D.ts` | **modifié** — la carte porte des `VillagerBody` |
| `apps/demo/src/simulation/CardinalSimulationSystem.ts` | **modifié** — `body.setPose(...)` |
| `apps/demo/src/index.ts` | **modifié** — `installCharacterThree`, le basculement asynchrone |

---

## Task 1 : La sonde réseau

**Cette tâche ne produit pas de code. Elle produit une réponse**, et cette réponse décide de ce que l'étape 3 pourra promettre. Elle passe en premier pour la même raison que l'applicateur skinné passait en premier à l'étape 2 : le pari non vérifié devant.

**Elle ne bloque pas les tâches 2 à 7.** Quel que soit son résultat, le code à écrire est le même. Seule la tâche 8 en dépend.

**Files :**
- Aucun fichier modifié. Le résultat va dans le rapport de tâche.

**Interfaces :**
- Consumes : rien.
- Produces : une réponse binaire — le navigateur managé atteint-il `models.readyplayer.me` ?

- [ ] **Step 1 : Démarrer le serveur de développement**

```bash
cd apps/demo && npx iwsdk dev up
```

Attendre que `npx iwsdk dev status` rapporte `browserCommandReady: true`. Si le démarrage échoue, ne pas insister : rapporter l'erreur telle quelle et passer au Step 4.

- [ ] **Step 2 : Demander à la PAGE de charger un avatar**

La question n'est pas « mon shell atteint-il ce domaine » — il ne l'atteint pas, c'est mesuré — mais « le navigateur managé l'atteint-il ». La requête doit donc partir de la page.

```bash
npx iwsdk browser eval --expression "fetch('https://models.readyplayer.me/6460d37e9d050a41d0ec2085.glb', { method: 'HEAD' }).then(r => 'HTTP ' + r.status).catch(e => 'ECHEC ' + e.message)"
```

Si `browser eval` n'existe pas sous ce nom, découvrir la bonne action avec `npx iwsdk browser --help` et l'utiliser. Ne pas contourner par un `curl` depuis le shell : il répondrait à une autre question.

- [ ] **Step 3 : Relever aussi la console**

```bash
npx iwsdk browser get-console-logs --count 100
```

Chercher toute erreur réseau ou CORS mentionnant `readyplayer`.

- [ ] **Step 4 : Rapporter**

Rapporter exactement l'une des trois réponses, sans l'interpréter :

- `RESEAU_OK` — la page a reçu un statut HTTP 2xx/3xx. Citer le statut.
- `RESEAU_BLOQUE` — la page a échoué. Citer le message.
- `OUTILLAGE_INDISPONIBLE` — le serveur ou le pont navigateur n'a pas démarré. Citer l'erreur et ce qui a été tenté.

Aucun commit dans cette tâche.

---

## Task 2 : Le script de récupération des clips

**Files :**
- Create: `scripts/fetch-character-clips.mjs`
- Modify: `.gitignore`
- Modify: `package.json` (racine — un script `clips`, et `test` qui l'appelle)
- Modify: `apps/demo/src/assets.ts`

**Interfaces :**
- Consumes : rien.
- Produces : cinq fichiers dans `apps/demo/public/characters/`, et quatre identifiants de manifeste — `clip-idle-masculine`, `clip-idle-feminine`, `clip-walk-masculine`, `clip-walk-feminine`. Le cinquième, `characters/F_Dances_001.glb`, n'est PAS déclaré au manifeste : c'est une fixture de test.

- [ ] **Step 1 : Écrire le script**

Les chemins sources sont exacts et vérifiés sur l'arborescence des 240 GLB du dépôt. `F_Walk_001.glb` **n'existe pas** — ne pas le « corriger » en le rétablissant.

Create `scripts/fetch-character-clips.mjs` :

```js
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

  const missing = Object.entries(CLIPS).filter(
    ([, local]) => !existsSync(join(DEST, local)),
  );
  if (missing.length === 0) {
    console.log(`Les ${Object.keys(CLIPS).length} clips sont déjà présents.`);
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
```

- [ ] **Step 2 : Lancer le script et vérifier les poids**

```bash
node scripts/fetch-character-clips.mjs && ls -la apps/demo/public/characters/
```

Attendu : cinq fichiers. Ordres de grandeur — `idle-masculine` ~163 Ko, `idle-feminine` ~392 Ko, `walk-masculine` ~70 Ko, `walk-feminine` ~108 Ko, `dance-fixture` ~156 Ko. Si un fichier fait moins de 10 Ko, c'est une page d'erreur déguisée : le script doit avoir levé sur la signature `glTF`.

- [ ] **Step 3 : Ignorer le dossier**

Ajouter à `.gitignore` :

```
# Clips d'animation Ready Player Me : récupérés par
# scripts/fetch-character-clips.mjs, JAMAIS commités — leur licence interdit
# la redistribution (spec étape 3, §6.2).
apps/demo/public/characters/
```

- [ ] **Step 4 : Vérifier que git les ignore VRAIMENT**

```bash
git status --porcelain apps/demo/public/characters/ && git check-ignore -v apps/demo/public/characters/idle-masculine.glb
```

Attendu : la première commande n'affiche **rien**, la seconde nomme la règle du `.gitignore`. Si un GLB apparaît dans `git status`, s'arrêter : le commit redistribuerait les fichiers.

- [ ] **Step 5 : Câbler le script dans package.json**

Dans `package.json` à la racine, ajouter à `"scripts"` :

```json
"clips": "node scripts/fetch-character-clips.mjs",
```

et préfixer la valeur de `"test"` par `node scripts/fetch-character-clips.mjs || true && ` — le `|| true` est délibéré : hors ligne, la suite doit tourner et les quatre tests concernés se sauter bruyamment, pas faire échouer l'ensemble.

- [ ] **Step 6 : Déclarer les quatre clips au manifeste**

Dans `apps/demo/src/assets.ts`, à l'intérieur de `defineAssets({ ... })`, à côté des avatars :

```ts
  // Clips d'animation Ready Player Me. Les fichiers sont récupérés par
  // `pnpm clips` et ne sont pas dans le dépôt : leur licence interdit la
  // redistribution. Absents, la démo reste en marionnettes.
  'clip-idle-masculine': {
    url: publicAssetUrl('characters/idle-masculine.glb'),
    type: AssetType.GLTF,
    name: 'RPM Idle (masculine rig)',
    priority: 'lazy',
  },
  'clip-idle-feminine': {
    url: publicAssetUrl('characters/idle-feminine.glb'),
    type: AssetType.GLTF,
    name: 'RPM Idle (feminine rig)',
    priority: 'lazy',
  },
  'clip-walk-masculine': {
    url: publicAssetUrl('characters/walk-masculine.glb'),
    type: AssetType.GLTF,
    name: 'RPM Walk (masculine rig)',
    priority: 'lazy',
  },
  'clip-walk-feminine': {
    url: publicAssetUrl('characters/walk-feminine.glb'),
    type: AssetType.GLTF,
    name: 'RPM Walk (feminine rig)',
    priority: 'lazy',
  },
```

- [ ] **Step 7 : Vérifier et commiter**

```bash
pnpm --filter @iwsdk/plugin-phoenix-demo typecheck
git status --porcelain | grep -c "public/characters" || echo "aucun GLB indexé — correct"
git add .gitignore package.json scripts/fetch-character-clips.mjs apps/demo/src/assets.ts
git commit -m "feat(character): fetch RPM clips without redistributing them"
```

---

## Task 3 : La politique de root motion

**Files :**
- Create: `packages/character-three/src/clips/rootMotion.ts`
- Modify: `packages/character-three/src/clips/sanitize.ts`
- Modify: `packages/character-three/src/index.ts`
- Create: `packages/character-three/test/root-motion.test.ts`
- Create: `packages/character-three/test/fixtures/realClip.ts`

**Interfaces :**
- Consumes : `sanitizeClip(clip, family, roleOfNode)` de l'étape 2, verdicts `'keep' | 'strip' | 'conflict'` de `classifyTranslationTrack`.
- Produces :
  - `export type RootMotionPolicy = 'keep' | 'strip' | 'flatten';`
  - `export function applyRootMotionPolicy(track: KeyframeTrack, policy: RootMotionPolicy): KeyframeTrack | null;`
  - `sanitizeClip(clip, family, roleOfNode, options?: { rootMotion?: RootMotionPolicy })`, défaut `'keep'`.

- [ ] **Step 1 : Écrire le chargeur de fixture réelle**

Create `packages/character-three/test/fixtures/realClip.ts` :

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AnimationClip } from '@iwsdk/core';

const DIR = join(__dirname, '../../../../apps/demo/public/characters');

/** Vrai si les clips récupérés par `pnpm clips` sont présents. */
export function clipsAvailable(): boolean {
  return existsSync(join(DIR, 'walk-masculine.glb'));
}

/**
 * Message de saut BRUYANT. Un test qui se saute en silence ne prouve rien —
 * ce dépôt en a déjà retiré une douzaine.
 */
export const SKIP_REASON =
  'clips RPM absents — lancer `pnpm clips` (ils ne sont pas commités, ' +
  'leur licence interdit la redistribution)';

/** Charge le premier clip d'un GLB récupéré. */
export async function loadRealClip(fileName: string): Promise<AnimationClip> {
  const buf = readFileSync(join(DIR, fileName));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise<{ animations: AnimationClip[] }>((res, rej) =>
    new GLTFLoader().parse(ab as ArrayBuffer, '', res as never, rej),
  );
  const clip = gltf.animations[0];
  if (clip === undefined) throw new Error(`${fileName} ne contient aucun clip`);
  return clip;
}

/** Amplitude maximale sur les trois axes d'une piste de position. */
export function amplitudeXYZ(values: ArrayLike<number>): [number, number, number] {
  const span: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = axis; i < values.length; i += 3) {
      const v = values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    span[axis] = max - min;
  }
  return span;
}
```

- [ ] **Step 2 : Écrire les tests qui échouent**

Create `packages/character-three/test/root-motion.test.ts` :

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { HUMANOID } from '@iwsdk/cardinal-character';
import { sanitizeClip } from '../src/clips/sanitize';
import type { AnimationClip } from '@iwsdk/core';
import { clipsAvailable, loadRealClip, amplitudeXYZ, SKIP_REASON } from './fixtures/realClip';

// `roleOfNode` d'un rig RPM : les noms Mixamo, tels que la bibliothèque les
// exporte. Seule la hanche nous intéresse ici — c'est elle qui porte la
// translation.
const roleOfNode = (name: string): string | null => (name === 'Hips' ? 'root' : null);

const available = clipsAvailable();
const maybe = available ? describe : describe.skip;
if (!available) console.warn(`\n⚠️  root-motion.test.ts SAUTÉ : ${SKIP_REASON}\n`);

maybe('politique de root motion sur un vrai clip de marche', () => {
  let walk: AnimationClip;
  beforeAll(async () => {
    walk = await loadRealClip('walk-masculine.glb');
  });

  function hipsAmplitude(clip: AnimationClip): [number, number, number] {
    const track = clip.tracks.find((t) => t.name === 'Hips.position');
    expect(track, 'le clip doit porter une piste Hips.position').toBeDefined();
    return amplitudeXYZ(track!.values);
  }

  it('mesure bien un vrai voyage horizontal avant toute politique', () => {
    // Si ce garde tombe, ce n'est plus le bon clip et les trois tests
    // suivants ne prouveraient plus rien.
    const [x, , z] = hipsAmplitude(walk);
    expect(Math.max(x, z)).toBeGreaterThan(1);
  });

  it('« keep » laisse le voyage intact', () => {
    const before = hipsAmplitude(walk);
    const after = hipsAmplitude(sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'keep' }).clip);
    expect(after[0]).toBeCloseTo(before[0], 5);
    expect(after[2]).toBeCloseTo(before[2], 5);
  });

  it('« strip » retire la piste racine', () => {
    const { clip } = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'strip' });
    expect(clip.tracks.find((t) => t.name === 'Hips.position')).toBeUndefined();
  });

  it('« flatten » annule l horizontale et PRÉSERVE la verticale', () => {
    const before = hipsAmplitude(walk);
    const after = hipsAmplitude(sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'flatten' }).clip);
    expect(after[0]).toBeLessThan(1e-6);
    expect(after[2]).toBeLessThan(1e-6);
    // La verticale doit rester : c'est le balancement de la marche. Une
    // implémentation qui remettrait les trois axes à zéro passe les deux
    // assertions ci-dessus et tombe sur celle-ci.
    expect(after[1]).toBeCloseTo(before[1], 5);
    expect(after[1]).toBeGreaterThan(0);
  });

  it('« flatten » rebase sur la première clé au lieu de viser zéro', () => {
    const { clip } = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'flatten' });
    const track = clip.tracks.find((t) => t.name === 'Hips.position')!;
    const source = walk.tracks.find((t) => t.name === 'Hips.position')!;
    // X et Z valent la PREMIÈRE clé du clip source, pas 0 : les hanches ne
    // sont pas à l'origine de l'armature, et les y ramener téléporterait le
    // bassin.
    expect(track.values[0]).toBeCloseTo(source.values[0]!, 6);
    expect(track.values[2]).toBeCloseTo(source.values[2]!, 6);
  });

  it('ne mute jamais le clip source, partagé par tout le village', () => {
    const before = hipsAmplitude(walk);
    sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'flatten' });
    const after = hipsAmplitude(walk);
    expect(after[0]).toBeCloseTo(before[0], 6);
  });

  it('la clé de mémo inclut la politique', () => {
    // Même clip, même famille, mêmes rôles : seule la politique change. Une
    // clé qui l'ignorerait rendrait au second appelant le verdict du premier.
    const kept = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'keep' }).clip;
    const flat = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'flatten' }).clip;
    expect(flat).not.toBe(kept);
    expect(amplitudeXYZ(flat.tracks.find((t) => t.name === 'Hips.position')!.values)[0]).toBeLessThan(1e-6);
  });

  it('le défaut est « keep », donc les appelants de l étape 2 ne changent pas', () => {
    const withoutOptions = sanitizeClip(walk, HUMANOID, roleOfNode).clip;
    const explicitKeep = sanitizeClip(walk, HUMANOID, roleOfNode, { rootMotion: 'keep' }).clip;
    expect(hipsAmplitude(withoutOptions)[0]).toBeCloseTo(hipsAmplitude(explicitKeep)[0], 6);
  });
});

maybe('la vraie danse : dix-sept pistes de translation, seize constantes', () => {
  it('en retire seize sans lever, et garde la racine', async () => {
    const dance = await loadRealClip('dance-fixture.glb');
    const positions = dance.tracks.filter((t) => t.name.endsWith('.position'));
    expect(positions.length).toBe(17);

    const { clip, stripped } = sanitizeClip(dance, HUMANOID, roleOfNode);
    expect(stripped.length).toBe(16);
    expect(stripped).not.toContain('Hips.position');
    expect(clip.tracks.find((t) => t.name === 'Hips.position')).toBeDefined();
  });
});
```

- [ ] **Step 3 : Lancer les tests pour les voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character-three test root-motion
```

Attendu : ÉCHEC — `sanitizeClip` n'accepte pas de quatrième argument. Si les tests se **sautent** à la place, `pnpm clips` n'a pas tourné : le lancer et recommencer.

- [ ] **Step 4 : Écrire les politiques**

Create `packages/character-three/src/clips/rootMotion.ts` :

```ts
import type { KeyframeTrack } from '@iwsdk/core';

/**
 * Que faire de la piste de translation de l'os racine.
 *
 * Ce n'est PAS une question d'espèce, donc ce n'est pas un champ de
 * `FamilyDescriptor` : c'est la question de savoir qui possède la position du
 * personnage dans le monde. Un villageois dont `AgentView.x/z` est recalculé
 * à chaque tick et un personnage joueur en locomotion libre appartiennent à la
 * même famille et veulent des réponses opposées. C'est donc l'appelant qui
 * tranche.
 *
 * Mesuré : `M_Walk_001` déplace les hanches de 3,21 m par boucle. Laissée
 * telle quelle sur un villageois, la marche l'emmène trois mètres devant
 * lui-même avant que la simulation ne le reteleporte.
 */
export type RootMotionPolicy = 'keep' | 'strip' | 'flatten';

/**
 * Applique la politique à la piste racine. Rend `null` quand la piste doit
 * disparaître, un NOUVEAU `KeyframeTrack` quand elle doit être transformée, et
 * la piste reçue quand elle est laissée intacte.
 *
 * Ne mute jamais la piste reçue : les clips viennent d'un glTF partagé par tout
 * le village, et les modifier sur place aplatirait la marche de tout le monde
 * depuis le premier personnage.
 */
export function applyRootMotionPolicy(
  track: KeyframeTrack,
  policy: RootMotionPolicy,
): KeyframeTrack | null {
  if (policy === 'keep') return track;
  if (policy === 'strip') return null;

  const copy = track.clone();
  const v = copy.values;
  // Rebasage sur la PREMIÈRE clé, pas sur zéro. Les hanches sont à ~1 m au-
  // dessus de l'origine de l'armature et rarement à x = z = 0 ; les y ramener
  // téléporterait le bassin. Chaque clé reçoit donc l'horizontale de DÉPART :
  // le voyage disparaît, la pose reste.
  const baseX = v[0] ?? 0;
  const baseZ = v[2] ?? 0;
  for (let i = 0; i < v.length; i += 3) {
    v[i] = baseX;
    v[i + 2] = baseZ;
    // v[i + 1], l'axe vertical, reste intact : c'est le balancement de la
    // marche et l'accroupissement du repos.
  }
  return copy;
}
```

- [ ] **Step 5 : Brancher la politique dans l'assainisseur**

Modify `packages/character-three/src/clips/sanitize.ts` :

1. Importer : `import { applyRootMotionPolicy, type RootMotionPolicy } from './rootMotion';`
2. Étendre `verdictKey` pour qu'elle prenne la politique et la préfixe à la clé :

```ts
function verdictKey(
  clip: AnimationClip,
  family: FamilyDescriptor,
  roleOfNode: (nodeName: string) => string | null,
  rootMotion: RootMotionPolicy,
): string {
  // La politique entre dans la clé. Sans elle, le cache rendrait un clip
  // aplati à un appelant qui demandait `keep` — le même défaut que la revue de
  // l'étape 2 a trouvé sur une clé par famille seule.
  let key = `${family.id}#${rootMotion}`;
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const nodeName = track.name.slice(0, -'.position'.length);
    key += `|${nodeName}=${roleOfNode(nodeName) ?? ''}`;
  }
  return key;
}
```

3. Étendre la signature et le corps :

```ts
export function sanitizeClip(
  clip: AnimationClip,
  family: FamilyDescriptor,
  roleOfNode: (nodeName: string) => string | null,
  options?: { rootMotion?: RootMotionPolicy },
): Sanitized {
  const rootMotion = options?.rootMotion ?? 'keep';
  // ... cache inchangé, mais `verdictKey(clip, family, roleOfNode, rootMotion)`
```

et, dans la boucle, remplacer `if (verdict === 'keep') kept.push(track);` par :

```ts
    if (verdict === 'keep') {
      // Seule la racine reçoit `keep` : c'est donc la seule piste que la
      // politique concerne.
      const policed = applyRootMotionPolicy(track, rootMotion);
      if (policed === null) stripped.push(track.name);
      else kept.push(policed);
    }
```

- [ ] **Step 6 : Exporter depuis l'index**

Modify `packages/character-three/src/index.ts`, remplacer la ligne `export { sanitizeClip } from './clips/sanitize';` par :

```ts
export { sanitizeClip } from './clips/sanitize';
export { applyRootMotionPolicy, type RootMotionPolicy } from './clips/rootMotion';
```

- [ ] **Step 7 : Lancer les tests**

```bash
pnpm --filter @iwsdk/cardinal-character-three test
```

Attendu : les 64 tests de l'étape 2 restent verts (le défaut `'keep'` ne change rien) plus les neuf nouveaux.

- [ ] **Step 8 : Prouver que le garde de `flatten` peut tomber**

Remplacer temporairement, dans `rootMotion.ts`, le second bloc de rétablissement par rien (donc rebasage vers zéro), relancer, et **vérifier que le test « rebase sur la première clé » tombe**. Rétablir ensuite. Si le test passe quand même, il ne prouve rien et doit être renforcé avant de continuer.

- [ ] **Step 9 : Passer la sonde sur les deux clips jamais mesurés**

La spec (§10.1) le demande : `idle-feminine.glb` et `walk-feminine.glb` n'ont pas été parsés lors de la rédaction. Ajouter à `root-motion.test.ts` :

```ts
maybe('les deux clips féminins suivent la même convention', () => {
  it.each(['idle-feminine.glb', 'walk-feminine.glb'])(
    '%s : une seule piste de translation, et c est la hanche',
    async (file) => {
      const clip = await loadRealClip(file);
      const positions = clip.tracks.filter((t) => t.name.endsWith('.position'));
      const moving = positions.filter((t) => Math.max(...amplitudeXYZ(t.values)) > 1e-6);
      expect(moving.map((t) => t.name)).toEqual(['Hips.position']);
    },
  );
});
```

Si l'un des deux dément la convention, **s'arrêter et le signaler** : la spec devra être corrigée avant que la tâche 4 soit écrite.

- [ ] **Step 10 : Vérifier et commiter**

```bash
pnpm --filter @iwsdk/cardinal-character-three test && pnpm typecheck && pnpm build
git add packages/character-three
git commit -m "feat(character-three): root motion policy, measured on a real walk cycle"
```

---

## Task 4 : La fabrique et le chargement des clips

**Files :**
- Create: `packages/character-three/src/clips/load.ts`
- Modify: `packages/character-three/src/create.ts`
- Modify: `packages/character-three/src/index.ts`
- Create: `packages/character-three/test/from-asset.test.ts`

**Interfaces :**
- Consumes : `createCharacter(world, { familyId, genome, age, rigRoot })` de l'étape 2 ; `world.assets.instantiate<T extends Object3D>(id): Promise<T>` ; `AssetManager.loadGLTFById(id): Promise<GLTF>`.
- Produces :
  - `createCharacterFromAsset(world, { assetId, familyId, genome, age }): Promise<{ entity, report }>`
  - `loadCharacterClips(ids: Readonly<Record<string, string>>): Promise<Record<string, AnimationClip>>`

- [ ] **Step 1 : Écrire les tests qui échouent**

Create `packages/character-three/test/from-asset.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { World, Object3D } from '@iwsdk/core';
import { HUMANOID, defaultGenome } from '@iwsdk/cardinal-character';
import { createCharacterFromAsset } from '../src/create';
import { installCharacterThree } from '../src/create';
import { humanoidPuppet } from './fixtures/humanoidPuppet';

/** Monde dont le gestionnaire d'assets est remplacé par un double. */
function worldWithAssets(instantiate: (id: string) => Promise<Object3D>): World {
  const world = new World();
  installCharacterThree(world);
  (world as unknown as { assets: { instantiate: typeof instantiate } }).assets = { instantiate };
  return world;
}

describe('createCharacterFromAsset', () => {
  it('passe au pont la RACINE rendue par le manifeste, pas un maillage', async () => {
    const { root } = humanoidPuppet();
    let asked: string | null = null;
    const world = worldWithAssets(async (id) => {
      asked = id;
      return root;
    });

    const { entity, report } = await createCharacterFromAsset(world, {
      assetId: 'avatar-mira',
      familyId: HUMANOID.id,
      genome: defaultGenome(HUMANOID),
      age: 34,
    });

    expect(asked).toBe('avatar-mira');
    expect(report.missingBones).toEqual([]);
    // Le nœud du manifeste doit se retrouver DANS la hiérarchie de l'entité —
    // c'est ce qui prouve qu'il a bien été passé comme `rigRoot` et non ignoré.
    let found = false;
    entity.object3D!.traverse((n) => { if (n === root) found = true; });
    expect(found).toBe(true);
  });

  it('laisse remonter l échec de CHARGEMENT tel quel', async () => {
    const world = worldWithAssets(async () => {
      throw new Error('Unknown renderable asset "avatar-absent"');
    });
    await expect(
      createCharacterFromAsset(world, {
        assetId: 'avatar-absent', familyId: HUMANOID.id,
        genome: defaultGenome(HUMANOID), age: 30,
      }),
    ).rejects.toThrow(/Unknown renderable asset/);
  });

  it('laisse remonter le REFUS DE RIG, distinct de l échec de chargement', async () => {
    // Un nœud nu : aucun os. `createCharacter` doit lever en nommant les os
    // manquants, et ce message doit rester lisible à travers la fabrique.
    const world = worldWithAssets(async () => new Object3D());
    await expect(
      createCharacterFromAsset(world, {
        assetId: 'avatar-vide', familyId: HUMANOID.id,
        genome: defaultGenome(HUMANOID), age: 30,
      }),
    ).rejects.toThrow(/os manquants/);
  });

  it('les deux échecs ne se confondent pas', async () => {
    // Un appelant doit pouvoir dire lequel s est produit sans instrumenter le
    // code : c est ce qui permet à la démo de journaliser une cause utile.
    const loadFail = await createCharacterFromAsset(
      worldWithAssets(async () => { throw new Error('Unknown renderable asset "x"'); }),
      { assetId: 'x', familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 30 },
    ).catch((e: Error) => e.message);
    const rigFail = await createCharacterFromAsset(
      worldWithAssets(async () => new Object3D()),
      { assetId: 'y', familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 30 },
    ).catch((e: Error) => e.message);
    expect(loadFail).not.toBe(rigFail);
  });
});
```

- [ ] **Step 2 : Lancer pour voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character-three test from-asset
```

Attendu : ÉCHEC — `createCharacterFromAsset` n'existe pas.

- [ ] **Step 3 : Écrire la fabrique**

Ajouter à la fin de `packages/character-three/src/create.ts` :

```ts
export interface CreateCharacterFromAssetOptions {
  /** Identifiant du manifeste — jamais une URL : le chargement passe par `AssetManager`. */
  assetId: string;
  familyId: string;
  genome: Genome;
  age: number;
}

/**
 * Instancie un rig depuis le manifeste et le fait entrer dans le pont.
 *
 * `world.assets.instantiate` rend `gltf.scene` d'un clone obtenu par
 * `SkeletonUtils.clone` — donc un `Skeleton` et des os NEUFS à chaque appel,
 * ce qui est la condition pour que onze villageois portent onze morphologies
 * sur cinq assets de base. Géométries, matériaux et clips restent partagés par
 * référence : c'est pourquoi l'applicateur clone ses matériaux et l'assainisseur
 * rend un nouveau clip.
 *
 * Le nœud rendu est la racine de scène, c'est-à-dire l'ANCÊTRE COMMUN de
 * l'armature et du `SkinnedMesh` — exactement ce que `createCharacter` exige.
 * Un import glTF place souvent l'armature en frère du maillage ; passer le
 * maillage seul ferait lever le pont.
 *
 * Deux échecs remontent, et ils doivent rester distinguables : le chargement
 * (identifiant inconnu, réseau) lève depuis `AssetManager` ; le refus de rig
 * lève depuis `createCharacter` avec la liste des os manquants.
 */
export async function createCharacterFromAsset(
  world: World,
  options: CreateCharacterFromAssetOptions,
): Promise<{ entity: ReturnType<World['createTransformEntity']>; report: ImportReport }> {
  const rigRoot = await world.assets.instantiate<Object3D>(options.assetId);
  return createCharacter(world, {
    familyId: options.familyId,
    genome: options.genome,
    age: options.age,
    rigRoot,
  });
}
```

- [ ] **Step 4 : Écrire le chargeur de clips**

Create `packages/character-three/src/clips/load.ts` :

```ts
import { AssetManager, type AnimationClip } from '@iwsdk/core';

/**
 * Charge des clips depuis le manifeste et rend le PREMIER de chaque fichier.
 *
 * Les clips sont partagés par tout le village : ils n'ont rien à faire dans une
 * fabrique par personnage. L'assainissement, lui, reste par personnage — il
 * dépend du `roleOfNode` de ce rig-là — et le mémo de `sanitizeClip` le rend
 * gratuit à partir du deuxième villageois.
 *
 * Un identifiant qui ne charge pas fait échouer la promesse entière : un
 * village où la moitié des verbes n'ont pas de clip est plus difficile à
 * diagnostiquer qu'un échec net.
 */
export async function loadCharacterClips(
  ids: Readonly<Record<string, string>>,
): Promise<Record<string, AnimationClip>> {
  const clips: Record<string, AnimationClip> = {};
  for (const [verb, assetId] of Object.entries(ids)) {
    const gltf = await AssetManager.loadGLTFById(assetId);
    const clip = gltf.animations[0];
    if (clip === undefined) {
      throw new Error(
        `loadCharacterClips: l'asset "${assetId}" (verbe "${verb}") ne contient aucun clip`,
      );
    }
    clips[verb] = clip;
  }
  return clips;
}
```

- [ ] **Step 5 : Exporter**

Ajouter à `packages/character-three/src/index.ts` :

```ts
export { loadCharacterClips } from './clips/load';
```

et étendre la ligne d'export de `create` avec `createCharacterFromAsset, type CreateCharacterFromAssetOptions`.

- [ ] **Step 6 : Lancer, vérifier, commiter**

```bash
pnpm --filter @iwsdk/cardinal-character-three test && pnpm typecheck && pnpm build
git add packages/character-three
git commit -m "feat(character-three): build a character from a manifest asset"
```

---

## Task 5 : Le système d'animation

**Files :**
- Create: `packages/character-three/src/systems/CharacterAnimationSystem.ts`
- Modify: `packages/character-three/src/create.ts` (`installCharacterThree`)
- Modify: `packages/character-three/src/index.ts`
- Create: `packages/character-three/test/animation-system.test.ts`

**Interfaces :**
- Consumes : `sanitizeClip(clip, family, roleOfNode, { rootMotion })` (tâche 3).
- Produces : `class CharacterAnimationSystem`, et une méthode publique `attach(entity, clips, roleOfNode, options)` / `setVerb(entity, verb)`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Create `packages/character-three/test/animation-system.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { World, AnimationClip, VectorKeyframeTrack, QuaternionKeyframeTrack } from '@iwsdk/core';
import { HUMANOID, defaultGenome } from '@iwsdk/cardinal-character';
import { installCharacterThree, createCharacter } from '../src/create';
import { CharacterAnimationSystem } from '../src/systems/CharacterAnimationSystem';
import { humanoidPuppet } from './fixtures/humanoidPuppet';

/** Un clip minimal qui fait voyager la hanche de deux mètres en Z. */
function travellingClip(name: string): AnimationClip {
  return new AnimationClip(name, 1, [
    new VectorKeyframeTrack('root.position', [0, 1], [0, 1, 0, 0, 1, 2]),
    new QuaternionKeyframeTrack('head.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
}

function build() {
  const world = new World();
  installCharacterThree(world);
  const { root } = humanoidPuppet();
  const { entity } = createCharacter(world, {
    familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 30, rigRoot: root,
  });
  const system = world.getSystem(CharacterAnimationSystem)!;
  return { world, entity, system };
}

describe('CharacterAnimationSystem', () => {
  it('est enregistré par installCharacterThree, après la compilation et l expression', () => {
    const world = new World();
    installCharacterThree(world);
    expect(world.getSystem(CharacterAnimationSystem)).toBeDefined();
  });

  it('assainit les clips à l attachement, avec la politique demandée', () => {
    const { entity, system } = build();
    system.attach(entity, { walk: travellingClip('walk') }, () => 'root', { rootMotion: 'flatten' });
    const track = system.clipFor(entity, 'walk')!.tracks.find((t) => t.name === 'root.position')!;
    // Le voyage de deux mètres en Z doit avoir disparu ; sans aplatissement,
    // l amplitude vaudrait 2.
    const z = [track.values[2]!, track.values[5]!];
    expect(Math.abs(z[1]! - z[0]!)).toBeLessThan(1e-6);
  });

  it('un verbe sans clip retombe sur idle plutôt que de lever', () => {
    const { entity, system } = build();
    system.attach(entity, { idle: travellingClip('idle') }, () => 'root', { rootMotion: 'flatten' });
    expect(() => system.setVerb(entity, 'sleep')).not.toThrow();
    expect(system.currentVerb(entity)).toBe('idle');
  });

  it('n alloue rien dans update sur un état stable', () => {
    const { world, entity, system } = build();
    system.attach(entity, { idle: travellingClip('idle') }, () => 'root', { rootMotion: 'flatten' });
    system.setVerb(entity, 'idle');
    // Deux cents frames ne doivent pas faire croître le nombre d actions du
    // mixer : un `clipAction` par frame serait une allocation par frame.
    for (let i = 0; i < 200; i++) system.update(0.016, i * 16);
    expect(system.actionCount(entity)).toBe(1);
    void world;
  });

  it('libère le mixer quand l entité disparaît', () => {
    const { entity, system } = build();
    system.attach(entity, { idle: travellingClip('idle') }, () => 'root', { rootMotion: 'flatten' });
    expect(system.mixerCount()).toBe(1);
    entity.dispose();
    system.update(0.016, 16);
    expect(system.mixerCount()).toBe(0);
  });
});
```

- [ ] **Step 2 : Lancer pour voir échouer**

```bash
pnpm --filter @iwsdk/cardinal-character-three test animation-system
```

Attendu : ÉCHEC — le module n'existe pas.

- [ ] **Step 3 : Écrire le système**

Create `packages/character-three/src/systems/CharacterAnimationSystem.ts` :

```ts
import {
  AnimationMixer, createSystem, Types,
  type AnimationAction, type AnimationClip, type Entity,
} from '@iwsdk/core';
import { getFamily } from '@iwsdk/cardinal-character';
import { CharacterIdentity } from '../components/index';
import { sanitizeClip } from '../clips/sanitize';
import type { RootMotionPolicy } from '../clips/rootMotion';

interface Rig {
  mixer: AnimationMixer;
  clips: Record<string, AnimationClip>;
  actions: Map<string, AnimationAction>;
  verb: string;
}

/**
 * Un `AnimationMixer` par personnage, des clips assainis une fois à
 * l'attachement, et un fondu enchaîné au changement de verbe.
 *
 * Priorité 80 : APRÈS `CharacterCompileSystem` (60) et
 * `CharacterExpressionSystem` (70). Le mixer doit tourner une fois la
 * morphologie de la frame posée, sinon il écrirait sur des os que la
 * compilation replacerait juste après.
 *
 * Pourquoi pas `AvatarAnimationController` de `@iwsdk/plugin-cardinal-ai` : il
 * fait des fondus et porte quatorze tests, mais il vit du mauvais côté — faire
 * dépendre les personnages du paquet IA inverse la dépendance — et il
 * duck-type `globalThis.THREE`, ce qui le laisse SILENCIEUSEMENT sans mixer
 * quand cet objet n'est pas là.
 */
export class CharacterAnimationSystem extends createSystem(
  { characters: { required: [CharacterIdentity] } },
  { fadeSeconds: { type: Types.Float32, default: 0.25 } },
) {
  private rigs = new Map<Entity, Rig>();

  /** Attache des clips à un personnage. Les assainit une fois, ici. */
  attach(
    entity: Entity,
    clips: Readonly<Record<string, AnimationClip>>,
    roleOfNode: (nodeName: string) => string | null,
    options: { rootMotion: RootMotionPolicy },
  ): void {
    const node = entity.object3D;
    if (node === null || node === undefined) return;
    const familyId = entity.getValue(CharacterIdentity, 'familyId');
    const family = getFamily(String(familyId));

    const sanitized: Record<string, AnimationClip> = {};
    for (const [verb, clip] of Object.entries(clips)) {
      sanitized[verb] = sanitizeClip(clip, family, roleOfNode, {
        rootMotion: options.rootMotion,
      }).clip;
    }
    this.rigs.set(entity, {
      mixer: new AnimationMixer(node),
      clips: sanitized,
      actions: new Map(),
      verb: '',
    });
  }

  /**
   * Change le verbe joué. Un verbe sans clip retombe sur `idle` : la
   * bibliothèque RPM ne contient aucun clip de repos ni de sommeil, et lever
   * ici ferait tomber la démo sur un comportement normal de la simulation.
   */
  setVerb(entity: Entity, verb: string): void {
    const rig = this.rigs.get(entity);
    if (rig === undefined) return;
    const wanted = rig.clips[verb] !== undefined ? verb : 'idle';
    if (wanted === rig.verb) return;
    const clip = rig.clips[wanted];
    if (clip === undefined) return;

    // Les actions sont créées UNE fois et réutilisées : en créer une par
    // changement de verbe allouerait à chaque pas de la simulation.
    let next = rig.actions.get(wanted);
    if (next === undefined) {
      next = rig.mixer.clipAction(clip);
      rig.actions.set(wanted, next);
    }
    const previous = rig.actions.get(rig.verb);
    if (previous !== undefined && previous !== next) {
      next.reset().play();
      previous.crossFadeTo(next, this.config.fadeSeconds.peek(), false);
    } else {
      next.reset().play();
    }
    rig.verb = wanted;
  }

  currentVerb(entity: Entity): string {
    return this.rigs.get(entity)?.verb ?? '';
  }

  /** Le clip assaini d'un verbe. Pour les tests et le diagnostic. */
  clipFor(entity: Entity, verb: string): AnimationClip | undefined {
    return this.rigs.get(entity)?.clips[verb];
  }

  actionCount(entity: Entity): number {
    return this.rigs.get(entity)?.actions.size ?? 0;
  }

  mixerCount(): number {
    return this.rigs.size;
  }

  override update(delta: number): void {
    for (const [entity, rig] of this.rigs) {
      // Une entité disposée ne doit pas garder son mixer vivant : c'est une
      // fuite qui ne se voit qu'au bout d'une heure de jeu.
      if (entity.object3D === null || entity.object3D === undefined) {
        rig.mixer.stopAllAction();
        this.rigs.delete(entity);
        continue;
      }
      rig.mixer.update(delta);
    }
  }
}
```

- [ ] **Step 4 : Enregistrer le système**

Modify `installCharacterThree` dans `packages/character-three/src/create.ts` :

```ts
  world.registerSystem(CharacterCompileSystem, { priority: 60 });
  world.registerSystem(CharacterExpressionSystem, { priority: 70 });
  // 80 : le mixer tourne APRÈS que la morphologie de la frame est posée.
  world.registerSystem(CharacterAnimationSystem, { priority: 80 });
```

et ajouter l'import correspondant en tête de fichier.

- [ ] **Step 5 : Exporter**

Ajouter à `packages/character-three/src/index.ts` :

```ts
export { CharacterAnimationSystem } from './systems/CharacterAnimationSystem';
```

- [ ] **Step 6 : Lancer, vérifier, commiter**

```bash
pnpm --filter @iwsdk/cardinal-character-three test && pnpm typecheck && pnpm build
git add packages/character-three
git commit -m "feat(character-three): one mixer per character, sanitised on attach"
```

---

## Task 6 : Les génomes du village

**Files :**
- Create: `apps/demo/src/simulation/villagerGenomes.ts`
- Create: `apps/demo/test/villager-genomes.test.ts`
- Modify: `apps/demo/package.json` (dépendances + script `test`)
- Create: `apps/demo/vitest.config.ts` (s'il n'existe pas)

**Interfaces :**
- Consumes : `createGenome(family, rng)`, `breed(family, mother, father, rng, sex)`, `HUMANOID`, `type Genome`, `type RngLike` de `@iwsdk/cardinal-character` ; `DEFAULT_VILLAGE.agents` (`ScenarioAgent[]` avec `id`, `gender`).
- Produces : `buildVillagerGenomes(agents): Record<string, Genome>`.

- [ ] **Step 1 : Ajouter les dépendances**

Dans `apps/demo/package.json`, ajouter aux `dependencies` :

```json
    "@iwsdk/cardinal-character": "workspace:*",
    "@iwsdk/cardinal-character-three": "workspace:*",
```

et aux `devDependencies` `"vitest": "^3.2.4"` si absent, puis ajouter à `"scripts"` : `"test": "vitest run"`.

Create `apps/demo/vitest.config.ts` s'il n'existe pas :

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, environment: 'node', include: ['test/**/*.test.ts'] },
});
```

Puis `pnpm install`.

- [ ] **Step 2 : Écrire les tests qui échouent**

Create `apps/demo/test/villager-genomes.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { HUMANOID, createGenome, type Genome, type RngLike } from '@iwsdk/cardinal-character';
import { DEFAULT_VILLAGE } from '@iwsdk/cardinal-simulation';
import { buildVillagerGenomes } from '../src/simulation/villagerGenomes';

const AGENTS = DEFAULT_VILLAGE.agents;

function distanceToMidparent(child: Genome, mother: Genome, father: Genome): number {
  const keys = Object.keys(HUMANOID.genes);
  let total = 0;
  for (const k of keys) {
    const mid = ((mother.genes[k] ?? 0.5) + (father.genes[k] ?? 0.5)) / 2;
    total += Math.abs((child.genes[k] ?? 0.5) - mid);
  }
  return total / keys.length;
}

describe('les génomes du village', () => {
  it('en produit un par agent', () => {
    const genomes = buildVillagerGenomes(AGENTS);
    expect(Object.keys(genomes).length).toBe(AGENTS.length);
    for (const agent of AGENTS) expect(genomes[agent.id]).toBeDefined();
  });

  it('est déterministe : deux appels donnent exactement les mêmes génomes', () => {
    expect(buildVillagerGenomes(AGENTS)).toEqual(buildVillagerGenomes(AGENTS));
  });

  it('donne des génomes DIFFÉRENTS à des agents différents', () => {
    // Un hachage constant, ou un générateur partagé mal semé, rendrait onze
    // fois le même villageois — et le test précédent passerait quand même.
    const g = buildVillagerGenomes(AGENTS);
    const signatures = new Set(AGENTS.map((a) => JSON.stringify(g[a.id]!.genes)));
    expect(signatures.size).toBe(AGENTS.length);
  });

  it('Lio et Aya ressemblent à leurs parents plus qu un inconnu', () => {
    const g = buildVillagerGenomes(AGENTS);
    const mira = g['mira']!;
    const haran = g['haran']!;

    // Cent inconnus, pour que la comparaison ne dépende pas d un tirage
    // chanceux.
    let seed = 12345;
    const rng: RngLike = { next: () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) };
    let strangerMean = 0;
    for (let i = 0; i < 100; i++) {
      strangerMean += distanceToMidparent(createGenome(HUMANOID, rng), mira, haran);
    }
    strangerMean /= 100;

    for (const childId of ['lio', 'aya']) {
      const d = distanceToMidparent(g[childId]!, mira, haran);
      expect(d, `${childId} doit ressembler à ses parents`).toBeLessThan(strangerMean);
    }
  });

  it('Lio et Aya ne sont pas le même enfant', () => {
    const g = buildVillagerGenomes(AGENTS);
    expect(g['lio']!.genes).not.toEqual(g['aya']!.genes);
  });

  it('tous les génomes appartiennent à la famille humanoïde', () => {
    const g = buildVillagerGenomes(AGENTS);
    for (const agent of AGENTS) expect(g[agent.id]!.family).toBe(HUMANOID.id);
  });
});
```

- [ ] **Step 3 : Lancer pour voir échouer**

```bash
pnpm --filter @iwsdk/plugin-phoenix-demo test
```

Attendu : ÉCHEC — `buildVillagerGenomes` n'existe pas.

- [ ] **Step 4 : Écrire le module**

Create `apps/demo/src/simulation/villagerGenomes.ts` :

```ts
/**
 * Les génomes des onze villageois, dérivés de leurs identifiants.
 *
 * Cinq avatars Ready Player Me pour onze habitants : ce qui les distingue est
 * la morphologie compilée, pas l'asset. C'est toute la démonstration.
 */
import {
  HUMANOID, breed, createGenome,
  type Genome, type RngLike,
} from '@iwsdk/cardinal-character';
import type { ScenarioAgent } from '@iwsdk/cardinal-simulation';

/** La famille de la tribu de l'Aube : deux parents, deux enfants engendrés. */
const MOTHER = 'mira';
const FATHER = 'haran';
const CHILDREN: Readonly<Record<string, 'f' | 'm'>> = { lio: 'm', aya: 'f' };

/** FNV-1a 32 bits. Stable, sans dépendance, suffisant pour semer. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Générateur congruentiel semé par l'identifiant de l'agent.
 *
 * Il ne PUISE JAMAIS dans `kernel.rng`. Prélever dans le flux du noyau
 * décalerait toutes ses valeurs suivantes et casserait les tests de
 * déterminisme de `cardinal-simulation` : la morphologie est une projection,
 * elle ne prend rien à la simulation.
 */
function rngFor(id: string): RngLike {
  let state = hash(id) || 1;
  return {
    next(): number {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    },
  };
}

export function buildVillagerGenomes(
  agents: readonly ScenarioAgent[],
): Record<string, Genome> {
  const genomes: Record<string, Genome> = {};

  // Les parents d'abord : les enfants en dépendent.
  for (const agent of agents) {
    if (CHILDREN[agent.id] !== undefined) continue;
    genomes[agent.id] = createGenome(HUMANOID, rngFor(agent.id));
  }

  const mother = genomes[MOTHER];
  const father = genomes[FATHER];
  for (const [childId, sex] of Object.entries(CHILDREN)) {
    if (mother === undefined || father === undefined) {
      // Le scénario a changé de casting : un enfant sans parents reçoit un
      // génome tiré, plutôt que de faire échouer le village entier.
      genomes[childId] = createGenome(HUMANOID, rngFor(childId));
      continue;
    }
    genomes[childId] = breed(HUMANOID, mother, father, rngFor(childId), sex);
  }

  return genomes;
}
```

- [ ] **Step 5 : Lancer, vérifier, commiter**

```bash
pnpm --filter @iwsdk/plugin-phoenix-demo test && pnpm typecheck
git add apps/demo package.json pnpm-lock.yaml
git commit -m "feat(demo): eleven village genomes, two of them bred"
```

---

## Task 7 : Le basculement `VillagerBody`

**Files :**
- Create: `apps/demo/src/simulation/VillagerBody.ts`
- Modify: `apps/demo/src/simulation/PrehistoricEnvironment3D.ts`
- Modify: `apps/demo/src/simulation/CardinalSimulationSystem.ts`
- Modify: `apps/demo/src/index.ts`
- Create: `apps/demo/test/villager-body.test.ts`

**Interfaces :**
- Consumes : `createAgentAvatar`, `applyAvatarPose` de `AgentAvatarFactory` ; `createCharacterFromAsset`, `loadCharacterClips`, `CharacterAnimationSystem`, `installCharacterThree` ; `buildVillagerGenomes` (tâche 6).
- Produces : `interface VillagerBody` (`node`, `setPose`, `dispose`) ; `class PuppetBody` ; `upgradeVillagers(options: UpgradeOptions): Promise<void>` ; `hashIndex(id, modulo): number` ; `makeRiggedBody(world, entity, clips): VillagerBody`. Il n'y a PAS de classe `RiggedBody` : le corps riggé est un objet rendu par `makeRiggedBody`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Create `apps/demo/test/villager-body.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest';
import { Group } from '@iwsdk/core';
import { PuppetBody, upgradeVillagers, type VillagerBody } from '../src/simulation/VillagerBody';

function puppetMap(ids: string[]): Map<string, VillagerBody> {
  return new Map(ids.map((id) => [id, new PuppetBody(new Group(), id)]));
}

describe('le basculement des villageois', () => {
  it('un échec de remplacement LAISSE la marionnette montée', async () => {
    const bodies = puppetMap(['mira', 'haran']);
    const before = bodies.get('mira')!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await upgradeVillagers({
      bodies,
      agents: [{ id: 'mira', gender: 'feminine' }, { id: 'haran', gender: 'masculine' }],
      // La fabrique échoue pour tout le monde : c'est le cas hors ligne.
      buildRig: async () => { throw new Error('Unknown renderable asset "avatar-mira"'); },
    });

    expect(bodies.get('mira')).toBe(before);
    expect(bodies.size).toBe(2);
    warn.mockRestore();
  });

  it('journalise UNE fois par villageois, avec son identifiant et la cause', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await upgradeVillagers({
      bodies: puppetMap(['mira']),
      agents: [{ id: 'mira', gender: 'feminine' }],
      buildRig: async () => { throw new Error('os manquants : spine, neck'); },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]!.join(' '));
    expect(message).toContain('mira');
    expect(message).toContain('os manquants');
    warn.mockRestore();
  });

  it('ne lève jamais, même si TOUT échoue', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      upgradeVillagers({
        bodies: puppetMap(['a', 'b', 'c']),
        agents: [{ id: 'a', gender: 'masculine' }, { id: 'b', gender: 'feminine' }, { id: 'c', gender: 'masculine' }],
        buildRig: async () => { throw new Error('boum'); },
      }),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('remplace ET libère la marionnette quand la fabrique réussit', async () => {
    const bodies = puppetMap(['mira']);
    const puppet = bodies.get('mira')!;
    const disposed = vi.spyOn(puppet, 'dispose');
    const rig: VillagerBody = { node: new Group(), setPose: () => {}, dispose: () => {} };

    await upgradeVillagers({
      bodies,
      agents: [{ id: 'mira', gender: 'feminine' }],
      buildRig: async () => rig,
    });

    expect(bodies.get('mira')).toBe(rig);
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('la marionnette applique encore sa pose procédurale', () => {
    const node = new Group();
    const body = new PuppetBody(node, 'mira');
    body.setPose('rest', 0);
    // `applyAvatarPose` écrase l échelle Y à 0,7 pour le repos.
    expect(node.scale.y).toBeCloseTo(0.7, 5);
  });
});
```

- [ ] **Step 2 : Lancer pour voir échouer**

```bash
pnpm --filter @iwsdk/plugin-phoenix-demo test villager-body
```

Attendu : ÉCHEC — le module n'existe pas.

- [ ] **Step 3 : Écrire le contrat et ses deux corps**

Create `apps/demo/src/simulation/VillagerBody.ts` :

```ts
/**
 * Le corps d'un villageois, quelle que soit sa nature.
 *
 * `CardinalSimulationSystem.projectScene` ne doit PAS apprendre à distinguer un
 * rig d'une marionnette : il appelle `setPose` et ne change plus jamais.
 */
import {
  CharacterAnimationSystem,
} from '@iwsdk/cardinal-character-three';
import type { AnimationClip, Entity, Group, Object3D, World } from '@iwsdk/core';
import type { AgentView } from '@iwsdk/cardinal-simulation';
import { applyAvatarPose } from './AgentAvatarFactory';

export interface VillagerBody {
  readonly node: Object3D;
  setPose(animation: AgentView['animation'], elapsedSeconds: number): void;
  dispose(): void;
}

/**
 * Les cylindres d'aujourd'hui, derrière le contrat.
 *
 * Ce n'est pas du code de transition jetable : c'est le repli permanent quand
 * un asset n'arrive pas, et c'est le SEUL usage réel de `PuppetApplicator`,
 * qui resterait sinon une implémentation d'interface que personne n'appelle.
 */
export class PuppetBody implements VillagerBody {
  // `Group` et non `Object3D` : `applyAvatarPose` en exige un, et typer le
  // champ ici évite un transtypage à chaque appel.
  constructor(readonly node: Group, readonly agentId: string) {}

  setPose(animation: AgentView['animation'], elapsedSeconds: number): void {
    applyAvatarPose(this.node, animation, elapsedSeconds);
  }

  dispose(): void {
    this.node.removeFromParent();
  }
}

/** Ce dont `upgradeVillagers` a besoin d'un agent, et rien de plus. */
export interface UpgradableAgent {
  id: string;
  gender: 'masculine' | 'feminine';
}

export interface UpgradeOptions {
  bodies: Map<string, VillagerBody>;
  agents: readonly UpgradableAgent[];
  /** Construit le corps riggé d'un agent, ou lève. Injecté pour les tests. */
  buildRig(agent: UpgradableAgent): Promise<VillagerBody>;
}

/**
 * Remplace les marionnettes par des rigs, un villageois à la fois.
 *
 * NE LÈVE JAMAIS. Un échec journalise une fois, nomme l'agent et la cause, et
 * laisse la marionnette : hors ligne, ou avec un rig incompatible, le village
 * reste complet et jouable. C'est le comportement nominal, pas une panne.
 */
export async function upgradeVillagers(options: UpgradeOptions): Promise<void> {
  for (const agent of options.agents) {
    const puppet = options.bodies.get(agent.id);
    if (puppet === undefined) continue;
    try {
      const rig = await options.buildRig(agent);
      options.bodies.set(agent.id, rig);
      puppet.dispose();
    } catch (error) {
      console.warn(
        `[cardinal-demo] villageois "${agent.id}" : rig indisponible, ` +
          `la marionnette reste — ${(error as Error).message}`,
      );
    }
  }
}
```

- [ ] **Step 4 : Faire porter des `VillagerBody` à la scène**

Modify `apps/demo/src/simulation/PrehistoricEnvironment3D.ts` :

1. Importer `PuppetBody` et le type : `import { PuppetBody, type VillagerBody } from './VillagerBody';`
2. Ligne 46, remplacer `agentAvatars: Map<string, Group>;` par `agentAvatars: Map<string, VillagerBody>;`
3. Ligne 65, remplacer `const agentAvatars = new Map<string, Group>();` par `const agentAvatars = new Map<string, VillagerBody>();`
4. Dans la boucle des agents (~ligne 222), remplacer `agentAvatars.set(agent.id, avatar);` par `agentAvatars.set(agent.id, new PuppetBody(avatar, agent.id));`

- [ ] **Step 5 : Faire appeler `setPose` à la projection**

Modify `apps/demo/src/simulation/CardinalSimulationSystem.ts`, dans `projectScene` (~ligne 222) :

```ts
      const body = sceneData.agentAvatars.get(view.id);
      if (body === undefined) continue;
      body.node.position.set(view.x, view.y, view.z);
      body.node.rotation.y = view.heading;
      body.setPose(view.animation, this.elapsed);
```

- [ ] **Step 6 : Brancher le tout dans la démo**

Modify `apps/demo/src/index.ts`. Ajouter les imports, puis, **après** la création de la scène (ligne ~67) :

```ts
    // Le paquet des personnages n'était branché nulle part : l'étape 2 avait
    // livré des composants et des systèmes que l'application n'importait pas.
    installCharacterThree(world);

    // Le village est monté en marionnettes et JOUABLE dès cette frame. Les
    // rigs le remplacent ensuite, un par un, si le réseau les apporte.
    const genomes = buildVillagerGenomes(VILLAGE_LAYOUT.agents);
    const AVATARS = ['avatar-mira', 'avatar-sylvia', 'avatar-eldrin', 'avatar-garrick', 'avatar-haran'];
    void loadCharacterClips({
      idle: 'clip-idle-masculine',
      walk: 'clip-walk-masculine',
    })
      .then((masculineClips) =>
        loadCharacterClips({ idle: 'clip-idle-feminine', walk: 'clip-walk-feminine' }).then(
          (feminineClips) =>
            upgradeVillagers({
              bodies: sceneData.agentAvatars,
              agents: VILLAGE_LAYOUT.agents,
              buildRig: async (agent) => {
                // Cinq assets pour onze villageois : le hachage de
                // l'identifiant en choisit un, de façon stable.
                const assetId = AVATARS[hashIndex(agent.id, AVATARS.length)]!;
                const { entity } = await createCharacterFromAsset(world, {
                  assetId,
                  familyId: 'humanoid',
                  genome: genomes[agent.id]!,
                  age: 30,
                });
                return makeRiggedBody(
                  world, entity,
                  agent.gender === 'feminine' ? feminineClips : masculineClips,
                );
              },
            }),
        ),
      )
      .catch((error: unknown) => {
        console.warn('[cardinal-demo] clips indisponibles, village en marionnettes :', error);
      });
```

`hashIndex` et `makeRiggedBody` vont dans `VillagerBody.ts` :

```ts
/** Choisit un asset de façon stable pour un identifiant donné. */
export function hashIndex(id: string, modulo: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % modulo;
}

/**
 * Enveloppe une entité de personnage compilée dans le contrat de corps.
 *
 * `rootMotion: 'flatten'` parce que la simulation possède déjà la position du
 * villageois : mesuré, `M_Walk_001` l'emmènerait 3,21 m devant lui-même à
 * chaque boucle.
 */
export function makeRiggedBody(
  world: World,
  entity: Entity,
  clips: Record<string, AnimationClip>,
): VillagerBody {
  const system = world.getSystem(CharacterAnimationSystem);
  if (system === null || system === undefined) {
    throw new Error('makeRiggedBody: CharacterAnimationSystem non enregistré');
  }
  // Les noms de nœuds d'un rig RPM suivent la convention Mixamo ; seule la
  // hanche porte un rôle qui nous intéresse pour l'assainissement.
  system.attach(entity, clips, (name) => (name === 'Hips' ? 'root' : null), {
    rootMotion: 'flatten',
  });
  const node = entity.object3D!;
  return {
    node,
    setPose: (animation) => system.setVerb(entity, animation),
    dispose: () => entity.dispose(),
  };
}
```

- [ ] **Step 7 : Lancer, vérifier, commiter**

```bash
pnpm --filter @iwsdk/plugin-phoenix-demo test && pnpm typecheck && pnpm build
git add apps/demo
git commit -m "feat(demo): swap puppets for real rigs, and never leave the village empty"
```

---

## Task 8 : La preuve à l'écran, et les corrections de spec

**Files :**
- Modify: `docs/superpowers/specs/2026-08-17-personnages-proceduraux-design.md` (ligne 435)
- Modify: `docs/superpowers/specs/2026-08-17-personnages-etape2-pont-three-design.md` (§13)
- Modify: `packages/character-three/README.md`

**Interfaces :**
- Consumes : la réponse de la tâche 1, tout ce que les tâches 2 à 7 ont livré.
- Produces : une capture d'écran, ou une réserve déclarée.

- [ ] **Step 1 : Lancer la suite complète**

```bash
pnpm clips && pnpm -r test && pnpm typecheck && pnpm build
```

Attendu : tout vert, et **aucun test sauté** (les clips sont là). Si des tests se sautent, `pnpm clips` a échoué : le dire.

- [ ] **Step 2 : Lancer la démo et regarder**

```bash
cd apps/demo && npx iwsdk dev up
```

Puis, une fois `browserCommandReady: true` :

```bash
npx iwsdk browser screenshot --output-file /tmp/village.png
npx iwsdk browser get-console-logs --count 200
```

**Utiliser `browser screenshot`, jamais `scene screenshot`** : le rendu de l'éditeur n'exécute pas les systèmes applicatifs et ne pourrait rien prouver sur le basculement.

- [ ] **Step 3 : Décider ce qui est prouvé**

Chercher dans la console les avertissements `[cardinal-demo] villageois "..."`. Ils disent exactement ce qui s'est passé :

- **Aucun avertissement** — les rigs sont montés. La capture prouve le chemin complet. Le dire.
- **Onze avertissements** — le réseau n'a pas apporté les avatars. La capture prouve **le repli**, pas le rig. Le dire exactement comme ça, sans l'arrondir.
- **Quelques-uns** — dire lesquels et pourquoi.

Joindre la capture au rapport dans les trois cas.

- [ ] **Step 4 : Corriger la ligne 435 de la spec mère**

Remplacer le texte du risque n°1 par :

```markdown
1. **Les clips écrasent-ils la morphologie ?** — **RÉPONDU (étape 3, §2.1).**
   Mesuré sur `readyplayerme/animation-library` : les clips de locomotion et
   d'inactivité ne portent qu'une piste de translation, sur les hanches. Les
   clips de danse en portent dix-sept — mais seize sont CONSTANTES à 10⁻⁶ m
   près et ne réencodent que les décalages d'os du rig source.
   `classifyTranslationTrack` juge sur l'amplitude et non sur la présence : il
   les retire sans conflit. La conception ne change pas.
```

- [ ] **Step 5 : Compléter le §13 de la spec de l'étape 2**

Ajouter sous la ligne « Le remplacement d'`AgentAvatarFactory` … : étape 3 » :

```markdown
- Le **root motion** n'était pas prévu ici et ne l'était nulle part : mesuré à
  3,21 m par boucle sur `M_Walk_001`, il est traité par l'étape 3 (§4), par une
  politique portée par l'appelant et non par la famille.
```

- [ ] **Step 6 : Mettre le README à jour**

Documenter dans `packages/character-three/README.md` : `createCharacterFromAsset`, `loadCharacterClips`, `CharacterAnimationSystem` (priorité 80), et l'option `rootMotion` de `sanitizeClip` avec la raison de son défaut `'keep'`.

- [ ] **Step 7 : Commiter**

```bash
git add docs packages/character-three/README.md
git commit -m "docs: close the mother spec's open clip question, and record what was seen"
```

---

---

## Task 9 : Les avatars T-pose, et la preuve du chemin riggé

**Pourquoi cette tâche existe.** Les cinq avatars du manifeste sont des URLs
`models.readyplayer.me`, et ce domaine **ne résout pas** dans cet environnement —
mesuré depuis le shell et depuis le navigateur managé. Le chemin riggé n'a donc
jamais pu être exercé : la tâche 8 n'a prouvé que le repli.

**Ce qui change.** La bibliothèque `readyplayerme/animation-library`, atteignable
par l'API GitHub, contient deux avatars complets. Sondés avant l'écriture de
cette tâche :

| | `Masculine_TPose.glb` | `Feminine_TPose.glb` |
| :--- | :--- | :--- |
| poids | 2,51 Mo | 2,59 Mo |
| maillage skinné | `Wolf3D_Avatar` | `Wolf3D_Avatar` |
| joints | 58 | 60 |
| **rôles d'os satisfaits** | **19/19** | **19/19** |
| morph targets | **0** | **0** |
| maillages de surface | `Wolf3D_Avatar` seul | `Wolf3D_Avatar` seul |

Aucun os manquant : `createCharacter` les accepte. En revanche **aucun morph
target** — les gènes de visage seront inertes — et **aucune cible de teinte**,
puisque l'unique maillage ne s'appelle ni `Wolf3D_Body` ni `Wolf3D_Hair`. Le
rapport d'import doit le dire, et cette tâche doit le vérifier.

**Files :**
- Modify: `scripts/fetch-character-clips.mjs`
- Modify: `apps/demo/src/assets.ts`
- Modify: `apps/demo/src/index.ts`
- Modify: `apps/demo/src/simulation/VillagerBody.ts`
- Modify: `apps/demo/test/villager-body.test.ts`
- Test: `packages/character-three/test/tpose-rig.test.ts` (créé)

**Interfaces :**
- Consumes : `createCharacterFromAsset`, `loadCharacterClips`, `makeRiggedBody`,
  `upgradeVillagers` — inchangés.
- Produces : deux identifiants de manifeste, `avatar-tpose-masculine` et
  `avatar-tpose-feminine`.

- [ ] **Step 1 : Étendre le script de récupération**

Dans `scripts/fetch-character-clips.mjs`, ajouter à côté de `CLIPS` :

```js
/** Avatars T-pose : rigs complets, skinnés, 19/19 rôles d'os satisfaits. */
export const AVATARS = {
  'masculine/glb/Masculine_TPose.glb': 'avatar-tpose-masculine.glb',
  'feminine/glb/Feminine_TPose.glb': 'avatar-tpose-feminine.glb',
};
```

et faire porter la boucle de téléchargement sur `{ ...CLIPS, ...AVATARS }`.
Même dossier `apps/demo/public/characters/`, donc **même règle `.gitignore`** :
ces fichiers ne sont pas plus redistribuables que les clips.

- [ ] **Step 2 : Lancer et vérifier**

```bash
node scripts/fetch-character-clips.mjs && ls -la apps/demo/public/characters/
git status --porcelain apps/demo/public/characters/
```

Attendu : sept fichiers, les deux avatars à ~2,5 Mo chacun, et un `git status`
**vide**. Un avatar sous 100 Ko serait une page d'erreur : le garde de signature
`glTF` du script doit avoir levé.

- [ ] **Step 3 : Un test qui vérifie le contrat du rig**

Create `packages/character-three/test/tpose-rig.test.ts`. Il charge le GLB
masculin, résout la liaison contre `HUMANOID`, et vérifie **trois** choses :

1. `report.missingBones` est vide — le rig satisfait le contrat ;
2. `report.missingMorphs` **n'est pas** vide — le rapport dit la vérité sur les
   morphs absents plutôt que de les taire ;
3. `report.missingSurfaces` **n'est pas** vide — idem pour les teintes.

Les points 2 et 3 sont l'essentiel : un rapport d'import qui prétendrait que
tout va bien serait pire qu'un rig incomplet. Sauter bruyamment si le fichier
est absent, comme `root-motion.test.ts` le fait déjà.

- [ ] **Step 4 : Déclarer les deux avatars au manifeste**

Dans `apps/demo/src/assets.ts`, à l'intérieur de `defineAssets({ ... })` :

```ts
  // Avatars T-pose Ready Player Me, récupérés par `pnpm clips` et absents du
  // dépôt (licence : usage autorisé, redistribution interdite). Ce sont les
  // seuls rigs joignables : `models.readyplayer.me` ne résout pas ici.
  'avatar-tpose-masculine': {
    url: publicAssetUrl('characters/avatar-tpose-masculine.glb'),
    type: AssetType.GLTF,
    name: 'RPM T-Pose (masculine)',
    priority: 'lazy',
  },
  'avatar-tpose-feminine': {
    url: publicAssetUrl('characters/avatar-tpose-feminine.glb'),
    type: AssetType.GLTF,
    name: 'RPM T-Pose (feminine)',
    priority: 'lazy',
  },
```

Laisser les cinq entrées `avatar-*` distantes en place : elles préexistent et ne
relèvent pas de cette tâche.

- [ ] **Step 5 : Faire pointer le basculement sur les rigs locaux**

Dans `apps/demo/src/index.ts`, remplacer le choix d'asset par le genre :

```ts
const assetId = agent.gender === 'feminine'
  ? 'avatar-tpose-feminine'
  : 'avatar-tpose-masculine';
```

**Sept villageois masculins partagent donc un seul asset de base, et quatre
féminines un autre — et c'est exactement la démonstration :** ce qui les
distingue à l'écran est la morphologie compilée, pas le fichier.

`hashIndex` n'a plus d'appelant. **Le supprimer** de `VillagerBody.ts`, ainsi que
l'export de `hash` dans `villagerGenomes.ts` s'il devient inutilisé — une revue
l'avait déjà signalé comme câblé sans test. Retirer aussi le test qui le couvre,
s'il en existe un.

- [ ] **Step 6 : Vérifier**

```bash
pnpm --filter @iwsdk/cardinal-character-three test
pnpm --filter @iwsdk/plugin-phoenix-demo test
pnpm typecheck && pnpm build
```

- [ ] **Step 7 : Regarder l'écran**

```bash
npx iwsdk dev up
npx iwsdk browser logs --count 200
```

Lire les avertissements `[cardinal-demo] villageois "…"`. **Zéro avertissement**
signifie que les onze rigs sont montés. Confirmer par le graphe :

```bash
npx iwsdk ecs find --withComponents CharacterIdentity
npx iwsdk scene runtime-hierarchy
```

Puis obtenir une capture montrant un villageois. La tâche 8 a établi la séquence
qui fonctionne : `xr enter`, puis `xr look-at` pour recentrer, puis `xr exit`,
puis `browser screenshot` — une session `immersive-vr` active coupe le miroir 2D
et rend un écran noir.

**Rapporter ce qui est vu, pas ce qui est espéré.** Si les rigs ne montent pas,
citer la cause exacte et le dire.

- [ ] **Step 8 : Commiter**

```bash
git add scripts apps/demo/src apps/demo/test packages/character-three/test
git commit -m "feat(demo): real RPM rigs from the animation library, and the screen to prove it"
```


## Auto-revue

**Couverture de la spec.** §2 → tâches 3 et 8 (les mesures deviennent des tests, puis corrigent les specs). §4 root motion → tâche 3. §5 fabrique → tâche 4. §6.1 chargement → tâche 4 ; §6.2 licence et script → tâche 2 ; §6.2.1 saut bruyant → tâche 3 step 1 ; §6.3 table des verbes → tâche 5 (`setVerb` retombe sur `idle`) et tâche 7 ; §6.4 système → tâche 5. §7 basculement → tâche 7. §8 génomes et `breed` → tâche 6. §10.1 tests 1–8 → répartis (1–4 tâche 3, 5–6 tâche 4, 7 tâche 6, 8 tâche 7). §10.2 écran → tâches 1 et 8. §11 corrections → tâche 8. §13 ordre → respecté.

**Un manque trouvé et comblé :** la spec ne disait pas *quel* avatar reçoit *quel* villageois. Cinq assets, onze habitants : `hashIndex` tranche, de façon stable, dans la tâche 7.

**Cohérence des types.** `VillagerBody` porte `node`, `setPose`, `dispose` — identiques en tâche 7 steps 3, 4, 5 et 6. `sanitizeClip` reçoit `options?: { rootMotion?: RootMotionPolicy }` en tâches 3 et 5. `buildVillagerGenomes(agents)` rend `Record<string, Genome>`, consommé tel quel en tâche 7. `createCharacterFromAsset` rend `{ entity, report }` en tâches 4 et 7.

**Un risque d'exécution, signalé aux implémenteurs :** la tâche 7 modifie `PrehistoricEnvironment3D.ts`, fichier que l'auteur du dépôt éditait en parallèle lors de l'étape 2. Vérifier `git status` avant de commencer.
