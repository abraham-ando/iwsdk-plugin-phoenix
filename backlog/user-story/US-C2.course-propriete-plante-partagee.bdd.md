# US-C2 — Course de propriété de la plante partagée (BDD)

> Story : [US-C2.course-propriete-plante-partagee.md](US-C2.course-propriete-plante-partagee.md)

```gherkin
# language: fr
Fonctionnalité: Propriété arbitrée des objets partagés
  La préhension est optimiste, l'autorité ne l'est jamais.

  @in-scene @multi-contexte
  Scénario: Deux joueurs saisissent la plante en même temps
    Étant donné deux clients "A" et "B" connectés à la même salle
    Quand "A" et "B" saisissent la plante partagée à moins de 100 ms d'écart
    Alors le serveur accorde la propriété à exactement un des deux
    Et chez le perdant, la plante retourne à sa position autoritative
    Et le HUD des deux clients nomme le même détenteur

  @in-scene @multi-contexte
  Scénario: Le détenteur part, la plante redevient disponible
    Étant donné "A" détenteur de la plante partagée
    Quand "A" se déconnecte
    Alors "B" peut obtenir la propriété à sa prochaine demande
```
