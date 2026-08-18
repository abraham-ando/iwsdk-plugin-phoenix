---
id: TS-A2
type: technical-story
title: "La démo s'authentifie via le BFF, plus de clé en dur"
epic: "Épic A — Sécurité et authentification (voie 1)"
priority: P1
voie: 1
depends_on: "—"
status: "À faire"
gherkin: TS-A2.authentification-bff-demo.bdd.md
---

# TS-A2 — La démo s'authentifie via le BFF, plus de clé en dur

**Contexte.** `apps/demo/src/ai-village.ts:55` installe le provider cloud avec
`apiKey: 'demo_key'` en dur, alors que le BFF expose déjà le flux complet :
`POST /api/auth/session` (JWT, TTL 3600 s) puis `POST /api/v1/cardinal/chat`
(vérification + rate-limit + injection de la clé serveur). `TokenManager`
(packages/ai) sait déjà gérer `tokenProvider` et le refresh.

**Objectif.** La démo n'embarque aucune clé ; elle obtient un jeton de session
et passe par le proxy. La clé fournisseur ne quitte jamais le serveur.

*Implémente : `bff-backend-engineer`. Relit : `security-reviewer`.*
