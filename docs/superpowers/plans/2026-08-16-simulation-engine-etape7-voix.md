# Moteur de Simulation — Étape 7 : Voix (STT micro + TTS spatial) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boucler la spec §10.5 côté voix : les villageois **parlent à voix haute** (TTS Piper spatial positionné sur leur avatar — bulles de dialogue, réponses au joueur), et le joueur peut **parler au micro** (STT → transcript → `playerSpeak` existant). Zéro changement moteur : intégration pure des briques `@iwsdk/plugin-cardinal-ai` déjà enregistrées par `installCardinalAI` dans la démo.

**Architecture:** Un `VillagerVoices` côté démo crée une entité ECS par villageois (`Transform` + `SpatialVoice`, pitch par genre) dont la position suit l'avatar chaque frame ; toute nouvelle réplique détectée par le cache `lastSpeech` existant part en `CardinalSpatialAudioSystem.speak(entity, text)`. Le micro : une entité `VoiceReceiver` + bouton 🎤 press-to-talk dans le HUD → `VoiceInputSystem.onTranscript` → `system.playerSpeak(transcript)` — exactement le même chemin que le texte (mémoires, LLM, dataset `player_text`).

**Contraintes :** dégradation silencieuse si adaptateur TTS/STT pas prêt (pas de blocage) ; pas d'allocation par frame (positions via `getVectorView`) ; `voiceId: 0` dans `SpatialVoice` (champ numérique — la voix Piper `fr_FR-siwis-medium` est le défaut du système) ; vérification = typecheck + builds (pas de runner de tests démo).

---

### Task 1 : `VillagerVoices` — TTS spatial suivant les avatars

**Files:** Create `apps/demo/src/simulation/VillagerVoices.ts` ; Modify `CardinalSimulationSystem.ts`.

- `class VillagerVoices`:
  - `constructor(world: World)` — capture `world.getSystem(CardinalSpatialAudioSystem)`.
  - `register(agentId: string, gender: 'masculine' | 'feminine'): void` — `world.createEntity()` + `Transform` + `SpatialVoice { voiceId: 0, pitch: gender === 'feminine' ? 1.12 : 0.92 }` ; map `agentId → entity`.
  - `updatePosition(agentId, x, y, z): void` — `entity.getVectorView(Transform, 'position')` muté en place (piège elics 3.4 : jamais `setValue` sur un Vec3).
  - `speak(agentId, text): void` — no-op si système absent ; sinon `void system.speak(entity, text)` (fire-and-forget ; `speak` gère lui-même `isReady`/`isPlaying`).
  - `dispose()`.
- `CardinalSimulationSystem` : dans `init()`, après `registerPlayer`, instancier `this.voices = new VillagerVoices(this.world)` et `register` chaque agent de `VILLAGE_LAYOUT.agents` (genre disponible). Dans `projectScene`, au point exact du cache `lastSpeech` (nouvelle réplique) : `this.voices.speak(view.id, view.dialogue)` ; et à chaque vue projetée : `this.voices.updatePosition(view.id, view.x, view.y, view.z)`.

- [ ] Implémenter, `pnpm --filter @iwsdk/plugin-phoenix-demo typecheck`. Commit `feat(demo): spatial piper voices following villager avatars`.

---

### Task 2 : Micro joueur — press-to-talk STT

**Files:** Create `apps/demo/src/simulation/PlayerMicrophone.ts` ; Modify `simulation-hud.ts`, `index.ts`.

- `class PlayerMicrophone`:
  - `constructor(world: World, onTranscript: (text: string) => void)` — capture `world.getSystem(VoiceInputSystem)` ; crée une entité `VoiceReceiver` ; s'abonne `voiceSystem.onTranscript((t) => onTranscript(t))`.
  - `async start(): Promise<boolean>` — `startMicrophone(entity)` (permission micro navigateur) ; false + warn unique si indisponible.
  - `stop(): void` — `stopMicrophone(entity)`.
  - `get active(): boolean`.
- HUD : bouton `🎤` à côté du champ texte — toggle : inactif gris → actif rouge (`#dc2626`, label `🎤 REC`) ; branché sur un `PlayerMicrophone` construit dans `index.ts` avec `onTranscript = (t) => simSystem.playerSpeak(t)` et passé au constructeur du HUD (paramètre optionnel `microphone?`). Si `start()` échoue, bouton désactivé avec title explicatif — le champ texte reste la voie sûre.

- [ ] Implémenter, typecheck. Commit `feat(demo): push-to-talk microphone wired to villager dialogue`.

---

### Task 3 : Vérification finale

- [ ] `pnpm typecheck && pnpm test && pnpm build && pnpm demo:build` — tout vert (aucun changement moteur/BFF : les 436 tests doivent rester inchangés).
- [ ] Commit final si retouches.

**Couverture spec :** §10.5 voix agents→joueur (T1), joueur→agents (T2) ; §13.6 reliquat vocal soldé. Hors périmètre : lipsync morphé (nos avatars n'ont pas de morph targets — viendra avec les GLB RPM), TTS des NPCs Cardinal historiques (déjà géré par leur propre pile).
