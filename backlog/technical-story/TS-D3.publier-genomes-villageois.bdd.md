# TS-D3 — Publier réellement les génomes des villageois (BDD)

> Story : [TS-D3.publier-genomes-villageois.md](TS-D3.publier-genomes-villageois.md)

```gherkin
# language: fr
Fonctionnalité: Réplication des génomes de villageois
  Un pair qui rejoint voit les mêmes corps que les pairs présents.

  @multi-contexte
  Scénario: Le génome voyage vers un pair déjà présent
    Étant donné deux clients "A" et "B" dans la même salle persistante
    Quand le génome du villageois d'id réseau fixe 200001 est modifié côté autorité
    Alors "A" et "B" décodent le même génome à l'octet près

  @multi-contexte
  Scénario: Un retardataire reçoit l'état courant
    Étant donné une salle où les génomes des villageois ont déjà été publiés
    Quand un client "C" rejoint la salle
    Alors "C" reçoit le dernier génome de chaque villageois via le cache
    Et les corps compilés chez "C" égalent ceux des pairs présents

  Scénario: Le test qui figeait l'absence de publication est retourné
    Étant donné la suite de réplication de la démo
    Alors le test de non-régression atteste désormais la publication effective
```
