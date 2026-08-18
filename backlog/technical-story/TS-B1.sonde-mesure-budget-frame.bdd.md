# TS-B1 — Généraliser la sonde de mesure au budget de frame (BDD)

> Story : [TS-B1.sonde-mesure-budget-frame.md](TS-B1.sonde-mesure-budget-frame.md)

```gherkin
# language: fr
Fonctionnalité: Instrumentation du budget de frame
  On ne défend pas un budget qu'on ne mesure pas.

  @dom
  Scénario: La sonde de frame rapporte des percentiles
    Étant donné la démo ouverte avec "?probe-frame=1"
    Quand 10 secondes de scène complète se sont écoulées
    Alors la console contient une ligne "[MESURE] frame p50=… p95=… p99=…"
    Et chaque valeur est un nombre en millisecondes

  @dom
  Scénario: Sans le paramètre, la sonde est totalement inerte
    Étant donné la démo ouverte sans paramètre de sonde
    Alors aucune ligne "[MESURE]" n'apparaît dans la console
    Et aucun échantillonneur de frame n'est en cours d'exécution
```
