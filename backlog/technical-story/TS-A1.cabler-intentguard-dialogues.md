---
id: TS-A1
type: technical-story
title: "Câbler IntentGuard dans le chemin des dialogues"
epic: "Épic A — Sécurité et authentification (voie 1)"
priority: P1
voie: 1
depends_on: "—"
status: "Fait"
gherkin: TS-A1.cabler-intentguard-dialogues.bdd.md
---

# TS-A1 — Câbler IntentGuard dans le chemin des dialogues

**Contexte.** `packages/ai/src/security/IntentGuard.ts` (assainissement de
l'entrée joueur + politiques RBAC par archétype de PNJ) est exporté et testé,
mais `CardinalIntelligenceSystem.queryNPC()` passe le message joueur brut au
LLM et dispatche les intents parsés sans validation.

**Objectif.** Toute entrée joueur est assainie avant construction du prompt ;
tout intent est validé contre la politique du PNJ avant dispatch.

*Implémente : session en cours (worktree séparé). Relit : `ai-security-engineer`.*
