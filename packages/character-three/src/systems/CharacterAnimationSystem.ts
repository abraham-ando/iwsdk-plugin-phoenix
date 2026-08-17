import {
  AnimationMixer, createSystem, Types,
  type AnimationAction, type AnimationClip, type Entity,
} from '@iwsdk/core';
import { getFamily } from '@iwsdk/cardinal-character';
import { CharacterIdentity } from '../components/index';
import { sanitizeClip } from '../clips/sanitize';
import type { RootMotionPolicy } from '../clips/rootMotion';

interface Rig {
  mixer: AnimationMixer;
  clips: Record<string, AnimationClip>;
  actions: Map<string, AnimationAction>;
  verb: string;
}

/**
 * Un `AnimationMixer` par personnage, des clips assainis une fois à
 * l'attachement, et un fondu enchaîné au changement de verbe.
 *
 * Priorité 80 : APRÈS `CharacterCompileSystem` (60) et
 * `CharacterExpressionSystem` (70). Le mixer doit tourner une fois la
 * morphologie de la frame posée, sinon il écrirait sur des os que la
 * compilation replacerait juste après.
 *
 * Pourquoi pas `AvatarAnimationController` de `@iwsdk/plugin-cardinal-ai` : il
 * fait des fondus et porte quatorze tests, mais il vit du mauvais côté — faire
 * dépendre les personnages du paquet IA inverse la dépendance — et il
 * duck-type `globalThis.THREE`, ce qui le laisse SILENCIEUSEMENT sans mixer
 * quand cet objet n'est pas là.
 */
export class CharacterAnimationSystem extends createSystem(
  { characters: { required: [CharacterIdentity] } },
  { fadeSeconds: { type: Types.Float32, default: 0.25 } },
) {
  private rigs = new Map<Entity, Rig>();

  /** Attache des clips à un personnage. Les assainit une fois, ici. */
  attach(
    entity: Entity,
    clips: Readonly<Record<string, AnimationClip>>,
    roleOfNode: (nodeName: string) => string | null,
    options: { rootMotion: RootMotionPolicy },
  ): void {
    const node = entity.object3D;
    if (node === null || node === undefined) return;
    // Le champ du composant s'appelle `family`, pas `familyId` — voir
    // `CharacterIdentity` dans `components/index.ts`. Lire une clé absente du
    // schéma rend `null` (comportement elics documenté dans
    // `Entity.getValue`), donc `familyId` aurait silencieusement résolu la
    // famille "null" et fait lever `getFamily` pour CHAQUE attachement.
    const familyId = entity.getValue(CharacterIdentity, 'family');
    const family = getFamily(String(familyId ?? 'humanoid'));

    const sanitized: Record<string, AnimationClip> = {};
    for (const [verb, clip] of Object.entries(clips)) {
      sanitized[verb] = sanitizeClip(clip, family, roleOfNode, {
        rootMotion: options.rootMotion,
      }).clip;
    }
    this.rigs.set(entity, {
      mixer: new AnimationMixer(node),
      clips: sanitized,
      actions: new Map(),
      verb: '',
    });
  }

  /**
   * Change le verbe joué. Un verbe sans clip retombe sur `idle` : la
   * bibliothèque RPM ne contient aucun clip de repos ni de sommeil, et lever
   * ici ferait tomber la démo sur un comportement normal de la simulation.
   */
  setVerb(entity: Entity, verb: string): void {
    const rig = this.rigs.get(entity);
    if (rig === undefined) return;
    const wanted = rig.clips[verb] !== undefined ? verb : 'idle';
    if (wanted === rig.verb) return;
    const clip = rig.clips[wanted];
    if (clip === undefined) return;

    // Les actions sont créées UNE fois et réutilisées : en créer une par
    // changement de verbe allouerait à chaque pas de la simulation.
    let next = rig.actions.get(wanted);
    if (next === undefined) {
      next = rig.mixer.clipAction(clip);
      rig.actions.set(wanted, next);
    }
    const previous = rig.actions.get(rig.verb);
    if (previous !== undefined && previous !== next) {
      next.reset().play();
      previous.crossFadeTo(next, this.config.fadeSeconds.peek(), false);
    } else {
      next.reset().play();
    }
    rig.verb = wanted;
  }

  currentVerb(entity: Entity): string {
    return this.rigs.get(entity)?.verb ?? '';
  }

  /** Le clip assaini d'un verbe. Pour les tests et le diagnostic. */
  clipFor(entity: Entity, verb: string): AnimationClip | undefined {
    return this.rigs.get(entity)?.clips[verb];
  }

  actionCount(entity: Entity): number {
    return this.rigs.get(entity)?.actions.size ?? 0;
  }

  mixerCount(): number {
    return this.rigs.size;
  }

  override update(delta: number, _time: number): void {
    for (const [entity, rig] of this.rigs) {
      // Une entité disposée ne doit pas garder son mixer vivant : c'est une
      // fuite qui ne se voit qu'au bout d'une heure de jeu.
      //
      // Mesuré (voir le rapport de tâche) : `entity.dispose()` appelle
      // `Entity.destroy()` d'elics, qui est SYNCHRONE — `active = false`,
      // requêtes mises à jour, puis `entityManager.releaseEntityInstance`.
      // `@iwsdk/core` intercepte ce dernier pour faire `delete
      // entity.object3D` avant même que `dispose()` ne rende la main. Ce
      // contrôle est donc déjà vrai à l'entrée de CETTE image, pas seulement
      // après un futur appel — la garde reste ici parce que c'est cette boucle
      // qui doit décrocher le mixer, mais elle ne dépend d'aucun luxe timing.
      if (entity.object3D === null || entity.object3D === undefined) {
        rig.mixer.stopAllAction();
        this.rigs.delete(entity);
        continue;
      }
      rig.mixer.update(delta);
    }
  }
}
