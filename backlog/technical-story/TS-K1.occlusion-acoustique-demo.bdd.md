# TS-K1 — Brancher l'occlusion acoustique dans la démo (BDD)

> Story : [TS-K1.occlusion-acoustique-demo.md](TS-K1.occlusion-acoustique-demo.md)

```gherkin
# language: fr
Fonctionnalité: Occlusion acoustique effective
  Un mur entre le joueur et un PNJ change réellement ce qu'on entend.

  @dom
  Scénario: Une occlusion mesurable derrière un obstacle
    Étant donné un PNJ parlant, séparé du joueur par le terrain
    Quand le joueur se place derrière un relief occludant
    Alors le filtre passe-bas appliqué à sa voix descend vers 700 Hz

  @dom
  Scénario: Aucune occlusion en ligne de vue directe
    Étant donné un PNJ parlant en ligne de vue directe du joueur
    Alors le filtre appliqué à sa voix reste proche de 20 kHz
```
