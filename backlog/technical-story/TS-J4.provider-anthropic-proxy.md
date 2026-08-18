---
id: TS-J4
type: technical-story
title: "Le provider `anthropic-proxy` est réel ou retiré du type"
epic: "Épic J — Dette des modules orphelins d'IA (voie 9)"
priority: P3
voie: 9
depends_on: "—"
status: "À faire"
gherkin: TS-J4.provider-anthropic-proxy.bdd.md
---

# TS-J4 — Le provider `anthropic-proxy` est réel ou retiré du type

**Contexte.** `packages/ai/src/types/options.ts:44` déclare
`'anthropic-proxy'` comme valeur valide de `CloudProviderConfig.provider`,
mais `resolveBaseURL` ne la traite dans aucune branche — elle tombe dans le
`default` OpenAI, donc un intégrateur qui choisit `'anthropic-proxy'` obtient
silencieusement un mauvais endpoint plutôt qu'une erreur.

**Objectif.** Implémenter réellement l'endpoint proxy Anthropic (format
Messages API, pas Chat Completions — en-têtes et corps différents), ou retirer
la valeur du type jusqu'à ce qu'elle soit vraie.

*Implémente : `bff-backend-engineer` (le proxy vit à côté du BFF). Relit :
`ai-security-engineer`.*
