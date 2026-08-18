# TS-D1 — Le regard des PNJ vise réellement le joueur (BDD)

> Story : [TS-D1.regard-pnj-vise-joueur.md](TS-D1.regard-pnj-vise-joueur.md)

```gherkin
# language: fr
Fonctionnalité: Regard dirigé des PNJ
  Un PNJ en conversation regarde son interlocuteur, dans les limites du cou.

  Scénario: Le PNJ converge vers la direction du joueur
    Étant donné un PNJ face au nord et un joueur plein est à 2 mètres
    Quand 2 secondes de suivi de regard s'écoulent
    Alors le yaw de la tête du PNJ pointe vers le joueur à 10 degrés près

  Scénario: L'angle de cou est respecté
    Étant donné un joueur placé directement derrière le PNJ
    Quand le suivi de regard converge
    Alors le yaw de la tête ne dépasse jamais l'angle maximal configuré

  Scénario: Les micro-saccades subsistent autour de la cible
    Étant donné un PNJ dont le regard a convergé sur le joueur immobile
    Quand 10 secondes s'écoulent
    Alors le yaw oscille autour de la direction du joueur sans s'en écarter
```
