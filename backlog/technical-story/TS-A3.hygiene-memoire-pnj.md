---
id: TS-A3
type: technical-story
title: "Hygiène de la mémoire PNJ (purge + isolation)"
epic: "Épic A — Sécurité et authentification (voie 1)"
priority: P1
voie: 1
depends_on: "—"
status: "À faire"
gherkin: TS-A3.hygiene-memoire-pnj.bdd.md
---

# TS-A3 — Hygiène de la mémoire PNJ (purge + isolation)

**Contexte.** `packages/ai/src/components/NPCMemory.ts:13` stocke l'historique
de dialogue dans une `Map` globale au module, indexée par id d'entité : pas de
purge à la destruction d'entité, et deux `World` du même bundle partagent la
map.

**Objectif.** La mémoire est possédée par l'installation du plugin (namespace
par monde), purgée au `dispose()` et à la destruction d'entité.

*Implémente : `ai-runtime-engineer`. Relit : `ai-security-engineer`
(fuite inter-sessions).*
