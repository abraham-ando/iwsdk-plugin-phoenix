# TS-I1 — Limiter le débit par pair (BDD)

> Story : [TS-I1.limiter-debit-par-pair.md](TS-I1.limiter-debit-par-pair.md)

```gherkin
# language: fr
Fonctionnalité: Limitation de débit par pair
  Un pair hostile ne peut pas coûter plus qu'un budget fixe à une room.

  Scénario: Un pair sous le seuil n'est jamais affecté
    Étant donné un pair envoyant des transforms au débit publié attendu
    Quand une minute de trafic s'écoule
    Alors aucun message de ce pair n'est rejeté

  Scénario: Un pair en rafale est throttlé puis reconnecté
    Étant donné un pair dépassant le seuil de messages par seconde
    Quand il continue d'émettre au-delà du seuil
    Alors ses messages excédentaires sont rejetés sans crash de la room
    Et les autres pairs de la même room ne voient aucune dégradation

  Scénario: Un pair qui persiste au-delà de la tolérance est déconnecté
    Étant donné un pair déjà throttlé qui ne réduit pas son débit
    Quand la fenêtre de tolérance expire
    Alors le pair est déconnecté avec une raison explicite
    Et la room continue de fonctionner pour les pairs restants
```
