# US-B2 — Session de mesure sur Quest 3 physique (BDD)

> Story : [US-B2.mesure-quest3-physique.md](US-B2.mesure-quest3-physique.md)

```gherkin
# language: fr
Fonctionnalité: Vérité terrain sur casque
  Les tests verts ne prouvent rien; seul le casque tranche.

  @device
  Scénario: La scène complète tient son budget sur Quest 3
    Étant donné la démo servie en HTTPS accessible depuis le casque
    Et une capture Perfetto démarrée sur l'appareil
    Quand le joueur parcourt le village pendant 2 minutes, PNJ actifs
    Alors le p95 du temps de frame mesuré est inférieur ou égal au budget cible
    Et aucune saccade de plus de 3 frames consécutives perdues n'est enregistrée

  @device
  Scénario: La délibération locale annonce honnêtement son coût
    Étant donné le panneau d'IA locale affiché dans le casque
    Quand le joueur active la délibération locale
    Alors l'avertissement de coût XR est visible avant l'activation
    Et la sonde rapporte l'écart de temps de frame pendant une génération
```
