# Moteur de Simulation de Civilisation — Design

**Date :** 2026-08-15
**Statut :** Validé (design approuvé section par section)
**Objectif :** Remplacer la simulation scriptée de `apps/demo/src/simulation/` par un moteur de simulation headless (`packages/simulation`) conçu de zéro, servant à la fois d'expérience VR immersive type Sims et d'usine à trajectoires pour entraîner et améliorer des LLM (agents incarnés, world model prédictif au sens de Yann LeCun, dataset tool-calling).

---

## 1. Motivation

L'état actuel (`PrehistoricWorldSystem`, `AgentBrain`, `TribeManager`) est un théâtre scripté :

- `AgentBrain.decideAction` est un arbre if/else avec dialogues codés en dur ; aucun LLM, aucune mémoire, aucun apprentissage, malgré le moteur Cardinal AI complet disponible dans `packages/ai`.
- La simulation est symbolique : `gather_berries` fait `berriesStock += 2` sans déplacement, sans perception, sans inventaire. Le monde 3D est un décor.
- Rien ne capture de données d'entraînement : les événements partent au HUD puis disparaissent.
- Défauts secondaires : naissance codée en dur au cycle 14, delta de frame constant (`0.0166`), météo binaire, mélange simulation/décor dans `update()`.

L'objectif du projet — entraîner des LLM à maîtriser un environnement complet et interagir avec des êtres vivants, du virtuel vers le réel — exige un grounding spatial réel, une cognition LLM authentique et une capture systématique des trajectoires.

## 2. Décisions structurantes (validées)

| Décision | Choix |
| :--- | :--- |
| Mécanisme d'apprentissage | **Boucle complète** : agents pilotés par LLM en direct + enregistrement des trajectoires pour fine-tuning |
| Architecture cognitive | **Hybride 2 vitesses** : utility AI par tick (Mode-1) + LLM périodique asynchrone (Mode-2) |
| Inférence LLM | **BFF cloud d'abord** ; capture des trajectoires côté serveur ; WebGPU local pour TTS/STT et fallback |
| Périmètre | Les 4 piliers : incarnation spatiale, vie sociale profonde, métabolisme du monde, dialogue vocal joueur |
| Approche | **B — moteur conçu de zéro** (`packages/simulation`), la démo VR devient un client de rendu |
| Cadre conceptuel | Le world model suit la **définition de Yann LeCun** (JEPA, *A Path Towards Autonomous Machine Intelligence*, 2022) : modèle interne prédictif par agent, coût intrinsèque, acteurs Mode-1/Mode-2, configurateur |

## 3. Architecture globale

```
packages/simulation        cœur headless, zéro dépendance rendu (ni three, ni @iwsdk/core)
├── SimKernel              boucle à pas fixe 10 Hz, horloge, RNG seedé, event-log, snapshots
├── GroundTruthWorld       smart objects, ressources, index spatial, lieux nommés (vérité terrain)
├── AgentRuntime           besoins, perception, BeliefState, inventaire, navigation, corps
├── CognitionHost          Mode-1 utility + interface AgentPlanner (Mode-2 LLM via BFF)
├── TrajectoryRecorder     flux JSONL : decisions / predictions / episodes
└── headless.ts            entrée Node : simulation accélérée ×50-100 pour datasets

apps/demo (client VR)      rendu Three.js : projette l'état moteur sur avatars RPM,
                           terrain, physique Havok, HUD — conservés tels quels
apps/bff-server            + POST /agents/plan (proxy LLM journalisé côté serveur)
                           + POST /trajectories/batch, GET /trajectories/stats
```

**Principes :**

1. **Headless et déterministe.** Maths pures et types uniquement. Pas fixe de 100 ms simulées ; RNG xorshift seedé unique : même graine ⇒ même civilisation.
2. **Deux clients du même moteur.** La démo VR est un renderer ; le mode headless Node tourne sur le BFF en batch (N graines × M jours) sans limite temps réel.
3. **Le monde parle en affordances.** Aucune action en dur dans le moteur : le contenu déclare les smart objects. Chaque affordance se sérialise en définition d'outil LLM (tool-calling).
4. **Frontière moteur/cognition.** Le moteur ne bloque jamais sur un LLM : plans asynchrones, l'agent poursuit son action courante entre-temps.

**Conservé tel quel :** terrain procédural, herbes, rivière, locomotion BVH, physique Havok, avatars/animations RPM, HUD, tout `packages/ai` (STT/TTS/LLM workers, RAG).
**Remplacé :** `apps/demo/src/simulation/*` devient un adaptateur mince vers le moteur.

## 4. GroundTruthWorld : smart objects et monde

### 4.1 Smart objects

Déclarés par un catalogue de contenu TypeScript, jamais par le moteur :

```ts
defineSmartObject('berry_bush', {
  affordances: [{
    verb: 'gather_berries',
    preconditions: { objectState: { berriesLeft: '>0' }, actorDistance: '<1.5' },
    durationTicks: 30,
    effects: { object: { berriesLeft: -2 }, actorInventory: { berries: +2 } },
  }],
  state: { berriesLeft: 12, regrowthPerDay: 4 },
})
```

Catalogue v1 : buisson à baies, arbre/bois mort, gisement de silex, feu de camp (`light_fire` avec préconditions d'inventaire, `add_wood`, `rest_nearby`), rivière (`drink`, `fish`, `knap_flint` sur berges), abri (`build` progressif multi-agents, `sleep_inside`), dépôt de camp (déposer/prendre des ressources).

### 4.2 Index spatial

Grille de hachage 2D (cases de 4 m) sur 64 m × 64 m : requêtes de proximité en O(1) pour la perception. La fonction analytique `getHeight(x, z)` du terrain est déplacée dans le moteur ; la démo VR la réimporte (source unique).

### 4.3 Ressources vivantes

Chaque nœud a un stock fini et une règle de régénération par jour simulé. La rareté locale émerge (sur-cueillette ⇒ exploration forcée).

### 4.4 Lieux nommés

Zones étiquetées (`camp_aube`, `riviere_nord`, clairières, crêtes) : citées par la perception, ciblables par les plans LLM, lisibles dans les trajectoires.

## 5. World model au sens LeCun

Distinction fondamentale :

- **`GroundTruthWorld`** : la réalité de la simulation (section 4).
- **`AgentWorldModel`** (par agent) : modèle interne construit uniquement depuis la perception partielle.

| Module LeCun | Réalisation |
| :--- | :--- |
| Perception | Observations locales à rayon limité ; jamais d'accès vérité terrain |
| Mémoire court terme | `BeliefState` : croyances datées, faillibles, périmables |
| World model (prédicteur) | `Predictor` : pour une action candidate, prédit l'état futur (effets, dynamique, réactions d'autrui) |
| Coût intrinsèque | Les 5 besoins (faim, chaleur, énergie, affection, stress) en fonction de coût continue |
| Acteur Mode-1 | Utility AI par tick : réflexes sans imagination |
| Acteur Mode-2 | Planificateur LLM : rollouts mentaux dans le modèle interne, choix du plan à moindre coût prédit |
| Configurateur | Contexte social/culturel de la tribu modulant les poids de coût (ex. décret divin ↑ cohésion) |

**Conséquence dataset :** chaque trajectoire enregistre **(état perçu, action, résultat prédit, résultat réel)**. L'écart — la **surprise** — sert de signal de saillance mémorielle et de cible d'entraînement d'un world model prédictif type JEPA. La vérité terrain permet de mesurer objectivement la qualité du modèle interne de chaque agent.

## 6. AgentRuntime

1. **Perception (10 Hz).** Rayon de vue ~12 m (réduit nuit/tempête), rayon d'ouïe ~20 m. Produit une observation structurée : objets + affordances disponibles, agents visibles (action, posture émotionnelle), sons (dialogues, cris, loup), lieu courant, météo/heure perçues. Seul ce document alimente la cognition.
2. **BeliefState.** Croyances datées mises à jour par observation (`berry_bush_07: { berriesLeft≈8, vu au tick 4210 }`). Elles se périment ; la divergence croyance/réalité est une métrique moteur.
3. **Besoins.** Décroissance continue selon activité, météo, heure (courir affame, la nuit refroidit, la solitude ronge l'affection). Coût total pondéré minimisé par Mode-1 (réflexe) et Mode-2 (rollouts).
4. **Corps et inventaire.** Inventaire à emplacements et capacité limitée (⇒ allers-retours de dépôt au camp) ; vitesse de déplacement ; exécution des affordances en temps réel dans l'espace : navigation par pas sur `getHeight` avec évitement simple, puis durée d'action. Plus aucun effet instantané.
5. **Interface de restitution.** Par agent : `{position, orientation, animation sémantique ('walk'|'gather'|'talk'|…), dialogue en cours}` — projetés par la démo sur les avatars RPM et leurs émotes existantes.

## 7. Cognition

1. **Mode-1 (utility, chaque tick, 0 latence).** Score par affordance connue = (réduction de coût prédite) ÷ (distance + durée) + poids d'urgence. Exécute le plan courant pas à pas ; l'interrompt si une urgence dépasse un seuil (arbitrage LeCun réactif/délibératif). Jamais d'attente LLM.
2. **Mode-2 (LLM via BFF, asynchrone).** Déclencheurs : aube (plan de journée), surprise forte, rencontre sociale notable, décret divin. Budget par agent (≤ 12 appels/jour simulé, chefs prioritaires). Prompt : carte d'identité (rôle, tribu, liens, traits), besoins, résumé du BeliefState, souvenirs pertinents (RAG), plan en cours. Réponse : tool-calling pur sur le schéma d'affordances — plan ordonné `[{goal, cible, resultat_predit}]`. Le `resultat_predit` est exigé et confronté au réel.
3. **Mémoire longue & réflexion (Smallville).** Souvenirs avec saillance = surprise + impact émotionnel ; stockage vectoriel via le RAG de `packages/ai` ; récupération récence × importance × pertinence. Réflexion nocturne : synthèse LLM des souvenirs du jour en enseignements durables qui enrichissent identité et liens.
4. **Dialogue agent↔agent.** Sur rencontre à motif social : échange court LLM (2-4 répliques, TTS spatial en VR). L'information circule (une pénurie entendue devient croyance de l'auditeur) — culture et rumeur émergent du transport d'information.
5. **Identité vivante.** Profil (traits, valeurs, liens, réflexions accumulées) remplaçant les rôles codés en dur ; c'est le configurateur qui module les poids Mode-1 et le persona Mode-2.

## 8. SimKernel

1. **Pas fixe.** Ticks de 100 ms simulées (10 Hz). Le client appelle `kernel.advance(realDelta)` (accumulateur). Un jour simulé = 2400 ticks (4 min réelles par défaut) ; échelle réglable à chaud (pause, ×1, ×10) ; rendu interpolé entre ticks pour 90 FPS.
2. **Déterminisme.** RNG xorshift seedé unique pour toute la stochasticité (météo, régénération, loup).
3. **LLM = entrées externes.** Les réponses LLM (non déterministes, asynchrones) sont journalisées comme les actions joueur : `{tick_de_réception, agent, plan_reçu}` dans l'event-log. Replay = réinjection du journal sans rappeler le LLM ⇒ rejeu exact. Pendant l'attente, l'agent poursuit en Mode-1 (latence invisible).
4. **Snapshots.** État complet (monde + agents + croyances + mémoires) sérialisé en JSON versionné : sauvegarde/reprise, bibliothèque de scénarios, A/B-test de deux politiques LLM sur la même situation.
5. **Headless.** `packages/simulation/src/headless.ts` : ticks aussi vite que CPU + LLM le permettent (~×50-100), lancé sur le BFF en batch. Même code, même contenu que la VR.

## 9. Télémétrie & dataset

### 9.1 Trois flux JSONL (`TrajectoryRecorder`, actif en VR et headless)

- **`decisions.jsonl`** — un enregistrement par appel Mode-2, au format messages tool-calling standard : `{messages: [system, user, assistant(tool_calls)], tools: schémas d'affordances, meta: {agent, tick, seed}}`. Directement consommable pour fine-tuning.
- **`predictions.jsonl`** — quadruplet LeCun `{état_perçu, action, résultat_prédit, résultat_réel, surprise}` à la résolution de chaque étape de plan. Dataset du world model prédictif (cibles JEPA).
- **`episodes.jsonl`** — journal narratif par tick (événements, dialogues, besoins) pour analyse, replay, évaluation humaine.

### 9.2 BFF

- `POST /agents/plan` : proxy LLM journalisant prompt/réponse côté serveur avant de répondre (capture indépendante du client).
- `POST /trajectories/batch` : ingestion des flux, stockage `datasets/{run_id}/` ; `GET /trajectories/stats` pour les volumes.

### 9.3 Métriques d'évaluation continues

Par agent et par run : (a) précision des croyances (divergence BeliefState ↔ vérité terrain), (b) erreur de prédiction moyenne (surprise), (c) bien-être (intégrale des coûts de besoins), (d) efficacité des plans (étapes réussies/abandonnées). Comparaison de modèles = deux runs même graine, quatre courbes.

### 9.4 Confidentialité

Segments issus du micro joueur marqués `source: 'player_voice'` (exclusion possible d'un dataset partagé). Clés API uniquement sur le BFF ; pipeline de sécurité BFF existant appliqué.

## 10. Monde vivant

1. **Cycle céleste continu.** Heure simulée 0-24 h ⇒ température et visibilité (moteur) ; soleil/lune, couleurs d'aube → nuit étoilée, ombres (démo VR). Les agents ressentent la nuit ⇒ regroupement au feu émergent.
2. **Météo dynamique.** Machine à états (clair → nuageux → pluie → orage, transitions seedées ; saisons en v2). Effets simulés : pluie éteint les feux non abrités, mouille le bois, remplit la rivière ; orage ⇒ stress ↑, recherche d'abri. Démo : particules, brouillard, audio.
3. **Écologie.** Nœuds qui se vident/repoussent ; gibier en population simulée abstraite v1 (densité par zone, chassable, migre si surchassé). La pénurie force exploration, échanges — ou conflits.
4. **Le loup.** Agent Mode-1 complet (sans LLM) : faim propre, territoire, chasse le gibier d'abord, rôde si affamé, attaque les isolés, fuit feu et nombre. Défense collective émergente par propagation de croyance (cri entendu), remplaçant le booléen global `isWolfAttacking`.
5. **Le joueur, être vivant.** Entité perçue dans l'index spatial : vu, entendu, mémorisé (don, aide, menace), relation individuelle par agent. Dialogue vocal : STT (micro) → Mode-2 de l'agent → TTS spatial + lipsync (briques `packages/ai` existantes). Ses paroles entrent dans les croyances (mentir, promettre, enseigner possibles) ; interactions homme-agent capturées au dataset.

## 11. Tests

- **Moteur** : tests unitaires purs (pas de rendu) — affordances (préconditions/effets), perception (rayons, occlusions simples), décroissance des besoins, utility Mode-1, péremption des croyances, RNG/replay déterministe (même graine + même event-log ⇒ même état final), snapshots (round-trip sérialisation).
- **Cognition** : Mode-2 testé avec un `AgentPlanner` factice (plans injectés) ; validation du schéma tool-calling ; arbitrage interruption Mode-1/Mode-2.
- **Télémétrie** : conformité des JSONL aux schémas ; cohérence prédit/réel ; agrégation des métriques.
- **Intégration démo** : l'adaptateur VR projette l'état moteur sans dérive (positions, animations) ; `npx tsc --noEmit` sur tous les paquets ; suites existantes (303 tests) maintenues vertes.

## 12. Hors périmètre v1

Saisons complètes, agriculture/artisanat avancés, reproduction/génétique simulée (au-delà des naissances événementielles), multijoueur dans la simulation, fine-tuning automatisé en boucle fermée (le dataset est produit ; l'entraînement lui-même est un pipeline séparé), gibier incarné en 3D (abstrait en v1).

## 13. Ordre de construction (décomposition en plans)

Chaque étape aura son plan d'implémentation dédié :

1. **Kernel + GroundTruthWorld** : pas fixe, RNG, index spatial, catalogue de smart objects, tests de déterminisme.
2. **AgentRuntime + Mode-1** : perception, BeliefState, besoins, inventaire, navigation, utility AI — civilisation autonome sans LLM, observable en headless.
3. **Adaptateur VR** : remplacement de `apps/demo/src/simulation/*`, projection sur avatars RPM, cycle céleste + météo visuels.
4. **Mode-2 + mémoire + BFF** : `/agents/plan`, planificateur LLM, RAG mémoire, réflexion, dialogues agent↔agent.
5. **Télémétrie + headless batch** : les trois flux JSONL, `/trajectories`, métriques, runs batch.
6. **Joueur incarné + faune** : perception du joueur, dialogue vocal STT/TTS, loup comportemental, gibier.
