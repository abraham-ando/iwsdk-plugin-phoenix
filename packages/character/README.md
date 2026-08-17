# @iwsdk/cardinal-character

Génome, hérédité et compilation morphologique des êtres vivants du stack Cardinal.
**Aucune dépendance runtime** — ni Three, ni IWSDK. Tout est pur et testable en Node.

## Ce que fait ce paquet

Un **descripteur de famille** dit ce qu'est une espèce : rôles d'os et leurs alias,
chaînes déformables, courbes de proportion selon l'âge, catalogue de gènes.

Un **génome** est un dictionnaire de gènes normalisés dans `[0,1]`. `breed()` en
croise deux de façon déterministe depuis un générateur injecté, ce qui rend la
ressemblance familiale rejouable depuis la graine du monde.

Le **compilateur** prend un génome, un âge et une liaison de rig mesurée, et rend
une pose de repos, des influences de morphs et des tons de surface. Il ne touche
jamais un objet Three : c'est le paquet `@iwsdk/cardinal-character-three` qui
applique le résultat.

## La règle qui gouverne tout

> Les longueurs passent par des **translations d'os**, les volumes par des
> **morphs**, et l'échelle n'est employée qu'**uniformément**.

Une échelle non uniforme sur un os cisaille la peau et casse les normales. Le
compilateur ne peut pas en produire : `CompiledBone.scale` est un scalaire.

## L'âge n'est pas un gène

Le génome décrit l'adulte-cible ; `compile(family, genome, age, binding)` applique
les courbes de proportion. Un enfant et l'adulte qu'il deviendra partagent donc le
même génome, et un villageois peut vieillir sans jamais être re-tiré.

## Usage

```ts
import { HUMANOID, createGenome, breed, compile, METIERS, genomeFromPreset } from '@iwsdk/cardinal-character';

const mère = genomeFromPreset(HUMANOID, METIERS.ferronnier!);
const père = createGenome(HUMANOID, rng);
const enfant = breed(HUMANOID, mère, père, rng, 'f');

const corps = compile(HUMANOID, enfant, 7, binding);
```

`rng` est un `RngLike` (une méthode `next()` renvoyant un flottant dans `[0,1)`) et
`binding` une `RigBinding` mesurée sur le rig cible. `METIERS.ferronnier` a le type
`Preset | undefined` — le paquet compile avec `noUncheckedIndexedAccess` — d'où le
`!` : on sait que la clé existe, `genomeFromPreset` ne le sait pas.

## Vecteurs dorés

`fixtures/character_vectors.tsv` fige la sortie du compilateur pour huit graines et
cinq âges. `pnpm test` régénère et compare : un diff signifie que la morphologie a
changé sans que la trace ait suivi.
