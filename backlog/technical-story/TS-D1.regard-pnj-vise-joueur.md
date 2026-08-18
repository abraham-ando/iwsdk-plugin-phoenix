---
id: TS-D1
type: technical-story
title: "Le regard des PNJ vise réellement le joueur"
epic: "Épic D — PNJ vivants (voie 4)"
priority: P3
voie: 4
depends_on: "—"
status: "À faire"
gherkin: TS-D1.regard-pnj-vise-joueur.bdd.md
---

# TS-D1 — Le regard des PNJ vise réellement le joueur

**Contexte.** `GazeIKSystem` stocke la pose du joueur mais le calcul de
`targetYaw` n'oriente que le jitter de saccade — le PNJ ne regarde pas
vraiment son interlocuteur.

**Objectif.** Le yaw/pitch cible est dérivé du vecteur PNJ→joueur, clampé par
`maxTurnAngleDeg`, saccades conservées par-dessus.

*Implémente : `npc-behavior-engineer`. Relit : `vr-comfort-ux-reviewer`.*
