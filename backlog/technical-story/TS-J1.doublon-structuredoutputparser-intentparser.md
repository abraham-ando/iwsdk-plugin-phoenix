---
id: TS-J1
type: technical-story
title: "Résorber le doublon StructuredOutputParser / IntentParser"
epic: "Épic J — Dette des modules orphelins d'IA (voie 9)"
priority: P3
voie: 9
depends_on: "—"
status: "À faire"
gherkin: TS-J1.doublon-structuredoutputparser-intentparser.bdd.md
---

# TS-J1 — Résorber le doublon StructuredOutputParser / IntentParser

**Contexte.** `CardinalIntelligenceSystem.queryNPC()` n'utilise que
`IntentParser` (regex `[ACTION: TYPE k=v]`). `src/structured/StructuredOutputParser.ts`
et `FunctionCallingSchema.ts` implémentent un second format (tool calls JSON)
et sont testés isolément, mais aucun système ne les appelle : deux
formats d'intent coexistent dans le code, un seul est vivant.

**Objectif.** Choisir un format d'intent unique — garder `IntentParser` et
supprimer le doublon, ou migrer `queryNPC()` vers le format structuré JSON
(plus robuste aux petits modèles) et supprimer `IntentParser`. Documenter le
choix dans le README du package.

*Implémente : `npc-behavior-engineer`. Relit : `ai-security-engineer`
(le format retenu doit rester compatible avec TS-A1/IntentGuard).*
