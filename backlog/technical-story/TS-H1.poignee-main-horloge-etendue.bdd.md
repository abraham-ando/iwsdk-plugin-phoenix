# TS-H1 — Le serveur complète la poignée de main d'horloge étendue (BDD)

> Story : [TS-H1.poignee-main-horloge-etendue.md](TS-H1.poignee-main-horloge-etendue.md)

```gherkin
# language: fr
Fonctionnalité: Poignée de main d'horloge étendue
  Le client obtient un offset d'horloge exploitable, pas seulement un RTT.

  Scénario: Le serveur répond par un PONG étendu
    Étant donné un client connecté à une salle
    Quand il envoie un PING horodaté
    Alors il reçoit un PONG de 29 octets
    Et ce PONG porte l'horodatage client, la réception serveur, l'émission serveur et l'époque

  Scénario: L'estimateur client converge vers un offset synchronisé
    Étant donné un client ayant échangé 5 PING/PONG étendus avec un serveur réel
    Quand l'estimateur d'horloge traite ces échantillons
    Alors "net.synced" devient vrai
    Et "net.serverNow()" diffère de l'horloge locale d'un offset stable

  Scénario: Un redémarrage serveur change l'époque
    Étant donné un client synchronisé avec l'époque courante du serveur
    Quand le serveur redémarre et qu'un nouvel échange PING/PONG a lieu
    Alors l'époque reçue diffère de la précédente
    Et l'estimateur d'horloge réinitialise sa fenêtre d'échantillons
```
