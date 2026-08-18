---
id: TS-H1
type: technical-story
title: "Le serveur complète la poignée de main d'horloge étendue"
epic: "Épic H — Synchronisation d'horloge (voie 7)"
priority: P2
voie: 7
depends_on: "—"
status: "À faire"
gherkin: TS-H1.poignee-main-horloge-etendue.bdd.md
---

# TS-H1 — Le serveur complète la poignée de main d'horloge étendue

**Contexte.** Le côté client est entièrement écrit et exposé publiquement :
`ClockSyncEstimator` (`packages/client/src/math/clock-sync.ts`), la boucle
`clock-loop.ts` qui lui fournit des échantillons, et `net.serverNow()` /
`net.synced` sur `plugin.ts`. Le codec sait encoder et décoder le PONG étendu à
29 octets (`Protocol.encode_pong/4` côté Elixir, `BinaryProtocol.encodePong`
côté TS). Mais `room/handler.ex::reply_pong/2` ne fait jamais que réémettre
l'horodatage du client via la forme historique à 9 octets
(`encode_ping(timestamp, true)`) : le serveur n'horodate jamais sa propre
réception ni son émission. Conséquence vérifiée : `offsetMs` reste `null` pour
toujours, `net.synced` ne devient jamais vrai — tout un pipeline fini et testé
tourne à vide faute d'un seul appel côté serveur.

**Objectif.** `reply_pong` horodate la réception (t1) et l'émission (t2) via
`Clock`, et répond avec `Protocol.encode_pong(t0, t1, t2, epoch)`.

*Implémente : `general-purpose`. Relit : `phoenix-networking-reviewer`.*
