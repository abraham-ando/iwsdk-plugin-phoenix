---
id: TS-E1
type: technical-story
title: "Les secteurs persistants survivent au redémarrage"
epic: "Épic E — Persistance (voie 5)"
priority: P4
voie: 5
depends_on: "—"
status: "À faire"
gherkin: TS-E1.secteurs-persistants-redemarrage.bdd.md
---

# TS-E1 — Les secteurs persistants survivent au redémarrage

**Contexte.** Les snapshots de secteurs vivent en ETS (mémoire) : ils survivent
au départ de tous les joueurs mais pas à un redémarrage de nœud. La forme du
snapshot est déjà compatible avec le behaviour `IwsdkPhoenix.Persistence`
(buffer write-behind avec coalescing) ; il manque le branchement.

*Implémente : `general-purpose` (Elixir). Relit : `bff-backend-engineer` +
`phoenix-networking-reviewer`.*
