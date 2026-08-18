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
  /**
   * Clavée par `entity.index`, JAMAIS par l'objet `Entity` — le motif
   * d'EntityIndex que `CharacterCompileSystem` emploie déjà pour ses trois
   * cartes.
   *
   * elics ne recycle pas seulement les index : il recycle les INSTANCES
   * (`entity-manager.js`, `requestEntityInstance` puise dans un pool). Une
   * carte clavée par l'objet garde donc silencieusement en vie le rig d'une
   * entité disposée dès que la suivante hérite du même exemplaire — et
   * `setVerb` de la nouvelle animerait le rig de l'ancienne. Mesuré :
   * `entityA.dispose()` puis une création rend le MÊME objet ET le même index.
   * Ce qui referme le piège n'est donc pas la clé seule, mais la clé plus le
   * `disqualify` ci-dessous, qui retire l'entrée avant tout recyclage.
   */
  private rigs = new Map<number, Rig>();

  public override init(): void {
    // La query existe pour ça, et pour rien d'autre : c'est elle qui dit quand
    // une entité de personnage cesse d'en être une (composant retiré) ou
    // disparaît (`dispose()`). elics fait tomber `disqualify` de façon
    // SYNCHRONE pendant `Entity.destroy()`, donc avant que
    // `releaseEntityInstance` ne remette l'exemplaire au pool : il n'existe
    // aucune fenêtre pendant laquelle une entité recyclée verrait le rig de sa
    // devancière.
    this.cleanupFuncs.push(
      this.queries.characters.subscribe('disqualify', (entity) => {
        const rig = this.rigs.get(entity.index);
        if (rig === undefined) return;
        // Le mixer d'une entité disposée qui continue de tourner est une fuite
        // qui ne se voit qu'au bout d'une heure de jeu.
        rig.mixer.stopAllAction();
        this.rigs.delete(entity.index);
      }),
    );
  }

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
    this.rigs.set(entity.index, {
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
    const rig = this.rigs.get(entity.index);
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
    return this.rigs.get(entity.index)?.verb ?? '';
  }

  /** Le clip assaini d'un verbe. Pour les tests et le diagnostic. */
  clipFor(entity: Entity, verb: string): AnimationClip | undefined {
    return this.rigs.get(entity.index)?.clips[verb];
  }

  actionCount(entity: Entity): number {
    return this.rigs.get(entity.index)?.actions.size ?? 0;
  }

  mixerCount(): number {
    return this.rigs.size;
  }

  /**
   * Le seul travail par image : faire avancer chaque mixer.
   *
   * Le décrochage des entités disposées ne se fait PLUS ici. Il se faisait par
   * un sondage de `entity.object3D`, ce qui obligeait à itérer les ENTRÉES de
   * la carte — `for (const [entity, rig] of this.rigs)` alloue un tableau de
   * deux éléments par entrée et par image, onze par image pour le village,
   * exactement ce que la contrainte « aucune allocation dans `update()` »
   * interdit. Le `subscribe('disqualify')` d'`init()` fait le même travail à
   * l'instant exact où l'entité s'en va, et cette boucle ne lit plus que les
   * valeurs.
   */
  override update(delta: number, _time: number): void {
    for (const rig of this.rigs.values()) {
      rig.mixer.update(delta);
    }
  }
}
