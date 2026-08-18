# TS-A2 — La démo s'authentifie via le BFF, plus de clé en dur (BDD)

> Story : [TS-A2.authentification-bff-demo.md](TS-A2.authentification-bff-demo.md)

```gherkin
# language: fr
Fonctionnalité: Authentification de la démo auprès du BFF
  La clé du fournisseur LLM vit uniquement dans l'environnement du BFF.

  @dom
  Scénario: Le client obtient un jeton puis dialogue via le proxy
    Étant donné le BFF démarré avec une clé fournisseur dans son environnement
    Quand la démo démarre son village IA
    Alors une requête POST /api/auth/session a été émise
    Et les requêtes de chat partent vers /api/v1/cardinal/chat
    Et aucune requête sortante ne porte la clé fournisseur

  @dom
  Scénario: Un jeton expiré est renouvelé sans erreur visible
    Étant donné une session dont le jeton expire dans 5 secondes
    Quand le joueur dialogue avec un PNJ après l'expiration
    Alors une nouvelle session est obtenue automatiquement
    Et la réponse du PNJ arrive sans erreur affichée

  Scénario: Sans BFF joignable, la démo reste utilisable
    Étant donné aucun BFF joignable
    Quand la démo démarre son village IA
    Alors les PNJ répondent par leurs répliques de repli
    Et aucune exception non gérée n'apparaît dans la console
```
