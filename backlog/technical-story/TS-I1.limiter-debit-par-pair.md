---
id: TS-I1
type: technical-story
title: "Limiter le débit par pair"
epic: "Épic I — Durcissement pour déploiement public (voie 8)"
priority: P2
voie: 8
depends_on: "—"
status: "À faire"
gherkin: TS-I1.limiter-debit-par-pair.bdd.md
---

# TS-I1 — Limiter le débit par pair

**Contexte.** [Spec approuvée](../docs/superpowers/specs/2026-08-15-rate-limiting-design.md)
le 15 août 2026, jamais implémentée (aucune occurrence de `RateLimit` dans
`packages/server`). `Physics.Kinematic` rejette déjà ce qu'un pair *affirme*
(vitesse, diagonale, pas de temps), et `Protocol` plafonne la taille d'un
`SIGNAL` à 16 KiB — mais rien ne borne la **fréquence** des messages. Le
throttling de `NetworkLODSystem` est côté client, donc coopératif : un
attaquant qui contrôle son client l'ignore. Bloquant pour tout déploiement où
les pairs sont des inconnus (le MMO RPG VR public visé par la vision produit).

**Objectif.** Un pair qui dépasse son budget de messages par seconde est
throttlé puis déconnecté, sans affecter les autres pairs de la même room.

*Implémente : `general-purpose`. Relit : `phoenix-networking-reviewer` +
`security-reviewer`.*
