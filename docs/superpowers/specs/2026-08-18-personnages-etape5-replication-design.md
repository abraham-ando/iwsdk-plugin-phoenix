# Étape 5 — Réplication : un génome qu'on ne peut plus recalculer

**Date :** 2026-08-18
**Spec mère :** `2026-08-17-personnages-proceduraux-design.md` (§10)
**Étape précédente :** `2026-08-18-personnages-etape4-panneaux-design.md`

---

## 1. Objet

Onze villageois tournent dans la démo, un panneau permet de régler leurs
gènes. Leur génome, aujourd'hui, n'existe que comme un calcul : chaque pair le
redérive localement, à l'apparition, en hachant l'identifiant de l'agent
(`apps/demo/src/simulation/villagerGenomes.ts`). Deux pairs au même code
voient donc le même villageois — mais par coïncidence de calcul, pas parce
qu'une donnée a été transmise.

Cette étape déclare `CharacterGenome` au schéma Cardinal, pour que le
mécanisme générique de réplication de composants — déjà écrit, déjà testé sur
trois autres composants — le porte entre pairs. Elle se termine par un fait
vérifiable et non par une différence visible : **pour les onze villageois de
départ, rien ne change à l'écran.** La raison de cette étape n'est pas ce
qu'elle change aujourd'hui, mais ce qu'elle rend possible demain : un
personnage né en cours de partie (étape 6) n'aura aucun calcul local à
rejouer, et devra recevoir son génome.

---

## 2. Ce que la mesure a établi

### 2.1 La simulation n'a pas d'hôte serveur

`packages/server` (Elixir) ne référence nulle part `SimKernel`, `AgentRuntime`
ni `cardinal-simulation` — vérifié par recherche exhaustive dans son
arborescence. Le kernel tourne **exclusivement côté client**, un par pair,
déterministe. `apps/bff-server` importe bien `@iwsdk/cardinal-simulation`,
mais seulement pour construire des invites de délibération LLM
(`buildSystemPrompt`, `extractPlanJson`) — ce n'est pas un hôte de simulation.

« Le serveur devient la source de vérité », formulation d'un brouillon
antérieur de cette étape, était donc fausse. Il n'y a pas de serveur
autoritaire pour les personnages dans ce système.

### 2.2 Deux modes d'autorité, et un seul convient

`docs/ARCHITECTURE.md` documente deux modes de room :

- **`:host_relayed`** — *« the server peeks at one byte and forwards the
  payload untouched… a relayed room trusts its peers by definition »*.
- **`:server_authoritative`** — un `COMPONENT_UPDATE` publié par un client est
  **refusé** (`client_authority_denied`), *« because a client asserting state
  is what that mode exists to prevent »* (`docs/PROTOCOL.md`).

`apps/demo/src/networking.ts` fixe le défaut à `host_relayed` ;
`server_authoritative` n'est activé que par `VITE_PHOENIX_MODE=server_authoritative`,
explicitement. Comme le serveur ne simule aucun personnage (§2.1), la
réplication du génome **ne peut fonctionner qu'en `host_relayed`** — un client
en `server_authoritative` verrait sa publication rejetée. C'est une limite
réelle, documentée ici, pas contournée.

### 2.3 Le cache de rattrapage est générique, et déjà écrit

`packages/server/lib/iwsdk_phoenix/cardinal/cache.ex` :

> *« Latest value per `{network_id, component_id}`, for late joiners. Without
> this a peer that arrives after a component was last published never learns
> its value. »*

N'importe quel composant déclaré dans `cardinal/components.mjs` en bénéficie
automatiquement. Rien à écrire côté serveur au-delà du schéma — confirmé
contre le code, pas seulement affirmé par la spec mère.

### 2.4 La publication et la réception sont automatiques

`packages/client/src/cardinal/publish.ts`, `CardinalPublisher.collect()` :

> *« Every component has a constant byte size, so "has this changed" is a byte
> comparison against the last thing published… a component that changes and
> changes back within one tick correctly produces no traffic. »*

Elle parcourt `CARDINAL_REGISTRY` et publie tout composant Cardinal qu'une
entité **porte**, uniquement si ses octets diffèrent des derniers publiés.
Réception, `PhoenixNetworkSystem.ts:541` :

```ts
CARDINAL_REGISTRY.get(record.componentId)?.write(entity, record.data);
```

**Aucun code applicatif n'est nécessaire ni pour publier ni pour recevoir.**
Poser `CharacterGenome` sur une entité `Networked` suffit ; le système s'en
charge, et se tait dès que la valeur cesse de changer — exactement le
comportement voulu pour un génome immuable.

**Une contrainte qui en découle :** `write()` fait `entity.setValue(...)`
directement (`components.generated.ts:59-61` pour `Health`), ce qui suppose le
composant **déjà présent** sur l'entité. Un pair doit poser `CharacterGenome`
au moment où il crée localement le personnage, avant qu'une réception ne
puisse y écrire.

### 2.5 Le patron à suivre existe déjà : la plante partagée

`apps/demo/src/multiplayer.ts`, `adoptSharedPlant()` :

> *« Turn the scene's plant into a replicated object. It is already authored,
> already grabbable and already present on every client; all it is missing is
> a network identity. »*

```ts
plant.addComponent(Networked, {
  networkId: SHARED_PLANT_ID,   // 100_001 — une constante fixe, choisie à la main
  isLocalOwner: false,
  ownerId: 0,
});
```

Aucun `SPAWN_ENTITY` dynamique, aucun ownership à arbitrer : l'objet existe
déjà identiquement sur chaque client, on lui donne juste une identité réseau
**fixe et connue d'avance**. C'est exactement la situation des onze
villageois de départ.

`SHARED_PLANT_ID = 100_001` est choisi loin au-dessus de ce que
`IwsdkPhoenix.Zone.IdAllocator.local/0` (le compteur séquentiel par défaut qui
alloue les identifiants de joueurs, en partant de 1) pourrait jamais atteindre
en pratique. C'est une convention manuelle, pas une garantie du code — la
même règle s'applique aux villageois.

### 2.6 Aucun champ `array` n'existe encore, mais le générateur le gère

`cardinal/components.mjs` ne déclare aujourd'hui que des champs scalaires et
`vec3`. `types.mjs` prévoit pourtant `{ type: 'array', of: <type>, length: N }`
depuis le début (`fieldSize`, `fieldSlots`), et `scripts/generate-cardinal.mjs`
a déjà les branches pour l'émettre — TypeScript (`number[]`, défaut
`Array(length).fill(0)`), Elixir (`List.duplicate(0, length)`, type
`[entry.elixir]`), et la logique de remplissage (`usesPad`). Vérifié par
lecture du générateur, pas supposé : le chemin de code existe, mais **cette
étape sera son premier usage réel**. À tester avec la même rigueur que
n'importe quel code jamais exercé.

Un tableau de 13 `u8` occupe 13 slots ECS (`fieldSlots` rend `field.length`) —
donc, côté client, c'est un champ **vecteur multi-slots**, accessible par
`entity.getVectorView(...)` et jamais par `setValue`, qui lève dessus.

---

## 3. Périmètre

**Dans :** le composant `CharacterGenome` au schéma Cardinal ; les
identifiants réseau fixes des onze villageois ; l'écriture à la création
(repli local conservé) ; la lecture automatique déjà fournie par le
protocole ; la preuve, headless, que la réplication fait converger deux
dérivations locales délibérément différentes.

**Dehors :** l'allocation dynamique d'un `networkId` pour un personnage né en
cours de partie — étape 6, qui devra aussi répondre à « que voit un pair qui
rejoint après une naissance et n'a **aucun** repli local possible ». Le mode
`server_authoritative` pour les personnages — non supporté par cette étape,
documenté comme limite. Toute modification du génome après l'apparition — il
est immuable, la spec mère (§10.2) l'a déjà tranché.

---

## 4. Le composant `CharacterGenome`

```js
// cardinal/components.mjs
{
  id: 4,   // 1=Health, 2=Grabbable, 3=Weather — le premier id libre
  name: 'CharacterGenome',
  fields: [
    { name: 'genes', type: 'array', of: 'u8', length: 13 },
  ],
},
```

Treize octets, dans l'ordre **alphabétique** des clés de `HUMANOID.genes`
(`packages/character/src/family/humanoid.ts`) — c'est déjà la convention que
`createGenome()` applique (`Object.keys(...).sort()`) pour que le tirage soit
reproductible quel que soit l'ordre de déclaration. Vérifié par exécution,
pas supposé :

| index | gène | index | gène |
| :-: | :--- | :-: | :--- |
| 0 | `armLength` | 7 | `legLength` |
| 1 | `bodyMass` | 8 | `noseSize` |
| 2 | `cheekbone` | 9 | `shoulderWidth` |
| 3 | `eyeScale` | 10 | `skinTone` |
| 4 | `hairStyle` | 11 | `stature` |
| 5 | `hairTone` | 12 | `torsoLength` |
| 6 | `jawWidth` | | |

Un octet par gène — 256 pas sur `[0,1]`, très en deçà du seuil de perception
sur une largeur d'épaules (spec mère §10.2, non rouverte ici). `2 + 13 = 15`
octets par enregistrement `COMPONENT_UPDATE`, contre `2 + 52` en `f32`.

**Conversion.** `Genome.genes` est un `Record<string, number>` de flottants
`[0,1]` ; le composant réseau est un tableau d'octets. La conversion —
`Math.round(valeur * 255)` à l'écriture, `octet / 255` à la lecture — vit dans
le pont (`character-three` ou un nouveau module de conversion), jamais dans le
schéma Cardinal lui-même, qui ne connaît que des octets.

---

## 5. Les identifiants réseau

Une table fixe, onze entrées, une par agent du village (`DEFAULT_VILLAGE.agents`,
`packages/simulation/src/content/scenario.ts`) :

```ts
export const VILLAGER_NETWORK_IDS: Readonly<Record<string, number>> = {
  haran: 100_010, mira: 100_011, lio: 100_012, aya: 100_013,
  dagan: 100_014, sira: 100_015, nia: 100_016, kan: 100_017,
  narek: 100_018, ivan: 100_019, tao: 100_020,
};
```

Pas de hachage : onze noms connus et fixes se déclarent explicitement, plus
lisible et plus sûr qu'une fonction dont il faudrait prouver l'absence de
collision. La plage démarre à `100_010`, au-dessus de `SHARED_PLANT_ID`
(100 001) avec neuf identifiants de marge — pour tout objet fixe futur qui
s'intercalerait sans forcer une renumérotation.

---

## 6. L'écriture

Au moment où un pair crée localement un villageois — dans `upgradeVillagers`
(`apps/demo/src/simulation/VillagerBody.ts`), le même point qui pose
`RayInteractable` aujourd'hui :

```ts
entity.addComponent(Networked, {
  networkId: VILLAGER_NETWORK_IDS[agent.id],
  isLocalOwner: false,
  ownerId: 0,
});
entity.addComponent(CharacterGenome, { genes: genomeToBytes(genome) });
```

**Le repli local ne disparaît pas.** `genome` reste calculé exactement comme
aujourd'hui (`buildVillagerGenomes`, hachage déterministe de `agent.id`) — ce
qui est écrit dans `CharacterGenome` est cette même valeur, encodée en
octets. `CardinalPublisher` la publie une fois ; comme elle ne change jamais,
plus aucun trafic ensuite (§2.4).

---

## 7. La lecture

Entièrement fournie par `PhoenixNetworkSystem` — aucun code applicatif. Si un
`COMPONENT_UPDATE(CharacterGenome)` arrive pour un `networkId` connu,
`entity.setValue` écrase la valeur locale. Pour les onze villageois de départ,
la valeur reçue est **identique** à la valeur locale (même dérivation
déterministe) : l'écrasement ne produit aucun changement visible.

C'est précisément ce point qui rend la section suivante nécessaire.

---

## 8. Ce que ça prouve, et ce que ça ne prouve pas

**Ça ne prouve rien à l'écran, et c'est dit d'avance.** Deux clients
connectés montreraient exactement ce qu'ils montrent déjà aujourd'hui, avec
ou sans cette étape — le repli local et la valeur répliquée coïncident par
construction. Une capture de « deux pairs voient le même villageois » ne
serait pas une preuve de réplication ; ce serait une preuve de déterminisme,
déjà acquise.

**La preuve doit forcer la divergence.** Un test headless simule deux pairs
dont la dérivation locale produit délibérément des valeurs différentes — par
exemple un test qui construit `genomeA` et `genomeB` avec des graines
distinctes pour le même `agent.id` — encode `genomeA` en `CharacterGenome`,
le fait transiter par l'encodeur/décodeur généré (`codecs.generated.ts`), et
vérifie que le pair B, après réception, porte `genomeA` et non `genomeB`.
C'est la preuve que le mécanisme fonctionne, indépendamment de son invisibilité
pratique aujourd'hui.

**Le vrai bénéfice attend l'étape 6.** Un enfant engendré en cours de partie
n'a, par construction, aucune fonction déterministe locale à rejouer sur un
pair qui n'était pas présent au tick de sa naissance. C'est le seul cas où
cette étape change quelque chose que l'œil peut voir — et il est
explicitement hors périmètre ici.

---

## 9. Contraintes globales

- **Un gène est un octet (`u8`)**, jamais un flottant — spec mère §10.2, non
  rouverte.
- **L'ordre des treize gènes est l'ordre alphabétique** de `HUMANOID.genes`,
  celui que `createGenome()` applique déjà. Ne pas en inventer un autre.
- **Le génome se transmet une fois, à l'apparition.** Aucune écriture
  ultérieure ; `CardinalPublisher` s'en assure par comparaison d'octets, mais
  le code applicatif ne doit jamais appeler `setValue` sur ce composant après
  la création.
- **Cette réplication ne fonctionne qu'en mode `host_relayed`.** Documenté,
  pas contourné — un client en `server_authoritative` verrait sa publication
  refusée.
- **Jamais de fichier `*.generated.*` édité à la main** — `cardinal/components.mjs`
  est la seule source ; `node scripts/generate-cardinal.mjs` produit le reste,
  et `scripts/check-cardinal-drift.mjs` (dans `pnpm test`, une fois réparé —
  voir §11) vérifie que rien n'a divergé.
- **`entity.getVectorView(...)`, jamais `setValue`**, pour le champ `genes` —
  c'est un champ à 13 slots.
- Toute modification touchant `fixtures/cardinal_vectors.tsv` régénère les
  vecteurs dorés (`node scripts/generate-fixtures.mjs`) et traite le diff
  comme le journal du changement, à la manière du reste du projet Cardinal.

---

## 10. La preuve

### 10.1 Headless

| # | ce qui est prouvé | comment il tombe s'il est faux |
| :--- | :--- | :--- |
| 1 | `CharacterGenome` génère un TS, un struct Elixir, un codec des deux côtés et des vecteurs dorés cohérents | `check-cardinal-drift` tombe sur un schéma non régénéré |
| 2 | L'ordre des treize octets correspond à l'ordre alphabétique de `HUMANOID.genes` | un test qui encode un génome connu et vérifie l'octet à l'index attendu |
| 3 | L'encodage/décodage TS↔Elixir round-trip un génome sans perte (256 pas, pas de troncature) | un vecteur doré avec des valeurs aux deux bornes (0, 255) et une valeur médiane |
| 4 | La conversion `Genome↔bytes` est réciproque à l'octet près | `octetVers(versOctet(g)) === g` sur un échantillon de génomes réels |
| 5 | **La divergence forcée converge** : deux dérivations locales différentes, après transit par le composant, produisent la même valeur côté receveur | le test du §8, le seul qui prouve la réplication elle-même |
| 6 | Les identifiants réseau des onze villageois ne collisionnent ni entre eux ni avec `SHARED_PLANT_ID` | un test qui énumère `VILLAGER_NETWORK_IDS` et vérifie l'unicité contre les deux |
| 7 | `CharacterGenome` n'est jamais écrit une seconde fois pour une même entité | un espion sur `CardinalPublisher.collect` qui compte les enregistrements produits sur trois frames consécutives |

### 10.2 À l'écran

Une capture avec deux clients connectés reste utile — pour confirmer qu'aucun
crash, aucune désynchronisation d'ownership, aucune erreur `schema_mismatch`
n'apparaît — mais elle **ne prouve pas la réplication**, et le rapport final
le dira dans ces termes plutôt que de laisser une capture réussie suggérer
plus qu'elle ne montre.

---

## 11. Risques

| risque | probabilité | conséquence | atténuation |
| :--- | :--- | :--- | :--- |
| Le premier usage réel d'un champ `array` révèle un chemin de code jamais exercé | moyenne | génération incorrecte, silencieuse jusqu'aux vecteurs dorés | §10.1 tests 1–4 ; ne pas supposer que « le code existe » veut dire « le code marche » |
| `pnpm test` racine reste cassé (`check-cardinal-drift` → `ERR_UNKNOWN_FILE_EXTENSION` sous Node 22.12, préexistant, noté à la fin de l'étape 4) | **certaine, déjà vérifiée** | la commande canonique ne valide pas la parité générée | à réparer en tâche 1, avant de déclarer le composant — sinon aucun garde ne protège cette étape |
| Le mode `server_authoritative` est un jour activé pour la démo | faible aujourd'hui | la réplication du génome cesse silencieusement de fonctionner | documenté §2.2 et §9 ; pas résolu ici |
| Deux villageois futurs partagent par erreur un `networkId` | faible | un `COMPONENT_UPDATE` écrase le mauvais personnage | test 6 du §10.1 |

---

## 12. Ordre de construction

| tâche | contenu | livrable |
| :--- | :--- | :--- |
| **1** | Réparer `pnpm test` racine (`check-cardinal-drift`), préexistant | la commande canonique tourne à nouveau, avant tout ajout de schéma |
| **2** | Déclarer `CharacterGenome`, régénérer, vecteurs dorés | tests 1 à 4 |
| **3** | `VILLAGER_NETWORK_IDS`, conversion `Genome↔bytes` | test 6 |
| **4** | Câblage dans `upgradeVillagers` : `Networked` + `CharacterGenome` à la création | test 7 |
| **5** | Le test de divergence forcée | test 5 — la preuve que la réplication fonctionne |
| **6** | Vérification à l'écran, deux clients, et le rapport honnête du §10.2 | capture, verdict sans exagération |

La tâche 1 précède le schéma pour la même raison que la sonde des centimètres
a précédé le premier panneau de l'étape 4 : un outil cassé ne protège
personne, et l'ajouter à une pile déjà silencieuse serait pire que de le
signaler seul.
