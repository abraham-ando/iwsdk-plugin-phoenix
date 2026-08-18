# TS-K2 — Occlusion de profondeur MR réelle (BDD)

> Story : [TS-K2.occlusion-profondeur-mr-reelle.md](TS-K2.occlusion-profondeur-mr-reelle.md)

```gherkin
# language: fr
Fonctionnalité: Occlusion par la profondeur réelle en MR
  Un PNJ virtuel disparaît derrière un objet physique, pas seulement virtuel.

  @device
  Scénario: Un PNJ est occulté par un meuble réel
    Étant donné une session MR avec depth sensing actif
    Et un PNJ virtuel placé derrière une table physique du point de vue du joueur
    Alors le rendu du PNJ n'affiche pas les fragments plus proches que la table

  @device
  Scénario: Sans depth sensing disponible, le rendu reste correct
    Étant donné un appareil sans capteur de profondeur
    Quand la session MR démarre
    Alors le PNJ se rend normalement, sans tentative d'occlusion
    Et aucune erreur n'apparaît dans la console
```
