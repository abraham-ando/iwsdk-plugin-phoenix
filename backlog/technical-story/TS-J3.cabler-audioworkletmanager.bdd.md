# TS-J3 — Câbler AudioWorkletManager dans le pipeline audio réel (BDD)

> Story : [TS-J3.cabler-audioworkletmanager.md](TS-J3.cabler-audioworkletmanager.md)

```gherkin
# language: fr
Fonctionnalité: Ring buffer audio effectivement utilisé
  Le chemin audio d'un PNJ ne copie pas ce qu'il pourrait faire transiter.

  Scénario: L'audio TTS transite par le ring buffer
    Étant donné un PNJ dont la réplique TTS est prête sous forme de PCM
    Quand l'audio est joué en spatial
    Alors le buffer utilisé est celui d'AudioWorkletManager
    Et aucune copie complète du buffer n'a lieu sur le chemin chaud
```
