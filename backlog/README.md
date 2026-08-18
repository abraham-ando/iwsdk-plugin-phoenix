# Backlog produit — index

Le carnet de commandes du pipeline `cardinal-feature-delivery`, une story par
paire de fichiers :

```
backlog/
  user-story/
    [code].[feature].md        # la story : contexte/objectif, qui implémente, qui relit
    [code].[feature].bdd.md    # les critères d'acceptation, en Gherkin
  technical-story/
    [code].[feature].md
    [code].[feature].bdd.md
```

`[code]` est l'identifiant stable de la story (`US-C2`, `TS-A1`…), déjà
référencé par les dépendances et par le code qu'il cite — il ne change jamais.
`[feature]` est un slug descriptif du sujet. Chaque fichier `.md` porte un
frontmatter (`id`, `type`, `epic`, `priority`, `voie`, `depends_on`, `status`,
`gherkin`) qui pointe vers son `.bdd.md` jumeau.

Quand une story entre en livraison, son bloc Gherkin est extrait vers
`features/<domaine>/<slug>.feature` et les steps sont écrits à côté
(`.steps.ts`), selon les conventions de [features/README.md](../features/README.md).
Le fichier `.bdd.md` reste la source de vérité *avant* implémentation ; le
`.feature` généré est la version exécutée par `playwright-bdd`.

État de référence : `main@9483066` (2026-08-19). Chaque story cite le code
qu'elle corrige ou étend — si la citation ne correspond plus, la story est à
réviser avant d'être lancée.

## Conventions

- **US** (`user-story/`) = valeur joueur/produit. **TS** (`technical-story/`)
  = dette, outillage, invariant.
- **Voie** = couloir parallélisable : deux stories de voies différentes
  peuvent être menées en même temps sans conflit de fichiers ; à l'intérieur
  d'une voie, les stories se suivent dans l'ordre de la table ci-dessous.
- Tags Gherkin : `@dom` (steps Playwright purs), `@in-scene` (pont de
  commandes ECS — jamais `page.click()` sur le canvas), `@multi-contexte`
  (plusieurs `browser.newContext()`), `@device` (casque physique requis, hors
  CI).
- `Implémente` nomme le rôle qui écrit le code (`general-purpose` quand le
  domaine n'a pas d'implémenteur direct dans le roster — un reviewer en
  lecture seule n'écrit jamais de code). `Relit` nomme le ou les reviewers de
  domaine qui valident avant merge.

## Vue d'ensemble

| ID | Titre | Priorité | Voie | Dépend de | Statut | Story | BDD |
|---|---|---|---|---|---|---|---|
| TS-A1 | Câbler IntentGuard dans le chemin des dialogues | P1 | 1 | — | **Fait** | [md](technical-story/TS-A1.cabler-intentguard-dialogues.md) | [bdd](technical-story/TS-A1.cabler-intentguard-dialogues.bdd.md) |
| TS-A2 | La démo s'authentifie via le BFF, plus de clé en dur | P1 | 1 | — | À faire | [md](technical-story/TS-A2.authentification-bff-demo.md) | [bdd](technical-story/TS-A2.authentification-bff-demo.bdd.md) |
| TS-A3 | Hygiène de la mémoire PNJ (purge + isolation) | P1 | 1 | — | À faire | [md](technical-story/TS-A3.hygiene-memoire-pnj.md) | [bdd](technical-story/TS-A3.hygiene-memoire-pnj.bdd.md) |
| TS-B1 | Généraliser la sonde de mesure au budget de frame | P2 | 2 | — | À faire | [md](technical-story/TS-B1.sonde-mesure-budget-frame.md) | [bdd](technical-story/TS-B1.sonde-mesure-budget-frame.bdd.md) |
| US-B2 | Session de mesure sur Quest 3 physique | P2 | 2 | TS-B1 | À faire | [md](user-story/US-B2.mesure-quest3-physique.md) | [bdd](user-story/US-B2.mesure-quest3-physique.bdd.md) |
| TS-C1 | Pont de steps in-scene pour playwright-bdd | P2 | 3 | — | À faire | [md](technical-story/TS-C1.pont-steps-in-scene-bdd.md) | [bdd](technical-story/TS-C1.pont-steps-in-scene-bdd.bdd.md) |
| US-C2 | Course de propriété de la plante partagée | P3 | 3 | TS-C1 | À faire | [md](user-story/US-C2.course-propriete-plante-partagee.md) | [bdd](user-story/US-C2.course-propriete-plante-partagee.bdd.md) |
| US-C3 | Éditer un villageois au panneau spatial | P3 | 3 | TS-C1 | À faire | [md](user-story/US-C3.editer-villageois-panneau-spatial.md) | [bdd](user-story/US-C3.editer-villageois-panneau-spatial.bdd.md) |
| US-C4 | Parler à un PNJ sans pouvoir le manipuler | P3 | 3 | TS-A1, TS-C1 | À faire | [md](user-story/US-C4.dialogue-pnj-sans-manipulation.md) | [bdd](user-story/US-C4.dialogue-pnj-sans-manipulation.bdd.md) |
| TS-D1 | Le regard des PNJ vise réellement le joueur | P3 | 4 | — | À faire | [md](technical-story/TS-D1.regard-pnj-vise-joueur.md) | [bdd](technical-story/TS-D1.regard-pnj-vise-joueur.bdd.md) |
| US-D2 | Les huit métiers façonnent les onze villageois | P3 | 4 | — | À faire | [md](user-story/US-D2.huit-metiers-onze-villageois.md) | [bdd](user-story/US-D2.huit-metiers-onze-villageois.bdd.md) |
| TS-D3 | Publier réellement les génomes des villageois | P3 | 4 | — | À faire | [md](technical-story/TS-D3.publier-genomes-villageois.md) | [bdd](technical-story/TS-D3.publier-genomes-villageois.bdd.md) |
| TS-E1 | Les secteurs persistants survivent au redémarrage | P4 | 5 | — | À faire | [md](technical-story/TS-E1.secteurs-persistants-redemarrage.md) | [bdd](technical-story/TS-E1.secteurs-persistants-redemarrage.bdd.md) |
| US-F1 | Exporter les datasets SFT et world-model | P4 | 6 | — | À faire | [md](user-story/US-F1.export-datasets-sft-world-model.md) | [bdd](user-story/US-F1.export-datasets-sft-world-model.bdd.md) |
| TS-H1 | Le serveur complète la poignée de main d'horloge étendue | P2 | 7 | — | À faire | [md](technical-story/TS-H1.poignee-main-horloge-etendue.md) | [bdd](technical-story/TS-H1.poignee-main-horloge-etendue.bdd.md) |
| TS-I1 | Limiter le débit par pair | P2 | 8 | — | À faire | [md](technical-story/TS-I1.limiter-debit-par-pair.md) | [bdd](technical-story/TS-I1.limiter-debit-par-pair.bdd.md) |
| TS-I2 | Roster de présence côté serveur | P3 | 8 | — | À faire | [md](technical-story/TS-I2.roster-presence-serveur.md) | [bdd](technical-story/TS-I2.roster-presence-serveur.bdd.md) |
| TS-J1 | Résorber le doublon StructuredOutputParser / IntentParser | P3 | 9 | — | À faire | [md](technical-story/TS-J1.doublon-structuredoutputparser-intentparser.md) | [bdd](technical-story/TS-J1.doublon-structuredoutputparser-intentparser.bdd.md) |
| TS-J2 | Décider du sort de SpeculativeDecodingEngine | P4 | 9 | — | À faire | [md](technical-story/TS-J2.sort-speculativedecodingengine.md) | [bdd](technical-story/TS-J2.sort-speculativedecodingengine.bdd.md) |
| TS-J3 | Câbler AudioWorkletManager dans le pipeline audio réel | P4 | 9 | — | À faire | [md](technical-story/TS-J3.cabler-audioworkletmanager.md) | [bdd](technical-story/TS-J3.cabler-audioworkletmanager.bdd.md) |
| TS-J4 | Le provider `anthropic-proxy` est réel ou retiré du type | P3 | 9 | — | À faire | [md](technical-story/TS-J4.provider-anthropic-proxy.md) | [bdd](technical-story/TS-J4.provider-anthropic-proxy.bdd.md) |
| TS-K1 | Brancher l'occlusion acoustique dans la démo | P3 | 10 | — | À faire | [md](technical-story/TS-K1.occlusion-acoustique-demo.md) | [bdd](technical-story/TS-K1.occlusion-acoustique-demo.bdd.md) |
| TS-K2 | Occlusion de profondeur MR réelle | P4 | 10 | — | À faire | [md](technical-story/TS-K2.occlusion-profondeur-mr-reelle.md) | [bdd](technical-story/TS-K2.occlusion-profondeur-mr-reelle.bdd.md) |
| US-G1 | Préparation Meta Horizon Store | Icebox | — | US-B2 | Gelée | [md](user-story/US-G1.preparation-meta-horizon-store.md) | [bdd](user-story/US-G1.preparation-meta-horizon-store.bdd.md) |

## Par épic / voie

- **Épic A — Sécurité et authentification** (voie 1) : TS-A1 (fait) → TS-A2 → TS-A3
- **Épic B — Mesure et budget de frame** (voie 2) : TS-B1 → US-B2
- **Épic C — Outillage BDD** (voie 3) : TS-C1 → US-C2, US-C3, US-C4
- **Épic D — PNJ vivants** (voie 4) : TS-D1, US-D2, TS-D3 (parallélisables entre elles)
- **Épic E — Persistance** (voie 5) : TS-E1
- **Épic F — Usine à données** (voie 6) : US-F1
- **Épic H — Synchronisation d'horloge** (voie 7) : TS-H1
- **Épic I — Durcissement pour déploiement public** (voie 8) : TS-I1, TS-I2
- **Épic J — Dette des modules orphelins d'IA** (voie 9) : TS-J1, TS-J2, TS-J3, TS-J4
- **Épic K — Occlusion perçue par le joueur** (voie 10) : TS-K1, TS-K2
- **Icebox** : US-G1 (gelée jusqu'à validation d'US-B2)

Les voies 1 à 10 sont indépendantes entre elles ; à l'intérieur d'une voie,
les stories se suivent dans l'ordre listé.
