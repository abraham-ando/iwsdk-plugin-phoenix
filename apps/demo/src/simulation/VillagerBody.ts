/**
 * Le corps d'un villageois, quelle que soit sa nature.
 *
 * `CardinalSimulationSystem.projectScene` ne doit PAS apprendre à distinguer un
 * rig d'une marionnette : il appelle `setPose` et ne change plus jamais.
 */
import {
  CharacterAnimationSystem,
} from '@iwsdk/cardinal-character-three';
import type { AnimationClip, Entity, Group, Object3D, World } from '@iwsdk/core';
import type { AgentView } from '@iwsdk/cardinal-simulation';
import { applyAvatarPose } from './AgentAvatarFactory';
import { hash } from './villagerGenomes';

export interface VillagerBody {
  readonly node: Object3D;
  setPose(animation: AgentView['animation'], elapsedSeconds: number): void;
  dispose(): void;
}

/**
 * Les cylindres d'aujourd'hui, derrière le contrat.
 *
 * Ce n'est pas du code de transition jetable : c'est le repli permanent quand
 * un asset n'arrive pas, et c'est le SEUL usage réel de `PuppetApplicator`,
 * qui resterait sinon une implémentation d'interface que personne n'appelle.
 */
export class PuppetBody implements VillagerBody {
  // `Group` et non `Object3D` : `applyAvatarPose` en exige un, et typer le
  // champ ici évite un transtypage à chaque appel.
  constructor(readonly node: Group, readonly agentId: string) {}

  setPose(animation: AgentView['animation'], elapsedSeconds: number): void {
    applyAvatarPose(this.node, animation, elapsedSeconds);
  }

  dispose(): void {
    this.node.removeFromParent();
  }
}

/** Ce dont `upgradeVillagers` a besoin d'un agent, et rien de plus. */
export interface UpgradableAgent {
  id: string;
  gender: 'masculine' | 'feminine';
}

export interface UpgradeOptions {
  bodies: Map<string, VillagerBody>;
  agents: readonly UpgradableAgent[];
  /** Construit le corps riggé d'un agent, ou lève. Injecté pour les tests. */
  buildRig(agent: UpgradableAgent): Promise<VillagerBody>;
}

/**
 * Remplace les marionnettes par des rigs, un villageois à la fois.
 *
 * NE LÈVE JAMAIS. Un échec journalise une fois, nomme l'agent et la cause, et
 * laisse la marionnette : hors ligne, ou avec un rig incompatible, le village
 * reste complet et jouable. C'est le comportement nominal, pas une panne.
 */
export async function upgradeVillagers(options: UpgradeOptions): Promise<void> {
  for (const agent of options.agents) {
    const puppet = options.bodies.get(agent.id);
    if (puppet === undefined) continue;
    try {
      const rig = await options.buildRig(agent);
      options.bodies.set(agent.id, rig);
      puppet.dispose();
    } catch (error) {
      console.warn(
        `[cardinal-demo] villageois "${agent.id}" : rig indisponible, ` +
          `la marionnette reste — ${(error as Error).message}`,
      );
    }
  }
}

/**
 * Choisit un asset de façon stable pour un identifiant donné.
 *
 * Réutilise le FNV-1a de `villagerGenomes.ts` plutôt que d'en écrire un
 * second dans ce dossier — une seule implémentation, deux usages.
 */
export function hashIndex(id: string, modulo: number): number {
  return hash(id) % modulo;
}

/**
 * Enveloppe une entité de personnage compilée dans le contrat de corps.
 *
 * `rootMotion: 'flatten'` parce que la simulation possède déjà la position du
 * villageois : mesuré, `M_Walk_001` l'emmènerait 3,21 m devant lui-même à
 * chaque boucle (et `F_Walk_002` 4,39 m).
 */
export function makeRiggedBody(
  world: World,
  entity: Entity,
  clips: Record<string, AnimationClip>,
): VillagerBody {
  const system = world.getSystem(CharacterAnimationSystem);
  if (system === undefined) {
    throw new Error('makeRiggedBody: CharacterAnimationSystem non enregistré');
  }
  // Les noms de nœuds d'un rig RPM suivent la convention Mixamo ; seule la
  // hanche porte un rôle qui nous intéresse pour l'assainissement.
  system.attach(entity, clips, (name) => (name === 'Hips' ? 'root' : null), {
    rootMotion: 'flatten',
  });
  const node = entity.object3D!;
  return {
    node,
    setPose: (animation) => system.setVerb(entity, animation),
    dispose: () => entity.dispose(),
  };
}
