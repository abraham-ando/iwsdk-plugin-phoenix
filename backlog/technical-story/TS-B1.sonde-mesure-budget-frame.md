---
id: TS-B1
type: technical-story
title: "Généraliser la sonde de mesure au budget de frame"
epic: "Épic B — Mesure et budget de frame (voie 2)"
priority: P2
voie: 2
depends_on: "—"
status: "À faire"
gherkin: TS-B1.sonde-mesure-budget-frame.bdd.md
---

# TS-B1 — Généraliser la sonde de mesure au budget de frame

**Contexte.** `apps/demo/src/simulation/GpuContentionProbe.ts` mesure déjà les
intervalles inter-frames pendant une génération locale (`?probe-gpu=1`, sortie
console `[MESURE]`). Mais le budget de 11,1 ms n'est instrumenté nulle part
ailleurs : aucun système de `packages/ai` ni `packages/world` ne rapporte son
coût, et aucun test de perf n'existe.

**Objectif.** Une instrumentation activable (`?probe-frame=1`) échantillonne le
temps de frame p50/p95/p99 et le coût des systèmes les plus suspects (terrain,
flore, IA), au même format `[MESURE]`, relisible par
`iwsdk browser logs --pattern MESURE`.

*Implémente : `ai-runtime-engineer`. Relit : `perf-profiler`.*
