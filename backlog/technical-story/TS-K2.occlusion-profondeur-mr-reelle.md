---
id: TS-K2
type: technical-story
title: "Occlusion de profondeur MR réelle"
epic: "Épic K — Occlusion perçue par le joueur (voie 10)"
priority: P4
voie: 10
depends_on: "—"
status: "À faire"
gherkin: TS-K2.occlusion-profondeur-mr-reelle.bdd.md
---

# TS-K2 — Occlusion de profondeur MR réelle

**Contexte.** `src/mr/MRDepthOcclusionHelper.ts` applique des indicateurs de
matériau (`depthTest`/`depthWrite`/`transparent`/`renderOrder`) sur une
hiérarchie Three, mais n'appelle jamais la WebXR Depth Sensing API — c'est un
utilitaire de matériaux, pas une occlusion réelle par la géométrie du monde
physique. IWSDK expose déjà `DepthSensingSystem` (skill `iwsdk-depth-occlusion`).

**Objectif.** Un système consomme la profondeur réelle du monde physique pour
occulter les PNJ et objets virtuels derrière un meuble ou un mur réel, en
s'appuyant sur `DepthSensingSystem` plutôt qu'en le réimplémentant.

*Implémente : `graphics-tech-artist`. Relit : `vr-comfort-ux-reviewer` +
`iwsdk-project-code-reviewer`.*
