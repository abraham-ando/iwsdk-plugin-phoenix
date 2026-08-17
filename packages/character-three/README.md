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

## Usage

```ts
import { installCharacterThree, createCharacter } from '@iwsdk/cardinal-character-three';
import { HUMANOID, createGenome } from '@iwsdk/cardinal-character';

installCharacterThree(world);

const { entity, report } = createCharacter(world, {
  familyId: 'humanoid',
  genome: createGenome(HUMANOID, rng),
  age: 34,
  rigRoot: assetInstance,
});

if (!report.accepted) {
  console.error('rig refusé, os manquants :', report.missingBones);
}
```

## Le rapport d'import

`resolveBinding` dit **par quel alias** chaque rôle a matché, et ce qui manque.
Un os nommé par une chaîne est structurel : son absence refuse l'asset. Un morph
absent ne bloque pas, mais figure au rapport — un asset ne se dégrade jamais en
silence.

## Le conteneur DOIT être un ancêtre des os

`createCharacter` écrit le décalage au sol sur `rigRoot`
(`stats.groundOffsetMeters`), et cet écrit ne bouge la peau que si les os en
sont des descendants réels — ni `RigBinding` ni `ImportReport` ne portent de
référence de scène, seulement des rôles et des transforms, donc rien en amont
ne peut garantir cette relation à la place de `createCharacter`.

Un import glTF place souvent l'armature en **frère** du `SkinnedMesh`, pas en
enfant : passer le maillage comme `rigRoot` déplacerait alors le conteneur sans
jamais atteindre les os, en silence. `createCharacter` vérifie donc, avant de
construire l'applicateur, que chaque os résolu remonte jusqu'à `rigRoot` par la
chaîne `.parent` — et **lève**, en nommant l'os fautif, si ce n'est pas le cas.
Passez l'ancêtre commun du maillage et de l'armature, pas le maillage seul.

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

`CharacterCompileSystem` (priorité 60) recompile le squelette sur changement de
gène de structure ou d'âge. `CharacterExpressionSystem` (priorité 70) applique
les morphs de visage chaque frame, sans jamais recompiler.
