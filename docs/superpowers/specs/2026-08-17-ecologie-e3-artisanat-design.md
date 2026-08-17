# Écologie E3 — Chaînes d'artisanat — conception

*Troisième des quatre sous-projets d'« écologie & subsistance », après E1 (le monde à portée) et avant E2 (populations animales) et E4 (démographie). Il arrive avant E2 parce que la mesure a montré que la rareté n'est plus le levier : c'est la demande qu'il faut faire croître.*

## 1. Le constat qui motive tout

```
knap_flint : flint -1 → flint_blade +1
flint_blade : consommé par PERSONNE
```

La chaîne d'artisanat existe et s'arrête au premier maillon. Quinze affordances, sept objets d'inventaire, et un seul produit manufacturé qui ne sert à rien.

Deux mesures encadrent ce sous-projet, et toutes deux disent la même chose.

**La rareté n'est plus le levier.** Dans un rayon de 25 m autour du village, la forêt régénère **36 baies et 36 bois par jour** contre une demande de 19 et 3,5. Resserrer l'offre n'enverrait personne voyager : cela affamerait le village, ou rendrait le monde stérile.

**Les agents n'exploitent que 0,2 % du monde.** Sur huit jours, cinq buissons sur 589 et cinq chênes sur 1 557, jamais au-delà de 24 m. Ils ont pourtant 2 166 objets à portée et 400 m à parcourir.

Ce qui manque n'est pas la matière : c'est une raison d'en vouloir davantage.

## 2. Le principe directeur

> **L'outil multiplie le travail ; il ne le conditionne jamais.**

Une lame de silex fait rendre trois fois plus qu'une main nue. Elle n'autorise rien : on peut toujours ramasser du bois mort sans elle.

Ce choix n'est pas de confort. Il découle de trois faits établis :

- **Mode-2 n'est pas fiable comme dépendance vitale.** Il est plafonné par un budget, dépend d'un service externe, et le modèle local — quand il est activé — rend parfois de la prose au lieu du JSON demandé. Un monde où la survie exige une délibération est un monde qui meurt quand le réseau tombe.
- **Un signal scalaire vaut mieux qu'un binaire.** « L'agent qui prévoit produit trois fois plus » se mesure ; « l'agent qui ne prévoit pas ne peut rien faire » ne se gradue pas. Pour comparer deux modèles sur le même monde, il faut une échelle, pas une porte.
- **Mode-1 ne chaîne que sur trois niveaux**, amortis de 0,7 par étage. Concevoir le monde autour de cette limite reviendrait à graver une contrainte d'implémentation dans le contenu.

## 3. Deux verbes plutôt qu'un multiplicateur

Un multiplicateur d'outil exigerait des effets conditionnels dans le moteur — les affordances déclarent aujourd'hui des effets fixes. Le même résultat s'obtient **sans toucher au moteur**, par deux affordances distinctes sur le même objet :

| Objet | Verbe | Précondition | Effets |
| :--- | :--- | :--- | :--- |
| `oak_tree` | `gather_wood` *(existant)* | — | `woodLeft −1`, `wood +1` |
| `oak_tree` | **`fell_tree`** | `woodLeft ≥ 3`, `flint_blade ≥ 1` | `woodLeft −3`, `wood +3`, `flint_blade −1` |
| `hunting_ground` | `hunt` *(existant)* | `gameLeft > 0` | `gameLeft −1`, `meat +1` |
| `hunting_ground` | **`hunt_spear`** | `gameLeft > 0`, `spear ≥ 1` | `gameLeft −1`, `meat +3`, `spear −1` |
| `river_bank` | **`craft_spear`** | `flint_blade ≥ 1`, `wood ≥ 1` | `spear +1`, `flint_blade −1`, `wood −1` |
| `river_bank` | `knap_flint` *(modifié)* | `flint ≥ 1` | `flint_blade +3`, `flint −1` |

Mode-1 note déjà les deux variantes et retient la mieux notée : quand l'agent tient une lame, abattre l'emporte de lui-même.

**La précondition `woodLeft ≥ 3` n'est pas un détail.** `applyAffordance` borne les états à zéro, ce qui protège l'objet mais non le bilan : sans elle, un chêne où il ne reste que deux bois en rendrait trois. La matière se créerait à partir de rien, et le monde cesserait d'être une comptabilité honnête. La règle vaut pour toute affordance qui prélève plus d'une unité.

**Ce n'est pas un contournement.** Ramasser du bois mort et abattre un arbre *sont* deux actions différentes — l'une possible à mains nues, l'autre non. Le modèle du monde y gagne en vérité.

## 4. L'usure, sans état nouveau

Une lame n'a pas besoin d'un compteur de durabilité : **`flint_blade` est ce compteur.** Un rognon de silex donne trois lames — ce qui est littéralement vrai de la taille du silex — et chaque abattage en consomme une.

Aucun champ d'état supplémentaire, aucun objet d'inventaire à structure. L'inventaire reste un `Record<string, number>`.

C'est l'usure qui crée la demande **récurrente** que la rareté seule ne produisait pas : abattre renvoie tailler, tailler renvoie au silex, et les trois gisements sont dans le village. Quand ils s'épuiseront, il faudra aller voir ailleurs.

## 5. La prédiction centrale, et elle est inconfortable

`knap_flint` et `craft_spear` n'ont **aucun effet sur un besoin**. Dans Mode-1, leur gain propre est nul : ils n'apparaissent qu'en tant que fournisseurs d'une chaîne. Or la chaîne du javelot compte cinq étages —

```
faim → eat_meat → hunt_spear → craft_spear → gather_wood / knap_flint → gather_flint
```

— quand Mode-1 s'arrête à trois.

**Donc, en réflexe pur, aucun outil ne sera jamais fabriqué.** C'est la conséquence assumée du §2, et c'est la prédiction que ce sous-projet met à l'épreuve :

> Un village qui délibère fabrique des outils et produit davantage. Un village qui ne fait que réagir survit sans jamais en fabriquer.

Si cette prédiction se vérifie, E3 livre au projet sa première mesure de ce que vaut le raisonnement d'un modèle, **en unités du monde**. Si elle échoue — parce que les modèles disponibles ne savent pas planifier cinq étapes — l'échec est lui-même le résultat, et il est publiable.

Le risque à nommer : **du contenu que personne n'exerce** tant qu'aucune délibération ne tourne. La chaîne du bois l'atténue, étant plus courte que celle du javelot, mais elle ne l'annule pas.

## 6. La capacité d'inventaire

`INVENTORY_CAPACITY` vaut 10, tous objets confondus. Trois lames, un javelot, du bois et des baies s'en approchent. La capacité n'est pas modifiée : si elle mord, c'est un arbitrage de plus à faire pour l'agent, et un fait à mesurer — pas un obstacle à écarter d'avance.

## 7. Surface de régression assumée

| Ce qui bouge | Conséquence |
| :--- | :--- |
| `knap_flint` rend 3 lames au lieu de 1 | Aucun appelant existant : `flint_blade` n'était consommé par personne |
| Deux affordances par objet | `availableAffordances` en rend davantage ; Mode-1 note deux candidats là où il en notait un |
| Coût de `selectAction` | Croît avec le nombre d'affordances par objet cru, non avec le nombre d'objets. Six affordances de plus au catalogue, à mesurer plutôt qu'à supposer |
| Narration | `fell_tree`, `hunt_spear`, `craft_spear` doivent avoir leur phrase française, sans quoi le HUD affichera le verbe brut — le défaut déjà visible sur `hunt` et `eat_meat` |
| Instantanés déterministes | Le déterminisme tient ; les références changent |

## 8. Tests

- **Les deux voies coexistent** : à mains nues le bois se ramasse toujours ; avec une lame, abattre rend trois fois plus et consomme la lame.
- **Aucun verbe outillé n'est atteignable sans son outil**, et la précondition le dit.
- **L'usure ferme la boucle** : trois abattages épuisent un rognon de silex.
- **RIEN NE SE CRÉE** : sur un chêne où il reste moins de trois bois, `fell_tree` se refuse, et la somme prélevée n'excède jamais la somme disponible. C'est l'invariant que le bornage à zéro masquerait.
- **Mode-1 préfère l'outil quand il l'a**, et le bois mort quand il ne l'a pas.
- **La prédiction du §5** : en réflexe pur, sur huit jours simulés, aucun `craft_spear` ni `knap_flint` achevé. Ce test fige un comportement *voulu*, et il devra être révisé le jour où Mode-1 chaînera plus profond.
- **Le budget par tick tient**, mesuré comme pour E1 : une journée simulée reste très en deçà de son plafond.

## 9. Hors périmètre

- **Pas d'arbre technologique**, pas de livre de recettes, pas d'interface d'artisanat, pas d'établi.
- **Pas de structure coûteuse** (séchoir, grenier). Elle viendra avec E4, quand il y aura plus de bouches : une grande construction crée une bouffée de demande, pas une demande durable.
- **Pas de modification de Mode-1.** Sa profondeur de chaînage reste à trois : la déplacer changerait l'équilibre de tout le moteur, et ce sous-projet est justement conçu pour ne pas en dépendre.
- **Pas de qualité d'outil** (une lame émoussée qui rend moins). L'usure est binaire : la lame sert, puis elle est consommée.
