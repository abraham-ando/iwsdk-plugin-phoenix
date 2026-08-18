# TS-J4 — Le provider `anthropic-proxy` est réel ou retiré du type (BDD)

> Story : [TS-J4.provider-anthropic-proxy.md](TS-J4.provider-anthropic-proxy.md)

```gherkin
# language: fr
Fonctionnalité: Le type des providers ne ment pas
  Choisir un provider dans le type produit ce provider, jamais un autre.

  Scénario: anthropic-proxy résout vers le bon endpoint
    Étant donné un adaptateur cloud configuré avec provider "anthropic-proxy"
    Quand une requête de chat est résolue
    Alors l'URL de base et le format de requête sont ceux de l'API Messages Anthropic
    Et non ceux du format OpenAI Chat Completions

  Scénario: Un provider non implémenté échoue tôt, jamais silencieusement
    Étant donné une valeur de provider absente de resolveBaseURL
    Quand l'adaptateur cloud est construit
    Alors la construction lève une erreur explicite au démarrage
```
