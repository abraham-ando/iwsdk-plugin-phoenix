# Étape 3 — Le chemin glTF : un vrai rig dans le village

**Date :** 2026-08-17
**Spec mère :** `2026-08-17-personnages-proceduraux-design.md`
**Étape précédente :** `2026-08-17-personnages-etape2-pont-three-design.md`

---

## 1. Objet

Les étapes 1 et 2 ont livré deux paquets, 156 tests, et **zéro pixel**. Les
villageois de la démo sont toujours des cylindres surmontés d'une sphère.
L'étape 3 fait entrer un rig Ready Player Me réel dans le pont déjà construit,
le fait bouger sur des clips réels, et remplace `AgentAvatarFactory`.

Elle se termine par un villageois visible, pas par une suite verte.

---

## 2. Ce que la mesure a établi

Trois clips de `readyplayerme/animation-library` ont été téléchargés et parsés
en Node avant l'écriture de cette spec. Les chiffres ci-dessous ne sont pas des
hypothèses.

| clip | pistes | pistes de position | amplitude |
| :--- | ---: | :--- | ---: |
| `M_Walk_001` | 53 | `Hips` seul | **3,20979 m** |
| `M_Standing_Idle_001` | 53 | `Hips` seul | 0,00344 m |
| `F_Dances_001` | 77 | `Hips` **+ 16 os** | Hips 0,21072 m — les 16 autres **0,00000 m** |

### 2.1 Le risque n°1 de la spec mère est clos

La ligne 435 de la spec mère demandait : *« Les clips écrasent-ils la
morphologie ? … la convention Mixamo/RPM ne met des pistes de position que sur
les hanches, auquel cas tout va bien — mais cela n'a pas été vérifié sur un rig
réel. »*

Vérifié. La convention tient pour la locomotion et l'inactivité. Elle **ne tient
pas** pour la danse — dix-sept pistes de translation, dont seize sur `Neck`,
`LeftForeArm`, `LeftUpLeg`, `RightFoot`, `RightToeBase`… — mais ces seize-là
sont **constantes** : elles réencodent les décalages d'os du rig source. Elles
écraseraient les longueurs compilées sans porter le moindre mouvement.

L'assainisseur de l'étape 2 les traite déjà correctement, parce que
`classifyTranslationTrack` juge sur l'amplitude et non sur la seule présence :
racine → `keep` ; sinon amplitude ≤ `CONSTANT_TRACK_EPSILON` (10⁻⁶ m) → `strip` ;
sinon → `conflict`. La mesure de l'étape 3 reproduit exactement le nombre inscrit
dans le commentaire de `sanitize.ts` — seize. **La ligne 435 de la spec mère est
périmée et doit être corrigée**, pas la conception.

### 2.2 Le compilateur ne se fait pas écraser par la piste racine

Le compilateur écrit une position pour **chaque** os, racine comprise. Celle de
la racine n'appartient à aucune chaîne, donc son facteur vaut 1 : c'est la
position de repos inchangée. La racine reçoit en revanche `scale: bodyScale`,
la stature globale du corps.

Un `AnimationMixer` n'écrit que les propriétés que ses pistes nomment. Une piste
`Hips.position` écrase donc une position déjà neutre et **ne touche pas** l'échelle.
Le verdict `keep` sur la racine est morphologiquement sain. Ce point a été
vérifié, pas supposé.

**Conséquence de second ordre, non traitée par cette étape :** la translation de
3,21 m n'est pas multipliée par `bodyScale` — l'échelle d'un nœud s'applique à
ses enfants, jamais à sa propre translation. Un villageois d'1,90 m et un
d'1,50 m font donc la même foulée. Sans effet ici, puisque le root motion
horizontal est neutralisé (§4) ; à rouvrir le jour où un personnage se déplace
par son clip.

### 2.3 Le gestionnaire d'assets clone de façon sûre pour le skinning

`world.assets.instantiate(id)` appelle `AssetManager.getGLTF(id)` **sans
options**, et `GetGLTFOptions.shared` vaut `false` par défaut : chaque appel rend
un arbre `Object3D` neuf. Le chargeur importe `clone` depuis
`three/examples/jsm/utils/SkeletonUtils.js` — le clone sûr pour le skinning.

Chaque instanciation reçoit donc **son propre `Skeleton` et ses propres os** :
onze villageois peuvent porter onze morphologies distinctes sur cinq assets de
base. Géométries, matériaux et clips restent partagés par référence — ce qui
valide après coup deux décisions de l'étape 2 : le clone de matériau par
individu, et l'assainisseur qui rend un **nouveau** clip au lieu d'amputer
l'original partagé.

### 2.4 Le réseau, depuis cet environnement

`models.readyplayer.me` **ne résout pas** depuis le shell de l'agent. Les cinq
avatars déclarés au manifeste de la démo y sont donc injoignables. Le navigateur
managé d'IWSDK tourne sur l'hôte et aura peut-être un accès différent : ce n'est
pas établi. Voir §10.2 et §12.

---

## 3. Périmètre

**Dans :** neutralisation du root motion ; fabrique de personnage depuis le
manifeste ; chargement des clips ; système d'animation ; basculement de la démo
avec repli ; génomes du village, dont deux engendrés par `breed`.

**Dehors :** les panneaux spatiaux (étape 4) ; la persistance du génome dans le
snapshot déterministe (étape 5) ; le lipsync ; la famille `canid` ; l'authorage
de clips.

---

## 4. La neutralisation du root motion

### 4.1 Où vit la décision

**Pas** dans `classifyTranslationTrack`. Cette fonction répond à *« cette piste
combat-elle la morphologie ? »* — une question d'espèce, qui appartient au
descripteur de famille. Le root motion répond à *« qui possède la position du
personnage dans le monde ? »* — une question d'application. Même famille,
réponses opposées : un villageois piloté par `AgentView.x/z` et un personnage
joueur en locomotion libre.

C'est donc une **option de l'appelant** sur `sanitizeClip`, et non un champ de
`FamilyDescriptor`.

### 4.2 Le contrat

```ts
export type RootMotionPolicy = 'keep' | 'strip' | 'flatten';

export function sanitizeClip(
  clip: AnimationClip,
  family: FamilyDescriptor,
  roleOfNode: (nodeName: string) => string | null,
  options?: { rootMotion?: RootMotionPolicy },
): { clip: AnimationClip; stripped: string[] };
```

Le défaut est `'keep'` — le comportement d'aujourd'hui. Les 64 tests de l'étape 2
restent verts sans être touchés, et aucun appelant existant ne change.

- **`keep`** — la piste racine est laissée intacte. Locomotion libre.
- **`strip`** — la piste racine est retirée. Le personnage s'anime strictement
  sur place ; l'application possède les trois axes.
- **`flatten`** — X et Z **rebasés sur la première clé**, Y intact.

### 4.3 Pourquoi `flatten` rebase au lieu d'annuler

Mettre X et Z à zéro téléporterait le bassin à l'origine de l'armature, qui
n'est pas là où les hanches se trouvent. On soustrait la valeur de la clé 0 de
chaque clé : l'offset de repos est préservé, le voyage disparaît. Y reste intact,
ce qui conserve le balancement vertical de la marche.

`M_Walk_001` passe ainsi de 3,20979 m de voyage horizontal à 0, son amplitude
verticale inchangée.

### 4.4 La clé de mémoïsation inclut la politique

`sanitizeClip` mémoïse sur `(clip, famille + signature des rôles)`. La politique
**doit** entrer dans cette clé, sinon le cache rend un clip aplati à un appelant
qui demandait `keep`. C'est le même défaut que la revue de l'étape 2 a trouvé
sur la clé par famille seule ; il ne doit pas revenir par une autre porte.

---

## 5. La fabrique

```ts
export async function createCharacterFromAsset(
  world: World,
  options: {
    assetId: string;
    familyId: string;
    genome: Genome;
    age: number;
  },
): Promise<{ entity: Entity; report: ImportReport }>;
```

Elle fait deux choses : `await world.assets.instantiate(assetId)`, puis
`createCharacter(world, { ...options, rigRoot })`.

Le nœud rendu est `gltf.scene`, c'est-à-dire **l'ancêtre commun** de l'armature
et du `SkinnedMesh` — précisément ce que `createCharacter` exige. Passer le
maillage seul le fait lever, et c'est le piège glTF classique que son message
d'erreur décrit déjà.

**Deux échecs, qui doivent rester distinguables :**

| cause | qui lève | ce que l'appelant lit |
| :--- | :--- | :--- |
| asset absent du manifeste, ou chargement échoué | `AssetManager` | `Unknown renderable asset` / `failed to load` |
| asset chargé, rig incompatible avec la famille | `createCharacter` | la liste des os manquants |

La démo se replie dans les deux cas (§7), mais un développeur doit pouvoir lire
lequel s'est produit sans instrumenter le code.

---

## 6. Les clips

### 6.1 Chargement

Les clips sont partagés par tout le village : ils n'appartiennent pas à une
fabrique par personnage.

```ts
export async function loadCharacterClips(
  ids: Readonly<Record<string, string>>,   // 'walk' → 'clip-walk-masculine'
): Promise<Record<string, AnimationClip>>;
```

Implémentée sur `AssetManager.loadGLTFById(id)` puis `.animations[0]`.
L'assainissement, lui, reste **par personnage** — il dépend du `roleOfNode` de
ce rig-là — et le mémo le rend gratuit à partir du deuxième villageois.

### 6.2 Les clips sont récupérés, jamais commités

**La licence l'interdit.** `readyplayerme/animation-library` est publiée sous une
licence propriétaire (`LICENSE.md`, clause 3) :

> *You may not redistribute, sell, or otherwise transfer the Animations, in whole
> or in part, to any third party, whether for commercial or non-commercial
> purposes, without the prior written consent of the owner.*

Commiter ces GLB dans un dépôt GitHub public **est** une redistribution. La
clause 1 autorise l'usage personnel et commercial gratuit, et la clause 2 le
restreint aux avatars Ready Player Me — ce qui est exactement notre cas. C'est
la **redistribution** qui est fermée, pas l'usage.

**Le remède :** `scripts/fetch-character-clips.mjs` télécharge les cinq GLB dans
`apps/demo/public/characters/`, dossier ajouté au `.gitignore`. Chaque
développeur et la CI les récupèrent sous leur propre acceptation de la licence.
Le script imprime la licence et son URL avant de télécharger.

| fichier source | rôle | taille |
| :--- | :--- | ---: |
| `masculine/glb/idle/M_Standing_Idle_001.glb` | `idle`, rig masculin | 163 Ko |
| `feminine/glb/idle/F_Standing_Idle_001.glb` | `idle`, rig féminin | 392 Ko |
| `masculine/glb/locomotion/M_Walk_001.glb` | `walk`, rig masculin | 70 Ko |
| `feminine/glb/locomotion/F_Walk_002.glb` | `walk`, rig féminin | 108 Ko |
| `feminine/glb/dance/F_Dances_001.glb` | **fixture de test** | 156 Ko |

889 Ko au total, dans un dossier ignoré.

**`F_Walk_001.glb` n'existe pas.** Les marches féminines de la bibliothèque
commencent à `F_Walk_002`. Le fait a été vérifié sur l'arborescence complète des
240 GLB, après qu'une première rédaction de cette spec eut cité un fichier
inventé.

`F_Dances_001` n'est pas un asset de la démo : c'est le clip aux dix-sept pistes
de translation dont seize constantes. L'assainisseur se teste aujourd'hui contre
un rig synthétique ; il se testera contre celui-là.

Les dossiers `feminine/` et `masculine/` de la bibliothèque RPM désignent le
**rig cible**, pas le genre du clip : chacun contient les versions M et F,
recuites sur des proportions différentes. On prend celle qui correspond au
genre de l'agent.

### 6.2.1 Les tests, quand les clips sont absents

Un test qui se saute en silence est un test qui ne prouve rien — ce projet en a
déjà retiré une douzaine. Règle :

- La suite lance le script de récupération avant de tourner. En marche normale,
  les clips sont là et **aucun** test ne se saute.
- Hors ligne, les tests 1 à 4 (§10.1) se sautent avec un message qui nomme le
  script à lancer. Le saut est **bruyant** et compté dans le rapport.
- Les tests 5 à 8 ne dépendent d'aucun clip réel et tournent toujours.

### 6.3 La table des verbes, et son trou

`AgentView.animation` vaut `'idle' | 'walk' | 'gather' | 'craft' | 'rest' | 'sleep'`.

| verbe | rig masculin | rig féminin |
| :--- | :--- | :--- |
| `idle` | `M_Standing_Idle_001` | `F_Standing_Idle_001` |
| `walk` | `M_Walk_001` | `F_Walk_002` |
| `gather`, `craft`, `rest`, `sleep` | **retombent sur `idle`** | **retombent sur `idle`** |

La bibliothèque RPM ne contient **aucun** clip de repos ou de sommeil — la
recherche `Sit|Sleep|Lay|Rest|Tired` sur ses 240 GLB ne rend rien.

C'est une **régression d'expressivité visible** par rapport aux cylindres
actuels, qui se plient pour `gather` et s'écrasent pour `rest`. Elle est
assumée et écrite ici : authorer des clips n'est pas le travail de l'étape 3,
taire le trou en serait un.

### 6.4 Le système d'animation

Un `CharacterAnimationSystem` dans `character-three` : un `AnimationMixer` par
entité de personnage, une table de clips assainis, un fondu enchaîné au
changement de verbe, et `mixer.update(delta)` dans `update()`.

**Pourquoi pas `AvatarAnimationController` de `packages/ai`.** Il existe, il
fait des fondus, il porte quatorze tests — et il ne convient pas. Il vit du
mauvais côté : faire dépendre les personnages du paquet IA inverse la
dépendance. Et il duck-type `globalThis.THREE`, ce qui le laisse **silencieusement
sans mixer** quand cet objet n'est pas là. Une soixantaine de lignes propres
valent mieux. Il n'est pas supprimé par cette étape, mais il en devient candidat.

**Priorité du système :** dans la bande des personnages, après
`CharacterCompileSystem` (60) et `CharacterExpressionSystem` (70) — donc **80**.
Le mixer doit tourner après que la morphologie de la frame est posée.

---

## 7. Le basculement de la démo

### 7.1 Le contrat de corps

`projectScene` ne doit pas apprendre à distinguer un rig d'une marionnette. La
valeur de `agentAvatars` cesse d'être un `Group` nu :

```ts
export interface VillagerBody {
  readonly node: Object3D;
  setPose(animation: AgentView['animation'], elapsedSeconds: number): void;
  dispose(): void;
}
```

Deux implémentations : `PuppetBody` enveloppe `applyAvatarPose` et les cylindres
d'aujourd'hui ; `RiggedBody` pilote le mixer. La boucle de projection devient
`body.setPose(view.animation, this.elapsed)` et ne change plus jamais.

### 7.2 L'ordre du montage

1. La scène se monte **immédiatement** en marionnettes, hors ligne compris. Le
   village est complet et correct dès la première frame.
2. Une routine asynchrone remplace chaque corps à mesure que son asset arrive :
   `createCharacterFromAsset`, puis échange de l'entrée dans la carte, `dispose()`
   de la marionnette, retrait de son nœud de la scène.
3. Un échec **journalise une fois**, avec l'identifiant de l'agent et la cause,
   et laisse la marionnette en place. Jamais de levée.

Ce repli n'est pas du code jetable : c'est le **seul usage réel** de
`PuppetApplicator`, qui reste sinon une implémentation d'interface que personne
n'appelle.

### 7.3 Ce qui disparaît

`createAgentAvatar` et `applyAvatarPose` ne disparaissent pas — ils passent
derrière `PuppetBody`. C'est `AgentAvatarFactory` en tant que **chemin
principal** qui disparaît, conformément au §10 de la spec mère.

---

## 8. Les génomes du village

Onze agents nommés, sur cinq assets RPM de base. C'est la démonstration : ce qui
les distingue est la morphologie compilée, pas l'asset.

| tribu | agents |
| :--- | :--- |
| Aube (famille) | `haran` (m), `mira` (f), `lio` (m), `aya` (f) |
| Rive | `dagan` (m), `sira` (f), `nia` (f), `kan` (m) |
| Pic | `narek` (m), `ivan` (m), `tao` (m) |

### 8.1 Dérivation

Neuf villageois tirent leur génome de `createGenome(HUMANOID, rng)`, où `rng`
est semé par le hachage de l'identifiant de l'agent. Le village est donc
identique à chaque chargement.

### 8.2 Hérédité

`lio` et `aya` sont **engendrés** :

```ts
breed(HUMANOID, genomes.mira, genomes.haran, rng, 'm')  // lio
breed(HUMANOID, genomes.mira, genomes.haran, rng, 'f')  // aya
```

`breed` n'a aucun consommateur depuis l'étape 1. Il en a un ici, et il est
visible : la famille de l'Aube doit se ressembler.

### 8.3 Le générateur ne touche jamais celui du noyau

Chaque génome est tiré d'un générateur **propre à l'agent**, semé par le hachage
de son identifiant — jamais `kernel.rng`. Puiser dans le flux du noyau
décalerait toutes ses valeurs suivantes et casserait les 315 tests de
déterminisme de `cardinal-simulation`. La morphologie est une projection : elle
ne prélève rien à la simulation.

---

## 9. Contraintes globales

- **Three s'importe depuis `@iwsdk/core`**, jamais depuis `three`. Exception
  admise : `import type { GLTF } from 'three/addons/...'`.
- **`skeleton.calculateInverses()` ne doit apparaître nulle part.** Déplacer un
  os *est* la déformation ; recalculer les inverses l'annule.
- **Les assets se chargent par `AssetManager` / le manifeste**, jamais par un
  `GLTFLoader` brut.
- **Aucune allocation dans `update()`.** Budget VR : 11–14 ms par frame.
- **`setValue` lève sur `Types.Color`, `Vec2/3/4`** en elics 3.4.x : passer par
  `entity.getVectorView(...)`.
- **`entity.dispose()`, jamais `entity.destroy()`** — le second fuit la mémoire GPU.
- **`noUncheckedIndexedAccess` est actif** : tout accès indexé est gardé ou
  suffixé de `!`.
- **Commentaires en français**, descriptions de tests comprises.

---

## 10. La preuve

### 10.1 Headless

| # | ce qui est prouvé | comment il tombe s'il est faux |
| :--- | :--- | :--- |
| 1 | `flatten` sur `M_Walk_001` : amplitude horizontale 0, verticale inchangée et **non nulle** | un rebasage vers zéro, ou sur le mauvais axe, le fait tomber |
| 2 | `strip` retire la piste racine ; `keep` conserve les 3,20979 m | une politique ignorée le fait tomber |
| 3 | La clé de mémo inclut la politique : même clip, deux politiques → deux résultats | une clé incomplète rend le premier verdict au second appelant |
| 4 | `F_Dances_001` réel : seize pistes retirées, zéro conflit | un assainisseur qui jugerait sur la présence et non l'amplitude lèverait |
| 5 | La fabrique passe la **racine de scène**, pas le maillage | passer le maillage fait lever `createCharacter` avec sa liste d'os |
| 6 | Chargement échoué et rig refusé restent distinguables | un `catch` unique qui aplatit les deux le fait tomber |
| 7 | `breed` : sur cent tirages, l'écart moyen enfant↔milieu-des-parents est **strictement inférieur** à celui d'un génome aléatoire | un `breed` qui ignorerait ses parents passe le test « rend un génome » et tombe sur celui-ci |
| 8 | Le remplacement échoué laisse la marionnette montée et journalise une fois | un chemin qui lèverait, ou qui viderait la carte, le fait tomber |

Les tests 1 à 4 parsent les GLB **réels** récupérés par le script (§6.2). Ce ne
sont pas des fixtures synthétiques. Seuls ceux-là dépendent du réseau, et leur
saut hors ligne est bruyant (§6.2.1).

**Mesuré sur trois clips, présumé sur deux.** `M_Walk_001`,
`M_Standing_Idle_001` et `F_Dances_001` ont été parsés avant l'écriture de cette
spec (§2). `F_Standing_Idle_001` et `F_Walk_002` ne l'ont pas été : la tâche 2
les passe à la même sonde et corrige la spec si l'un d'eux dément la convention.

### 10.2 À l'écran, et la réserve qui l'accompagne

Les tests verts ne prouvent rien sur le rendu. La preuve est
`npx iwsdk dev up` puis `browser_screenshot` — **pas** `scene_screenshot`, qui
rend l'éditeur et n'exécute aucun système applicatif.

**Réserve explicite.** `models.readyplayer.me` ne résout pas depuis le shell de
l'agent (§2.4). La **tâche 0 du plan** est de lancer le serveur de développement
et de vérifier qu'un avatar charge, **avant** d'écrire une ligne. Si le réseau ne
passe pas depuis le navigateur managé non plus, l'étape 3 se terminera avec une
preuve visuelle du **repli** et non du rig, et ce sera dit comme tel. Aucun succès
ne sera annoncé qui n'aura pas été vu.

---

## 11. Corrections à apporter aux specs antérieures

1. **Spec mère, ligne 435** — le risque « les clips écrasent-ils la
   morphologie ? » est **clos** par §2.1. La réponse est nuancée : la convention
   tient pour la locomotion, elle ne tient pas pour la danse, et l'assainisseur
   gère déjà le cas parce qu'il juge sur l'amplitude.
2. **Spec de l'étape 2, §13** — « le chargement des clips au manifeste : étape 3 »
   reste juste ; y ajouter que le root motion n'y était pas prévu.

---

## 12. Risques

| risque | probabilité | conséquence | atténuation |
| :--- | :--- | :--- | :--- |
| Le navigateur managé n'atteint pas `models.readyplayer.me` | **inconnue, mesurée en tâche 0** | pas de preuve visuelle du rig | le repli reste vérifiable ; la limite est déclarée, pas masquée |
| Un rig RPM ne satisfait pas tous les rôles d'os de `HUMANOID` | moyenne | `createCharacter` lève, le villageois reste en cylindres | le rapport d'import nomme les os manquants ; le repli absorbe |
| Le fondu enchaîné révèle un conflit clip↔morphologie non vu en Node | faible | membres qui tressautent | §2.1 a mesuré la seule source connue ; observable à l'écran |
| Onze rigs skinnés dépassent le budget de 11 ms | moyenne | chute d'images | mesurer avant d'optimiser ; la compilation est hors frame par construction |
| Un clone du dépôt sans réseau n'a ni avatars ni clips | **certaine** | quatre tests sautent, la démo reste en marionnettes | conséquence assumée de la licence RPM (§6.2) ; le saut est bruyant, le repli est le comportement nominal |
| Ready Player Me change ou retire un fichier de sa bibliothèque | faible | le script de récupération échoue | il télécharge par chemin explicite et signale le fichier manquant ; les chemins sont dans la spec |

---

## 13. Ordre de construction

| tâche | contenu | livrable |
| :--- | :--- | :--- |
| **0** | Lancer `iwsdk dev up`, charger un avatar RPM | **réponse réseau, avant toute écriture** |
| **1** | `scripts/fetch-character-clips.mjs`, `.gitignore`, déclaration au manifeste | cinq GLB récupérés, jamais commités |
| **2** | Root motion : `RootMotionPolicy`, `flatten`, clé de mémo — **et la sonde passée sur les deux clips non mesurés** | tests 1 à 4 sur les clips réels |
| **3** | `createCharacterFromAsset` et `loadCharacterClips` | tests 5 et 6 |
| **4** | `CharacterAnimationSystem`, priorité 80 | un personnage marche en Node |
| **5** | Génomes du village, `breed` pour Lio et Aya | test 7 |
| **6** | `VillagerBody`, les deux corps, le basculement | test 8 |
| **7** | Vérification à l'écran, et correction des specs (§11) | capture, ou réserve déclarée |

La tâche 0 précède tout parce que sa réponse change ce que l'étape peut
promettre. C'est le même raisonnement qui a placé l'applicateur skinné en
première position de l'étape 2 : le pari non vérifié passe devant.
