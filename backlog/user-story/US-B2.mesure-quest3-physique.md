---
id: US-B2
type: user-story
title: "Session de mesure sur Quest 3 physique"
epic: "Épic B — Mesure et budget de frame (voie 2)"
priority: P2
voie: 2
depends_on: "TS-B1"
status: "À faire"
gherkin: US-B2.mesure-quest3-physique.bdd.md
---

# US-B2 — Session de mesure sur Quest 3 physique

**Story.** En tant que directeur technique, je veux une mesure de la scène
complète (terrain streamé + flore instanciée + eau + 11 villageois + LLM local
actif) sur un Quest 3 physique, afin de savoir si le budget de frame tient
réellement — aucun test n'ayant jamais tourné sur casque.

**Critère chiffré à valider en séance** : p95 du temps de frame ≤ 13,9 ms
(72 Hz) en scène complète, et ≤ 11,1 ms (90 Hz) sans délibération locale.
Question ouverte pour la séance : quel mode d'affichage (72/90/120 Hz) est la
cible de confort du produit — la réponse fixe le budget définitif.

*Mène : `perf-profiler` (capture Perfetto via metavr). Constate : `xr-visual-qa`.*
