# Moteur de Simulation — Étape 6 : Joueur incarné + Faune — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le joueur devient un être vivant du monde simulé (spec §10.5) : perçu et mémorisé par les agents, capable de leur parler (texte v1) avec réponses LLM personnalisées et marquage dataset `player_text` (spec §9.4). La faune arrive : terrains de chasse au gibier (population abstraite qui se régénère), et le **loup** — un prédateur Mode-1 déterministe avec faim, territoires de chasse, approche des camps en disette, fuite devant le feu — que les agents craignent (stress, souvenirs, réflexe de repli au feu).

**Architecture:** Tout état joueur/loup vit dans le moteur, piloté par des mécanismes existants : la position du joueur entre par événements externes journalisés (`player_move` échantillonné ~1 Hz — replay exact conservé), sa parole par `player_speak` ; la réponse de l'agent revient par `llm_player_reply` (nouvelle raison Mode-2 `player_dialogue`). Le loup est un automate déterministe (`WolfSystem`) alimenté par le rng du kernel, sérialisé en option dans le snapshot. Les agents perçoivent joueur et loup par le canal de perception normal (entrées `PerceivedAgent` spéciales `player`/`wolf`).

**Tech Stack:** inchangé. **Spec:** sections 10.3–10.5, 9.4, 13.6 (voix STT/TTS → étape 7).

## Global Constraints

- Déterminisme intact : `player_move`/`player_speak` sont des événements externes journalisés ; le loup ne consomme le rng que dans des handlers `onTick` ordonnés.
- Le joueur n'est PAS un `AgentState` (pas de besoins/plan) : c'est une présence perçue + une source d'événements.
- Les décisions issues de la parole joueur portent `meta.source: 'player_text'` dans `decisions.jsonl` (spec §9.4).
- Sans BFF, `player_speak` reste sans réponse mais mémorisé — jamais de blocage.
- Conventions inchangées (TDD moteur/BFF, typecheck démo, commits `feat(...)` + trailer).

---

## Structure de fichiers cible

```
packages/simulation/src/
├── content/objects.ts      (modifié) hunting_ground ; intrinsics.ts: eat_meat
├── content/scenario.ts     (modifié) 2 terrains de chasse (objets 21→23)
├── agents/Mode2.ts         (modifié) raison 'player_dialogue'
├── agents/AgentRuntime.ts  (modifié) joueur : présence, vue, parole, réponses ;
│                           peur du loup (stress + repli au feu)
├── world/WolfSystem.ts     (nouveau) FSM prédateur déterministe
├── telemetry/TrajectoryRecorder.ts (modifié) meta.source player_text
├── telemetry/MockPlanner.ts (modifié) réponse player_dialogue
└── kernel/snapshot.ts      (modifié) wolf optionnel

packages/simulation/test/
├── fauna.test.ts  player.test.ts  wolf.test.ts

apps/bff-server/src/server.ts  (modifié) prompt player_dialogue
apps/demo/src/simulation/
├── CardinalSimulationSystem.ts (modifié) feed position joueur, vue loup
├── WolfVisual.ts               (nouveau) mesh loup projeté
├── Mode2Client.ts              (modifié) mapping player_dialogue
├── simulation-hud.ts           (modifié) champ « Parler aux villageois »
└── index.ts                    (inchangé — wiring existant suffit)
```

---

### Task 1 : Faune passive — terrains de chasse et viande

**Files:** Modify `content/objects.ts`, `agents/intrinsics.ts`, `content/scenario.ts` ; Test `test/fauna.test.ts` (+ mise à jour `scenario.test.ts` : 23 objets).

**Interfaces:**
- Smart object `hunting_ground` : état `{ gameLeft: 5 }`, regrowth `+1/jour max 5` ; affordance `hunt` (durée 80 ticks, préconds `gameLeft > 0`, distance `< 3` ; effets objet `gameLeft: -1`, inventaire `meat: +1`).
- Intrinsèque `eat_meat` : préconds `meat >= 1`, durée 30, effets `meat: -1`, `hunger: +50`.
- `DEFAULT_VILLAGE.objects` += `{ type: 'hunting_ground', x: 10, z: -12 }` et `{ type: 'hunting_ground', x: -11, z: -9 }`.

- [ ] **Step 1 : Tests** (`fauna.test.ts`) : catalogue expose `hunt` avec les bons effets ; `eat_meat` déclaré ; un agent affamé avec `meat` en inventaire la mange (via `executeActionTick` intrinsèque) ; un `hunt` complet donne 1 viande et décrémente `gameLeft` ; scenario.test passe à 23 objets dont 2 `hunting_ground`.
- [ ] **Steps 2–4 : échec → implémentation → toute la suite verte** (le mock planner ne référence pas `hunt` — inchangé). **Step 5 : Commit** `feat(simulation): hunting grounds with abstract game population and meat`.

---

### Task 2 : Le joueur, être vivant perçu

**Files:** Modify `agents/AgentRuntime.ts`, `agents/Mode2.ts`, `telemetry/TrajectoryRecorder.ts`, `telemetry/MockPlanner.ts`, `src/index.ts` ; Test `test/player.test.ts`.

**Interfaces:**
- Constantes : `PLAYER_ID = 'player'`, `PLAYER_SIGHTING_COOLDOWN = 600`, `PLAYER_SPEAK_RADIUS = 6`.
- `AgentRuntime` :
  - `registerPlayer(x: number, z: number): void` / `playerPosition(): { x: number; z: number } | null` — état interne `{ x, z, lastSightingByAgent: Map<string, number> }`.
  - Le joueur apparaît dans les `others` de la perception (`{ id: PLAYER_ID, verb: null }`) → les agents le voient/entendent naturellement.
  - Première vue (et re-vue après cooldown 600 ticks) : mémoire importance 3 `« J'ai croisé l'étranger près de {place} »`.
  - Événement externe `player_move` `{ x, z }` → met à jour la position (ignoré si pas de joueur enregistré).
  - Événement externe `player_speak` `{ text, targetAgentId? }` : cible = agent désigné, sinon l'agent le plus proche à ≤ 6 m (sinon ignoré) ; mémoire importance 6 `« L'étranger m'a dit: "{text}" »` ; requête Mode-2 raison `'player_dialogue'` (budget + pending respectés), `participantIds: [PLAYER_ID, agentId]`, et le texte joueur transporté via `PlanRequest.playerText`.
  - Événement externe `llm_player_reply` `{ requestId, agentId, reply }` : libère le pending, `speech` (bulle, 50 ticks), mémoire importance 4 `« J'ai répondu à l'étranger: "{reply}" »`.
- `Mode2.ts` : `PlanRequestReason` += `'player_dialogue'` ; `PlanRequest.playerText?: string` ; `buildPlanRequest` accepte un paramètre optionnel `playerText`.
- `TrajectoryRecorder` : les décisions dont `request.reason === 'player_dialogue'` portent `meta.source: 'player_text'` (spec §9.4) ; l'assistant est `{ role: 'assistant', content: JSON.stringify(payload) }` (pas de tool_calls).
- `MockPlanner` : `player_dialogue` → `{ reply: 'Bienvenue près de notre feu, étranger.' }`.

- [ ] **Step 1 : Tests** (`player.test.ts`) :
  - le joueur enregistré est perçu : après 12 ticks, un agent proche a une mémoire « étranger » ; cooldown : pas de doublon immédiat.
  - `player_move` déplace la présence (nouvel agent loin ne le voit pas, puis le voit après déplacement).
  - `player_speak` sans cible : l'agent le plus proche mémorise le texte et une requête `player_dialogue` part avec `playerText` et `participantIds` corrects.
  - `llm_player_reply` : bulle (`view(...).dialogue`), mémoire de réponse, pending libéré.
  - replay : un run avec `player_move`+`player_speak` rejoué depuis le journal donne le même état agent.
  - recorder : une décision `player_dialogue` appariée porte `meta.source === 'player_text'`.
- [ ] **Steps 2–4 : échec → implémentation → suite verte.** **Step 5 : Commit** `feat(simulation): embodied player presence, text speech and llm replies`.

---

### Task 3 : Le loup — prédateur Mode-1

**Files:** Create `world/WolfSystem.ts` ; Modify `agents/AgentRuntime.ts` (peur/repli), `kernel/snapshot.ts` (wolf optionnel), `src/index.ts` ; Test `test/wolf.test.ts`.

**Interfaces:**
- `interface WolfState { x: number; z: number; hunger: number; mode: 'roam' | 'hunt' | 'stalk' | 'flee'; targetX: number; targetZ: number }`
- `class WolfSystem { constructor(world: GroundTruthWorld, runtime: AgentRuntime); attachTo(kernel: SimKernel): () => void; state(): Readonly<WolfState>; view(): { x, y, z, heading, mode } ; toJSON()/fromJSON-compatible }`
- FSM par tick (vitesse 1.8 m/s, pas de 0.1 s, spawn (0, −14), faim −0.03/tick) :
  - `roam` : cap vers `targetX/Z` (waypoint rng parmi ±20 m, renouvelé à l'arrivée) ; si `hunger < 55` → `hunt`.
  - `hunt` : cap vers le `hunting_ground` avec `gameLeft > 0` le plus proche ; à ≤ 2 m : `gameLeft −1`, `hunger = 100`, → `roam`. Aucun gibier nulle part → `stalk`.
  - `stalk` : cap vers l'agent le plus proche ; ne mord pas en v1 — la menace suffit ; si `hunger` remonte (proie via hunt possible à nouveau) → `hunt`.
  - `flee` (prioritaire) : si feu allumé à ≤ 6 m OU ≥ 2 agents à ≤ 6 m → cap opposé pendant 100 ticks, puis `roam`.
- Peur côté agents (dans `AgentRuntime.tickAgent`, si un `WolfSystem` est enregistré via `runtime.attachWolf(wolf)`) : loup à ≤ 8 m → (cooldown 300 ticks/agent) `stress +25`, mémoire importance 7 `« Le loup rôde ! »` ; loup à ≤ 5 m ET pas de feu allumé à ≤ 4 m → l'action courante est interrompue et remplacée par un repli `goto` vers le feu de camp allumé cru le plus proche (source `'reflex'`).
- Le loup apparaît dans la perception des agents comme `PerceivedAgent { id: 'wolf', verb: mode }`.
- Snapshot : `SimSnapshot.wolf?: WolfState` (optionnel, via paramètre supplémentaire de `snapshotSim` — même approche que `weather`).

- [ ] **Step 1 : Tests** (`wolf.test.ts`) :
  - déterminisme : deux `buildVillageSim` + loup, même graine, 2 000 ticks → états loup identiques.
  - la faim conduit au terrain de chasse : après assez de ticks, `gameLeft` d'un terrain a diminué et `hunger` du loup est remonté.
  - la peur : loup placé (état forcé) à 3 m d'un agent sans feu proche → stress de l'agent monte, mémoire « loup », et son action devient un `goto` (repli).
  - la fuite : loup placé à 3 m d'un feu allumé → mode `flee` au tick suivant.
  - snapshot round-trip du loup.
- [ ] **Steps 2–4 : échec → implémentation → suite verte.** **Step 5 : Commit** `feat(simulation): deterministic wolf predator with hunger, stalking and fire fear`.

---

### Task 4 : BFF — prompt player_dialogue

**Files:** Modify `apps/bff-server/src/server.ts` ; Test bff-server.test.ts (describe mock existant).

- `buildSystemPrompt` : cas `player_dialogue` → « Tu es {persona} ({role}, tribu {tribe}). Un étranger (le joueur) vient de te dire : "{playerText}". Réponds-lui en 1 ou 2 phrases, dans ton personnage, en français. JSON strict : {"reply":"..."} » (le type local `AgentPlanRequest` gagne `playerText?: string`).
- Mock : `player_dialogue` → `{ reply: 'Bienvenue près de notre feu, étranger.' }`.
- [ ] Test : requête `reason: 'player_dialogue'`, `playerText: 'Bonjour !'` → 200 avec `reply` non vide. **Commit** `feat(bff): player dialogue prompting and mock reply`.

---

### Task 5 : Démo — présence joueur, chat HUD, loup visible

**Files:** Create `apps/demo/src/simulation/WolfVisual.ts` ; Modify `CardinalSimulationSystem.ts`, `Mode2Client.ts`, `simulation-hud.ts` ; Verify complet.

- `CardinalSimulationSystem` :
  - `init()` : `this.runtime.registerPlayer(0, 2);` et `this.wolf = new WolfSystem(this.simWorld, this.runtime); this.runtime.attachWolf(this.wolf); this.wolf.attachTo(this.kernel);`
  - `update()` : toutes les ~1 s (accumulateur), lire la position du joueur (`(this.world as any).camera?.position` — fallback : origine du rig via `player.head`) et `kernel.submitEvent('player_move', { x, z })` si déplacement > 0,5 m.
  - `playerSpeak(text: string): void` → `kernel.submitEvent('player_speak', { text })` + événement HUD `🗣️ Vous : « {text} »`.
  - `attachScene` : `this.wolfVisual = new WolfVisual(sceneData.root);` ; `projectScene` : `this.wolfVisual?.update(this.wolf.view())`.
- `WolfVisual.ts` : reconstruit le mesh loup (corps/tête/yeux rouges/oreilles — reprendre le code supprimé à l'étape 3), `update(view)` : position (y = terrain), `rotation.y = heading`.
- `Mode2Client` : `EVENT_BY_REASON['player_dialogue'] = 'llm_player_reply'`.
- HUD : sous les boutons divins, champ texte + bouton `🗣️ Parler` → `system.playerSpeak(input.value)` (Enter aussi) ; placeholder « Parler aux villageois… ».
- [ ] Vérification finale : `pnpm typecheck && pnpm test && pnpm build && pnpm demo:build`. **Commit** `feat(demo): player presence feed, villager chat box and visible wolf`.

---

## Couverture spec (auto-contrôle)

| Exigence spec | Tâche(s) |
| :--- | :--- |
| Gibier population abstraite chassable qui se régénère (§10.3) | 1 |
| Joueur entité perçue, vu/entendu/mémorisé (§10.5) | 2 |
| Relation individuelle : mémoires par agent des interactions joueur (§10.5) | 2 |
| Parler aux agents, réponses en personnage (texte v1) (§10.5) | 2, 4, 5 |
| Marquage dataset des données issues du joueur (§9.4) | 2 |
| Loup : faim, chasse gibier d'abord, rôde si affamé, fuit le feu/le nombre (§10.4) | 3 |
| Défense/peur émergente côté agents (stress, repli au feu) (§10.4) | 3 |
| Replay exact avec entrées joueur (§8.3) | 2 (test) |
| Loup visible en VR (§13.6) | 5 |

Différés (étape 7) : voix STT→LLM→TTS spatial + lipsync (dépend du WIP `packages/ai` — exploration nécessaire), morsure/combat du loup, chasse des agents au gibier pilotée par le loup-écosystème.
