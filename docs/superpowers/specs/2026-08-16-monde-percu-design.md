# Relier le monde aux agents — conception

## 1. Le constat qui motive tout

Six phases d'environnement ont produit un relief kilométrique, des biomes, un streaming par tuiles et une rivière qui descend jusqu'à la mer. Une vérification suffit à mesurer ce qui en parvient aux agents :

```
grep -rn "biomeAt" packages/simulation/src/agents src/content src/kernel
→ aucun résultat
```

`biomeAt` n'est consommé par personne dans le moteur. Le seul fait du terrain qui touche une décision d'agent est `isRiverAt`, qui divise la vitesse de marche par deux. **Les agents reçoivent du monde un unique bit d'information : « ai-je les pieds dans l'eau ? »**

L'objectif du projet est d'entraîner des modèles à maîtriser leur environnement et à passer du monde virtuel au monde réel. Un environnement imperceptible n'enseigne rien : il ne produit ni décision, ni trajectoire, ni signal. Cette phase comble l'écart.

## 2. Le principe directeur

Le projet s'est engagé dès son origine sur la définition du modèle du monde de Yann LeCun. Elle commande ici une conclusion précise, et écarte la solution la plus commode.

**Donner aux agents une carte des régions serait une faute.** Un savoir géographique fourni d'emblée serait *infaillible* et *non acquis* — l'inverse d'une croyance. Dans le modèle de LeCun, la connaissance du monde est construite par la perception, datée, faillible, et révisable.

Le moteur possède déjà ce mécanisme : `BeliefState` tient des croyances datées sur les objets, et `learn()` accepte une rumeur *datée à l'instant où on l'entend, non au moment du fait*. La connaissance géographique s'y inscrit sans rien inventer — elle devient une nouvelle classe de faits dans un patron éprouvé.

## 3. Le semis appartient à la vérité terrain

`scatterAt(tileX, tileZ)` rend, de façon déterministe, les ressources d'une tuile de 32 m. Une grille perturbée propose des points ; chacun consulte `biomeAt`, `slopeAt` et une table d'espèces :

| Espèce | Condition |
| :--- | :--- |
| `berry_bush` | biome humide ou prairie, pente douce |
| `flint_deposit` | biome rocheux, ou pente forte |
| `oak_tree` | biome forestier |
| `deadwood` | abords de la rivière |

**La rareté devient une conséquence de la géographie** au lieu d'être un choix de contenu posé à la main dans `DEFAULT_VILLAGE`.

Le moteur et le rendu appellent **la même fonction** : le moteur y instancie des smart objects exploitables, le rendu y instancie des maillages. Sans cette discipline, les agents bûcheronneraient des arbres invisibles pendant que la forêt visible resterait inerte.

**Réserve du village.** `scatterAt` ne sème rien dans le plateau. Les 23 objets calibrés de `DEFAULT_VILLAGE` restent seuls maîtres chez eux : c'est ce qui protège le garde-fou d'habitabilité, les tests du loup et ceux du joueur, tous calés sur des coordonnées à la main.

## 4. La perception gagne le sol

`Observation` porte trois faits nouveaux, lus **à la position de l'agent** :

```ts
groundBiome: BiomeId;
groundSlope: number;
groundHeight: number;
```

Rien d'autre. C'est local et perceptuel : aucune omniscience, aucune vue d'ensemble. Un agent sait ce qu'il a sous les pieds, pas ce qu'il y a derrière la colline.

## 5. Les lieux deviennent des croyances

```ts
interface PlaceBelief {
  key: string;          // biome et tuile, par exemple 'forest@3,-2'
  biome: BiomeId;
  x: number;            // centre de la tuile, au moment de l'observation
  z: number;
  lastSeenTick: number;
}
```

- **Acquise en marchant**, jamais donnée. Chaque tick, l'agent enregistre la tuile de biome qu'il foule — **la même grille de 32 m que `scatterAt`**, pour qu'un lieu cru et un lieu semé désignent exactement la même case.
- **Datée, donc faillible** : il peut croire aux baies d'un lieu cueilli depuis.
- **Transmissible** par `learnPlace`, datée à l'instant où on l'entend — comme la rumeur des objets.
- **Interrogeable** : `placesOf(biome)` rend les lieux connus d'un type, du plus proche au plus lointain. C'est ce qui donne enfin à Mode-2 de quoi planifier un déplacement au lieu de réagir à ce qui passe.

## 6. La zone simulée s'élargit

`WORLD_SIZE` passe de 64 m à **400 m**. Comme aujourd'hui, cette valeur est le **côté** du carré simulé, non un rayon : la navigation borne donc les agents à ±200 m de l'origine, contre ±32 m auparavant.

Sans espace, la rareté géographique n'a nulle part où s'exprimer : les agents n'auraient jamais à voyager, et la carte mentale ne servirait à rien. Quatre cents mètres donnent une centaine de tuiles de semis et plusieurs biomes distincts à parcourir, tout en restant très en deçà des 800 m qui séparent le village de la mer — la côte reste hors d'atteinte, et c'est voulu.

## 7. Surface de régression assumée

Elle est large, et l'énoncer fait partie de la conception.

| Ce qui bouge | Conséquence |
| :--- | :--- |
| `WORLD_SIZE` 64 → 400 | Clamp de navigation, et toute assertion de position qui en dérive |
| `WolfSystem` | Rayon de rôdage codé en dur à ±20 m, à élargir |
| `objectsNear(0, 0, 1000)` | **Défaut préexistant** : balaie 250 000 cellules par appel, à chaque tick en mode chasse. Avec dix fois plus d'objets il devient intenable ; il est borné dans cette phase. |
| `scenario.test` | Fige 23 objets ; le compte change |
| Instantanés déterministes | Le déterminisme tient — tout reste déterministe — mais les références enregistrées changent |
| Coût par tick | `biomeAt` coûte 3,2 µs ; onze agents à 10 Hz, soit 35 µs par seconde. Négligeable. |

## 8. Ce que cela donne à l'entraînement

Les observations portent enfin la géographie, donc les décisions et les jeux de données aussi. Une trajectoire enregistre désormais : *l'agent croyait qu'une forêt se trouvait ici, il s'y est rendu, voici ce qu'il y a trouvé*.

**L'écart entre la croyance et le fait devient mesurable.** C'est précisément la cible d'entraînement décrite par la spec du moteur (§5, la « surprise » comme saillance mémorielle et cible JEPA), et elle n'existait pas jusqu'ici pour la géographie — faute de croyance géographique à confronter.

## 9. Tests

- **`scatterAt`** : déterminisme, raccord aux frontières de tuile, densité conforme au biome, aucun semis dans le village, aucun sur pente forte.
- **Perception** : l'observation porte les trois faits du sol, et ils s'accordent avec le moteur.
- **`PlaceBelief`** : acquise en marchant et pas autrement, datée, transmissible par rumeur, `placesOf` ordonné par distance.
- **Zone élargie** : le clamp de navigation tient à la nouvelle borne ; le garde-fou d'habitabilité du village reste vert **sans modification** ; le loup trouve encore ses proies.
- **Divergence croyance/vérité** : une métrique existante du moteur, étendue aux lieux.

## 10. Hors périmètre

- **Pas d'exploration délibérée.** Les agents n'ont pas de pulsion à découvrir ; ils enregistrent ce qu'ils traversent en vaquant à leurs besoins.
- **Pas de carte partagée.** La rumeur transmet un lieu à la fois, par le dialogue existant.
- **Pas de régénération des ressources.** Une baie cueillie ne repousse pas ; cela relève du sous-projet *écologie & subsistance*.
- **Pas de pêche ni de chasse nouvelles.** Le loup reste le seul animal de vérité terrain.
- **Pas de navigation par le relief.** `Mode1` estime toujours les déplacements en distance planaire, sans tenir compte du dénivelé.
