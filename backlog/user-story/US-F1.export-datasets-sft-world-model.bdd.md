# US-F1 — Exporter les datasets SFT et world-model (BDD)

> Story : [US-F1.export-datasets-sft-world-model.md](US-F1.export-datasets-sft-world-model.md)

```gherkin
# language: fr
Fonctionnalité: Export des jeux d'entraînement
  Une nuit de village devient deux datasets prêts pour le fine-tuning.

  Scénario: Un run headless produit les deux flux
    Étant donné un run headless de 2 jours simulés avec la graine 42
    Quand l'export de datasets est lancé
    Alors un jeu "policy" au format chat SFT est produit
    Et un jeu "world-model" de paires prédiction-réalité est produit
    Et chacun est découpé en train et valid

  Scénario: Le même run produit les mêmes datasets
    Étant donné deux runs headless avec la même graine et la même durée
    Quand leurs exports sont comparés
    Alors les fichiers produits sont identiques octet pour octet

  Scénario: Les dires du joueur sont marqués et anonymes
    Étant donné une trajectoire contenant un dialogue avec le joueur
    Quand l'export est produit
    Alors les tours du joueur portent le marquage "player_text"
    Et aucun identifiant d'appareil ou de session n'apparaît dans l'export
```
