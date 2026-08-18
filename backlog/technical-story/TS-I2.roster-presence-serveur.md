---
id: TS-I2
type: technical-story
title: "Roster de présence côté serveur"
epic: "Épic I — Durcissement pour déploiement public (voie 8)"
priority: P3
voie: 8
depends_on: "—"
status: "À faire"
gherkin: TS-I2.roster-presence-serveur.bdd.md
---

# TS-I2 — Roster de présence côté serveur

**Contexte.** [FEASIBILITY.md](../docs/FEASIBILITY.md) §4 liste `Phoenix.Presence`
parmi ce qui a été délibérément non livré. `Room.State` connaît déjà la
membership pour ses propres besoins (allocation d'id, AoI), mais rien
n'expose de roster standard côté canal Phoenix pour un client externe
(overlay web de modération, tableau de bord de salle).

**Objectif.** `RoomChannel` track chaque pair via `Phoenix.Presence`, avec les
métadonnées minimales (network_id, heure de connexion).

*Implémente : `general-purpose`. Relit : `phoenix-networking-reviewer` +
`bff-backend-engineer`.*
