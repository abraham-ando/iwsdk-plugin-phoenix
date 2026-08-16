# Écosystème Three.js pour l'environnement procédural — note de référence

**Date de relevé :** 2026-08-16
**Objet :** évaluer les bibliothèques et ressources externes proposées pour la modélisation réaliste de l'environnement (terre, ciel, mer, rivière, faune, matériels), et statuer sur leur compatibilité avec ce dépôt.

> Toutes les données de versions, licences et dépendances ci-dessous ont été **vérifiées** au registre npm (`registry.npmjs.org`) ou dans les dépôts, et non reprises de mémoire.

---

## 1. La contrainte qui décide de tout : une seule instance de Three

Ce dépôt impose une instance unique de Three.js :

```yaml
# pnpm-workspace.yaml
overrides:
  three: npm:super-three@0.181.0
```

`@iwsdk/core` réexporte tout Three ; importer `three` en direct crée une **seconde instance**, et les vérifications `instanceof` échouent d'un exemplaire à l'autre (le script `scripts/check-single-three.mjs` monte la garde).

**Conséquence pratique :** une bibliothèque tierce n'est utilisable ici que si elle déclare `three` en **`peerDependency`**. Elle reçoit alors l'instance du projet au lieu d'embarquer la sienne.

**Preuve que le mécanisme fonctionne :** `three-mesh-bvh@0.9.14` est déjà installé, résolu contre `super-three@0.181.0` (chemin pnpm `three-mesh-bvh@0.9.14_super-three@0.181.0`).

Second garde-fou : la cible Quest autonome tourne en **WebGL2 sous WebXR**. Toute bibliothèque exigeant `WebGPURenderer` est hors jeu pour cette cible.

---

## 2. Verdicts

| Bibliothèque | Version | Licence | `three` | Compatible ici | Verdict |
| :--- | :--- | :--- | :--- | :---: | :--- |
| [`@dgreenheck/ez-tree`](https://github.com/dgreenheck/ez-tree) | 1.1.0 | MIT | peer `>=0.167` | ✅ | **Adopter** (phase flore) |
| [`three-bvh-csg`](https://github.com/gkjohnson/three-bvh-csg) | 0.0.18 | MIT | peer `>=0.179` + `three-mesh-bvh >=0.9.7` | ✅ | **Adopter** (génération d'assets hors ligne) |
| [`@dgreenheck/three-pinata`](https://github.com/dgreenheck/three-pinata) | 2.0.1 | MIT | peer `>=0.158` | ✅ | **Évaluer plus tard** (taille de silex, bris) |
| [`jeantimex/threejs-water`](https://github.com/jeantimex/threejs-water) | — (dépôt de démo) | MIT | — | ⚠️ | **Source d'inspiration** — à porter, pas à installer |
| `threejs-sky-pro` | — | **Commerciale, tous droits réservés** | three `>=0.185` + **WebGPU** | ❌ | **Écarter** — mais sa doc sert de référentiel de concepts |
| `threejs-water-pro` | — | **Commerciale, tous droits réservés** | three `>=0.185` + **WebGPU** | ❌ | Idem |

---

## 3. Détail par ressource

### 3.1 `@dgreenheck/ez-tree` — générateur d'arbres procéduraux ✅

- **Installation :** `pnpm add @dgreenheck/ez-tree` (MIT, peer `three >=0.167` → compatible super-three 0.181).
- **API :** classe `Tree` ; `tree.options.seed = 12345` puis `tree.generate()`. `tree.loadPreset('Ash Medium')` applique un préréglage. `createGeometry(detail)` renvoie les géométries brutes `{ branches, leaves }`.
- **LOD intégré :** `generateLODs()` construit un `THREE.LOD` multi-niveaux qui bascule selon la distance caméra en préservant la silhouette — précieux pour un monde kilométrique.
- **Paramètres :** type et texture d'écorce, niveaux/angles/longueurs de branches, propriétés des feuilles, forces de croissance.
- **Point de vigilance :** **22,8 Mo dépaquetés** (textures et préréglages). À traiter comme un outil de *génération*, pas comme une dépendance d'exécution embarquée telle quelle : on génère les géométries au chargement (ou hors ligne) et l'on n'expédie que ce qu'on utilise.
- **Usage retenu :** remplacer `ProceduralVegetation.createOakTree/createCypressTree` (arbres en sphères et cylindres) par de vraies structures branchues, instanciées par biome, avec les LOD d'ez-tree.

### 3.2 `three-bvh-csg` — opérations booléennes de géométrie ✅

- **Installation :** `pnpm add three-bvh-csg` (MIT ; ses deux pairs, `three` et `three-mesh-bvh@0.9.14`, sont déjà satisfaits).
- **API :** `Evaluator` (`evaluate()`, `evaluateHierarchy()`), objets `Brush`, opérations `ADDITION`, `SUBTRACTION`, `INTERSECTION` et variantes creuses.
- **Performance :** annoncée « plus de 100× plus rapide » que les CSG à BSP ; bibliothèque toutefois **marquée expérimentale** (limites connues sur la découpe de triangles et la précision numérique).
- **Usage retenu :** **génération d'assets au chargement, jamais par frame** — creuser des abris dans la roche, tailler des outils de silex, percer des ouvertures, sculpter des reliefs de falaise. Résultat mis en cache comme géométrie statique. Attention : les résultats CSG utilisent `Geometry.drawRange`, à convertir avant export.

### 3.3 `@dgreenheck/three-pinata` — fracturation temps réel ⚠️

- **Installation possible** (MIT, peer `three >=0.158`), 0,32 Mo.
- **API :** `DestructibleMesh` étendant `THREE.Mesh` — `fracture(options, onFragment?, onComplete?)`, `slice(sliceNormal, sliceOrigin, …)`, `sliceWorld()`. Fracturation **Voronoï à l'exécution**.
- **Recommandations de l'auteur :** 10 à 50 fragments pour de bonnes performances, préférer le mode 2.5D au 3D, réserver le mode approximatif au-delà de 50 fragments, et **dépeupler les fragments une fois la physique stabilisée**.
- **Pertinence ici :** la taille du silex (`knap_flint`) et le bris de poterie sont des cas d'usage naturels. **Reporté** : ce n'est pas le chemin critique du réalisme, et le budget VR ne pardonne pas la fracturation temps réel.

### 3.4 `jeantimex/threejs-water` — simulation d'eau ⚠️ (inspiration)

Dépôt de **démonstration** (pas un paquet npm), MIT, port du WebGL Water d'Evan Wallace. Techniques directement transposables :

- **Caustiques** par « méthode des aires différentielles » : la luminosité vient du rapport entre l'aire d'origine et l'aire projetée des rayons.
- **Réflexion/réfraction** mélangées par **Fresnel (approximation de Schlick)**, selon l'angle de vue.
- **Ondes** : équation d'onde 2D résolue sur GPU par laplacien discret en **ping-pong de buffers**.
- **Avertissement mobile explicite :** artefacts sur **iOS Safari** (eau zébrée, surface opaque, réfractions brûlées) dus aux limites de précision WebGL ; parades documentées — effacement explicite de la carte de hauteur, filtrage *nearest*, repli en cibles de rendu *half-float*. **À prendre au sérieux pour la cible Quest.**

### 3.5 `threejs-sky-pro` et `threejs-water-pro` ❌ (concepts seulement)

- **Licence commerciale « tous droits réservés »** (DRG Software Solutions LLC, 2025–2026), vendus sur [threejsroadmap.com](https://threejsroadmap.com/assets) ; livraison par copie de fichiers, remboursement sous 14 jours **avant** téléchargement.
- **Incompatibles avec notre pile sur trois plans :** exigent `three r0.185+` (nous sommes sur le fork `super-three@0.181`), la **build WebGPU** et le pipeline **TSL**, alors que Quest tourne en WebGL2 ; le WebXR n'est mentionné nulle part dans leur documentation.
- **Ce qu'on en retient :** leur documentation publique constitue un excellent **référentiel de concepts à implémenter nous-mêmes** depuis la littérature publique (Preetham, Hosek-Wilkie, Bruneton pour l'atmosphère ; Schneider pour les nuages). On s'inspire des *idées documentées*, jamais de leur code propriétaire.

**API `SkySystem` (pour information, comme modèle d'ergonomie) :** création par `create(renderer, camera, scene)` ; composants `atmosphere` (turbidité, exposition), `sun` (direction, intensité, couleur, taille du disque), `nightSky` (lune, étoiles), `timeOfDay`, `clouds`, `godRays` ; méthodes `update(dt)`, `applyTo(sceneColor, scenePass)`, `applyPreset()`, `cloudShadow(worldPos)`, `createSkyProvider()`, `createEnvironmentMap()`, `setQualityLevel()`, `setCloudAmortization()`. **Quatre paliers de qualité** (low / medium / high / ultra) — la même idée que nos paliers, ce qui conforte notre choix d'architecture.

---

## 4. Glossaire des concepts à implémenter

Relevé depuis le [glossaire Sky Pro](https://docs.threejsskypro.com/glossary.html), reformulé — ce sont des notions publiques de rendu atmosphérique.

| Concept | Définition retenue |
| :--- | :--- |
| **Turbidité** | Concentration en aérosols. Plus elle est haute, plus l'air est brumeux et les couleurs désaturées. |
| **Diffusion de Rayleigh** | Diffusion à l'échelle moléculaire : les courtes longueurs d'onde (bleu) diffusent davantage — d'où le ciel bleu de jour et rouge au couchant. |
| **Diffusion de Mie** | Diffusion par les aérosols : produit le halo lumineux autour du soleil. Réglée par turbidité, biais directionnel et intensité. |
| **Élévation / azimut** | Coordonnées angulaires du soleil : élévation = angle au-dessus de l'horizon (0° au lever/coucher, 90° au zénith) ; azimut = rotation horizontale. |
| **Exposition** | Multiplicateur de luminosité appliqué **avant** le tone mapping et le bloom. |
| **Perspective aérienne** | Atténuation et bleuissement des objets lointains par la masse d'air — le repère de profondeur le plus fort dans un paysage. |
| **Couverture / densité** (nuages) | Couverture = proportion de ciel nuageux (0-1) ; densité = opacité et noirceur. |
| **Érosion de détail** | Bruit haute fréquence rongeant les bords de nuages pour des silhouettes vaporeuses. |
| **Diffusion multiple** | Approximation du rebond répété de la lumière dans un nuage : éclaircit l'intérieur et les dessous. |
| **Amortissement** (*amortization*) | Optimisation temporelle : le *raymarching* est réparti sur plusieurs frames par blocs (1×1, 2×2, 4×4) — on échange de la réactivité contre du budget. |
| **Reconstruction temporelle** | Combinaison des échantillons de la frame courante avec l'historique reprojeté, à résolution réduite. |
| **God rays** (rayons crépusculaires) | Puits de lumière volumétrique issus de la source active, respectant l'occlusion par la géométrie. |

---

## 5. Ce qui en découle pour notre conception

1. **Le ciel se construit sur les primitives IWSDK.** `DomeGradient` (dôme procédural en espace de clip) et `IBLGradient` (éclairage image-based) existent déjà dans `@iwsdk/core` et se posent sur la racine du niveau. Notre modèle de diffusion atmosphérique alimente leurs couleurs et intensités plutôt que de réimplémenter un dôme — ce que fait aujourd'hui `CelestialVisuals`, en moins bien et **sans IBL**.

2. **Les nuages volumétriques sont un pari, pas un acquis.** Raymarching + amortissement + reconstruction temporelle est jouable sur desktop, très risqué en VR autonome. À traiter comme un effet réservé au palier `high`, avec repli sur des nuages en couches (billboards ou dôme texturé animé) en `low`.

3. **L'eau demande deux implémentations.** En `high` : réflexion planaire, réfraction, caustiques, écume. En `low` : normal maps animées, Fresnel, profondeur par gradient de couleur — sans cible de rendu supplémentaire. Les avertissements iOS/mobile de `threejs-water` valent aussi pour le navigateur Quest.

4. **CSG et arbres procéduraux sont des outils de *génération*, pas de rendu.** On les exécute au chargement (ou hors ligne, à la construction), on met en cache les géométries, et le rendu par frame ne voit que des maillages statiques instanciés.

---

## Sources

- [dgreenheck/ez-tree](https://github.com/dgreenheck/ez-tree)
- [gkjohnson/three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg)
- [dgreenheck/three-pinata](https://github.com/dgreenheck/three-pinata)
- [jeantimex/threejs-water](https://github.com/jeantimex/threejs-water)
- [Three.js Sky Pro — documentation](https://docs.threejsskypro.com/) · [API SkySystem](https://docs.threejsskypro.com/api/sky-system.html) · [glossaire](https://docs.threejsskypro.com/glossary.html) · [installation](https://docs.threejsskypro.com/guide/installation.html)
- [Three.js Water Pro — documentation](https://docs.threejswaterpro.com/) · [page produit](https://threejsroadmap.com/assets/threejs-water-pro)
- [Three.js Roadmap — assets](https://threejsroadmap.com/assets)
