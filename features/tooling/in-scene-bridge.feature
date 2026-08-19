# TS-C1 — Pont de steps in-scene pour playwright-bdd
# backlog/technical-story/TS-C1.pont-steps-in-scene-bdd.md
# language: fr
Fonctionnalité: Pont de commandes pour les steps in-scene
  Un step peut agir dans la scène et lire l'ECS, sans jamais cliquer le canvas.

  @in-scene
  Scénario: Lire un composant d'une entité nommée
    Étant donné la démo chargée et le monde initialisé
    Quand je lis le composant "Transform" de l'entité "plante partagée"
    Alors la lecture renvoie une position à trois composantes finies

  @in-scene
  Scénario: Cliquer une entité au rayon simulé
    Étant donné la démo chargée et le monde initialisé
    Quand je clique l'entité "plante partagée" au rayon simulé
    Alors un événement d'interaction est enregistré sur cette entité
