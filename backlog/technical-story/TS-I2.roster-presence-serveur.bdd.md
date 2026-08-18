# TS-I2 — Roster de présence côté serveur (BDD)

> Story : [TS-I2.roster-presence-serveur.md](TS-I2.roster-presence-serveur.md)

```gherkin
# language: fr
Fonctionnalité: Roster de présence de la room
  N'importe quel canal peut lister qui est présent, sans lire l'état interne.

  Scénario: Un pair qui rejoint apparaît dans la présence
    Étant donné une room vide
    Quand un pair rejoint le canal
    Alors la présence de la room liste ce pair avec son network_id

  Scénario: Un pair qui part disparaît de la présence
    Étant donné deux pairs présents dans une room
    Quand l'un des deux se déconnecte
    Alors la présence ne liste plus que le pair restant

  Scénario: La présence survit à un handoff de zone
    Étant donné un pair en cours de transfert entre deux zones
    Quand le handoff se termine
    Alors le pair apparaît dans la présence de la zone de destination
    Et n'apparaît plus dans celle de la zone d'origine
```
