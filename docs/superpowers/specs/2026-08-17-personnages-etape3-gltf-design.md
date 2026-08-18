# Étape 3 — Le chemin glTF : un vrai rig dans le village

**Date :** 2026-08-17
**Révisée :** 2026-08-18, après la revue finale de branche
**Spec mère :** `2026-08-17-personnages-proceduraux-design.md`
**Étape précédente :** `2026-08-17-personnages-etape2-pont-three-design.md`

---

## 0. Ce que la construction a démenti

Cette spec a été écrite avant la première ligne de code et n'avait jamais été
rééditée : la revue finale a trouvé six passages qui décrivaient une branche
non livrée. Ils sont corrigés dans le corps du document, mais l'écart lui-même
vaut d'être gardé — une spec qui montre où elle s'est trompée vaut mieux qu'une
spec lissée.

| § | ce que la spec annonçait | ce qui a été livré | ce que ça apprend |
| :--- | :--- | :--- | :--- |
| §2.4, §10.2, §12 | l'étape se terminerait sans doute sur une preuve du **repli**, faute de réseau | onze rigs RPM montés, zéro avertissement | la réserve portait sur `models.readyplayer.me` ; les avatars sont finalement venus de `readyplayerme/animation-library`, le même dépôt que les clips. La bonne question n'était pas « le réseau passe-t-il ? » mais « d'où viennent les assets ? » |
| §8 | onze agents sur **cinq** assets RPM de base | **deux**, choisis par le genre | la démonstration voulue — « ce qui les distingue est la morphologie, pas l'asset » — est plus forte avec deux qu'avec cinq |
| §6.2 | cinq fichiers, 889 Ko | **sept** fichiers, **6 264 996 octets** | les deux avatars T-pose n'étaient pas prévus : la spec supposait des avatars servis par URL |
| §7.1 | une classe `RiggedBody` | `makeRiggedBody`, qui rend un littéral | un ruling de pré-vol l'avait déjà tranché ; la spec ne l'avait pas enregistré |
| §7.2 | le repli est « le seul usage réel de `PuppetApplicator` » | faux, et jamais vérifié | deux objets sans rapport confondus par leur nom. Voir §7.2 |
| §4.3 | « on soustrait la valeur de la clé 0 de chaque clé » | une phrase qui se contredit, et qui ne décrivait pas le code | voir §4.3, réécrit |
| §13 | sept tâches | **dix** exécutées | trois sont nées de mesures faites en route |

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
onze villageois peuvent porter onze morphologies distinctes sur deux assets de
base (§8). Géométries, matériaux et clips restent partagés par référence — ce qui
valide après coup deux décisions de l'étape 2 : le clone de matériau par
individu, et l'assainisseur qui rend un **nouveau** clip au lieu d'amputer
l'original partagé.

### 2.4 Le réseau, depuis cet environnement — et comment la réserve a été levée

`models.readyplayer.me` **ne résout pas** depuis le shell de l'agent, ni depuis
le navigateur managé : les cinq avatars déclarés au manifeste de la démo sont
et restent injoignables.

**Ce n'était pas la bonne question.** La réserve supposait que le seul chemin
vers un rig RPM passait par `models.readyplayer.me`. Il en existait un autre :
`readyplayerme/animation-library`, le dépôt d'où viennent déjà les clips, publie
deux avatars T-pose complets — `Masculine_TPose.glb` et `Feminine_TPose.glb`,
skinnés, 19/19 rôles d'os `HUMANOID` satisfaits (mesuré, `tpose-rig.test.ts`).
Le script de récupération les prend avec les clips, sous la même licence et la
même règle de non-redistribution.

L'étape se termine donc sur onze rigs montés, **zéro** avertissement de repli.
Les §10.2 et §12 ont été mis à jour en conséquence ; ce paragraphe garde la
trace de la réserve parce que la leçon n'est pas « le réseau est passé » mais
« la réserve portait sur une source, pas sur une capacité ».

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
- **`flatten`** — le **déplacement net** est retiré de X et Z, Y intact.

### 4.3 Ce que `flatten` retire, et ce qu'il garde

**Cette section a été réécrite après la revue finale. La première version se
contredisait en une phrase, et le code qui la suivait faisait autre chose
encore.** Elle disait « on soustrait la valeur de la clé 0 de chaque clé » —
ce qui met justement la clé 0 à zéro, l'inverse de l'intention annoncée juste
avant — et l'implémentation, elle, **épinglait** chaque clé sur l'horizontale
de la clé 0. Trois formulations, trois comportements. Ce qui suit est le seul
qui tienne.

Il y a deux choses dans la piste horizontale des hanches, et une seule est du
root motion :

- le **voyage** — la dérive nette d'un bout à l'autre de la boucle. C'est ce
  que l'application possède déjà, par `AgentView.x/z`, et c'est ce qu'il faut
  retirer.
- l'**oscillation** — le balancement latéral du bassin autour de cette
  trajectoire. C'est de l'animation, au même titre que le balancement vertical,
  et il n'y a aucune raison de le jeter.

`flatten` retire donc la **composante linéaire** : pour chaque clé d'indice `i`
au temps `t_i`, on ôte de X et Z la fraction `(t_i − t_0) / (t_n − t_0)` du
déplacement net `(dernière clé − première clé)`. Conséquences :

- la clé 0 est intacte — mettre X et Z à zéro téléporterait le bassin à
  l'origine de l'armature, qui n'est pas là où les hanches se trouvent ;
- le déplacement net tombe à zéro — le voyage disparaît ;
- le résidu autour de la droite survit ;
- Y n'est pas touché.

Mesuré sur les GLB réels (`Hips.translation`) :

| clip | | X | Y | Z |
| :--- | :--- | ---: | ---: | ---: |
| `walk-masculine` | amplitude source | 0,05459 m | 0,05222 m | 3,20979 m |
| | net source | 0,00005 m | — | **3,20979 m** |
| | amplitude après `flatten` | **0,05456 m** | 0,05222 m | 0,04513 m |
| | net après `flatten` | 0 | — | **0** |
| `walk-feminine` | amplitude source | 0,08256 m | 0,04545 m | 4,38555 m |
| | net source | −0,00058 m | — | **4,38555 m** |
| | amplitude après `flatten` | **0,08267 m** | 0,04545 m | 0,14650 m |
| | net après `flatten` | 0 | — | **0** |

Le chiffre qui a tranché : **5,46 cm et 8,26 cm de balancement latéral**, contre
5,22 et 4,55 cm de balancement vertical. L'épinglage jetait le plus grand des
deux mouvements que la politique se donnait explicitement du mal à conserver.

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

**Le remède :** `scripts/fetch-character-clips.mjs` télécharge les GLB dans
`apps/demo/public/characters/`, dossier ajouté au `.gitignore`. Chaque
développeur et la CI les récupèrent sous leur propre acceptation de la licence.
Le script imprime la licence et son URL avant de télécharger.

**Sept fichiers, et non cinq.** La rédaction initiale n'en prévoyait que cinq
— les clips — parce qu'elle supposait les avatars servis par
`models.readyplayer.me`. Ce chemin n'existe pas depuis cet environnement
(§2.4), et les deux avatars T-pose viennent du même dépôt que les clips.

| fichier source | rôle | taille |
| :--- | :--- | ---: |
| `masculine/glb/idle/M_Standing_Idle_001.glb` | `idle`, rig masculin | 164 Ko |
| `feminine/glb/idle/F_Standing_Idle_001.glb` | `idle`, rig féminin | 392 Ko |
| `masculine/glb/locomotion/M_Walk_001.glb` | `walk`, rig masculin | 70 Ko |
| `feminine/glb/locomotion/F_Walk_002.glb` | `walk`, rig féminin | 109 Ko |
| `feminine/glb/dance/F_Dances_001.glb` | **fixture de test** | 156 Ko |
| `masculine/glb/Masculine_TPose.glb` | **avatar**, rig masculin | 2,51 Mo |
| `feminine/glb/Feminine_TPose.glb` | **avatar**, rig féminin | 2,59 Mo |

**6 264 996 octets** au total — 5,97 Mio, soit 6,26 Mo — dans un dossier
ignoré. Les deux avatars, qui portent leurs textures, en font **85,4 %**.

Ces chiffres sont comptés sur le disque, fichier par fichier. Une première
rédaction annonçait « ≈ 5,2 Mo » et « 98 % » : les deux venaient d'un arrondi
recopié sans être recalculé, ce qui est précisément la faute que le §7.2
sanctionne ailleurs.

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

Deux implémentations : `PuppetBody` — une classe, parce qu'elle porte un
`dispose()` qui libère de vraies ressources GPU — enveloppe `applyAvatarPose` et
les cylindres d'aujourd'hui ; **`makeRiggedBody`**, une fonction qui rend un
littéral, pilote le mixer. Il n'y a pas de classe `RiggedBody` : le corps riggé
n'a aucun état propre, tout vit dans l'entité et dans le système d'animation.
(Écrit ici après coup — un ruling de pré-vol l'avait tranché, la spec ne
l'avait pas enregistré.) La boucle de projection devient
`body.setPose(view.animation, this.elapsed)` et ne change plus jamais.

`makeRiggedBody` **dispose l'entité qu'il a reçue si quoi que ce soit lève**.
`createTransformEntity` parente le rig immédiatement : sans cette garde, une
levée laisserait un avatar monté dans la scène, animé, à l'origine du monde et
absent de la carte `bodies` — le village doublerait au lieu de se replier.

### 7.2 L'ordre du montage

1. La scène se monte **immédiatement** en marionnettes, hors ligne compris. Le
   village est complet et correct dès la première frame.
2. Une routine asynchrone remplace chaque corps à mesure que son asset arrive :
   `createCharacterFromAsset`, puis échange de l'entrée dans la carte, `dispose()`
   de la marionnette, retrait de son nœud de la scène.
3. Un échec **journalise une fois**, avec l'identifiant de l'agent et la cause,
   et laisse la marionnette en place. Jamais de levée.

Ce repli n'est pas du code jetable : c'est le comportement **nominal** hors
ligne, et c'est lui qui garantit un village complet et jouable dès la première
image, quoi qu'il arrive au réseau.

**Ce qu'il n'est pas.** Une première rédaction affirmait ici que le repli était
« le seul usage réel de `PuppetApplicator` ». C'est faux, et l'affirmation a
voyagé jusque dans le source livré sans jamais être confrontée au code. Ce sont
deux objets sans rapport que leurs noms rapprochent : `PuppetBody` (démo)
enveloppe `applyAvatarPose` et les cylindres d'`AgentAvatarFactory` ;
`PuppetApplicator` vit dans `character-three` et n'est construit par
`createCharacter` que pour un rig **sans `SkinnedMesh`**. Les deux avatars
T-pose livrés en portent un (`Wolf3D_Avatar`), donc `PuppetApplicator` reste
après cette étape **sans aucun appelant de production** — exactement ce que la
phrase prétendait avoir corrigé. Il n'est pas supprimé pour autant : c'est la
moitié non skinnée du contrat d'applicateur, testée pour elle-même.

### 7.3 Ce qui disparaît

`createAgentAvatar` et `applyAvatarPose` ne disparaissent pas — ils passent
derrière `PuppetBody`. C'est `AgentAvatarFactory` en tant que **chemin
principal** qui disparaît, conformément au §10 de la spec mère.

---

## 8. Les génomes du village

Onze agents nommés, sur **deux** assets RPM de base — `avatar-tpose-masculine`
et `avatar-tpose-feminine`, choisis par le genre de l'agent. C'est la
démonstration, et deux la portent mieux que cinq : ce qui distingue les
villageois à l'écran est la morphologie compilée, pas le fichier.

(La rédaction initiale annonçait cinq assets `models.readyplayer.me`. Ils
restent déclarés au manifeste de la démo, injoignables et inutilisés — voir
§2.4. Les retirer est une tâche à part.)

**Ce que la démonstration livrée montre vraiment : onze squelettes distincts,
pas onze morphologies complètes.** Mesuré (`tpose-rig.test.ts`) : ces deux
avatars ne portent **aucun** morph target, et leur unique maillage s'appelle
`Wolf3D_Avatar`, qui ne figure dans aucun alias de `HUMANOID.surfaces`. Les
cinq gènes de visage et les tons de peau et de cheveux n'ont donc **aucun effet
visible** sur ces assets ; ils sont calculés, écrits dans les composants, et
n'ont rien où se poser. Le rapport d'import le dit (`missingMorphs` et
`missingSurfaces` non vides), et c'est ce que ce test assère.

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
| 1 | `flatten` sur `M_Walk_001` : déplacement net horizontal nul, amplitude latérale **non nulle** (5,46 cm), verticale inchangée | l'épinglage sur la clé 0 — le comportement d'origine — passe la première assertion et tombe sur la deuxième |
| 2 | `strip` retire la piste racine ; `keep` conserve les 3,20979 m | une politique ignorée le fait tomber |
| 3 | La clé de mémo inclut la politique : même clip, deux politiques → deux résultats | une clé incomplète rend le premier verdict au second appelant |
| 4 | `F_Dances_001` réel : seize pistes retirées, zéro conflit | un assainisseur qui jugerait sur la présence et non l'amplitude lèverait |
| 5 | La fabrique passe la **racine de scène**, pas le maillage | passer le maillage fait lever `createCharacter` avec sa liste d'os |
| 6 | Chargement échoué et rig refusé restent distinguables | un `catch` unique qui aplatit les deux le fait tomber |
| 7 | `breed` : sur cent tirages, l'écart moyen enfant↔milieu-des-parents est **strictement inférieur** à celui d'un génome aléatoire | un `breed` qui ignorerait ses parents passe le test « rend un génome » et tombe sur celui-ci |
| 8 | Le remplacement échoué laisse la marionnette montée et journalise une fois | un chemin qui lèverait, ou qui viderait la carte, le fait tomber |
| 9 | L'avatar T-pose réel satisfait 19/19 rôles d'os, et le rapport dit la vérité sur ce qu'il n'a pas (`missingMorphs`, `missingSurfaces` non vides) | un rapport qui prétendrait que tout va bien serait pire qu'un rig incomplet |
| 10 | **Le mixer bouge un os** : après `setVerb` puis `update`, la rotation de la tête a changé et la hanche n'a pas voyagé | un mixer construit sur un nœud étranger, ou des pistes qui ne visent aucun nœud, laisse l'angle à zéro |
| 11 | Une levée de `makeRiggedBody` ne laisse **aucun** nœud orphelin dans la scène ni de mixer vivant | un chemin d'échec sans `dispose()` laisse le rig monté, animé, à l'origine du monde |
| 12 | Une entité recyclée par elics n'hérite pas du rig de sa devancière | une carte clavée par l'objet `Entity` rend `'walk'` là où le nouveau venu n'a rien attaché |

Les tests 1 à 4 et 9 parsent les GLB **réels** récupérés par le script (§6.2).
Ce ne sont pas des fixtures synthétiques. Seuls ceux-là dépendent du réseau, et
leur saut hors ligne est bruyant (§6.2.1).

Les tests 10 à 12 ont été ajoutés par la revue finale : les cinq tests du
système d'animation passaient tous avec un mixer branché sur un `Group` vide,
parce que leurs clips visaient des nœuds (`root`, `head`) qui n'existaient dans
aucune fixture. Mesuré à cette occasion, et vrai bien au-delà de ce test :
`PropertyBinding` lit `:` comme un séparateur de répertoire, donc une piste
nommée `mixamorig:Hips.position` — la **seule forme que produisent les GLB** —
est analysée en `{ nodeName: 'Hips' }` et ne trouve rien sur un rig nommé à la
Mixamo. L'énoncé absolu « aucune piste ne peut viser `mixamorig:Hips` » serait
faux : la forme complète `Body.bones[mixamorig:Hips].position` se lie bien,
car le groupe `objectName`/`objectIndex` est comparé verbatim au nom de l'os.
Aucun exportateur glTF ne l'émet, mais la nuance compte pour qui écrirait une
piste à la main. Les deux avatars livrés nomment leurs os `Hips`,
`Head`… — la convention RPM, la seule qu'un mixer sache viser.

**Mesuré sur trois clips, présumé sur deux — puis mesuré sur les cinq.**
`M_Walk_001`, `M_Standing_Idle_001` et `F_Dances_001` ont été parsés avant
l'écriture de cette spec (§2). `F_Standing_Idle_001` et `F_Walk_002` l'ont été
par la tâche 2 : **ils confirment la convention** — une seule piste de
translation qui bouge, et c'est la hanche.

### 10.2 À l'écran, et ce que la réserve est devenue

Les tests verts ne prouvent rien sur le rendu. La preuve est
`npx iwsdk dev up` puis `browser_screenshot` — **pas** `scene_screenshot`, qui
rend l'éditeur et n'exécute aucun système applicatif.

**Ce qui a été vu.** Onze entités portant `CharacterIdentity`
(`ecs find --withComponents CharacterIdentity` = 11), zéro avertissement de
repli dans la console, et la capture du navigateur runtime.

**La réserve initiale, et sa levée.** Elle disait : « si `models.readyplayer.me`
ne passe pas depuis le navigateur managé non plus, l'étape 3 se terminera avec
une preuve visuelle du **repli** et non du rig, et ce sera dit comme tel. » Le
réseau n'est en effet jamais passé vers cet hôte — la tâche 0 l'a mesuré — mais
la conclusion ne suit pas : les avatars sont venus d'ailleurs (§2.4). La règle
qui portait la réserve, elle, tient toujours et n'a pas été entamée : **aucun
succès n'a été annoncé qui n'ait été vu.**

---

## 11. Corrections à apporter aux specs antérieures

1. **Spec mère, ligne 435** — le risque « les clips écrasent-ils la
   morphologie ? » est **clos** par §2.1. La réponse est nuancée : la convention
   tient pour la locomotion, elle ne tient pas pour la danse, et l'assainisseur
   gère déjà le cas parce qu'il juge sur l'amplitude. *(Fait, tâche 8.)*
2. **Spec de l'étape 2, §13** — « le chargement des clips au manifeste : étape 3 »
   reste juste ; y ajouter que le root motion n'y était pas prévu. *(Fait,
   tâche 8.)*
3. **Cette spec elle-même.** La tâche 8 a corrigé les deux specs que ce
   paragraphe nommait, et personne n'a corrigé le paragraphe — ni le document
   qui le contient. Un seul commit sur ce fichier (`fd39a2c`, sa création)
   pendant que le plan en recevait trois. Corrigé le 2026-08-18, après la revue
   finale ; voir §0 pour l'écart mesuré. **La leçon de méthode :** la liste des
   specs à corriger doit s'inclure elle-même, sans quoi la seule spec qu'on
   n'audite jamais est celle qu'on est en train de suivre.

---

## 12. Risques

Colonne « issue » : ce que la construction a effectivement fait de chaque
risque. Les laisser au futur aurait été le principal mensonge restant du
document.

| risque | probabilité | conséquence | atténuation | issue |
| :--- | :--- | :--- | :--- | :--- |
| Le navigateur managé n'atteint pas `models.readyplayer.me` | **inconnue, mesurée en tâche 0** | pas de preuve visuelle du rig | le repli reste vérifiable ; la limite est déclarée, pas masquée | **survenu, contourné** : il ne l'atteint pas ; les avatars T-pose viennent du dépôt des clips (§2.4) et la preuve du rig a bien été faite |
| Un rig RPM ne satisfait pas tous les rôles d'os de `HUMANOID` | moyenne | `createCharacter` lève, le villageois reste en cylindres | le rapport d'import nomme les os manquants ; le repli absorbe | **non survenu** : 19/19 rôles satisfaits sur les deux avatars |
| Le fondu enchaîné révèle un conflit clip↔morphologie non vu en Node | faible | membres qui tressautent | §2.1 a mesuré la seule source connue ; observable à l'écran | **non survenu** |
| Onze rigs skinnés dépassent le budget de 11 ms | moyenne | chute d'images | mesurer avant d'optimiser ; la compilation est hors frame par construction | **non mesuré** : à rouvrir dans une passe de perf |
| Un clone du dépôt sans réseau n'a ni avatars ni clips | **certaine** | des tests sautent, la démo reste en marionnettes | conséquence assumée de la licence RPM (§6.2) ; le saut est bruyant, le repli est le comportement nominal | **tel quel** : deux fichiers de test se sautent bruyamment hors ligne |
| Ready Player Me change ou retire un fichier de sa bibliothèque | faible | le script de récupération échoue | il télécharge par chemin explicite et signale le fichier manquant ; les chemins sont dans la spec | **non survenu** |
| Les morphs de visage et les tons de peau n'ont aucune cible sur l'asset livré | — *(non prévu par la rédaction initiale)* | cinq gènes sur onze n'ont aucun effet visible | rien : les avatars T-pose n'ont ni morph target ni maillage aux noms attendus | **survenu, assumé et déclaré** (§8) |

---

## 13. Ordre de construction

Huit lignes étaient prévues ; **dix tâches** ont été exécutées. Les trois
dernières ne sont pas de la dérive : chacune est née d'une mesure que la
rédaction initiale n'avait pas faite. Elles figurent ici pour que l'ordre de
construction décrive ce qui a été construit.

| tâche | contenu | livrable |
| :--- | :--- | :--- |
| **0** | Lancer `iwsdk dev up`, charger un avatar RPM | **réponse réseau, avant toute écriture** |
| **1** | `scripts/fetch-character-clips.mjs`, `.gitignore`, déclaration au manifeste | les GLB récupérés, jamais commités |
| **2** | Root motion : `RootMotionPolicy`, `flatten`, clé de mémo — **et la sonde passée sur les deux clips non mesurés** | tests 1 à 4 sur les clips réels |
| **3** | `createCharacterFromAsset` et `loadCharacterClips` | tests 5 et 6 |
| **4** | `CharacterAnimationSystem`, priorité 80 | un personnage marche en Node |
| **5** | Génomes du village, `breed` pour Lio et Aya | test 7 |
| **6** | `VillagerBody`, les deux corps, le basculement | test 8 |
| **7** | Vérification à l'écran, et correction des specs (§11) | capture, ou réserve déclarée |
| **8** *(non prévue)* | Avatars T-pose du dépôt des clips, et preuve du chemin riggé | test 9 ; la réserve du §10.2 levée |
| **9** *(non prévue)* | Le génome de structure doit atteindre le compilateur | défaut Critique : onze villageois compilaient le même corps |
| **10** *(après la revue finale)* | Les six trouvailles de revue : liaison du mixer, recyclage d'entité, avatars fantômes, affirmations fausses, cette spec, `flatten` | tests 10 à 12 ; §0, §4.3, §7.2 |

La tâche 0 précède tout parce que sa réponse change ce que l'étape peut
promettre. C'est le même raisonnement qui a placé l'applicateur skinné en
première position de l'étape 2 : le pari non vérifié passe devant.

**Ce que la tâche 9 apprend, et qu'aucune spec n'aurait attrapé :** les tests
d'une branche peuvent être verts de bout en bout et pourtant ne rien prouver,
quand ils sont écrits d'après un brief plutôt que confrontés au code. Les
tâches 9 et 10 ont toutes deux été ouvertes par une **sonde** — regarder ce que
le programme fait vraiment — et non par une relecture. C'est la contrepartie de
la règle « mesurer avant de construire » : mesurer aussi après.
