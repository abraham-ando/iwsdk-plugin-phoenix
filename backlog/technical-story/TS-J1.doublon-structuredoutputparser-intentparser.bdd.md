# TS-J1 — Résorber le doublon StructuredOutputParser / IntentParser (BDD)

> Story : [TS-J1.doublon-structuredoutputparser-intentparser.md](TS-J1.doublon-structuredoutputparser-intentparser.md)

```gherkin
# language: fr
Fonctionnalité: Un seul format d'intent
  Le code ne porte plus deux analyseurs d'intent dont un seul est branché.

  Scénario: Le format retenu est le seul importé par le runtime
    Étant donné le choix de format documenté dans le README du package
    Quand on cherche les imports du format abandonné hors des tests
    Alors aucun système de production ne l'importe

  Scénario: Le format retenu passe par IntentGuard
    Étant donné une réponse de modèle contenant un intent hors politique
    Quand elle est parsée par le format retenu
    Alors l'intent est toujours rejeté par la validation de politique
```
