import { heightAt } from '@iwsdk/cardinal-simulation';

/**
 * La règle qui empêche quoi que ce soit de traverser le sol.
 *
 * Le terrain est streamé par tuiles : entre le moment où l'on arrive quelque
 * part et celui où sa tuile existe, il n'y a rien sous les pieds. Le joueur
 * est alors tombé à −3 192 m, et il tombait encore. Ce défaut s'est produit
 * trois fois dans l'histoire de ce projet, à chaque fois avec une cause
 * différente — ordre de construction des tuiles, point d'apparition, course
 * au démarrage — parce qu'on le corrigeait instance par instance.
 *
 * L'altitude du terrain, elle, est **analytique** : `heightAt` la connaît
 * partout, sans maillage, sans streaming, en moins d'une microseconde. Il n'y
 * a donc aucune raison qu'un maillage manquant fasse tomber qui que ce soit.
 *
 * Pure et sans Three, pour se vérifier sans GPU.
 */

/**
 * Marge sous le sol avant de rattraper, en mètres.
 *
 * Assez grande pour ne pas contrarier un saut, un pas dans une dépression ou
 * l'imprécision d'une tuile de faible détail ; assez petite pour rattraper
 * avant que la chute ne devienne visible.
 */
export const GROUND_GUARD_MARGIN = 3;

/**
 * Rend l'altitude corrigée, ou `null` s'il n'y a rien à corriger.
 *
 * Rendre `null` plutôt que la valeur inchangée dit à l'appelant de ne rien
 * écrire du tout : une écriture par image, même identique, se paierait en
 * invalidations de transformation.
 */
export function groundGuardY(x: number, y: number, z: number): number | null {
  const sol = heightAt(x, z);
  return y < sol - GROUND_GUARD_MARGIN ? sol : null;
}
