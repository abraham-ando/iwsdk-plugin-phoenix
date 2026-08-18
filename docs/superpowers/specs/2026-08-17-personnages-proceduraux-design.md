# Personnages procéduraux et hérédité — Design

**Date :** 2026-08-17
**Statut :** Validé (conception approuvée section par section)
**Objet :** Construire un système de personnalisation d'êtres vivants — humains et faune — dont la morphologie est décrite par un génome héritable, compilée une fois à l'instanciation en géométrie correcte, éditable par des panneaux spatiaux UIKitML, et persistée dans le snapshot déterministe de `cardinal-simulation`.

**Origine :** spécification externe « Personnalisation 3D Hybride et Procédurale avec Meta IWSDK ». La section 2 recense ce qui en a été retenu, corrigé ou écarté, et pourquoi.

**Reprend un hors-périmètre antérieur :** la spec `2026-08-15-simulation-engine-design.md` excluait explicitement « reproduction/génétique simulée » et la spec `2026-08-16-environnement-procedural-ecs-design.md` renvoyait la « démographie des villageois » à un sous-projet distinct. C'est celui-ci.

---

## 1. Diagnostic de l'existant

Le dépôt ne part pas de zéro sur les avatars, et le nouveau système doit se brancher sur ce qui existe plutôt qu'à côté.

- `packages/ai/src/avatar/AvatarMeshBinder.ts` résout déjà, par **recherche de noms tolérante à plusieurs conventions** (RPM, Mixamo, VRM, ARKit), les os de tête, cou et yeux ainsi que les morph targets de visèmes. C'est le germe du contrat de rig de ce design : sa méthode est généralisée, pas remplacée.
- `packages/ai/src/avatar/RPMAvatarRig.ts` construit une hiérarchie humanoïde complète en code, avec un `nodeFactory` injectable qui la rend testable sans Three.
- `apps/demo/src/simulation/AgentAvatarFactory.ts` est un placeholder assumé : cylindre plus sphère, avec un commentaire annonçant son remplacement. Il disparaît à l'étape 3 de ce design.
- `packages/world` fournit `MaterialLibrary`, une bibliothèque de matériaux PBR procéduraux partagés, avec gestion des couleurs et tone mapping déjà établis sur trois phases. Les teintes de peau, de cheveux et de vêtement passent par elle.
- `packages/ai` fournit `AILODSystem`, qui donne une prise immédiate sur le coût des personnages lointains.
- `packages/simulation` fournit un `Rng` seedé, un journal d'événements rejouable et `snapshotSim`/`restoreSim`. Le génome y trouve son domicile naturel.

## 2. Corrections apportées à la spécification d'origine

Chaque affirmation ci-dessous a été vérifiée contre le code réellement présent dans ce dépôt, pas contre un souvenir de l'API.

| Affirmation d'origine | Réalité | Conséquence |
| :--- | :--- | :--- |
| `entity.get(Component)` | **Zéro occurrence** dans le dépôt ; l'API est `entity.getValue(C, 'champ')`, utilisée 326 fois. `setValue` **lève** sur les champs vecteurs en elics 3.4.x. | Tout le code de systèmes est réécrit sur l'API réelle. |
| `Types.Integer` | N'existe pas. Le jeu réel est `Float32/64`, `Int8/16/32`, `Boolean`, `String`, `FilePath`, `Vec2/3/4`, `Color`, `Entity`, `Enum`, `Object`. | Les styles de cheveux deviennent des `Types.Enum`, ce qui rend l'inspecteur meilleur que prévu. |
| « Meta Spatial Editor » | C'est l'outil du Spatial SDK Android. IWSDK a son propre éditeur managé (`iwsdk dev up`). | Le vocabulaire est corrigé partout ; le pilotage IA change de mécanisme (§9.4). |
| « exposées automatiquement en curseurs » | Vrai, mais uniquement si le composant figure dans le `defineComponents()` **de l'application**. Les métadonnées `label`, `min`, `max`, `step`, `enum`, `help`, `widget` pilotent l'inspecteur. | Une partie de « l'éditeur » demandé est déjà fournie. Le paquet d'UI est redimensionné en conséquence (§9). |
| `bone.scale.y = torsoHeight` | **Ne fonctionne pas.** Un `Bone` est un `Object3D` : l'échelle descend dans toute la chaîne, donc allonger le buste allonge la tête et les bras. Une échelle non uniforme dans une chaîne d'os rotés produit du cisaillement au skinning et casse les normales. | Remplacé par le compilateur à translations d'os (§7). C'est la correction structurante de ce design. |
| `getObjectByName()` dans `update()` | Une recherche d'arbre par chaîne, par entité, par frame. Exactement ce que le budget de 11,1 ms interdit. | Résolution unique à la liaison, conservée dans une `Map` possédée par le système (§8). |
| `ShaderMaterial` brut avec `gl_FragColor` | Perd l'IBL, les ombres, le tone mapping et la gestion des couleurs que `packages/world` a mis trois phases à établir. | Extension de `MeshStandardMaterial` via `onBeforeCompile`, ou entrée supplémentaire dans `MATERIAL_DEFINITIONS`. |
| « millions de combinaisons » | Exact, mais chaque individu unique impose son propre `Skeleton` et son propre matériau, et un `SkinnedMesh` ne s'instancie pas dans Three. | Le partage est explicité et budgété (§7.3, §11). |

## 3. Décisions structurantes (validées)

| Décision | Choix retenu |
| :--- | :--- |
| Consommateurs visés | **Les quatre** : villageois Cardinal, créateur d'avatar joueur, paquet réutilisable, atelier d'auteur — superposés, pas concurrents |
| Portée « variante d'armature » | **Familles de squelettes distinctes**, une par type d'être vivant |
| Retargeting inter-familles | **Non requis** : chaque famille possède ses propres clips. Ce qui se partage est le contrat de description, pas l'animation |
| Modèle de données | **Génome de gènes normalisés `[0,1]`**, mélangeable, avec hérédité réelle et persistance |
| Âge | **Paramètre d'évaluation, pas un gène.** `expressAt(genome, âge)` applique des courbes de proportion |
| Stratégie de déformation | **Approche A — compilateur**, avec ligne de partage par type de canal : morphs continus, longueurs d'os recompilées |
| Sources d'assets | **Indifférente** : Blender-MCP, Ready Player Me, sculpture manuelle et procédural TypeScript satisfont le même contrat |
| Découpage | **Trois paquets** : noyau pur, pont Three, panneaux spatiaux |
| Surface de l'IA | L'IA écrit des **génomes**, jamais du code, jamais des os |

## 4. Architecture

```text
packages/character        @iwsdk/cardinal-character        PUR — ni Three, ni IWSDK
  ├── family/             descripteur de famille, alias d'os, courbes de proportion
  ├── genome/             gènes, expression, hérédité, sérialisation
  └── compile/            compilateur : génome + âge + liaison → CompiledCharacter

packages/character-three  @iwsdk/cardinal-character-three  PONT
  ├── binding/            résolution d'un glTF contre un descripteur, rapport d'import
  ├── apply/              application de la pose, morphs, matériaux
  ├── components/         CharacterIdentity, Structure, Face, Surface, Selection
  └── systems/            CharacterCompileSystem (60), CharacterExpressionSystem (70)

packages/character-ui     @iwsdk/cardinal-character-ui     PANNEAUX SPATIAUX
  ├── router/             CharacterUIRoute — la navigation qu'IWSDK ne fournit pas
  ├── panels/             réglages, persona, archétypes, hérédité (UIKitML)
  └── mount/              adaptateur de montage, isolant le chemin IWSDK retenu

packages/character/presets/   archétypes versionnés, commités, testés
```

Le sens des dépendances est strict et non négociable : `character` ne connaît personne, `character-three` connaît `character` et `@iwsdk/core`, `character-ui` connaît les deux. Aucune flèche ne remonte.

## 5. Le contrat de famille

Chaque famille d'êtres vivants est décrite **une fois**, en données pures. Rien dans le système ne connaît un nom d'os en dur.

```ts
export const HUMANOID: FamilyDescriptor = {
  id: 'humanoid',

  // Rôle sémantique → alias acceptés. C'est ce qui rend le système indifférent
  // à la source : RPM, Mixamo, Blender-MCP ou TypeScript procédural satisfont
  // le même contrat. AvatarMeshBinder fait déjà exactement cela pour les
  // visèmes — on généralise sa méthode plutôt que d'en inventer une seconde.
  bones: {
    root:      ['Root', 'Hips', 'mixamorig:Hips', 'Armature'],
    spine:     ['Bone_Spine', 'Spine', 'mixamorig:Spine'],
    chest:     ['Bone_Chest', 'Spine2', 'Chest'],
    neck:      ['Neck', 'mixamorig:Neck'],
    head:      ['Head', 'mixamorig:Head', 'j_bip_c_head'],
    shoulderL: ['Bone_Clavicle_L', 'LeftShoulder'],
    upperArmL: ['Bone_Arm_L', 'LeftArm', 'mixamorig:LeftArm'],
    // … le miroir droit et les membres inférieurs suivent la même forme
  },

  // Une longueur n'a de sens que LE LONG d'une chaîne, jamais sur un axe monde.
  chains: {
    arm:   { from: 'shoulderL', to: 'handL', mirror: true },
    leg:   { from: 'upLegL',    to: 'footL', mirror: true },
    torso: { from: 'root',      to: 'neck',  mirror: false },
  },

  morphs: {
    jawWidth: { aliases: ['jawWidth', 'Jaw_Width'], range: [-1, 1] },
    noseSize: { aliases: ['noseSize', 'Nose_Size'], range: [-1, 1] },
    bodyMass: { aliases: ['bodyMass', 'Corpulence'], range: [0, 1] },
  },

  // Ce qui rend un bébé crédible plutôt qu'un adulte réduit : le rapport
  // tête/corps passe d'environ 1:4 à la naissance à 1:7,5 à l'âge adulte.
  // Aucune combinaison d'échelles d'os ne produit cela.
  proportions: {
    headToBody:  [[0, 0.250], [3, 0.200], [12, 0.150], [18, 0.133]],
    limbToTorso: [[0, 0.620], [12, 0.880], [18, 1.000]],
  },

  slots: { rightHand: 'handR', leftHand: 'handL', back: 'chest', head: 'head' },

  // Le catalogue de gènes appartient à la famille, et à elle seule. Un cerf
  // n'a pas les mêmes gènes qu'un humain, et il n'existe pas de second endroit
  // où une règle d'hérédité pourrait diverger de sa définition.
  genes: {
    stature:       { group: 'structure', heritability: 0.9, dominance: 0.5, mutationRate: 0.04 },
    shoulderWidth: { group: 'structure', heritability: 0.8, dominance: 0.6, sexLinked: 'm',
                     mutationRate: 0.05 },
    jawWidth:      { group: 'face',      heritability: 0.7, dominance: 0.5, mutationRate: 0.06 },
    skinTone:      { group: 'surface',   heritability: 0.95, dominance: 0.5, mutationRate: 0.02 },
    // … une entrée par gène, environ trente pour `humanoid`
  },
};
```

**Règle de validation.** Un asset qui n'honore pas le contrat est **rejeté à l'import, avec la liste précise de ce qui manque** — jamais dégradé en silence. La leçon est celle de `RoomChannel` compilé conditionnellement : un échec silencieux qui laisse la vérification verte coûte plus cher qu'un rejet bruyant.

Familles prévues à ce stade : `humanoid`, `canid` (le loup existe déjà dans `WolfSystem`), `cervid`. La liste est ouverte : ajouter une famille est une donnée, pas du code.

## 6. Le génome et l'hérédité

### 6.1 Structure

Un génome est un dictionnaire de gènes nommés, tous normalisés dans `[0,1]`, groupés **par ce qu'ils coûtent à appliquer**.

| Groupe | Exemples | Application |
| :--- | :--- | :--- |
| `structure` | stature, longueur de bras, longueur de jambe, largeur d'épaules | recompilation du squelette |
| `face` | mâchoire, nez, yeux, corpulence du visage | influence de morph, **continu** |
| `surface` | teint, couleur et style de cheveux, pilosité | uniforme de matériau, **continu** |

Les gènes sont normalisés et jamais exprimés en mètres. Un curseur borné ne peut pas produire de valeur absurde, l'hérédité se mélange sans conversion, et la traduction en géométrie appartient au descripteur de famille — donc un cerf et un humain se pilotent avec les mêmes composants.

Chaque gène porte ses propres règles : `heritability`, `dominance`, `sexLinked`, `mutationRate`.

### 6.2 Hérédité

```ts
breed(mother: Genome, father: Genome, rng: Rng, sex: 'f' | 'm'): Genome
```

Fonction **pure**, alimentée par le `Rng` seedé de `SimKernel`. Mêmes parents, même graine, même enfant — à jamais, et vérifiable par vecteurs dorés exactement comme le protocole binaire l'est.

### 6.3 L'âge n'est pas un gène

Le génome décrit **l'adulte-cible**. C'est `expressAt(genome, âge)` qui applique les courbes de proportion de la famille.

Conséquence directe et essentielle : un enfant et l'adulte qu'il deviendra **partagent le même génome**. Un villageois peut donc vieillir au fil des jours simulés sans jamais être re-tiré, et son identité visuelle survit au snapshot, à la sauvegarde et au replay.

## 7. Le compilateur

### 7.1 Signature

Le compilateur est une fonction pure. Il ne touche jamais un objet Three : il produit une description de ce qu'il faudra écrire. C'est cette séparation qui le rend testable en Node et vérifiable par vecteurs dorés.

```ts
compile(family: FamilyDescriptor, genome: Genome, age: number, binding: RigBinding)
  → CompiledCharacter

type Vec3 = readonly [number, number, number];

interface CompiledBone {
  role: string;
  position: Vec3;
  scale: number; // UNIFORME, jamais par axe : une similitude ne cisaille pas, une échelle par axe si.
}

interface CompiledCharacter {
  family:         string;
  restPose:       CompiledBone[];
  morphs:         Record<string, number>;
  surface:        Record<string, number>; // un ton par gène du groupe `surface`, scalaires normalisés
  stats:          { nominalHeightMeters: number };
}
```

Deux précisions issues de l'implémentation. **`nominalHeightMeters` et non
`heightMeters`** : le champ ne rend compte que de l'âge et de la stature, pas de la
longueur des membres ni du tronc ; mesurée sur la pose réelle, la différence atteint
0,43 m. La hauteur debout véritable exige de savoir quelle chaîne touche le sol — un
fait de rig, donc le travail du pont (§8), qui doit aussi porter le **ré-ancrage au
sol** : la pose compilée est exprimée dans le repère du rig source et peut placer les
pieds sous zéro à certains âges. Et **les tons de surface restent des scalaires
normalisés**, la conversion en couleur appartenant à `MaterialLibrary`.

Les types sont des tuples de nombres, jamais des objets Three : c'est ce qui
permet de sérialiser un `CompiledCharacter` en vecteur doré et de le comparer
octet pour octet entre deux exécutions.

### 7.2 Pourquoi une translation d'os suffit, et pourquoi il ne faut surtout pas rebaker

Un `SkinnedMesh` déforme avec `boneMatrix = bone.matrixWorld × boneInverse`, où `boneInverse` est figée à l'export du glTF.

**Cette section affirmait le contraire de la vérité, et la correction vient d'une mesure faite à l'étape 2.** Elle prescrivait de recalculer les matrices inverses depuis la nouvelle pose. Sur une chaîne hanche → genou → cheville, avec un sommet pondéré au genou :

| Geste | genou | cheville |
| :--- | ---: | ---: |
| repos | −1,000 | −2,000 |
| cuisse allongée, sans rebake | **−1,500** | **−2,500** |
| …puis `skeleton.calculateInverses()` | −1,000 | −2,000 |

Déplacer l'os **est** la déformation : la peau suit parce que la matrice d'os diffère de la matrice de liaison, ce qui est exactement le travail du skinning. Recalculer les inverses rend la pose courante neutre et **annule** la morphologie — le maillage revient à sa géométrie de base.

D'où la règle, corrigée :

> **Les longueurs passent par des translations d'os, les volumes par des morphs, jamais par une échelle non uniforme. Les matrices inverses ne sont jamais recalculées.**

Le cisaillement devient impossible **par construction**, et non par vigilance.

Ce qui fait tenir la morphologie sous animation n'est donc pas un rebake, mais l'assainissement des clips : une piste de rotation ne touche pas la translation locale et compose proprement, tandis qu'une piste de position sur un os non racine l'écraserait à chaque frame. La règle livrée avec l'étape 1 n'est pas une précaution — c'est la condition de tout le mécanisme.

### 7.3 Ce qui se partage entre individus

| Ressource | Partagée | Raison |
| :--- | :--- | :--- |
| `BufferGeometry` (positions, poids, attributs de morph) | **Oui**, une par famille | la déformation vient des matrices d'os, pas de la géométrie |
| `Skeleton` | **Non**, un par individu | ses matrices inverses encodent la morphologie |
| Matériau | **Non**, un clone par individu | le teint est un uniforme ; le dépôt clone déjà `grass` pour le terrain |
| Clips d'animation | **Oui**, un jeu par famille | ce sont des deltas, indifférents à la morphologie |

### 7.4 Quand il tourne

À l'instanciation, une fois. Sur relâchement de réglage dans les panneaux, throttlé. **Jamais dans `update()`.**

Étant pur, il est mémoïsable par `(famille, hash du génome, âge quantifié)` : deux jumeaux ne compilent qu'une fois. Une fratrie qui partage 80 % de ses gènes ne partage rien du tout, ce qui est correct et assumé.

## 8. Le pont ECS

### 8.1 Composants

La frontière entre composants est **la même** que la ligne de partage du compilateur. Un champ modifié dit alors de lui-même s'il déclenche une recompilation.

```ts
export const CharacterIdentity = createComponent('CharacterIdentity', {
  family: { type: Types.Enum, enum: ['humanoid', 'canid', 'cervid'], default: 'humanoid' },
  sex:    { type: Types.Enum, enum: ['f', 'm'], default: 'f' },
  age:    { type: Types.Float32, default: 25, min: 0, max: 90, step: 0.5, label: 'Âge' },
  seed:   { type: Types.Int32, default: 0, help: 'Graine du tirage — rejouable' },
});

// Modifier un champ ici RECOMPILE le squelette.
export const CharacterStructure = createComponent('CharacterStructure', {
  stature:       { type: Types.Float32, default: 0.5, min: 0, max: 1, step: 0.01 },
  armLength:     { type: Types.Float32, default: 0.5, min: 0, max: 1, step: 0.01 },
  legLength:     { type: Types.Float32, default: 0.5, min: 0, max: 1, step: 0.01 },
  shoulderWidth: { type: Types.Float32, default: 0.5, min: 0, max: 1, step: 0.01 },
  torsoLength:   { type: Types.Float32, default: 0.5, min: 0, max: 1, step: 0.01 },
});

// Modifier un champ ici s'applique à la frame suivante, sans recompiler.
export const CharacterFace = createComponent('CharacterFace', {
  jawWidth: { type: Types.Float32, default: 0.5, min: 0, max: 1, step: 0.01 },
  noseSize: { type: Types.Float32, default: 0.5, min: 0, max: 1, step: 0.01 },
  eyeScale: { type: Types.Float32, default: 0.5, min: 0, max: 1, step: 0.01 },
  cheekbone: { type: Types.Float32, default: 0.5, min: 0, max: 1, step: 0.01 },
  bodyMass: { type: Types.Float32, default: 0.5, min: 0, max: 1, step: 0.01 },
});

export const CharacterSurface = createComponent('CharacterSurface', {
  skin:      { type: Types.Color, default: [0.82, 0.70, 0.55, 1] },
  hair:      { type: Types.Color, default: [0.20, 0.13, 0.09, 1] },
  hairStyle: { type: Types.Enum, enum: ['none', 'short', 'braid', 'bun', 'loose'], default: 'short' },
});

// Singleton : une seule cible d'édition, sinon chaque panneau mémorise la
// sienne et ils divergent.
export const CharacterSelection = createComponent('CharacterSelection', {
  target: { type: Types.Entity, default: null },
});
```

**Aucun `Types.Object` dans les composants.** La liaison résolue — indices de morphs, références d'os — est un état runtime, pas une donnée d'auteur. Elle vit dans une `Map` possédée par le système et reconstruite sur les événements `qualify`/`disqualify` de la query, exactement comme `EntityIndex` côté réseau. Les composants restent ainsi entièrement sérialisables et éditables.

**`Types.Color` est un champ vecteur.** `setValue` **lève** dessus en elics 3.4.x : les teintes se lisent et s'écrivent par `entity.getVectorView(CharacterSurface, 'skin')`. C'est le chemin sans allocation, et c'est aussi le seul qui ne jette pas. Les panneaux de réglage doivent l'utiliser, sous peine d'une exception au premier clic sur la couleur de peau.

### 8.2 Systèmes et priorités

| Priorité | Système | Quand il travaille |
| :--- | :--- | :--- |
| **60** | `CharacterCompileSystem` | sur `qualify`, ou sur changement d'un champ de `CharacterStructure` ou de l'âge au-delà d'un seuil |
| **70** | `CharacterExpressionSystem` | chaque frame, mais n'écrit que les canaux marqués sales |

En amont de tout le reste : la forme d'un personnage précède son LOD (90), sa prédiction (100) et sa cognition (115+).

**Point à vérifier avant implémentation :** la position exacte de `CharacterExpressionSystem` par rapport au mixer d'animation d'IWSDK. Nos morphs de visage et les visèmes de `LipSyncSystem` (145) écrivent sur des canaux disjoints, donc l'ordre devrait être indifférent — mais « devrait » n'est pas une garantie, et cela se lit dans `@iwsdk/core` une fois les dépendances installées.

### 8.3 Naissance d'un personnage

```ts
const enfant = createCharacter(world, {
  family: 'humanoid',
  genome: breed(mère.genome, père.genome, kernel.rng, 'f'),
  age: 7,
});
```

La fabrique instancie l'asset depuis le manifeste, résout la liaison contre le descripteur, pose les composants et compile une fois. Côté simulation, `AgentView` porte une référence de génome et `CardinalSimulationSystem` appelle cette fabrique. `AgentAvatarFactory` disparaît, comme chaque phase de la spec environnement supprime son équivalent legacy.

### 8.4 Ce que le compilateur tolère, et ce que ça déplace vers le pont

`compile` accepte délibérément deux formes d'incomplétude : un génome auquel il manque un gène retombe sur `0.5` plutôt que de lever, et un morph du descripteur absent de la liaison (`morphIndex`) est simplement omis de la sortie plutôt que de bloquer la compilation. Aucun `validateBinding` n'existe dans ce paquet.

Ce n'est pas un oubli. Un génome ou une liaison PARTIELS sont des cas normaux en cours d'édition — dans un panneau de réglage, une fabrique qui construit un personnage par étapes — et y répondre par une levée systématique gênerait ces usages sans rien garantir de plus : un descripteur de famille est déjà validé une fois pour toutes par `validateDescriptor` (§5), et c'est l'INTÉGRITÉ D'UN ASSET RÉEL contre le contrat de sa famille — les os que le rig source expose réellement, les morphs qu'il porte vraiment — qui reste à vérifier. Cette vérification est le travail du pont (`character-three`), au moment où il résout la liaison contre le descripteur, et non celui du compilateur pur qui ne voit jamais l'asset. Inventer un `validateBinding` ici, sans consommateur, serait ajouter une garantie que personne n'appelle.

## 9. Les panneaux spatiaux

### 9.1 Ce que le paquet n'a pas à être

L'inspecteur IWSDK rend déjà les curseurs, bornés et étiquetés, dès lors que les composants figurent dans `defineComponents()`. Le paquet ne se justifie que par ce que l'inspecteur ne sait pas faire.

| Panneau | Montre | Écrit |
| :--- | :--- | :--- |
| **Réglages** | les gènes, groupés par coût | `CharacterStructure`, `CharacterFace`, `CharacterSurface` de la cible |
| **Persona** | persona, rôle, tribu, besoins, action en cours, plan Mode-2, génome | rien — inspecteur en lecture seule |
| **Archétypes** | les presets versionnés, par métier, âge et sexe | applique un génome complet à la cible |
| **Hérédité** | mère, père, fratrie engendrée, défilement de graines | crée de nouvelles entités |

Le panneau Persona a un double emploi qui le rend prioritaire : il devient l'outil de débogage de `cardinal-simulation`. Voir les besoins, la croyance courante et le plan Mode-2 d'un villageois **dans le casque, en visant le villageois**, vaut n'importe quel `console.log`.

### 9.2 Contraintes UIKitML établies

Vérifiées contre la documentation officielle IWSDK :

- **Les tailles numériques sont en centimètres**, pas en pixels. `width: 95` est un panneau de 95 cm. `doc.setTargetDimensions(0.9, 0.6)` fixe l'occupation physique en mètres, avec mise à l'échelle uniforme.
- Éléments disponibles : `div`, `p`, `h1`, `button`, `ul`/`li`, `img`, `svg`, `video`, `input`, `textarea`. **Aucun `type="range"`** — il n'existe pas de curseur natif.
- Pseudo-sélecteurs natifs `:hover`, `:active`, `:focus`, `:dark`, et responsives `:sm` à `:2xl`. Le retour visuel au rayon et le thème sombre sont donc gratuits.
- `classList.add/remove` à l'exécution, `getElementById`, `getElementsByClassName`, `querySelector` limité à `#id`, `.classe` et descendance. Pas de sélecteurs d'attribut ni de pseudo-classes dans les requêtes.
- **Aucune navigation entre panneaux n'est fournie.** La documentation l'énonce explicitement.
- `dispose()` au démontage, sous peine de fuite — même famille de règle que `entity.dispose()` plutôt que `destroy()`.

### 9.3 Décisions de conception

**Montage possédé par le code, par défaut.** `installCharacterUI(world)` crée ses entités et attache ses panneaux. Une option `mount: 'scene'` laisse l'application reprendre le placement en fournissant ses propres identifiants de nœuds — un atelier posé au milieu du village n'est pas au bon endroit, et c'est l'app qui le sait.

**Un routeur de panneaux**, puisqu'il n'en existe aucun : un onglet actif, les autres en `display: none`, `CharacterUIRoute` comme unique source de vérité.

**Le réglage sans curseur.** Chaque gène est une ligne :

```text
  Largeur d'épaules   [ − ]  ███████░░░  0.72  [ + ]  ↻
```

La jauge est un `div` dont on pilote la largeur. Le pas vient du champ ECS (`step: 0.01`), donc l'inspecteur bureau et le panneau spatial partagent une seule source. Le symbole `↻` marque les gènes qui recompilent, et `classList.add('recompiling')` le fait clignoter pendant l'opération : la contrainte géométrique de la section 7 devient une information visible plutôt qu'une surprise.

### 9.4 Pilotage par l'IA

L'IA n'écrit ni shader, ni os, ni code. Elle écrit **un génome** : un vecteur nommé de flottants bornés à `[0,1]`. Aucune valeur ne peut être invalide, aucune injection n'est possible, et « guerrier orque » devient un objet vérifiable, diffable et rejouable.

Le mécanisme principal est **l'écriture de fichiers de preset, rechargés à chaud par les panneaux**. C'est versionné, revu comme du code, et cela fonctionne sans passerelle. Une passerelle MCP existe bien dans IWSDK, mais ses outils n'ont pas pu être énumérés dans ce worktree ; si elle expose la mutation d'entités, elle deviendra un raccourci d'ergonomie ajouté par-dessus — jamais la fondation.

### 9.5 Format de preset

```json
{
  "id": "ferronnier_adulte_m",
  "version": 1,
  "family": "humanoid",
  "genome": { "stature": 0.72, "shoulderWidth": 0.88, "armLength": 0.61 },
  "ageRange": [28, 55],
  "note": "Charpente lourde, avant-bras longs — le marteau plutôt que la taille."
}
```

Commité dans le dépôt : le diff est le journal de changement, comme pour les composants Cardinal générés.

Les huit métiers du scénario — charbonnier, ferronnier, chasseur, pêcheur, chercheur, inventeur, enseignant, commerçant — donnent chacun un archétype par sexe et par tranche d'âge, plus une dérive familiale.

## 10. Persistance et réplication

### 10.1 Domicile du génome

La **source de vérité est le snapshot de `cardinal-simulation`**. L'agent possède son génome, et c'est la simulation qui fait naître les enfants. `snapshotSim`/`restoreSim` sérialisent déjà les agents ; le génome y entre comme un champ de plus, et hérite gratuitement du déterminisme, du replay et des tests de reproductibilité du kernel.

L'entité ECS, les panneaux et le fil réseau n'en sont que des **projections**.

### 10.2 Réplication

Déclarer `CharacterGenome` dans `cardinal/components.mjs` suffit : le générateur produit le composant TypeScript, le struct Elixir, les deux codecs et les vecteurs dorés. L'opcode `COMPONENT_UPDATE` (12) le transporte déjà. **Aucun travail de protocole n'est nécessaire.**

Deux décisions de dimensionnement :

- **Un gène est un `uint8`, pas un `float32`.** 256 pas sur `[0,1]` sont très en deçà du seuil de perception sur une largeur d'épaules. Le format tient en **`2 + un octet par gène`** — deux octets d'en-tête puis un par gène — contre quatre octets par gène en float32, même arithmétique que les trames de 33 octets et la compression de quaternion sur 32 bits.
- **Un génome se transmet une fois, à l'apparition.** Il ne change pas et n'a rien à faire dans le flux de snapshots.

## 11. Budget de performance

Cible : 30 à 40 êtres vivants morphologiquement distincts, sur Quest 3 autonome, dans le budget de 11,1 ms.

| Poste | Contrainte |
| :--- | :--- |
| Compilation | **< 2 ms par personnage**, à l'instanciation seulement ; test qui échoue au-delà |
| Coût par frame de la morphologie | **nul** pour la structure ; écriture de morphs seulement sur canaux sales |
| Draw calls | un `SkinnedMesh` ne s'instancie pas : 40 individus = 40 draw calls, à brancher sur `AILODSystem` |
| Mémoire | une géométrie et un jeu de clips par famille, un `Skeleton` et un matériau cloné par individu |

## 12. Tests et vérification

| Objet | Méthode |
| :--- | :--- |
| Compilateur | vecteurs dorés `génome + âge + famille → CompiledCharacter`, headless |
| Invariants géométriques | 10 000 génomes tirés : aucune matrice non finie, **aucune échelle non uniforme sur un os**, hauteur plausible pour l'âge |
| Hérédité | déterminisme strict (mêmes parents + graine ⇒ même enfant), plus une propriété statistique sur 1 000 enfants : la moyenne des gènes converge vers la moyenne parentale à la mutation près |
| Contrat de famille | un asset volontairement incomplet doit être rejeté **avec la liste de ce qui manque** |
| Presets | chaque archétype commité compile dans des bornes déclarées |
| Budget | compilation sous 2 ms |
| Liaison des panneaux | testée headless : quel élément reçoit quelle valeur |
| Affichage des panneaux | vérifié en runtime réel — le rendu de l'éditeur n'exécute pas les systèmes applicatifs et ne peut donc rien prouver sur le comportement |
| Unités | un test refuse tout `px` dans le markup UIKitML |

## 13. Incertitudes à lever avant l'implémentation

Deux sondes jetables, une heure chacune, avant la première ligne de production.

1. **Les clips écrasent-ils la morphologie ?** — **RÉPONDU (étape 3, §2.1).**
   Mesuré sur `readyplayerme/animation-library` : les clips de locomotion et
   d'inactivité ne portent qu'une piste de translation, sur les hanches. Les
   clips de danse en portent dix-sept — mais seize sont CONSTANTES à 10⁻⁶ m
   près et ne réencodent que les décalages d'os du rig source.
   `classifyTranslationTrack` juge sur l'amplitude et non sur la présence : il
   les retire sans conflit. La conception ne change pas.
2. **Quel chemin de montage UIKitML pour `@iwsdk/core@0.5.3` ?** La documentation officielle en décrit trois, vraisemblablement issus de versions différentes : compilation Vite vers JSON puis `PanelUI { config }` ; fichiers servis tels quels depuis `public/ui` sans plugin ; enregistrement au manifeste puis `world.assets.instantiate`. Sonde : trancher contre la référence installée (`npx iwsdk reference warmup` puis les outils de `@iwsdk/reference`). Le montage est isolé derrière un adaptateur, donc seule son implémentation dépend de la réponse.

## 14. Corrections adjacentes incluses

Deux, parce qu'on travaille dedans et qu'elles coûtent quelques lignes :

- **Déclarer les priorités des onze systèmes qui n'en ont pas** — les sept de `cardinal-world` et les quatre du demo — et lever la collision à 120 entre `NetworkInterpolationSystem` et `GazeIKSystem` en déplaçant ce dernier à 121. Introduire une bande de priorités neuve sans régler cela reviendrait à ajouter un étage à un immeuble dont le plan des étages n'est pas écrit.
- **Corriger les unités de `UIKitMLTemplateBuilder`**, qui déclare `width: 320px` et `font-size: 16px` — soit une bulle de dialogue de 3,2 mètres avec du texte de 16 cm. Ce template n'a manifestement jamais été placé dans une scène.

## 15. Hors périmètre

- Simulation de tissu et mèches de cheveux physiques. Les cheveux restent un maillage stylisé avec morphs.
- Retargeting inter-familles : inutile, chaque famille possède ses clips.
- Génération automatique de maillages ou de clés de forme par Blender-MCP. Le contrat les **accepte comme source** ; on n'écrit pas le générateur maintenant.
- Édition de textures au-delà des teintes.
- Migration des HUD DOM existants du demo vers du spatial.
- Autorité serveur sur l'apparence : le génome est répliqué, pas arbitré.
- Vêtements comme entités séparées avec équipement dynamique. Les emplacements (`slots`) sont déclarés dans le contrat de famille, mais rien ne s'y attache dans cette version.

## 16. Ordre de construction

Chaque étape aura son plan d'implémentation dédié.

| Étape | Contenu | Livrable visible |
| :--- | :--- | :--- |
| **0. Sondes** | les deux incertitudes de la §13 | deux réponses écrites, aucun code conservé |
| **1. Noyau** | `@iwsdk/cardinal-character` — contrat, génome, hérédité, compilateur | rien à l'écran, tout en tests headless |
| **2. Pont** | `@iwsdk/cardinal-character-three` — liaison, application, composants, deux systèmes | premier villageois avec une morphologie réelle |
| **3. Intégration** | branchement sur `cardinal-simulation`, familles des huit métiers | `AgentAvatarFactory` supprimé |
| **4. Panneaux** | `@iwsdk/cardinal-character-ui` — routeur, puis Persona, Réglages, Archétypes, Hérédité | atelier utilisable dans le casque |
| **5. Réplication** | `CharacterGenome` au schéma Cardinal, régénération | avatars distincts entre pairs |
| **6. Démographie** | naissances et vieillissement dans la simulation | familles qui grandissent au fil des jours |
