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
