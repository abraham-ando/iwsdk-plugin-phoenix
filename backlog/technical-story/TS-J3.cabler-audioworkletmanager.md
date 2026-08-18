---
id: TS-J3
type: technical-story
title: "Câbler AudioWorkletManager dans le pipeline audio réel"
epic: "Épic J — Dette des modules orphelins d'IA (voie 9)"
priority: P4
voie: 9
depends_on: "—"
status: "À faire"
gherkin: TS-J3.cabler-audioworkletmanager.bdd.md
---

# TS-J3 — Câbler AudioWorkletManager dans le pipeline audio réel

**Contexte.** `src/audio/AudioWorkletManager.ts` gère un ring buffer sans
allocation pour l'audio PCM, mais rien dans `CardinalSpatialAudioSystem` ni
`LipSyncSystem` ne l'utilise aujourd'hui.

**Objectif.** Le pipeline TTS→audio spatial passe réellement par ce ring
buffer plutôt que par une éventuelle copie intermédiaire.

*Implémente : `ai-runtime-engineer`. Relit : `perf-profiler`.*
