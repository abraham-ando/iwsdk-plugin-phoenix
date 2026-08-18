/**
 * Le corps d'un villageois, quelle que soit sa nature.
 *
 * `CardinalSimulationSystem.projectScene` ne doit PAS apprendre à distinguer un
 * rig d'une marionnette : il appelle `setPose` et ne change plus jamais.
 */
import {
  CharacterAnimationSystem,
} from '@iwsdk/cardinal-character-three';
import { Mesh, RayInteractable } from '@iwsdk/core';
import type { AnimationClip, Entity, Group, Object3D, World } from '@iwsdk/core';
import type { AgentView } from '@iwsdk/cardinal-simulation';
import { applyAvatarPose } from './AgentAvatarFactory';

export interface VillagerBody {
  readonly node: Object3D;
  setPose(animation: AgentView['animation'], elapsedSeconds: number): void;
  dispose(): void;
}

/**
 * Les cylindres d'aujourd'hui, derrière le contrat.
 *
 * Ce n'est pas du code de transition jetable : c'est le repli permanent quand
 * un asset n'arrive pas — hors ligne, ou avec un rig que la famille refuse.
 *
 * Ce corps n'a en revanche AUCUN rapport avec `PuppetApplicator` de
 * `@iwsdk/cardinal-character-three`, contrairement à ce qu'une phrase de la
 * spec §7.2 affirmait et que ce commentaire recopiait : `PuppetBody` enveloppe
 * `applyAvatarPose` et les cylindres d'`AgentAvatarFactory`, tandis que
 * `PuppetApplicator` n'est construit par `createCharacter` que pour un rig
 * SANS `SkinnedMesh`. Les deux avatars T-pose livrés en portent un
 * (`Wolf3D_Avatar`), donc `PuppetApplicator` reste sans appelant de
 * production. Le dire ici plutôt que de laisser croire l'inverse : ce qui
 * justifie ce repli est le village jouable hors ligne, pas un applicateur à
 * faire vivre.
 */
export class PuppetBody implements VillagerBody {
  // `Group` et non `Object3D` : `applyAvatarPose` en exige un, et typer le
  // champ ici évite un transtypage à chaque appel.
  constructor(
    readonly node: Group,
    // Pas encore lu en production : `upgradeVillagers` connaît déjà l'agent
    // par la clé de la carte `bodies`. Conservé pour le diagnostic (messages
    // d'erreur futurs, inspection en test) plutôt que retiré — retirer le
    // paramètre casserait les appels à deux arguments déjà fixés par le brief
    // et par `villager-body.test.ts`.
    readonly agentId: string,
  ) {}

  setPose(animation: AgentView['animation'], elapsedSeconds: number): void {
    applyAvatarPose(this.node, animation, elapsedSeconds);
  }

  /**
   * Détache le nœud ET libère ses ressources GPU.
   *
   * `createAgentAvatar` alloue trois géométries et trois matériaux NEUFS par
   * villageois, jamais partagés (voir `AgentAvatarFactory.ts`) : sur le
   * chemin en ligne, onze remplacements abandonneraient trente-trois
   * géométries et trente-trois matériaux au GPU si `dispose()` se contentait
   * de détacher le nœud. C'est le piège `entity.destroy()` du CLAUDE.md sous
   * une autre forme.
   */
  dispose(): void {
    this.node.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      // `material` peut être un tableau (multi-matériaux) : les deux formes
      // doivent être libérées, pas seulement la première.
      const material = child.material;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose();
      } else {
        material.dispose();
      }
    });
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
  /**
   * Construit le corps riggé d'un agent, ou lève. Injecté pour les tests.
   *
   * Reçoit aussi le corps ACTUEL (la marionnette qu'il s'apprête à
   * remplacer) : un rig doit atterrir dans le même repère qu'elle — voir
   * `assertSameWorldFrame`, que `makeRiggedBody` applique.
   */
  buildRig(agent: UpgradableAgent, currentBody: VillagerBody): Promise<VillagerBody>;
}

/**
 * Remplace les marionnettes par des rigs, un villageois à la fois.
 *
 * NE LÈVE JAMAIS. Un échec journalise une fois, nomme l'agent et la cause, et
 * laisse la marionnette : hors ligne, ou avec un rig incompatible, le village
 * reste complet et jouable. C'est le comportement nominal, pas une panne.
 *
 * `puppet.dispose()` ne s'exécute QUE dans la branche de succès, après que la
 * carte porte déjà le nouveau corps : un `dispose()` glissé dans le `catch`
 * détacherait le nœud de la marionnette de la scène (et, depuis la correction
 * I1, libérerait ses ressources GPU) tout en laissant la RÉFÉRENCE dans la
 * carte intacte — un échec qui ressemblerait à un succès. Voir
 * `villager-body.test.ts`, le test qui vérifie que le nœud reste DANS la
 * scène après un échec, pas seulement que la carte le référence encore.
 */
export async function upgradeVillagers(options: UpgradeOptions): Promise<void> {
  for (const agent of options.agents) {
    const puppet = options.bodies.get(agent.id);
    if (puppet === undefined) continue;
    try {
      const rig = await options.buildRig(agent, puppet);
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
 * Vrai si `node` remonte à l'IDENTITÉ locale, étage par étage, jusqu'à
 * `stopAt` (un ancêtre commun — typiquement `world.scene`).
 *
 * Pur calcul sur le graphe Three.js : aucune dépendance à l'ECS ni au rendu,
 * donc testable sans monde IWSDK.
 */
export function chainsToIdentity(node: Object3D, stopAt: Object3D): boolean {
  let cursor: Object3D | null = node;
  while (cursor !== null && cursor !== stopAt) {
    const p = cursor.position;
    const q = cursor.quaternion;
    const s = cursor.scale;
    const atIdentity =
      p.x === 0 && p.y === 0 && p.z === 0 &&
      q.x === 0 && q.y === 0 && q.z === 0 && q.w === 1 &&
      s.x === 1 && s.y === 1 && s.z === 1;
    if (!atIdentity) return false;
    cursor = cursor.parent;
  }
  return cursor === stopAt;
}

/**
 * Refuse bruyamment un rig dont le repère divergerait de celui de la
 * marionnette qu'il remplace.
 *
 * `CardinalSimulationSystem.projectScene` écrit des coordonnées MONDE
 * directement sur `body.node.position`, quel que soit le parent réel du
 * nœud (voir l'en-tête de ce fichier : le système ne distingue jamais un rig
 * d'une marionnette). Une même position monde ne désigne donc le même endroit
 * que si le parent de la marionnette et celui du rig sont eux-mêmes à
 * l'identité jusqu'à `world.scene`.
 *
 * Aujourd'hui c'est le cas, mais par COÏNCIDENCE, pas par garantie : la
 * marionnette pend sous `sceneData.root` (un `Group` brut ajouté directement
 * à `world.scene` dans `index.ts`, en dehors du graphe d'entités — ce que
 * `apps/demo/CLAUDE.md` déconseille explicitement : « Create entities with
 * `world.createTransformEntity(...)`, never `scene.add()` »), tandis que le
 * rig pend sous `activeLevel` (l'`Entity` que `createTransformEntity` choisit
 * par défaut). Les deux sont des `Group` à l'identité aujourd'hui — rien ne
 * le garantit demain.
 *
 * REPARENTER le rig sous `sceneData.root` pour forcer un parent commun a été
 * envisagé et rejeté, mais pas pour la raison que ce commentaire donnait
 * d'abord. Relu ligne à ligne dans
 * `@iwsdk/core/dist/transform/transform.js`, `TransformSystem.update()` ne
 * livre AUCUNE bataille par image : le rig porte un `Transform.parent` valide
 * (posé par `createTransformEntity`), donc la seule branche qui le concerne
 * est `parentObject !== object.parent`, laquelle rappelle `add()` — ce qui
 * réaligne `object.parent` sur-le-champ. La correction est donc PONCTUELLE,
 * et elle est SILENCIEUSE : le `console.warn` de ce système vit dans une
 * autre branche, celle des entités sans parent valide.
 *
 * Ce qui reste vrai, et suffit à rejeter le reparentage : un `add()` manuel
 * sous `sceneData.root` serait défait une fois, sans un mot, à la première
 * image suivante — un déplacement qui ne tient pas et qui ne prévient pas.
 * D'où l'assertion plutôt que le reparentage : la coïncidence devient un
 * échec bruyant, nommé, si l'une des deux racines bouge un jour.
 */
export function assertSameWorldFrame(
  puppetParent: Object3D | null,
  rigParent: Object3D | null,
  scene: Object3D,
): void {
  const puppetOk = puppetParent === null || chainsToIdentity(puppetParent, scene);
  const rigOk = rigParent === null || chainsToIdentity(rigParent, scene);
  if (!puppetOk || !rigOk) {
    throw new Error(
      'assertSameWorldFrame: la marionnette et le rig ne partagent plus le ' +
        'même repère monde — un ancêtre (racine de niveau ou racine de scène ' +
        'du village) a bougé ou tourné. CardinalSimulationSystem.projectScene ' +
        'écrit des coordonnées monde sur body.node.position sans jamais ' +
        'consulter le parent : un villageois riggé apparaîtrait ailleurs que ' +
        'les autres.',
    );
  }
}

/**
 * Enveloppe une entité de personnage compilée dans le contrat de corps.
 *
 * `rootMotion: 'flatten'` parce que la simulation possède déjà la position du
 * villageois : mesuré, `M_Walk_001` l'emmènerait 3,21 m devant lui-même à
 * chaque boucle (et `F_Walk_002` 4,39 m).
 *
 * **Toute levée dispose l'entité reçue avant de remonter.** `createCharacter`
 * appelle `world.createTransformEntity`, qui parente le rig IMMÉDIATEMENT sous
 * `activeLevel` (`@iwsdk/core/dist/ecs/world.js`) : une erreur laissée
 * remonter telle quelle laisserait un avatar monté dans la scène, compilé et
 * animé à chaque image, à l'origine du monde, et absent de la carte `bodies`
 * — donc jamais positionné par `projectScene`. `upgradeVillagers` attrape,
 * garde la marionnette, et le village se retrouverait doublé : onze
 * marionnettes correctes PLUS onze rigs empilés à l'origine. La garde qui
 * existait pour rendre une coïncidence bruyante produirait une scène pire que
 * la coïncidence.
 *
 * Les trois portes sont toutes ici : le système non enregistré, un
 * `sanitizeClip` en conflit dans `attach`, et `assertSameWorldFrame`.
 */
export function makeRiggedBody(
  world: World,
  entity: Entity,
  clips: Record<string, AnimationClip>,
  puppet: VillagerBody,
): VillagerBody {
  try {
    const system = world.getSystem(CharacterAnimationSystem);
    if (system === undefined) {
      throw new Error('makeRiggedBody: CharacterAnimationSystem non enregistré');
    }
    // Les noms de nœuds des avatars T-pose RPM sont `Hips`, `Spine`, `Head`…
    // (mesuré dans `tpose-rig.test.ts`) ; seule la hanche porte un rôle qui
    // nous intéresse pour l'assainissement.
    system.attach(entity, clips, (name) => (name === 'Hips' ? 'root' : null), {
      rootMotion: 'flatten',
    });
    const node = entity.object3D!;
    // Visable au rayon du casque comme au pointeur souris : c'est le même
    // composant qui sert les deux, et c'est ce qui rend le panneau utilisable
    // en immersion et hors immersion sans chemin séparé.
    entity.addComponent(RayInteractable, {});
    assertSameWorldFrame(puppet.node.parent, node.parent, world.scene);
    return {
      node,
      setPose: (animation) => system.setVerb(entity, animation),
      dispose: () => entity.dispose(),
    };
  } catch (error) {
    // `dispose()` et non `destroy()` : le second fuit la mémoire GPU. Il
    // détache aussi le nœud de son parent (`releaseEntityInstance` fait
    // `obj.removeFromParent()`), ce qui est précisément ce qu'on veut ici.
    entity.dispose();
    throw error;
  }
}
