---
id: TS-K1
type: technical-story
title: "Brancher l'occlusion acoustique dans la démo"
epic: "Épic K — Occlusion perçue par le joueur (voie 10)"
priority: P3
voie: 10
depends_on: "—"
status: "À faire"
gherkin: TS-K1.occlusion-acoustique-demo.bdd.md
---

# TS-K1 — Brancher l'occlusion acoustique dans la démo

**Contexte.** `AcousticOcclusionSystem` est enregistré par `plugin.ts` (donc
actif) mais reste inerte tant qu'aucun raycaster ne lui est fourni via
`setRaycaster` — et aucun appel de ce genre n'existe dans `apps/demo/src`.
Résultat : le système tourne chaque frame sans jamais produire d'effet.

**Objectif.** La démo injecte un raycaster réel (contre le mesh de terrain et
les objets solides) au montage du village IA.

*Implémente : `ai-runtime-engineer`. Relit : `vr-comfort-ux-reviewer` +
`graphics-tech-artist`.*
