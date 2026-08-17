import { createSystem } from '@iwsdk/core';
import { groundGuardY } from './groundGuard';

/**
 * Empêche le joueur de traverser le sol (spec environnement §6).
 *
 * Le terrain est streamé : entre le moment où l'on arrive quelque part et
 * celui où sa tuile existe, aucun maillage ne porte personne. Le joueur est
 * ainsi tombé à −3 192 m, et il tombait encore.
 *
 * Ce défaut s'est produit trois fois dans ce projet, chaque fois avec une
 * cause différente — ordre de construction des tuiles, point d'apparition,
 * course au démarrage — parce qu'on le corrigeait instance par instance.
 * Celui-ci le corrige en classe : l'altitude du terrain est ANALYTIQUE, donc
 * connue partout, sans maillage et sans attente.
 *
 * Le coût est d'un `heightAt` par image — 0,8 µs — contre un joueur perdu.
 */
export class GroundGuardSystem extends createSystem({}, {}) {
  /** Combien de fois le garde-fou a rattrapé. Zéro en régime normal. */
  public caughtCount = 0;

  override update(): void {
    const player = this.player as unknown as
      | { position: { x: number; y: number; z: number } }
      | undefined;
    if (player === undefined) return;

    const { x, y, z } = player.position;
    const corrige = groundGuardY(x, y, z);
    if (corrige === null) return;

    player.position.y = corrige;
    this.caughtCount++;
    // Rattraper en silence masquerait la cause. Un défaut qui se répare seul
    // sans laisser de trace est un défaut qu'on ne corrige jamais vraiment.
    console.warn(
      `[GroundGuard] joueur rattrapé à ${y.toFixed(1)} m, remis au sol (${corrige.toFixed(1)} m) ` +
        `en ${x.toFixed(1)}, ${z.toFixed(1)} — une tuile manquait sous ses pieds.`
    );
  }
}
