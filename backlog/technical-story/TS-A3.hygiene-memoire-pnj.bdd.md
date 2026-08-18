# TS-A3 — Hygiène de la mémoire PNJ (purge + isolation) (BDD)

> Story : [TS-A3.hygiene-memoire-pnj.md](TS-A3.hygiene-memoire-pnj.md)

```gherkin
# language: fr
Fonctionnalité: Cycle de vie de la mémoire des PNJ
  La mémoire d'un PNJ meurt avec lui, et deux mondes ne partagent rien.

  Scénario: La destruction d'un PNJ libère son historique
    Étant donné un PNJ ayant échangé 6 répliques avec le joueur
    Quand l'entité du PNJ est détruite
    Alors son historique de dialogue n'est plus accessible
    Et la mémoire du plugin ne référence plus son id d'entité

  Scénario: Deux mondes n'échangent aucun souvenir
    Étant donné deux installations du plugin dans deux mondes distincts
    Et un PNJ d'id 7 dans chaque monde
    Quand le PNJ du premier monde mémorise "le joueur m'a offert une baie"
    Alors l'historique du PNJ d'id 7 du second monde est vide

  Scénario: dispose() ne laisse rien derrière lui
    Étant donné un monde avec 3 PNJ ayant chacun un historique
    Quand le plugin est disposé
    Alors la mémoire ne contient plus aucune entrée
```
