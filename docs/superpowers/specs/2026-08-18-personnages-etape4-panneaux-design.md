# Étape 4 — Les panneaux spatiaux : régler un villageois en le regardant

**Date :** 2026-08-18
**Spec mère :** `2026-08-17-personnages-proceduraux-design.md` (§9)
**Étape précédente :** `2026-08-17-personnages-etape3-gltf-design.md`

---

## 1. Objet

Onze villageois Ready Player Me tournent dans la démo, chacun avec sa
morphologie compilée. **Rien ne permet de les modifier ni de les inspecter.**
`CharacterSelection` est enregistré et n'a aucun lecteur ; les huit archétypes
de métier sont écrits, testés, et sans interface.

L'étape 4 livre un paquet de panneaux spatiaux UIKitML : on vise un villageois,
un panneau apparaît à côté de lui, et on règle ses gènes ou on lit son état
mental. **En immersion et hors immersion**, par la même voie de code.

Elle se termine par un villageois qui grandit à l'écran quand on clique, dans
les deux modes — pas par une suite verte.

---

## 2. Ce que la mesure a établi

### 2.1 L'unité est le centimètre, et les panneaux existants écrivent `px`

Les déclarations de type de `@iwsdk/core` sont explicites
(`dist/ui/document.d.ts:94`) :

> *Current intrinsic size of the UIKit root component (**in UIKit units,
> centimeters**)*

Or `apps/demo/public/ui/local-ai.uikitml` déclare `width: 400px` — **39
occurrences de `px`, zéro de `cm`** ; `welcome.uikitml` en compte 16 et zéro —
et `mountLocalAiPanel` compense par
`scale.setScalar(0.5)`. Le suffixe est retiré par `parseFloat` : `400px` déclare
donc **quatre mètres**, ramenés à deux par l'échelle. Ça fonctionne, mais par
compensation, pas par intention.

**Cette règle est déduite, pas observée.** Elle vient de déclarations de type et
d'un bundle minifié. La tâche 1 la mesure dans le navigateur avant toute autre
ligne (§12.2). Si elle est fausse, tous les chiffres du document le sont.

### 2.2 Huit gènes sur treize sont inertes sur les rigs livrés

`HUMANOID` déclare treize gènes : cinq de **structure** (`stature`, `armLength`,
`legLength`, `torsoLength`, `shoulderWidth`) qui recompilent le squelette, cinq
de **visage** (`jawWidth`, `noseSize`, `eyeScale`, `cheekbone`, `bodyMass`) qui
pilotent des morphs, et trois de **surface** (`skinTone`, `hairTone`,
`hairStyle`) qui pilotent des teintes.

Les deux avatars T-pose de l'étape 3 ne portent **aucun morph target** et un
**unique maillage** nommé `Wolf3D_Avatar` — ni `Wolf3D_Body` ni `Wolf3D_Hair`.
Les huit gènes de visage et de surface n'ont donc aucun effet visible, et
`ImportReport` le sait déjà : `missingMorphs` et `missingSurfaces` les nomment.

C'est une contrainte de conception, pas un défaut à corriger : le panneau doit
**montrer** l'inertie plutôt que d'offrir un bouton qui ment (§8.2).

### 2.3 Les composants ne sont pas déclarés à l'application

`apps/demo/src/components.ts` ne déclare que `Robot`. Les cinq composants de
personnage n'y figurent pas — alors que le §9.1 de la spec mère fonde tout son
raisonnement là-dessus : l'inspecteur IWSDK rend des curseurs bornés et
étiquetés dès qu'un composant est déclaré, avec les métadonnées `label`, `min`,
`max`, `step` que `gene()` porte déjà.

Trois lignes donnent l'édition sur bureau avant qu'un panneau n'existe. C'est la
première tâche de code de cette étape.

### 2.4 Le motif de panneau testable existe et n'a jamais été testé

`apps/demo/src/simulation/LocalAiPanel.ts` déclare une interface structurelle
étroite — `PanelDocument { getElementById }`, `PanelElement { setProperties,
setText, addEventListener }` — sous le commentaire *« Ce que le panneau sait
faire d'un élément, sans dépendre de Three »*.

Le contrôleur est donc testable en Node avec un document factice : pas
d'analyseur UIKitML, pas de polices, pas de réseau. **Ce fichier ne porte aucun
test.** L'étape 4 reprend le motif et, cette fois, s'en sert.

### 2.5 La sélection est agnostique du mode par construction

`iwsdk.config.json` de la démo active déjà `canvasPointerEvents: true`, et
`apps/demo/src/AGENTS.md` énonce que `RayInteractable` plus `Hovered`/`Pressed`
couvre *« both mouse/touch canvas input and XR rays »*. Le motif est déjà employé
sur les pierres, potions et bûches de `PhysicsSimulationSystem`.

Une seule voie de code sert donc l'immersion et le bureau. C'est la raison pour
laquelle cette spec ne prévoit **aucun** chemin d'entrée séparé.

---

## 3. Périmètre

**Dans :** le paquet `@iwsdk/cardinal-character-ui` ; le routeur d'onglets ; la
jauge sans curseur ; l'onglet **Réglages** ; l'onglet **Persona** ; le système de
sélection au rayon ; le placement du panneau auprès de la cible ; la déclaration
des composants à l'application.

**Dehors :** les onglets **Archétypes** et **Hérédité** (étape 5) ; le format de
preset et son rechargement à chaud (étape 5) ; le pilotage par l'IA (§9.4 de la
spec mère) ; l'option `mount: 'scene'` du §9.3 — personne ne la demande, et une
généralité sans consommateur est une dette que ce projet a déjà payée.

---

## 4. Le paquet et son cadre

### 4.1 Dépendances

`@iwsdk/cardinal-character-ui` dépend de `@iwsdk/cardinal-character`, de
`@iwsdk/cardinal-character-three` et de `@iwsdk/core`. **Jamais** de
`@iwsdk/cardinal-simulation` : voir §10.

La démo l'importe ; il n'importe jamais la démo.

### 4.2 Surface publique

```ts
export interface CharacterUIOptions {
  /** Résout l'état de persona d'une entité. Voir §10. */
  persona?: (entity: Entity) => PersonaView | null;
}

export interface CharacterUI {
  /** Le nœud du panneau, pour que l'application le place si elle le veut. */
  readonly node: Object3D;
  dispose(): void;
}

export function installCharacterUI(
  world: World,
  options?: CharacterUIOptions,
): Promise<CharacterUI>;
```

Il enregistre `CharacterUIRoute`, ses trois systèmes, charge son document depuis
le manifeste, et rend une poignée. `dispose()` démonte le document — le §9.2 de
la spec mère le rappelle, un document UIKitML non disposé fuit.

### 4.3 Un document, trois onglets

Pas deux panneaux : **un** document, un onglet actif, les autres en
`display: none`. `CharacterUIRoute { tab: Types.Enum }` est l'unique source de
vérité ; le troisième onglet est un pied de page permanent qui porte le nom de
la cible et les trois boutons de navigation.

IWSDK ne fournit **aucune** navigation entre panneaux — la documentation
l'énonce. C'est nous qui la faisons, avec `classList` et `getElementById`.

---

## 5. La sélection

### 5.1 Le mécanisme

Chaque villageois riggé reçoit `RayInteractable`. Un `CharacterPickSystem` lit
`Pressed` et écrit `CharacterSelection.target` sur une entité singleton — le
composant existe depuis l'étape 2 et n'avait jusqu'ici aucun lecteur.

Viser un autre villageois **remplace** la cible ; il n'y a jamais deux
sélections.

### 5.2 Ce que la sélection ne couvre pas

Les marionnettes de repli sont des `Group` nus, ajoutés par `root.add()` hors du
graphe d'entités : elles **ne peuvent pas** porter `RayInteractable`. Seuls les
villageois riggés sont visables.

C'est cohérent — seuls eux affichent la morphologie qu'on édite — mais cela veut
dire qu'**hors ligne, aucun villageois n'est sélectionnable**. Le panneau
affiche alors « aucune cible » et reste monté. C'est le comportement nominal
d'un clone sans réseau, pas une panne, et le §12.1 le teste.

---

## 6. Le placement

Le panneau se pose à un décalage fixe de la cible — 0,8 m sur le côté, à hauteur
de regard — et se tourne **vers la caméra active** : celle du casque en
immersion, celle du bureau sinon.

Le composant `Follower` du cœur oriente vers sa *cible de suivi* ; ici la cible
de position (le villageois) et la cible d'orientation (la caméra) diffèrent.
C'est donc un petit système à nous, `CharacterPanelPlacementSystem`, et non le
composant du cœur.

**Taille angulaire constante.** Hors immersion, la caméra bureau peut être à
vingt mètres du villageois. Le panneau porte une échelle proportionnelle à la
distance caméra, bornée entre 0,5× et 3× : il occupe la même part du champ de
vision de près comme de loin, dans les deux modes.

**Aucune allocation par frame.** Les vecteurs de travail sont alloués à
l'initialisation, en propriétés de système. Budget VR : 11–14 ms par frame.

---

## 7. La jauge

Une ligne, un widget, deux usages :

```text
  Largeur d'épaules   [ − ]  ███████░░░  0.72  [ + ]  ↻
```

La barre est un `div` dont on pilote la **largeur en pourcentage** — `%` est
supporté, les deux panneaux existants s'en servent. Le widget prend une
**fraction normalisée** `[0,1]` : les gènes la fournissent directement, les
besoins la calculent en divisant par 100 (leur échelle est 0–100, défauts
80/80/80/80/10).

Le pas vient du schéma ECS (`step: 0.01` porté par `gene()`), donc l'inspecteur
bureau et le panneau spatial partagent une source unique. Le symbole `↻` marque
les gènes qui recompilent, c'est-à-dire ceux du groupe `structure`.

**Un écart assumé au §7 de la spec mère.** Elle prescrit d'écrire « sur
relâchement de réglage, throttlé » — ce qui supposait un curseur. UIKitML n'a
pas de `type="range"` ; avec `[−]`/`[+]`, chaque clic est déjà discret, et la
porte de recompilation de `CharacterCompileSystem` ne recompile que si une
valeur a bougé. Aucun étranglement à écrire. Pas de répétition au maintien
enfoncé non plus : elle ramènerait l'étranglement par la fenêtre, pour un
confort que personne n'a demandé.

---

## 8. Onglet Réglages

### 8.1 Ce qu'il montre

Les treize gènes, groupés par coût — structure, visage, surface — chacun sur une
ligne de jauge. `[−]` et `[+]` écrivent respectivement `valeur − step` et
`valeur + step`, bornés à `[0,1]`.

Les gènes de structure écrivent `CharacterStructure`, ceux de visage
`CharacterFace`. Les gènes de surface sont des **couleurs** : `Types.Color` est
un champ vecteur et `setValue` **lève** dessus en elics 3.4.x — ils s'écrivent
par `entity.getVectorView(CharacterSurface, 'skin')`.

### 8.2 Les lignes inertes

Une ligne dont le gène n'a aucun effet sur le rig courant est **grisée, sans
boutons, et porte sa raison** : « ce rig ne déclare pas ce morph » ou « ce rig
n'expose aucune surface de peau ».

La liste des gènes inertes est **dérivée du `ImportReport`** de la cible —
`missingMorphs` et `missingSurfaces` — jamais d'une liste en dur. Le jour où un
rig complet arrive, les mêmes lignes s'allument sans une ligne de code de plus.

C'est l'idée centrale de cet onglet : le rapport d'import cesse d'être un objet
que personne ne lit et devient ce que l'utilisateur voit.

---

## 9. Onglet Persona

En lecture seule : persona, rôle et tribu ; les cinq besoins sur la même jauge ;
l'action en cours ; le plan Mode-2 ; le génome.

Le §9.1 de la spec mère le juge prioritaire, et il a raison : voir les besoins et
le plan d'un villageois **dans le casque, en le visant**, vaut n'importe quel
`console.log`. C'est le débogueur de `cardinal-simulation` autant que l'outil de
l'utilisateur.

**Rafraîchi à 4 Hz, et seulement quand l'onglet est visible.** Ce sont des
données par frame ; les lire à 90 Hz allouerait dans la boucle de rendu pour un
texte que l'œil ne suit pas.

---

## 10. La frontière avec la simulation

`CharacterSelection.target` porte une **entité**. Mais l'état d'un agent se lit
par **identifiant d'agent**, dans `AgentRuntime.agents`. Le lien entité → agent,
seule l'application le connaît : sa carte `agentAvatars` est clavée par
identifiant.

Le paquet déclare donc ce dont l'onglet a besoin, et l'application le fournit :

```ts
export interface PersonaView {
  name: string;
  tribe: string;
  role: string;
  persona: string | null;
  /** Cinq besoins, échelle 0–100. */
  needs: Readonly<Record<'hunger' | 'warmth' | 'energy' | 'affection' | 'stress', number>>;
  /** Verbe en cours, ou null au repos. */
  action: string | null;
  /** Les buts du plan Mode-2, dans l'ordre. */
  plan: readonly string[];
}
```

Sans fournisseur, l'onglet affiche « aucune source de persona » et le panneau
reste pleinement utile pour les Réglages. **Il ne lève pas.**

Importer `cardinal-simulation` depuis le paquet d'UI le rendrait inutilisable
dans tout projet qui n'a pas ce moteur, pour un onglet sur deux. La dépendance
va dans l'autre sens, et c'est l'application qui fait le pont.

---

## 11. Contraintes globales

- **Three s'importe depuis `@iwsdk/core`**, jamais depuis `three`.
- **`skeleton.calculateInverses()` ne doit apparaître nulle part.**
- **Les assets se chargent par `AssetManager` / le manifeste**, jamais par un
  chargeur brut dans `src/`.
- **Aucune allocation dans `update()`.** Budget VR : 11–14 ms par frame.
- **`setValue` lève sur `Types.Color`, `Vec2/3/4`** : passer par
  `entity.getVectorView(...)`.
- **`entity.dispose()`, jamais `entity.destroy()`** ; **`document.dispose()`** au
  démontage du panneau.
- **`noUncheckedIndexedAccess` est actif** : tout accès indexé gardé ou suffixé
  de `!`.
- **Les tailles du document sont écrites en centimètres**, sans suffixe `px`,
  une fois la tâche 1 confirmée.
- **Commentaires en français**, descriptions de tests comprises.
- Les accents dépendent d'un correctif `@pmndrs/uikit` déclaré dans
  `patchedDependencies`, gardé par `scripts/__tests__/uikit-charset.test.mjs`.
  Ne pas le retirer.

---

## 12. La preuve

### 12.1 Headless

| # | ce qui est prouvé | comment il tombe s'il est faux |
| :--- | :--- | :--- |
| 1 | **Chaque identifiant que le contrôleur demande existe dans le `.uikitml`** | une faute de frappe ou un renommage le fait tomber — c'est la panne la plus probable de l'étape, et celle qu'un document factice ne voit jamais |
| 2 | `[+]` sur un gène de structure change le composant **et le squelette compilé** | un gestionnaire câblé sur la mauvaise clé passe le premier maillon et tombe ici |
| 3 | `[−]` et `[+]` bornent à `[0,1]` et avancent d'exactement `step` | un pas codé en dur, divergent du schéma, le fait tomber |
| 4 | Les gènes de surface s'écrivent par `getVectorView` | un `setValue` lève, et le test le voit |
| 5 | Le routeur : un onglet visible, les autres en `display: none`, `CharacterUIRoute` seule vérité | deux onglets visibles, ou un état divergent, le fait tomber |
| 6 | Les lignes inertes sont dérivées de `ImportReport` | un rapport différent change la liste ; une liste figée le fait tomber |
| 7 | `Pressed` écrit `CharacterSelection.target`, et viser ailleurs remplace | une accumulation de cibles le fait tomber |
| 8 | Sans cible, le panneau affiche « aucune cible » et ne lève pas | c'est le cas hors ligne, où aucun villageois n'est riggé |
| 9 | Sans fournisseur de persona, l'onglet affiche son message et ne lève pas | un `undefined` déréférencé le fait tomber |
| 10 | Persona ne lit qu'à 4 Hz, et seulement onglet visible | un espion sur le fournisseur compte les appels |
| 11 | Le placement n'alloue rien par frame | un espion sur l'allocation, ou une lecture du code, le prouve |

Les tests 1 à 6 emploient un document factice au motif de `LocalAiPanel`
(§2.4) — sauf le test 1, qui analyse le **vrai fichier**.

### 12.2 À l'écran, deux fois

**Tâche 1, avant toute autre ligne : la sonde des centimètres.** Monter un
document de largeur déclarée connue, mesurer sa boîte englobante monde, et
comparer. La règle du §2.1 est déduite d'un bundle minifié ; si elle est fausse,
tous les chiffres du document le sont, et la spec doit être corrigée avant que
le premier panneau soit écrit.

Puis, **en immersion et hors immersion** :

1. le panneau s'affiche et se lit ;
2. viser un villageois le sélectionne, et le pied de page porte son nom ;
3. `[+]` sur `stature` **fait grandir le villageois à l'écran**.

La capture doit montrer **le changement**, pas le panneau. Un panneau qui
s'affiche ne prouve pas plus qu'un test vert — c'est la leçon que l'étape 3 a
payée cher.

### 12.3 Ce qui ne sera pas prouvé, et le dit d'avance

Le confort en casque — distance de lecture, taille de texte, fatigue — ne se
mesure pas depuis cet environnement. Les recommandations d'IWSDK seront suivies
et le point signalé comme non vérifié.

Si le rendu en immersion se révèle inaccessible ici — l'étape 3 a mesuré qu'une
session `immersive-vr` active coupe le miroir 2D et rend un écran noir — ce sera
dit, et la preuve se limitera au mode bureau. Aucun succès ne sera annoncé qui
n'aura pas été vu.

---

## 13. Risques

| risque | probabilité | conséquence | atténuation |
| :--- | :--- | :--- | :--- |
| L'unité n'est pas le centimètre | faible, **mesurée en tâche 1** | tous les chiffres du document sont faux | la tâche 1 précède tout ; la spec est corrigée avant le premier panneau |
| Le rendu en immersion est inobservable depuis cet environnement | **moyenne** — mesuré à l'étape 3 | la preuve se limite au mode bureau | déclaré au §12.3 plutôt que masqué |
| Les identifiants du document et du contrôleur divergent | moyenne | panneau vide, sans erreur | le test 1 les confronte au vrai fichier |
| Hors ligne, aucun villageois n'est sélectionnable | **certaine** | le panneau reste sans cible | comportement nominal, testé (test 8) |
| Le texte accentué casse si le correctif uikit se perd | faible | glyphes manquants | `uikit-charset.test.mjs` tombe |

---

## 14. Ordre de construction

| tâche | contenu | livrable |
| :--- | :--- | :--- |
| **1** | Sonde des centimètres dans le navigateur | **la règle du §2.1, confirmée ou corrigée** |
| **2** | Les cinq composants dans `defineComponents()` de la démo | curseurs de l'inspecteur bureau, sans un panneau |
| **3** | Échafaudage du paquet, `CharacterUIRoute`, le routeur | tests 5 |
| **4** | La jauge et le contrôleur de l'onglet Réglages | tests 1 à 4, 6 |
| **5** | `CharacterPickSystem` et le placement | tests 7, 8, 11 |
| **6** | L'onglet Persona et le contrat `PersonaView` | tests 9, 10 |
| **7** | Intégration dans la démo, et la preuve à l'écran dans les deux modes | captures, ou réserve déclarée |

La tâche 1 précède tout pour la même raison que l'applicateur skinné ouvrait
l'étape 2 et la sonde réseau l'étape 3 : le pari non vérifié passe devant.
