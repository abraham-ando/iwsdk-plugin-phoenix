import { solarPosition, type SolarPosition } from './solar';

/**
 * Position et phase de la lune (spec §4), dans le même esprit que `solar.ts` :
 * pures, donc vérifiables sans renderer. Une lune qui se lève au mauvais
 * moment ruine chaque nuit du monde, et cela ne se voit qu'à l'œil, tard.
 *
 * Le modèle est délibérément simple. La lune parcourt le même arc que le
 * soleil, décalé dans le temps par sa phase : à la nouvelle lune elle
 * accompagne le soleil, à la pleine lune elle se lève quand il se couche.
 * C'est l'approximation qui rend le ciel juste à l'œil sans embarquer une
 * théorie lunaire complète — les nœuds, l'inclinaison de 5° et l'éclipse ne
 * changeraient rien à ce qu'un villageois observe.
 */

/** Durée du cycle synodique, en jours. */
export const SYNODIC_MONTH_DAYS = 29.53;

/**
 * Phase dans [0, 1) : 0 nouvelle lune, 0,5 pleine lune.
 *
 * Dérivée du jour, pour que la lune croisse et décroisse au fil des jours
 * sans qu'aucun état ne soit stocké.
 */
export function moonPhaseForDay(dayOfYear: number): number {
  const cycles = dayOfYear / SYNODIC_MONTH_DAYS;
  return cycles - Math.floor(cycles);
}

/**
 * Fraction éclairée du disque, dans [0, 1].
 *
 * Zéro à la nouvelle lune, un à la pleine. C'est ce que l'œil appelle « la
 * lune est grosse », et ce qui pilote sa luminosité.
 */
export function moonIllumination(phase: number): number {
  return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

/**
 * Position de la lune à une heure donnée.
 *
 * Le décalage est direct : la phase EST le retard sur le soleil, en fraction
 * de jour. À 0,5, la lune est à douze heures du soleil — elle se lève quand
 * il se couche, ce que tout le monde a déjà observé.
 */
export function moonPosition(
  hour: number,
  latitudeDeg: number,
  phase: number,
  declinationDeg = 0
): SolarPosition {
  const lunarHour = hour - phase * 24;
  return solarPosition(lunarHour, latitudeDeg, declinationDeg);
}

/**
 * Ce que la lune ajoute à la lumière de la nuit, dans [0, 1].
 *
 * Nul de jour — le soleil écrase tout — et proportionnel à la fraction
 * éclairée quand la lune est levée. Une nuit de pleine lune se voit ; une
 * nuit de nouvelle lune est noire, et c'est voulu.
 */
export function moonlightIntensity(
  sunElevationDeg: number,
  moonElevationDeg: number,
  phase: number
): number {
  if (sunElevationDeg > 0) return 0;
  if (moonElevationDeg <= 0) return 0;
  // Une lune basse sur l'horizon éclaire moins qu'au zénith : la même
  // atténuation que pour le soleil, en plus douce.
  const hauteur = Math.min(1, moonElevationDeg / 45);
  return moonIllumination(phase) * hauteur;
}
