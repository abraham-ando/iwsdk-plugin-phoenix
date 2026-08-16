# Environnement procédural ECS — Design

**Date :** 2026-08-16
**Statut :** Validé (conception approuvée section par section)
**Objet :** Reconstruire l'environnement de la démo — terre, ciel, mer, rivière, flore, faune, matériels de civilisation — en Three.js procédural, structuré selon le pattern ECS, dans un nouveau paquet `packages/world`, avec deux paliers de qualité (casque autonome / desktop) et un monde streamé à l'échelle kilométrique.

**Référence externe :** `docs/research/THREE_ECOSYSTEM_ENVIRONMENT.md` (bibliothèques évaluées, licences, compatibilité, glossaire des concepts atmosphériques).

---

## 1. Diagnostic de l'existant

L'environnement visuel actuel **n'est pas en ECS** :

- `PrehistoricEnvironment3D.ts` construit un arbre monolithique de 407 lignes en `new Group()`, attaché par `(world as any).scene?.add?.()` dans `index.ts`.
- Les entités ECS ne servent qu'à porter des **colliders physiques invisibles** posés à côté des visuels. Il existe donc **deux mondes parallèles** — groupes Three.js visibles et entités ECS physiques — corrélés seulement par leurs coordonnées.
- C'est l'anti-pattern que le `CLAUDE.md` du projet interdit explicitement : « Create entities with `world.createTransformEntity(...)`, never `scene.add()` ».
- `apps/demo/src/components.ts` ne déclare qu'un seul composant (`Robot`) : rien de l'environnement n'est interrogeable par un système ni éditable dans l'éditeur IWSDK.
- Les matériaux sont des `MeshStandardMaterial({ color, roughness })` à couleur plate — aucune texture, aucun relief de surface.
- `CelestialVisuals.ts` réimplémente un dôme de ciel (sphère `BackSide` de 90 m) **moins bon que la primitive `DomeGradient` native d'IWSDK**, et ne fournit **aucun éclairage image-based (IBL)** — raison principale pour laquelle des matériaux PBR paraîtraient plats.

Volume concerné : environ 1 300 lignes de code impératif dans `apps/demo/src/simulation/`.

## 2. Décisions structurantes (validées)

| Décision | Choix retenu |
| :--- | :--- |
| Cible de rendu | **Les deux**, avec paliers de qualité `low` / `high` détectés à l'exécution |
| Échelle du monde | **Monde streamé 1 km+**, tuiles, biomes multiples, mer navigable |
| Priorité de réalisme | **Matière & lumière** d'abord |
| Stratégie | **Approche A** : socle ECS d'abord, avec le rig ciel/lumière comme première charge utile |
| Découpage en paquets | **Un paquet `packages/world`, modules étanches**, extraction ultérieure quand une couture sera stable |
| Écologie (populations autonomes, artisanat, démographie) | **Sous-projet distinct**, spécification séparée, traitée après celle-ci |

## 3. Architecture

```text
packages/simulation  (existant, enrichi)   maths pures, zéro Three.js — VÉRITÉ TERRAIN
  └── terrain/       heightAt, slopeAt, isWaterAt, depthAt, biomeAt, scatterAt

packages/world       (nouveau) @iwsdk/cardinal-world — rendu d'environnement
  ├── core/          service de qualité, helpers d'installation ECS, WorldStats
  ├── materials/     MaterialLibrary (génération PBR procédurale, cache, dispose)
  ├── atmosphere/    CelestialTime, SkyModel, StarField + systèmes
  ├── terrain/       TerrainTile, streaming, maillage, LOD
  ├── water/         WaterBody (mer et rivière)
  ├── flora/         génération ez-tree, instanciation par biome
  ├── fauna/         projection des vues d'animaux, nuées d'ambiance
  └── objects/       SmartObjectVisual (matériels de civilisation)

apps/demo            composition seulement : installCardinalWorld(world, { quality })
```

**Trois frontières, trois responsabilités :**

1. **`packages/simulation`** garde la vérité terrain et s'enrichit, en maths pures. Les agents marchent sur ce relief, le rendu ne fait que le mailler. Briser cette discipline ferait flotter les agents au-dessus du sol.
2. **`packages/world`** possède tout le rendu. Il dépend de `@iwsdk/core` en **peer dependency** — jamais de `three` en direct (override `three: npm:super-three@0.181.0`, garde-fou `scripts/check-single-three.mjs`). Il suit le patron éprouvé de `packages/ai` : composants + systèmes installés par une fonction `installCardinalWorld(world, options)`.
3. **`apps/demo`** maigrit jusqu'à n'être plus que de la composition.

**Modules étanches, extraction différée.** Chaque module de `packages/world` possède sa fonction d'installation, ses tests et son API documentée. On extrait en paquets séparés lorsqu'une couture aura prouvé sa stabilité — les coutures naturelles étant *atmosphère*, *terrain & eau*, *vie*. Un découpage `sky` / `water` serait le pire possible : l'eau se dérive du champ de hauteur du terrain, pas du ciel.

## 4. Modèle ECS

**Composants déclarés par `packages/world` :**

| Composant | Porté par | Champs | Rôle |
| :--- | :--- | :--- | :--- |
| `CelestialTime` | racine du niveau | `hour` (0-24), `latitudeDeg`, `weather` | L'horloge, alimentée par la simulation |
| `SkyModel` | racine du niveau | `turbidity`, `rayleigh`, `mieCoefficient`, `mieDirectionalG`, `sunElevationDeg`, `sunAzimuthDeg`, `moonPhase`, `exposure`, `_needsUpdate` | Paramètres physiques de l'atmosphère |
| `StarField` | entité fille | `count`, `radius`, `opacity` | Ciel nocturne |
| `ProceduralMaterial` | entité de maillage | `materialId`, `tint`, `tiling` | Choix de matière, authorable et interrogeable |
| `TerrainTile` | entité de tuile | `tileX`, `tileZ`, `lod`, `_needsBuild` | Unité de streaming |
| `WaterBody` | entité d'eau | `kind` (`sea`/`river`), `level`, `flowX`, `flowZ`, `depthFade` | Corps d'eau |
| `SmartObjectVisual` | entité d'objet | `objectId`, `type` | Visuel piloté par l'état moteur |

**Systèmes, avec séparation stricte entre calcul et rendu :**

- **`CelestialTimeSystem`** — lit `CelestialTime`, calcule la position solaire réelle (élévation, azimut) depuis l'heure et la latitude, écrit dans `SkyModel`, lève `_needsUpdate`. Zéro Three.js : astronomie testable unitairement.
- **`SkyRenderSystem`** — sur `_needsUpdate`, évalue le modèle de diffusion atmosphérique et en dérive les couleurs et intensités de `DomeGradient` et `IBLGradient` (primitives natives d'IWSDK, posées sur la racine du niveau), la direction/couleur/intensité de la lumière solaire, et la couleur du brouillard. Le soleil bas rougit l'horizon **et** l'éclairage ambiant simultanément.
- **`StarFieldSystem`** — opacité suivant l'élévation solaire.
- **`TerrainStreamingSystem`** — maintient l'ensemble de tuiles voulu selon la position du joueur.
- **`TerrainMeshSystem`** — construit la géométrie des tuiles marquées, **au plus une par frame** ou dans un worker.
- **`WaterSystem`** — géométrie par tuile, uniformes animés, cibles de rendu selon le palier.
- **`SmartObjectVisualSystem`** — projette l'état moteur des objets proches sur leurs maillages.

**Contrainte de performance intégrée dès la conception :** régénérer l'IBL produit un PMREM (pré-filtrage de carte d'environnement), coûteux. Le système ne le régénère que lorsque l'élévation solaire a bougé d'au moins ~1°, à cadence réduite en palier `low`. Le dôme et la lumière directionnelle, quasi gratuits, suivent en continu.

**Service de qualité :** passé à l'installation (`installCardinalWorld(world, { quality: 'low' | 'high' })`, détecté par défaut), lu par chaque système via `configData`. Pas de faux composant singleton.

## 5. Matériaux PBR procéduraux et couleur

**`MaterialLibrary`** : registre indexé par identifiant (`rock`, `sand`, `grass`, `bark`, `hide`, `flint`, `clay`, `water`…) qui génère ses textures procéduralement à la première demande (albédo, normale, rugosité, occlusion) puis met le matériau en cache. Toutes les entités partagent l'instance — décisif pour le nombre d'appels de rendu et la mémoire GPU. La bibliothèque porte la responsabilité du `dispose`, là où le code actuel fuit à chaque `new MeshStandardMaterial`.

**Génération au démarrage plutôt qu'en shader.** Calculer le bruit dans le fragment shader donnerait un détail infini sans mémoire, mais à un coût ALU par pixel rédhibitoire sur GPU mobile. On génère donc des textures tuilables une fois au chargement, hors du thread principal.

| | `low` (Quest) | `high` (desktop) |
| :--- | :--- | :--- |
| Résolution de textures | 512 px | 1024–2048 px |
| Mapping des falaises | UV planaire | **triplanaire** (supprime l'étirement) |
| Couche de détail rapprochée | absente | normale de détail au second tuilage |
| Rafraîchissement IBL | rare | fréquent |

**Gestion des couleurs.** Espace colorimétrique de sortie explicite, tone mapping ACES Filmic, et **exposition reliée à celle du modèle de ciel** : le crépuscule assombrit la scène entière de façon cohérente. Les textures générées sont marquées dans le bon espace — albédo en sRGB, normale et rugosité en linéaire — erreur classique qui produit le rendu « lavé ».

## 6. Terrain, biomes et streaming

Le module `terrain/` de `packages/simulation` expose quatre fonctions pures, appelées à l'identique par le moteur et par le rendu :

- **`heightAt(x, z)`** — bruit fractal en couches : masque continental (terre/mer), crêtes en multifractale ridée, érosion approximée par lissage selon la pente, détail fin. Implémenté **sans dépendance externe** (le paquet en a zéro aujourd'hui, propriété préservée).
- **`isWaterAt(x, z)` / `depthAt(x, z)`** — niveau de la mer à zéro ; le masque continental dessine le littoral.
- **`biomeAt(x, z)`** — dérivé de l'altitude, de la pente, de la distance à la mer et d'un bruit d'humidité ; renvoie un biome et ses poids de mélange.
- **`slopeAt(x, z)`** — falaises, placement de végétation, navigation.

**Les biomes deviennent une donnée de simulation, pas une décoration.** Une fois `biomeAt` dans le moteur, les baies poussent où le biome est humide, le silex affleure où la roche est exposée, le gibier vit en lisière — au lieu d'être posés à la main dans `DEFAULT_VILLAGE`. La rareté que subissent les agents devient une conséquence de la géographie.

**Streaming en ECS :** chaque tuile est une entité `TerrainTile`. Anneau proche en pleine résolution, anneau moyen dégradé, maillage grossier lointain régénéré rarement pour l'horizon kilométrique. Les fissures entre niveaux de détail sont masquées par des **jupes verticales** en bordure de tuile — technique robuste et peu coûteuse.

**Risque de migration assumé :** changer le relief invalidera des tests moteur qui figent le terrain actuel (plateau plat à y=0, rivière en `x = 4 + sin(z·0,12)·3,5`) et surtout **les coordonnées de `DEFAULT_VILLAGE`**. Le nouveau générateur devra conserver un plateau habitable à l'origine avec accès à l'eau, faute de quoi les agents se retrouveraient dans une falaise ou sans rivière. La phase terrain inclut la revalidation du village.

## 7. L'eau : rivière et mer

Deux corps d'eau, une même famille de matériau. La mer est un plan au niveau zéro découpé par les tuiles visibles ; la rivière suit l'entaille du terrain et porte une direction d'écoulement.

**La profondeur est calculée par sommet, côté CPU, avec la fonction TypeScript partagée**, et stockée comme attribut de géométrie. Le poste le plus coûteux d'une eau réaliste sur mobile — la passe ou cible de rendu de profondeur — disparaît : le shader interpole l'attribut. Et surtout, **aucun risque de divergence**, contrairement à une réimplémentation du bruit en GLSL : l'eau et le terrain restent exacts l'un envers l'autre par construction.

| | `low` (Quest) | `high` (desktop) |
| :--- | :--- | :--- |
| Vagues | 2-3 ondes de Gerstner en vertex shader | Gerstner multi-octaves + ondulations locales |
| Réflexion | ciel via l'IBL, Fresnel de Schlick | réflexion planaire en cible de rendu |
| Réfraction | dégradé de couleur par profondeur | cible de réfraction avec distorsion |
| Caustiques | absentes | méthode des aires différentielles |
| Écume | ligne de rivage depuis la profondeur | écume dynamique sur crêtes et obstacles |

**Parades mobiles intégrées dès la conception** (documentées par `jeantimex/threejs-water` sur Safari iOS, même famille de contraintes que le navigateur Quest) : cibles en demi-flottant, filtrage *nearest*, effacement explicite des cartes de hauteur.

## 8. Flore et faune

**Flore.** Au chargement, quelques variantes par espèce sont générées via `@dgreenheck/ez-tree` (`new Tree()` + graine déterministe, `generateLODs()`), et l'on ne conserve que les géométries en cache — le paquet de 22,8 Mo est un outil d'atelier, pas une charge d'exécution. Ces géométries alimentent des **`InstancedMesh` par espèce et par niveau de détail**. Herbe et sous-bois restent instanciés autour du joueur seulement, densité dictée par le biome.

**Le semis appartient à la vérité terrain.** `scatterAt(tileX, tileZ)` dans `packages/simulation` renvoie de façon déterministe les positions et espèces d'une tuile (graine, biome, pente, bruit bleu). Le **moteur** y instancie les smart objects exploitables ; le **rendu** y instancie les maillages. Sans cela, les agents bûcheronneraient sur des arbres invisibles pendant que la forêt visible resterait inerte.

**La faune se scinde selon un critère net : compte-t-elle pour la simulation ?**

- **Faune de vérité terrain** — le loup (déjà un automate déterministe) et, à terme, les troupeaux d'herbivores. Ces animaux vivent dans le moteur, sérialisés et rejouables ; ils exposent des vues (`position`, `orientation`, `animation`) que le rendu projette, exactement comme les villageois. **Périmètre de la présente spécification : uniquement l'interface de projection** — le rendu sait afficher tout animal exposant une vue. La dynamique de population elle-même (natalité, broutage, prédation, migration) relève du sous-projet *écologie & subsistance* (§12) ; d'ici là, seul le loup alimente cette interface.
- **Faune d'ambiance** — oiseaux, poissons, insectes. Aucun agent n'interagit avec eux ; les faire entrer dans le moteur alourdirait la simulation et les snapshots pour rien. Ils restent côté rendu, animés par un système de nuées local.

**Animation procédurale** (cycles de pattes sinusoïdaux, oscillation du corps, orientation de la tête) plutôt que squelettage lourd — cohérent stylistiquement, quasi gratuit, sans dépendance à des assets.

## 9. Matériels de civilisation

Chaque type du catalogue moteur reçoit un visuel **dont l'apparence reflète l'état** :

| État moteur | Ce que l'on voit |
| :--- | :--- |
| `shelter.progress` 0 → 5 | perches → charpente → peaux tendues : la construction se voit avancer |
| `campfire.lit` / `fuel` | flamme présente et de taille variable, lumière et ombres portées |
| `berry_bush.berriesLeft` | densité de baies visibles |
| `camp_storage.berries/wood` | tas de provisions dont le volume suit la réserve |
| `flint_deposit.flintLeft` | affleurement entamé |

`three-bvh-csg` sert **au chargement** (ouvertures d'abris, lames de silex, affleurements sculptés), résultats mis en cache comme géométries statiques — jamais recalculés par frame.

## 10. Budget de performance et vérification

**Budget :** cible Quest 72–90 fps, soit 11–14 ms par frame. Plafonds explicites de l'ordre de **200 appels de rendu et 500 k triangles visibles** en palier `low`, tenus par l'instanciation systématique et la bibliothèque de matériaux partagée. Un affichage de diagnostic `WorldStats` (appels de rendu, triangles, tuiles actives, instances) rend le budget visible pendant le développement ; l'outillage metavr permet des traces Perfetto sur casque réel.

**Trois niveaux de vérification :**

1. **Fonctions pures en vitest** — relief, biomes, semis, position solaire, modèle de couleur du ciel, profondeur par sommet. Déterministe, sans GPU ni navigateur. C'est le gros du travail : le rendu se réduit à *appliquer* ces valeurs.
2. **Systèmes ECS** — testés avec un monde simulé, selon le patron déjà en place dans `packages/ai` (mock `@iwsdk/core` dans `test/mocks/`).
3. **Rendu réel** — build de la démo, captures via l'outillage IWSDK (`browser_screenshot` pour le runtime, le rendu éditeur n'exécutant pas les systèmes applicatifs), mesure de frame time.

## 11. Phasage

| Phase | Contenu | Livrable visible |
| :--- | :--- | :--- |
| **1. Socle + ciel** | Paquet `packages/world`, service de qualité, helpers ECS, `CelestialTime`/`SkyModel`/`StarField` + systèmes, IBL | Ciel physique avec diffusion atmosphérique et éclairage cohérent ; `CelestialVisuals.ts` supprimé |
| **2. Matériaux** | `MaterialLibrary`, génération PBR procédurale, gestion des couleurs et tone mapping, `ProceduralMaterial` | Roche, sable, herbe, écorce réagissant correctement à la lumière |
| **3. Terrain & streaming** | `terrain/` enrichi dans `packages/simulation`, tuiles, LOD, revalidation du village | Monde kilométrique parcourable, biomes visibles |
| **4. Eau** | Mer et rivière, profondeur par sommet, paliers | Littoral et rivière crédibles |
| **5. Flore** | ez-tree, `scatterAt` partagé, instanciation | Forêts réelles, cohérentes avec les smart objects |
| **6. Faune & matériels** | Projection des vues d'animaux (loup aujourd'hui, troupeaux quand l'écologie les fournira), nuées d'ambiance, `SmartObjectVisual` | Monde habité, constructions qui progressent |

Chaque phase supprime son équivalent legacy dans `apps/demo`. Au terme, `CelestialVisuals.ts`, `ProceduralTerrain.ts`, `ProceduralGrassField.ts`, `ProceduralVegetation.ts`, `ProceduralRiver.ts`, `PrehistoricEnvironment3D.ts`, `WolfVisual.ts` et `AgentAvatarFactory.ts` ont disparu.

## 12. Hors périmètre

- **Écologie & subsistance** (populations animales autonomes, chaînes d'artisanat, démographie des villageois) — sous-projet distinct, spécification séparée à traiter après celle-ci. La présente spécification fournit **l'interface d'accueil** : tout animal du moteur exposant une vue sera projeté par le rendu sans modification supplémentaire.
- **Nuages volumétriques** — raymarching avec amortissement et reconstruction temporelle : jouable en palier `high`, très risqué en VR autonome. Repli sur des nuages en couches en `low` ; à traiter comme un pari à instruire, pas comme un acquis.
- **Fracturation temps réel** (`@dgreenheck/three-pinata`) — installable et pertinente pour la taille du silex ou le bris de poterie, mais hors chemin critique et coûteuse en VR. Reportée.
- **Produits commerciaux `threejs-sky-pro` / `threejs-water-pro`** — écartés : licence propriétaire, et incompatibles sur trois plans (three ≥ 0.185 contre notre fork `super-three@0.181`, build WebGPU/TSL contre WebGL2, WebXR non documenté). Leur documentation publique sert de référentiel de concepts, implémentés depuis la littérature publique.
