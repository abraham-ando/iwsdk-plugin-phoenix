# TS-E1 — Les secteurs persistants survivent au redémarrage (BDD)

> Story : [TS-E1.secteurs-persistants-redemarrage.md](TS-E1.secteurs-persistants-redemarrage.md)

```gherkin
# language: fr
Fonctionnalité: Persistance durable des secteurs
  Un monde n'oublie ni son heure ni sa météo, même quand le serveur redémarre.

  Scénario: Un secteur endormi est écrit derrière
    Étant donné une salle persistante "northmarch" dont le dernier pair part
    Quand le snapshot du secteur est pris
    Alors une écriture est enregistrée dans le backend de persistance
    Et la room ne bloque pas sur cette écriture

  Scénario: Le redémarrage restaure puis avance
    Étant donné un snapshot de "northmarch" écrit il y a 30 minutes simulées
    Quand le nœud redémarre et qu'un pair rejoint "northmarch"
    Alors le temps monde restauré est avancé de 30 minutes en une étape
    Et la météo découle de la même graine que sans interruption

  Scénario: Un snapshot d'une autre époque d'horloge n'est pas avancé
    Étant donné un snapshot pris sous une époque d'horloge différente
    Quand le secteur est restauré
    Alors l'état est repris tel quel, sans avance de temps
```
