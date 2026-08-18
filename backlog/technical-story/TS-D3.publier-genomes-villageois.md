---
id: TS-D3
type: technical-story
title: "Publier réellement les génomes des villageois"
epic: "Épic D — PNJ vivants (voie 4)"
priority: P3
voie: 4
depends_on: "—"
status: "Fait"
gherkin: TS-D3.publier-genomes-villageois.bdd.md
---

# TS-D3 — Publier réellement les génomes des villageois

**Contexte.** Constat épinglé par `main@43449f1` : `CardinalPublisher.collect()`
n'est appelé que pour les entités `isLocalOwner: true`, et aucun chemin du
dépôt ne donne cette propriété aux villageois — donc **aucun pair ne publie
`CharacterGenome` aujourd'hui** ; un test de non-régression fige ce comportement
incomplet en attendant une décision.

**Décision d'architecture à trancher avant implémentation** (avec
`phoenix-networking-reviewer`) : qui possède les villageois — des objets
répliqués possédés par le serveur (cohérent avec l'autorité serveur), ou un
pair hôte désigné ? La réponse conditionne le mode `host_relayed`.

*Implémente : `general-purpose`. Relit : `phoenix-networking-reviewer`.*
