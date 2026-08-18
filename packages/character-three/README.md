# @iwsdk/cardinal-character-three

Applique la morphologie compilée par `@iwsdk/cardinal-character` à de vrais
objets Three, et l'expose en composants et systèmes ECS d'IWSDK.

## La règle qui gouverne tout

> **Déplacer un os EST la déformation. On n'appelle jamais
> `skeleton.calculateInverses()`.**

Ce n'est pas une préférence, c'est une mesure. Sur une chaîne
hanche → genou → cheville, avec un sommet pondéré au genou :

| Geste | genou | cheville |
| :--- | ---: | ---: |
| repos | −1,000 | −2,000 |
| cuisse allongée, sans rebake | **−1,500** | **−2,500** |
| …puis `calculateInverses()` | −1,000 | −2,000 |
| + rotation de clip sur le genou | −1,500 | −1,500 |

La peau suit l'os parce que la matrice d'os diffère de la matrice de liaison —
c'est le travail du skinning. Recalculer les inverses rend la pose courante
neutre et **annule** la morphologie.

La quatrième ligne porte l'autre moitié : une rotation de clip laisse la cuisse
allongée intacte. C'est pourquoi `sanitizeClip` retire les pistes de *position*
sur les os non racines — sans quoi elles écraseraient la longueur du membre à
chaque image.

## Deux applicateurs, une interface

`SkinnedApplicator` écrit dans un `Skeleton`. `PuppetApplicator` écrit dans des
`Object3D` nommés, pour les hiérarchies non skinnées. `createCharacter` choisit
selon ce que l'asset porte réellement, pas selon une option.

### Un clone de matériau par individu

Les deux applicateurs **clonent** à la construction le matériau des maillages
qu'ils vont teinter, et le remplacent par ce clone. `Object3D.clone()` partage
ses matériaux, et un asset chargé une fois puis instancié quarante fois aussi :
sans ce clone, le premier villageois repeindrait les trente-neuf autres, et le
défaut se lirait comme « tout le monde a la même peau », très loin de sa cause.

Le clone nous appartient, donc `dispose()` le libère — appelé par
`CharacterCompileSystem` quand l'entité quitte la query. Les **textures**, elles,
restent celles de la bibliothèque : `Material.clone()` en copie les références
et `Material.dispose()` n'y touche pas.

## Usage

```ts
import { installCharacterThree, createCharacter } from '@iwsdk/cardinal-character-three';
import { HUMANOID, createGenome } from '@iwsdk/cardinal-character';

installCharacterThree(world);

// Lève si le rig est refusé — voir « Le rig refusé lève » plus bas.
const { entity, report } = createCharacter(world, {
  familyId: 'humanoid',
  genome: createGenome(HUMANOID, rng),
  age: 34,
  rigRoot: assetInstance,
});

// `entity.object3D` est à vous : posez-y la hauteur de terrain, le point
// d'apparition, ce que vous voulez. Aucune compilation ne l'écrasera.
entity.object3D.position.set(x, terrainHeight, z);

if (report.missingMorphs.length > 0) {
  console.warn('rig accepté, morphs absents :', report.missingMorphs);
}
```

## Depuis le manifeste : `createCharacterFromAsset`

`createCharacter` exige un `rigRoot` déjà instancié. `createCharacterFromAsset`
fait l'instanciation elle-même, par `world.assets.instantiate` — donc par
`AssetManager`, jamais par un `GLTFLoader` brut :

```ts
import { createCharacterFromAsset } from '@iwsdk/cardinal-character-three';

const { entity, report } = await createCharacterFromAsset(world, {
  assetId: 'avatar-haran',
  familyId: 'humanoid',
  genome: createGenome(HUMANOID, rng),
  age: 34,
});
```

`world.assets.instantiate` rend `gltf.scene` d'un clone `SkeletonUtils.clone` —
donc un `Skeleton` et des os NEUFS à chaque appel, ce qui permet à onze
villageois de porter onze morphologies sur cinq assets de base. Géométries,
matériaux et clips restent partagés par référence entre ces appels : c'est
pourquoi les applicateurs clonent leurs matériaux (voir plus haut) et pourquoi
`sanitizeClip` rend un nouveau clip plutôt que de muter le sien.

Deux échecs remontent, et ils restent distinguables : le chargement (asset
inconnu, réseau indisponible) lève depuis `AssetManager`, avant que
`createCharacterFromAsset` n'appelle `createCharacter` ; le refus de rig lève
depuis `createCharacter` avec la liste des os manquants (voir « Le rig refusé
lève » plus haut).

## Le rapport d'import

`resolveBinding` dit **par quel alias** chaque rôle a matché, et ce qui manque.
Un os nommé par une chaîne est structurel : son absence refuse l'asset. Un morph
absent ne bloque pas, mais figure au rapport — un asset ne se dégrade jamais en
silence.

## Trois niveaux, et celui du milieu porte l'ancrage

`createCharacter` ne rend pas votre `rigRoot` tel quel : elle l'enveloppe.

```
CharacterEntity            ← entity.object3D — À VOUS
  └ CharacterGroundAnchor  ← le décalage au sol, écrit par l'applicateur
      └ votre rigRoot
          └ os…
```

L'applicateur écrit `anchor.position.y = stats.groundOffsetMeters` par
**affectation**, et non par addition : l'ancrage est une propriété de la
morphologie compilée, pas un delta. Sans le nœud du milieu, cette affectation
tomberait sur le nœud d'entité — donc sur la hauteur de terrain ou le point
d'apparition que l'application vient de poser — à la première compilation puis
à chacune des suivantes. « La morphologie du personnage et l'endroit où il se
tient sont deux choses distinctes » (conception §7.2) : ici, ce sont deux
nœuds.

Corollaire : **`entity.object3D` vous appartient entièrement.** Placez-y le
personnage ; aucune recompilation ne l'écrasera.

L'ancre est aussi ce qui garantit l'autre invariant : le décalage au sol ne
bouge la peau que si les os en sont des descendants réels, et ils le sont par
construction puisque `createCharacter` reparente votre rig sous l'ancre.
`assertBonesAreDescendants` reste exportée et vérifiée, mais c'est désormais
le filet d'un futur remaniement, pas un chemin que `createCharacter` peut
emprunter.

## Le rig refusé lève

`createCharacter` **lève** quand `resolveBinding` ne trouve pas tous les os
déclarés par la famille, en nommant la famille et la liste exacte des rôles
manquants. Elle lève **avant** de créer l'entité : rien n'est laissé à
moitié construit.

C'est précisément le cas de l'import glTF qui place l'armature en **frère** du
`SkinnedMesh` : passer le maillage comme `rigRoot` ne trouve aucun os. Passez
l'ancêtre commun du maillage et de l'armature, pas le maillage seul.

Un morph ou une cible de surface absents, eux, ne bloquent pas — ils figurent
au rapport (`report.missingMorphs`, `report.missingSurfaces`), et
`report.accepted` vaut alors `true`. Un rig qu'on vous rend est un rig dont
tous les os ont matché.

## Composants et systèmes

| Composant | Rôle |
| :--- | :--- |
| `CharacterIdentity` | Espèce, sexe, âge, graine du tirage. |
| `CharacterStructure` | Gènes de groupe `structure` — modifier RECOMPILE le squelette. |
| `CharacterFace` | Gènes de groupe `face` — s'applique à la frame suivante, sans recompiler. |
| `CharacterSurface` | Couleurs de peau et de cheveux, en `Types.Color` (champ vecteur). |
| `CharacterSelection` | Singleton : la cible d'édition courante des panneaux d'inspection. |

`CharacterSurface` porte des **couleurs**, la sortie de la rampe — jamais son
entrée. Les gènes de groupe `surface` (teinte de peau, de cheveux…) n'ont donc
aucun champ réglable : ils ne peuvent venir que du génome posé à la création
via `createCharacter`, qui reste la source de vérité pour tout ce qu'aucun
curseur n'expose.

`CharacterCompileSystem` **écrit** ces deux couleurs à chaque compilation, par
la même interpolation de rampe que celle qui teinte le matériau (`rampColour`,
appelée en un seul endroit du paquet : deux interpolations séparées finiraient
par diverger, et le composant dirait alors autre chose que l'écran). Elles se
lisent — et s'écrivent — par `getVectorView`, jamais par `setValue` :

```ts
const skin = entity.getVectorView(CharacterSurface, 'skin'); // [r, g, b, a]
```

> `Types.Color` est un champ **vecteur** et `setValue` **lève** dessus en elics
> 3.4.x. C'est le rappel qui a déjà coûté une revue.

Les couleurs sont écrites même quand l'asset n'a rien à teinter — une
marionnette sans maillage de cheveux porte quand même sa teinte de cheveux dans
le composant : la couleur est une propriété du personnage, pas de son asset.

`CharacterCompileSystem` (priorité 60) recompile le squelette **uniquement**
sur changement de gène de STRUCTURE ou d'âge — `genomeFromComponents` ne lit
jamais `CharacterFace`, précisément pour que traîner un curseur de mâchoire ne
recompile pas le squelette entier à chaque cran. Cette même compilation
applique aussi les tons de peau et de cheveux (`applicator.applySurface`) :
comme les gènes de surface viennent du génome posé à la création et ne
changent jamais entre deux compilations, la porte de recompilation est le bon
endroit pour les écrire, pas une frame séparée.

`CharacterExpressionSystem` (priorité 70) applique les morphs de visage chaque
frame, sans jamais recompiler — et projette chaque gène `[0,1]` dans la plage
que la famille déclare pour ce morph (souvent `[-1,1]`), la même formule que le
compilateur : un gène à 0 ne veut pas dire « pas de morph », il peut vouloir
dire « morph au maximum dans l'autre sens ».

## Clips : chargement et assainissement

`loadCharacterClips` charge des clips depuis le manifeste et rend le
**premier** `AnimationClip` de chaque asset :

```ts
import { loadCharacterClips } from '@iwsdk/cardinal-character-three';

const clips = await loadCharacterClips({
  idle: 'clip-idle',
  walk: 'clip-walk',
  dance: 'clip-dance',
});
```

Les clips sont partagés par tout le village — ils n'ont rien à faire dans une
fabrique par personnage, contrairement à `rigRoot`. L'assainissement, lui,
reste par personnage, parce qu'il dépend du `roleOfNode` de CE rig ; c'est
`sanitizeClip` (et non `loadCharacterClips`) qui décide quelles pistes
survivent, et son mémo (voir plus haut) le rend gratuit à partir du deuxième
villageois. Un identifiant qui ne charge pas, ou un asset sans aucun clip, fait
échouer toute la promesse : un village où la moitié des verbes n'a pas de clip
serait plus difficile à diagnostiquer qu'un échec net.

### `rootMotion` : qui possède la position du personnage

`sanitizeClip(clip, family, roleOfNode, options?)` accepte
`options.rootMotion: 'keep' | 'strip' | 'flatten'` :

- `'keep'` — la piste de translation de la racine passe telle quelle.
- `'strip'` — elle disparaît : le personnage ne bouge jamais dans le monde,
  quel que soit le clip.
- `'flatten'` — le **déplacement net** est retiré de X et Z, et rien d'autre :
  chaque clé au temps `t_i` perd la fraction `(t_i − t_0) / (t_n − t_0)` de
  l'écart entre la dernière clé et la première. La clé 0 est donc préservée
  (la pose de départ reste), le voyage disparaît, et l'**oscillation** autour
  de cette droite survit. L'axe vertical n'est pas touché.

  > La première version épinglait chaque clé sur l'horizontale de la clé 0.
  > C'était trop : mesuré, le balancement LATÉRAL des hanches vaut 5,46 cm
  > (`walk-masculine`) et 8,26 cm (`walk-feminine`) — plus que le balancement
  > vertical (5,22 / 4,55 cm) que cette même politique se donne explicitement
  > du mal à conserver. L'épinglage jetait le plus grand des deux avec le
  > voyage.

**Le défaut est `'keep'` — pas parce que c'est le bon choix pour un
villageois, mais pour ne rien changer aux appelants existants.**
`sanitizeClip` existait avant cette option (étape 2) ; en faire changer le
comportement par défaut aurait modifié, sans qu'ils le demandent, tout code déjà
écrit contre elle. La question que tranche `rootMotion` n'est d'ailleurs pas
une question d'espèce — donc pas un champ de `FamilyDescriptor` — mais la
question de savoir QUI possède la position du personnage dans le monde. Un
villageois dont `AgentView.x/z` est recalculé à chaque tick par la simulation
(`rootMotion: 'flatten'`, voir `makeRiggedBody` dans `apps/demo`) et un
personnage joueur en locomotion libre (`'keep'`) appartiennent à la même
famille et veulent des réponses opposées : c'est donc l'appelant qui tranche,
jamais la famille.

Mesuré sur `readyplayerme/animation-library` : `M_Walk_001` déplace les hanches
de 3,20979 m par boucle, `F_Walk_002` de 4,386 m — laissés en `'keep'`, ces
clips emmènent un villageois plusieurs mètres devant lui-même avant que la
simulation ne le reteleporte. `F_Dances_001` porte dix-sept pistes de
translation, dont seize CONSTANTES à 10⁻⁶ m près (les décalages d'os du rig
source, pas du mouvement) : `classifyTranslationTrack` les retire sur
l'amplitude, jamais sur la présence, donc `rootMotion` ne les concerne pas —
seule la piste de la racine, jugée `'keep'`, passe par la politique.

## `CharacterAnimationSystem` (priorité 80)

Un `AnimationMixer` par personnage, des clips assainis une seule fois à
l'attachement, et un fondu enchaîné au changement de verbe.

**Priorité 80 : après `CharacterCompileSystem` (60) et
`CharacterExpressionSystem` (70).** Le mixer doit tourner une fois la
morphologie de la frame posée ; avant elles, il écrirait sur des os que la
compilation replacerait juste après.

```ts
const system = world.getSystem(CharacterAnimationSystem);

// Une fois, à l'attachement : assainit et mémorise les clips pour CETTE entité.
system.attach(entity, clips, roleOfNode, { rootMotion: 'flatten' });

// À chaque changement de verbe : fondu enchaîné vers l'action déjà créée,
// ou nouvellement créée puis réutilisée — jamais recréée à chaque appel.
system.setVerb(entity, 'walk');
```

Un verbe sans clip retombe sur `idle` plutôt que de lever : la bibliothèque RPM
ne contient aucun clip de repos ni de sommeil, et lever ici ferait tomber la
démo sur un comportement normal de la simulation. `currentVerb`, `clipFor` et
`actionCount` existent pour le diagnostic et les tests, pas pour le chemin
chaud. `update()` détache et arrête le mixer d'une entité disposée — sans
cette garde, un village qui remplace régulièrement ses marionnettes par des
rigs fuirait un mixer par remplacement, une fuite qui ne se voit qu'au bout
d'une heure de jeu.

Pourquoi pas `AvatarAnimationController` de `@iwsdk/plugin-cardinal-ai` : il
fait des fondus et porte quatorze tests, mais il vit du mauvais côté — faire
dépendre les personnages du paquet IA inverse la dépendance — et il
duck-type `globalThis.THREE`, ce qui le laisse silencieusement sans mixer
quand cet objet n'est pas là.
