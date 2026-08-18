---
id: TS-C1
type: technical-story
title: "Pont de steps in-scene pour playwright-bdd"
epic: "Épic C — Outillage BDD (voie 3)"
priority: P2
voie: 3
depends_on: "—"
status: "À faire"
gherkin: TS-C1.pont-steps-in-scene-bdd.bdd.md
---

# TS-C1 — Pont de steps in-scene pour playwright-bdd

**Contexte.** `features/README.md` définit deux natures de steps, mais seuls
les DOM steps existent (`features/tooling/smoke.steps.ts`). Les scénarios
in-scene (interaction PNJ, grab, panneaux) exigent une fixture qui expose le
pont de commandes agent d'IWSDK : simuler un rayon/contrôleur, lire le graphe
ECS, attendre un état d'entité.

**Objectif.** Une fixture partagée `features/support/in-scene.ts` fournit
`scene.clickEntity(name)`, `scene.readComponent(entity, comp)`,
`scene.waitFor(predicate)` — et le smoke test in-scene qui la prouve.

*Implémente : `xr-visual-qa` (steps) avec `general-purpose` (fixture).
Relit : `iwsdk-project-code-reviewer`.*
