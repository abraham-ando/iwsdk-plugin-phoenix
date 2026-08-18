---
id: US-F1
type: user-story
title: "Exporter les datasets SFT et world-model"
epic: "Épic F — Usine à données (voie 6)"
priority: P4
voie: 6
depends_on: "—"
status: "À faire"
gherkin: US-F1.export-datasets-sft-world-model.bdd.md
---

# US-F1 — Exporter les datasets SFT et world-model

**Story.** En tant que chercheur, je veux transformer les trajectoires
collectées par le BFF en deux jeux d'entraînement distincts — politique
d'action (tool-calling) et modèle du monde prédictif (paires prédit/réel) —
afin de fermer la boucle simulation → données → fine-tuning qui est la raison
d'être du programme Cardinal. Les briques existent (`headless.ts`,
`datasetExport.ts`, `/trajectories/batch`, `/trajectories/stats`) ; il manque
le chemin de bout en bout documenté et testé.

*Implémente : `general-purpose`. Relit : `simulation-designer` (qualité des
épisodes) + `ai-security-engineer` (aucune donnée joueur non anonymisée).*
