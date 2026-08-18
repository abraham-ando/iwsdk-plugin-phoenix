---
id: US-D2
type: user-story
title: "Les huit métiers façonnent les onze villageois"
epic: "Épic D — PNJ vivants (voie 4)"
priority: P3
voie: 4
depends_on: "—"
status: "À faire"
gherkin: US-D2.huit-metiers-onze-villageois.bdd.md
---

# US-D2 — Les huit métiers façonnent les onze villageois

**Story.** En tant que joueur, je veux reconnaître le métier d'un villageois à
sa silhouette — la charpente du ferronnier, la maigreur du chercheur — afin
que le village raconte son organisation sans qu'on me l'explique. Les presets
existent (`packages/character/src/presets/metiers.ts`) et les villageois ont
des génomes fixes (`apps/demo/src/simulation/villagerGenomes.ts`), mais les
deux ne sont pas reliés.

**Décision de design à trancher avec `simulation-designer` avant
implémentation** : la correspondance rôle préhistorique → métier (les personas
actuelles — Éclaireur, Artisane, Pisteur… — ne recouvrent pas les huit métiers
un pour un).

*Implémente : `general-purpose`. Relit : `cardinal-genome-reviewer` +
`simulation-designer`.*
