# Écologie E1 — Le monde à portée — conception

*Premier des quatre sous-projets d'« écologie & subsistance ». Les trois autres — populations animales, chaînes d'artisanat, démographie villageoise — reposent sur celui-ci : ils ont besoin respectivement d'espace, de matières premières et d'une subsistance qui tienne.*

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

## 3. Le semis engendre des objets exploitables

`scatterAt(tileX, tileZ)` **existe depuis la phase 5** : il rend, de façon déterministe, les espèces et positions d'une tuile de 32 m, dérivées du biome, de la pente et d'un hachage. Le rendu le consomme déjà et en instancie les maillages.

**Il lui manque son second consommateur.** Le moteur n'y instancie aucun smart object : la forêt se voit mais ne se coupe pas. C'est précisément le défaut que la spec environnement §8 annonçait — « les agents bûcheronneraient des arbres invisibles pendant que la forêt visible resterait inerte » — inversé : ici la forêt visible est inerte.

Le moteur instancie donc, pour chaque tuile de la zone simulée, les smart objects que `scatterAt` y sème :

| Espèce semée | Smart object | Verbes déjà disponibles |
| :--- | :--- | :--- |
| `oak` | `oak_tree` | `gather_wood` |
| `bush` | `berry_bush` | `gather_berries` |
| `aspen` | `oak_tree` | `gather_wood` |

**Aucun verbe nouveau n'est nécessaire.** Le moteur porte déjà `hunt`, `fish`, `knap_flint`, `build`, `gather_*` — quinze affordances, cinq besoins, un inventaire générique et une régénération déclarée. Ce qui manquait n'était pas la capacité d'agir, mais le monde sur lequel agir.

**Réserve du village.** `scatterAt` observe déjà une réserve de 14 m autour du plateau : les 23 objets calibrés de `DEFAULT_VILLAGE` y restent seuls, et le garde-fou d'habitabilité continue d'en répondre.

**Le semis est instancié d'emblée, pas à la demande.** Sur 400 m de côté, `scatterAt` sème **2 143 plantes** — mesuré, non estimé : 1 554 chênes, 586 buissons, 3 trembles. Avec les 23 objets du village, la vérité terrain passe donc de **23 à 2 166 objets**, un facteur 94. Les instancier tous au démarrage coûte quelques centaines de kilo-octets et garantit des identifiants stables : une instanciation paresseuse ferait dépendre l'identité d'un arbre de l'ordre dans lequel les agents s'en approchent, et le déterminisme du moteur n'y survivrait pas.

Ce facteur 94 est la véritable difficulté de cette phase, et le §7 en tire les conséquences.

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

Elle est large, et l'énoncer fait partie de la conception. Trois lignes de ce tableau ne sont pas des ajustements : ce sont des **défauts préexistants que le facteur 94 rend intenables**. Ils sont mesurés ci-dessous, et corrigés dans cette phase.

| Ce qui bouge | Conséquence |
| :--- | :--- |
| `WORLD_SIZE` 64 → 400 | Clamp de navigation seulement. **Vérifié** : `WORLD_SIZE` n'a qu'un consommateur, `navigation.ts`. Le champ de hauteur est défini sur le plan infini et ne s'en trouve pas modifié — le relief, la rivière et l'habitabilité du village restent bit pour bit identiques. |
| `BeliefState.known()` | **Défaut préexistant, le plus grave.** Copie et trie la carte entière à chaque appel, avec `localeCompare`. `Mode1` l'appelle à chaque décision de chaque agent. Mesuré : **0,003 ms à 23 croyances, 0,165 ms à 2 166** — un facteur 55 dans le chemin le plus chaud du moteur, soit 18 ms par seconde simulée à onze agents. Pire, `SimKernel` autorise des rattrapages de 1 000 ticks : une telle rafale bloquerait la frame près de deux secondes. Corrigé par une mémoïsation invalidée à l'écriture, qui préserve exactement l'ordre trié dont dépend le déterminisme. |
| `objectsNear(0, 0, 1000)` | **Défaut préexistant.** Balaie 251 001 cellules de grille par appel — indépendamment du nombre d'objets — puis trie tout ce qu'il rend. Trois appelants (`WolfSystem` à chaque tick en chasse, `WeatherMachine` sous la pluie, `scenario`) ne cherchent en réalité qu'un type. Corrigé par un index par type sur `GroundTruthWorld`, en O(k). |
| `BeliefState` sans borne | Un agent qui parcourt 400 m finit par croire à des milliers d'arbres, dont la plupart ne lui serviront jamais. Une borne par récence est **fidèle au modèle** — une mémoire qui décline est une mémoire faillible — et non un simple expédient de performance. |
| `WolfSystem` | Rayon de rôdage codé en dur à ±20 m, à élargir |
| `scenario.test` | Fige 23 objets ; le compte devient 2 166 |
| Instantanés déterministes | Le déterminisme tient — tout reste déterministe — mais les références enregistrées changent |
| Coût de perception | Rayon de vision de 12 m le jour : à la densité du semis, une dizaine d'objets par observation. Sans effet. |
| Coût du sol | `biomeAt` coûte 3,2 µs ; onze agents à 10 Hz, soit 35 µs par seconde. Négligeable. |

## 8. Ce que cela donne à l'entraînement

Les observations portent enfin la géographie, donc les décisions et les jeux de données aussi. Une trajectoire enregistre désormais : *l'agent croyait qu'une forêt se trouvait ici, il s'y est rendu, voici ce qu'il y a trouvé*.

**L'écart entre la croyance et le fait devient mesurable.** C'est précisément la cible d'entraînement décrite par la spec du moteur (§5, la « surprise » comme saillance mémorielle et cible JEPA), et elle n'existait pas jusqu'ici pour la géographie — faute de croyance géographique à confronter.

## 9. Tests

- **Instanciation du semis** : chaque tuile de la zone simulée porte autant de smart objects que `scatterAt` y sème ; aucun dans le village ; le compte total reste borné.
- **Perception** : l'observation porte les trois faits du sol, et ils s'accordent avec le moteur.
- **`PlaceBelief`** : acquise en marchant et pas autrement, datée, transmissible par rumeur, `placesOf` ordonné par distance.
- **Zone élargie** : le clamp de navigation tient à la nouvelle borne ; le garde-fou d'habitabilité du village reste vert **sans modification** ; le loup trouve encore ses proies.
- **Tenue en charge** : à 2 166 objets, un tick de onze agents reste sous son budget, et `known()` ne se dégrade plus avec le nombre de croyances. Chaque correctif du §7 porte le test qui l'établit — un banc qui échouerait si la copie triée revenait.
- **Déterminisme préservé** : deux exécutions du même scénario rendent le même instantané, mémoïsation et index par type compris.
- **Divergence croyance/vérité** : une métrique existante du moteur, étendue aux lieux.

## 10. Hors périmètre

- **Pas d'exploration délibérée.** Les agents n'ont pas de pulsion à découvrir ; ils enregistrent ce qu'ils traversent en vaquant à leurs besoins.
- **Pas de carte partagée.** La rumeur transmet un lieu à la fois, par le dialogue existant.
- **Pas de population animale.** Le loup reste le seul animal de vérité terrain ; les troupeaux relèvent d'E2.
- **Pas de recettes d'artisanat.** `knap_flint` existe et fonctionne ; les chaînes de fabrication relèvent d'E3.
- **Pas de démographie.** Ni naissance, ni âge, ni mort : c'est E4.
- **Pas de navigation par le relief.** `Mode1` estime toujours les déplacements en distance planaire, sans tenir compte du dénivelé.
