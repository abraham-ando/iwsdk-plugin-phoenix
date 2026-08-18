# US-D2 — Les huit métiers façonnent les onze villageois (BDD)

> Story : [US-D2.huit-metiers-onze-villageois.md](US-D2.huit-metiers-onze-villageois.md)

```gherkin
# language: fr
Fonctionnalité: Morphologies de métier
  Le corps d'un villageois porte vingt ans de son métier.

  Scénario: Chaque villageois reçoit le génome de son métier
    Étant donné le scénario du village et la table rôle-métier validée
    Quand les génomes des onze villageois sont construits
    Alors chaque génome reprend les gènes du preset de son métier
    Et l'âge de chaque villageois tombe dans la plage d'âge du preset

  Scénario: Deux métiers opposés produisent des corps discernables
    Étant donné le villageois au preset "ferronnier" et celui au preset "chercheur"
    Quand leurs morphologies sont compilées au même âge
    Alors la largeur d'épaules compilée du ferronnier dépasse celle du chercheur
    Et la masse corporelle compilée du chercheur est inférieure

  @in-scene
  Scénario: La silhouette est visible en scène
    Étant donné la démo chargée avec les génomes de métier
    Quand je compare les corps de "Sira" et d'un villageois d'un autre métier
    Alors leurs échelles d'os compilées diffèrent au-delà du seuil de recompilation
```
