/**
 * Traduction de l'état d'un smart object en paramètres visuels (spec §9).
 *
 * Pure et sans Three : « un buisson à moitié cueilli montre la moitié de ses
 * baies » est une RÈGLE, pas un dessin. Isolée, elle se vérifie sans GPU ;
 * mêlée au code de scène, elle ne se vérifierait qu'à l'œil.
 */

export interface ObjectVisualState {
  /** Étape de construction, de 0 à `stageCount - 1`. */
  readonly stage: number;
  readonly stageCount: number;
  /** Taux de remplissage dans [0, 1] : baies restantes, provisions, silex. */
  readonly fill: number;
  readonly lit: boolean;
  /** Taille relative de la flamme dans [0, 1] ; 0 quand le foyer est éteint. */
  readonly flame: number;
}

/** Maxima déclarés par le contenu du moteur (`content/objects.ts`). */
const MAX = {
  berriesLeft: 12,
  flintLeft: 6,
  woodLeft: 8,
  shelterProgress: 5,
  campfireFuel: 12,
  storage: 30,
} as const;

export const VISUAL_TYPES: readonly string[] = [
  'shelter',
  'campfire',
  'berry_bush',
  'flint_deposit',
  'oak_tree',
  'camp_storage',
];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const NEUTRAL: ObjectVisualState = { stage: 0, stageCount: 1, fill: 1, lit: false, flame: 0 };

export function visualStateFor(
  type: string,
  state: Readonly<Record<string, number>>,
): ObjectVisualState {
  switch (type) {
    case 'shelter': {
      const progress = Math.max(0, Math.min(MAX.shelterProgress, state.progress ?? 0));
      return {
        stage: Math.round(progress),
        stageCount: MAX.shelterProgress + 1,
        fill: clamp01(progress / MAX.shelterProgress),
        lit: false,
        flame: 0,
      };
    }
    case 'campfire': {
      const lit = (state.lit ?? 0) >= 1;
      const fuel = clamp01((state.fuel ?? 0) / MAX.campfireFuel);
      return {
        stage: 0,
        stageCount: 1,
        fill: fuel,
        lit,
        // Une flamme ne s'éteint pas d'un coup faute de bûches : elle rétrécit.
        flame: lit ? 0.45 + 0.55 * fuel : 0,
      };
    }
    case 'berry_bush':
      return { ...NEUTRAL, fill: clamp01((state.berriesLeft ?? 0) / MAX.berriesLeft) };
    case 'flint_deposit':
      return { ...NEUTRAL, fill: clamp01((state.flintLeft ?? 0) / MAX.flintLeft) };
    case 'oak_tree':
      return { ...NEUTRAL, fill: clamp01((state.woodLeft ?? 0) / MAX.woodLeft) };
    case 'camp_storage':
      return {
        ...NEUTRAL,
        fill: clamp01(((state.berries ?? 0) + (state.wood ?? 0)) / MAX.storage),
      };
    default:
      // Un type inconnu s'affiche tel qu'il a été bâti : ne rien casser vaut
      // mieux que masquer un objet dont on ignore la forme.
      return NEUTRAL;
  }
}
