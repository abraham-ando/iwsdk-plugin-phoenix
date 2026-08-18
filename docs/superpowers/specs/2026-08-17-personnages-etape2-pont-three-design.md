# Personnages procéduraux, étape 2 : le pont Three — Design

**Date :** 2026-08-17
**Statut :** Validé (conception approuvée section par section)
**Objet :** Construire `@iwsdk/cardinal-character-three`, le paquet qui applique la sortie du compilateur morphologique à de vrais objets Three — squelette skinné ou marionnette articulée — et l'expose comme composants et systèmes ECS d'IWSDK.

**Spec amont :** `docs/superpowers/specs/2026-08-17-personnages-proceduraux-design.md` — §8 y fixe déjà les composants, les systèmes et leurs priorités. Cette spec ne les rouvre pas ; elle tranche ce qu'ils supposaient résolu.

---

## 1. Ce que l'étape 1 a livré, et ce qu'elle n'a pas prouvé

`@iwsdk/cardinal-character` existe, sans aucune dépendance runtime : descripteur de famille, génome héritable, sérialisation d'un octet par gène, compilateur pur, cache borné, vecteurs dorés, règle d'assainissement des clips. 83 tests.

**Rien de tout cela n'a jamais rien affiché.** Le paquet ne connaît ni Three ni IWSDK — c'était la décision d'architecture — donc la promesse centrale, « allonger un membre déforme correctement une peau », reste une assertion numérique.

## 2. Le diagnostic qui reformule cette étape

Vérifié avant de concevoir : **le dépôt ne contient aucun personnage skinné.** Pas un `Bone`, pas un `SkinnedMesh`, pas un `Skeleton` dans tout le code. Les cinq avatars Ready Player Me sont déclarés dans `apps/demo/src/assets.ts` mais **jamais instanciés**. Ce qui s'affiche vient de `createRPMAvatar` (`packages/ai/src/avatar/RPMAvatarRig.ts`), qui assemble une hiérarchie de `Group` et de primitives portant des noms humanoïdes — une marionnette articulée, pas une peau attachée à un squelette.

Conséquence : l'application d'une morphologie à une peau n'a **rien dans ce dépôt sur quoi s'appliquer**. Sur une marionnette, appliquer la pose compilée revient à écrire des `position` sur des nœuds nommés, et aucune matrice inverse n'entre en jeu.

Ni la spec de l'étape 1 ni son plan n'avaient vu ce point.

**Pas de recouvrement avec la faune existante.** `packages/world/src/objects/FaunaSystem.ts` projette **où** se trouve un animal du moteur — position et cap — et ne dit rien de sa forme. Le pont dit **de quoi il a l'air**. Une entité animale portera les deux : `AnimalVisual` pour son placement, les composants de personnage pour sa morphologie.

## 3. Décisions structurantes (validées)

| Décision | Choix retenu |
| :--- | :--- |
| Cible de l'application | **Les deux**, derrière une interface — marionnette et maillage skinné, comme `INetworkAdapter` fait de l'offline un adaptateur et non un drapeau |
| Ordre de construction | **Les deux en parallèle**, sans sonde préalable. L'applicateur skinné est la **première tâche du plan**, pour que les surprises du chargement tombent au premier jour |
| Ancrage au sol | **La famille déclare son appui, le compilateur calcule.** `groundRole` dans le descripteur, `stats.groundOffsetMeters` en sortie |
| Couleurs de surface | **La famille déclare ses rampes.** Deux couleurs bornes par gène de groupe `surface` |
| Découpage | **Approche A** : résolveur pur, applicateurs minces, systèmes qui orchestrent |

**Un risque assumé, et sa compensation.** La sonde du chargement skinné a été écartée. Le chemin IWSDK → `SkinnedMesh` → `Skeleton` n'a donc jamais été exercé dans ce dépôt, et l'hypothèse qu'un GLB Ready Player Me arrive avec un squelette exploitable dont les noms d'os satisfont les alias d'`HUMANOID` reste non vérifiée. Le plan la place en première tâche : si elle est fausse, on l'apprend au jour un et non au dixième.

## 4. Architecture

```text
packages/character-three     @iwsdk/cardinal-character-three
  ├── resolve/    hiérarchie + descripteur → RigBinding + rapport d'import   [PUR]
  ├── apply/      CharacterApplicator, PuppetApplicator, SkinnedApplicator
  ├── clips/      application de la règle d'assainissement à des AnimationClip
  ├── components/ CharacterIdentity, Structure, Face, Surface, Selection
  ├── systems/    CharacterCompileSystem (60), CharacterExpressionSystem (70)
  └── create.ts   createCharacter — le seul chemin d'entrée
```

Dépendances : `@iwsdk/cardinal-character` (noyau pur), `@iwsdk/core` en peer. Jamais l'inverse.

Le résolveur est isolé parce que c'est là que vit la seule chose distinguant un asset rejeté proprement d'un personnage silencieusement difforme — et cette chose doit être vérifiable sans navigateur.

## 5. Amendements au noyau pur

Trois ajouts à `@iwsdk/cardinal-character`, tous additifs, tous enregistrés par les vecteurs dorés.

### 5.1 L'appui au sol

```ts
  /**
   * Rôle de l'os qui touche le sol. Optionnel, contrairement à `limb` : son
   * absence a un sens — un poisson, un oiseau en vol ne s'ancrent à rien — là
   * où un `limb` absent ne signifierait rien d'autre qu'un oubli.
   */
  groundRole?: string;
```

Le compilateur en déduit `stats.groundOffsetMeters` : le décalage vertical à appliquer pour que cet os repose à zéro. Absent le rôle, l'offset vaut zéro.

### 5.2 Les rotations de repos, sans lesquelles l'ancrage serait faux

Calculer cette hauteur exige de composer la chaîne de la racine jusqu'à l'appui, donc de connaître les **rotations de repos**. `BoneRest` ne les portait pas.

```ts
export interface BoneRest {
  role: string;
  position: Vec3;
  /** Quaternion de repos, mesuré par le résolveur. */
  rotation: Vec4;
  parentRole: string | null;
}
```

Sur la fixture de test de l'étape 1 les jambes descendent droit sur l'axe Y et une somme de translations aurait suffi ; sur un rig réel, rien ne le garantit. Sans cette donnée, l'ancrage serait juste pour la fixture et faux pour un personnage.

Le compilateur compose translation, rotation et échelle uniforme le long de la chaîne. Il reste pur et vérifiable headless.

### 5.3 Les rampes de couleur

```ts
  /** Deux couleurs bornes, requises sur un gène de groupe `surface`. */
  ramp?: readonly [string, string];
```

`validateDescriptor` gagne deux règles : un gène de surface doit porter sa rampe, et `groundRole`, s'il est déclaré, doit nommer un os connu.

### 5.4 Le retrait de `rebindSkeleton`

`CompiledCharacter` porte un champ `rebindSkeleton: boolean`, toujours vrai, livré à l'étape 1. Il nomme une opération que le §7.2 démontre nuisible : recalculer les matrices inverses annule la morphologie au lieu de la fixer. Un champ qui prescrit le contraire de ce qu'il faut faire est pire qu'un champ absent — le premier consommateur l'aurait honoré.

Il est retiré. Les vecteurs dorés l'enregistrent.

### 5.5 Note sur la croissance du descripteur

C'est le quatrième élargissement de `FamilyDescriptor` depuis sa création — après `limb`, `rootRole` et `headRole`. C'est la direction voulue : tout ce qui est propre à une espèce est de la donnée, et créer une famille reste un acte d'écriture de données. Mais la tendance mérite d'être nommée plutôt que subie, et la deuxième famille (`canid`) sera le test de savoir si elle s'arrête.

## 6. Le résolveur et son rapport d'import

### 6.1 Il ne connaît pas Three

Comme `RngLike` pour l'aléatoire, il prend un contrat structurel minimal que n'importe quel `Object3D` satisfait sans le savoir :

```ts
export interface RigNode {
  readonly name: string;
  readonly children: readonly RigNode[];
  readonly position: { x: number; y: number; z: number };
  readonly quaternion: { x: number; y: number; z: number; w: number };
  /** Présent sur un maillage porteur de morphs, absent sinon. */
  readonly morphTargetDictionary?: Readonly<Record<string, number>>;
}
```

### 6.2 Signature

```ts
resolveBinding(
  family: FamilyDescriptor,
  root: RigNode,
  restHeightMeters: number,
): { binding: RigBinding | null; report: ImportReport }
```

**La hauteur est un paramètre, pas une mesure.** Elle vient d'une boîte englobante, donc de la géométrie, que seul le côté Three possède. Le résolveur ne l'invente pas.

### 6.3 Le rapport

```ts
export interface ImportReport {
  family: string;
  matched: Array<{ role: string; nodeName: string; viaAlias: string }>;
  missingBones: string[];
  missingMorphs: string[];
  missingSurfaces: string[];
  accepted: boolean;
}
```

Il dit **par quel alias** chaque rôle a matché, pas seulement s'il a matché — ce qui rend un import diagnosticable sans relire le glTF.

**Os et morphs ne pèsent pas pareil, et c'est délibéré.** Un rôle d'os nommé par une chaîne, ou par `rootRole` / `headRole` / `groundRole`, est structurel : son absence rend `binding` nul et l'asset est refusé. Un morph ou une cible de surface absents ne sont pas fatals — le compilateur sait déjà omettre un morph — mais ils **figurent au rapport**. C'est ce qui solde le reproche de la revue finale de l'étape 1 : « un morph absent était sauté sans un mot ».

La comparaison de noms est insensible à la casse : `mixamorig:Hips` et `mixamorig:hips` désignent le même os selon l'exportateur, et c'est déjà ce que fait `AvatarMeshBinder` en pratique.

### 6.4 Les cibles de surface

Les applicateurs doivent savoir quel maillage porte la peau et lequel porte les cheveux. C'est une propriété de l'**asset**, pas de l'espèce — un rig RPM nomme `Wolf3D_Body` et `Wolf3D_Hair`. La famille déclare donc des alias de surface, sur le même mécanisme que les os, et le résolveur remplit :

```ts
  /** Gène de surface → noms de maillages qu'il teinte. */
  surfaceTargets: Readonly<Record<string, readonly string[]>>;
```

## 7. Les applicateurs

### 7.1 L'interface

Découpée sur la ligne de coût que la spec amont a posée : ce qui recompile d'un côté, ce qui est continu de l'autre.

```ts
export interface CharacterApplicator {
  /** Pose de repos et ancrage. À l'instanciation, jamais par frame. */
  applyRestPose(compiled: CompiledCharacter): void;
  /** Continus : n'écrivent que les canaux marqués sales. */
  applyMorphs(morphs: Readonly<Record<string, number>>): void;
  applySurface(surface: Readonly<Record<string, number>>): void;
  dispose(): void;
}
```

### 7.2 `SkinnedApplicator` — deux gestes, et surtout un troisième à ne pas faire

1. Écrire les translations et échelles uniformes locales sur les os.
2. `root.updateMatrixWorld(true)`.

**Et ne jamais appeler `skeleton.calculateInverses()`.**

C'est l'inverse de ce que les deux premières rédactions de cette conception affirmaient, et la correction vient d'une mesure. Sur une chaîne hanche → genou → cheville, avec un sommet pondéré au genou et un autre à la cheville :

| Geste | genou | cheville |
| :--- | ---: | ---: |
| repos | −1,000 | −2,000 |
| cuisse allongée, sans rebake | **−1,500** | **−2,500** |
| …puis `calculateInverses()` | −1,000 | −2,000 |
| + rotation de clip sur le genou | −1,500 | −1,500 |

La deuxième ligne **est** la jambe allongée : la peau suit l'os parce que la matrice d'os diffère de la matrice de liaison, ce qui est précisément le travail du skinning. La troisième montre que recalculer les inverses **annule** la morphologie — la pose courante devient neutre et le maillage revient à sa géométrie de base.

Un rebake aurait donc produit un personnage rigoureusement inchangé, et le défaut se serait présenté comme « le compilateur ne fait rien », très loin de sa cause.

**La quatrième ligne porte l'autre moitié du mécanisme.** Une rotation de clip sur le genou laisse la cuisse allongée intacte, parce qu'une piste de rotation ne touche pas la translation locale. C'est ce qui rend la morphologie durable sous animation — et ce qui donne à l'assainisseur de clips (§8) son vrai statut : il n'est pas une précaution, il est la condition pour qu'une piste de position sur un os non racine n'écrase pas la longueur du membre à chaque frame.

**`CompiledCharacter.rebindSkeleton` devient donc faux.** Le champ, livré à l'étape 1, promet une opération qu'il ne faut surtout pas faire. Il est retiré dans les amendements du §5.

**L'ancrage se pose sur l'`Object3D` conteneur, pas sur l'os racine** : la morphologie du personnage et l'endroit où il se tient sont deux choses distinctes, et les mêler rendrait l'une invisible dans le débogage de l'autre.

Les morphs s'écrivent dans `mesh.morphTargetInfluences` aux index que la liaison porte — résolus une fois, jamais recherchés par frame.

### 7.3 `PuppetApplicator`

Écrit les mêmes translations et échelles sur les nœuds nommés. Ignore les morphs : une marionnette n'en a pas, et `applyMorphs` y est un no-op silencieux — le fait a déjà été dit **une fois**, par le résolveur, qui a rempli `missingMorphs` en ne trouvant aucun `morphTargetDictionary`. L'applicateur n'écrit pas dans le rapport ; il n'a rien à ajouter à ce que l'import a déjà constaté.

### 7.4 Matériaux

Un **clone par individu** : les teintes sont des uniformes, et muter le matériau partagé recolorerait tout le village. Ce clone nous appartient, donc `dispose()` le libère.

> **Écart assumé à l'implémentation.** Cette section prescrivait de prendre le clone sur `MaterialLibrary` de `cardinal-world`. Le pont clone en fait le matériau **que porte déjà l'asset**, dans `apply/materials.ts`. Deux raisons : `Object3D.clone()` de Three partage les matériaux, donc quarante villageois issus d'un même GLB partagent une instance qu'il faut dédoubler quelle qu'en soit l'origine ; et faire dépendre `cardinal-character-three` de `cardinal-world` pour cela lui imposerait un paquet entier là où `Material.clone()` suffit. Le clone appartient toujours à l'applicateur, et `dispose()` ne libère que ce qu'il a cloné — jamais un matériau reçu.

Le ton normalisé devient une couleur par interpolation entre les deux bornes de la rampe déclarée par le gène.

## 8. Les clips

```ts
sanitizeClip(
  clip: AnimationClip,
  family: FamilyDescriptor,
  roleOfNode: (name: string) => string | null,
): { clip: AnimationClip; stripped: string[] }
```

**Elle rend un nouveau clip, elle ne mute pas l'ancien.** Les clips arrivent d'un glTF et sont partagés entre toutes les instances : les amputer sur place assainirait le clip de quarante villageois depuis le premier, et priverait un applicateur non skinné de pistes qu'il aurait pu vouloir. Le résultat est mémoïsé par `clip.uuid`.

**`roleOfNode` est l'inverse de ce que le résolveur a produit.** Une piste s'appelle `mixamorig:LeftLeg.position` ; il faut remonter au rôle `legL` pour que la règle sache si c'est la racine. Le pont construit cette table une fois depuis la liaison.

**L'amplitude est calculée, pas devinée** : l'écart maximal sur les trois axes à travers toutes les clés. Sous `CONSTANT_TRACK_EPSILON`, la piste ne porte aucun mouvement et disparaît ; au-dessus, sur un os non racine, `sanitizeClip` **lève**, en nommant le clip et l'os.

**Hors périmètre :** charger les clips. Ils viennent de GLB séparés de l'avatar et leur déclaration au manifeste appartient à l'application — donc à l'étape 3.

## 9. Le pont ECS

Composants et priorités viennent de la spec amont §8 et ne sont pas rouverts : `CharacterIdentity`, `CharacterStructure`, `CharacterFace`, `CharacterSurface`, `CharacterSelection` ; `CharacterCompileSystem` à 60, `CharacterExpressionSystem` à 70.

**Rappel qui a déjà coûté une revue :** `Types.Color` est un champ vecteur et `setValue` **lève** dessus en elics 3.4.x. Les teintes se lisent et s'écrivent par `entity.getVectorView(...)`.

**La liaison et l'applicateur vivent dans une `Map` possédée par le système**, reconstruite sur les événements `qualify`/`disqualify` de la query — le motif d'`EntityIndex` du paquet réseau. Aucun `Types.Object` dans les composants, qui restent sérialisables et éditables.

**La détection de changement est déjà écrite.** `genomeKey(famille, génome, âge)` existe depuis l'étape 1 et quantifie l'âge à l'année. Le système garde la dernière clé par entité ; si elle bouge, il recompile. Un villageois qui vieillit d'un jour ne recompile pas.

**Un seul chemin d'entrée :**

```ts
createCharacter(world, { family, genome, age, assetId })
```

Elle instancie l'asset, mesure la **boîte englobante de l'asset entier dans sa pose de repos, avant toute morphologie** — c'est la hauteur de référence que le génome module ensuite —, résout la liaison, choisit l'applicateur selon ce qu'elle a trouvé — squelette ou marionnette — pose les composants et compile une fois.

**Un point à vérifier avant implémentation :** la position de `CharacterExpressionSystem` par rapport au mixer d'animation d'IWSDK. Nos morphs de visage et les visèmes de `LipSyncSystem` (145) écrivent sur des canaux disjoints, donc l'ordre devrait être indifférent — mais « devrait » n'est pas une garantie.

## 10. Budget de performance

| Poste | Contrainte |
| :--- | :--- |
| Compilation | déjà mesurée à l'étape 1 : **médiane 0,006–0,014 ms**, plafond contractuel 2 ms |
| `applyRestPose` | **à mesurer**, même méthode : médiane sur cent applications, pas maximum |
| Coût par frame | **nul** pour la structure ; morphs et teintes seulement sur canaux sales |
| Mémoire | une géométrie et un jeu de clips par famille ; un `Skeleton` et un matériau cloné par individu |

## 11. Vérification

**La bonne nouvelle : la déformation est testable sans navigateur.** Les mathématiques de squelette de Three — matrices monde, matrices inverses, `calculateInverses` — ne touchent pas WebGL ; seul le rendu en a besoin. On peut donc construire en Node un `SkinnedMesh` à deux os, allonger l'un, et **vérifier qu'un sommet pondéré atterrit là où il doit**. C'est une preuve géométrique de la promesse centrale du projet, dans une suite headless.

| Objet | Méthode |
| :--- | :--- |
| Résolveur | arbres de nœuds factices, dont un volontairement incomplet → rejeté avec la liste exacte |
| Rapport d'import | l'alias ayant matché est nommé, morphs et surfaces absents figurent |
| Assainisseur de clips | réplique de `F_Dances_001` : dix-sept pistes de translation, seize retirées, celle des hanches gardée |
| Applicateur marionnette | hiérarchie factice, translations et échelles vérifiées |
| **Applicateur skinné** | **vrai `SkinnedMesh` en Node : sommet pondéré vérifié après allongement** |
| Ancrage | l'os d'appui repose à zéro, à tous les âges testés |
| Budget d'application | médiane sous le plafond, mesurée et consignée |
| Chargement IWSDK → `SkinnedMesh` | **seul point exigeant un vrai runtime** |

## 12. Dettes que cette étape solde

La spec amont §14 les promettait ; l'étape 1 ne les a pas touchées faute de systèmes à ordonner.

- Déclarer les priorités des onze systèmes de `cardinal-world` et du demo qui n'en ont pas.
- Lever la collision à 120 entre `NetworkInterpolationSystem` et `GazeIKSystem`.
- Corriger les unités en pixels d'`UIKitMLTemplateBuilder`, qui produit une bulle de 3,2 mètres.

## 13. Hors périmètre

- Le remplacement d'`AgentAvatarFactory` et le chargement des clips au manifeste : étape 3.
- Le **root motion** n'était pas prévu ici et ne l'était nulle part : mesuré à
  3,21 m par boucle sur `M_Walk_001`, il est traité par l'étape 3 (§4), par une
  politique portée par l'appelant et non par la famille.
- Les panneaux spatiaux : étape 4.
- La réplication du génome : étape 5.
- La famille `canid` : recommandée mais distincte, et c'est elle qui dira si `FamilyDescriptor` a cessé de grossir.
- Toute simulation de tissu, de cheveux ou de fracture.

## 14. Ordre de construction

| Étape | Contenu | Livrable |
| :--- | :--- | :--- |
| **1. Amendements au noyau** | `groundRole`, rotations de repos, rampes, `groundOffsetMeters`, validation | vecteurs dorés régénérés |
| **2. Applicateur skinné** | **en premier, délibérément** : c'est l'hypothèse non vérifiée | sommet pondéré déplacé par l'allongement, en Node |
| **3. Résolveur et rapport** | alias d'os, morphs, cibles de surface, rejet précis | asset incomplet refusé avec sa liste |

**Pourquoi l'applicateur précède le résolveur.** L'applicateur consomme une
`RigBinding` que le résolveur produira — mais il n'en a besoin que du
mapping rôle → os, qu'un test construit à la main en trois lignes. Le
construire d'abord met le seul pari de cette étape en première position ; le
construire après le résolveur retarderait la mauvaise nouvelle sans rien
gagner. L'ordre est délibéré, pas un oubli de dépendance.
| **4. Applicateur marionnette** | l'autre implémentation de la même interface | villageois déformé sans squelette |
| **5. Clips** | assainissement mémoïsé | seize pistes retirées d'une réplique de danse |
| **6. Pont ECS** | composants, deux systèmes, `createCharacter`, dettes §12 | un personnage compilé dans une scène |
