# US-C3 — Éditer un villageois au panneau spatial (BDD)

> Story : [US-C3.editer-villageois-panneau-spatial.md](US-C3.editer-villageois-panneau-spatial.md)

```gherkin
# language: fr
Fonctionnalité: Fiche spatiale de personnage
  Désigner un villageois ouvre sa fiche; la modifier modifie son corps.

  @in-scene
  Scénario: Désigner un villageois ouvre sa fiche à hauteur de regard
    Étant donné la démo chargée avec les onze villageois
    Quand je clique le villageois "Sira" au rayon simulé
    Alors le panneau de personnage affiche l'onglet persona de "Sira"
    Et le panneau est placé en coordonnées monde, face au joueur

  @in-scene
  Scénario: Un réglage recompile le corps
    Étant donné la fiche de "Sira" ouverte sur l'onglet réglages
    Quand j'augmente le gène "bodyMass" d'un cran
    Alors le composant de génome de "Sira" reflète la nouvelle valeur
    Et sa morphologie compilée est marquée à recompiler dans la même frame

  @in-scene
  Scénario: Changer de villageois efface la fiche précédente
    Étant donné la fiche de "Sira" ouverte
    Quand je clique le villageois "Narek" au rayon simulé
    Alors le panneau affiche la persona de "Narek"
    Et aucun champ de "Sira" ne reste affiché
```
