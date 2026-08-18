# TS-J2 — Décider du sort de SpeculativeDecodingEngine (BDD)

> Story : [TS-J2.sort-speculativedecodingengine.md](TS-J2.sort-speculativedecodingengine.md)

```gherkin
# language: fr
Fonctionnalité: Décodage spéculatif honnête
  Le module n'existe dans le build que s'il fait vraiment gagner du temps.

  Scénario: Branché, il mesure un vrai gain
    Étant donné un modèle draft et un modèle cible chargés dans le worker LLM
    Quand une génération passe par le décodage spéculatif
    Alors la télémétrie de speedup rapporte un ratio mesuré, pas simulé

  Scénario: Non branché, il n'est plus exporté
    Étant donné la décision de ne pas câbler le décodage spéculatif pour l'instant
    Quand on inspecte les exports publics du package
    Alors SpeculativeDecodingEngine n'y figure plus
```
