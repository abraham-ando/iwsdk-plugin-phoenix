---
id: TS-J2
type: technical-story
title: "Décider du sort de SpeculativeDecodingEngine"
epic: "Épic J — Dette des modules orphelins d'IA (voie 9)"
priority: P4
voie: 9
depends_on: "—"
status: "À faire"
gherkin: TS-J2.sort-speculativedecodingengine.bdd.md
---

# TS-J2 — Décider du sort de SpeculativeDecodingEngine

**Contexte.** `src/speculative/SpeculativeDecodingEngine.ts` évalue un lot de
tokens draft contre un seuil de probabilité et calcule une télémétrie de
speedup — mais c'est un estimateur pur : aucun couple modèle draft/cible réel
ne l'alimente, et aucun worker ne l'appelle.

**Objectif.** Soit le brancher sur `llm.worker.ts` avec un vrai modèle draft
(WebLLM le permet), soit le retirer du build tant qu'aucun modèle draft n'est
choisi — pas de code mort exporté publiquement entre les deux.

*Implémente : `ai-runtime-engineer`. Relit : `perf-profiler`.*
