/**
 * Les modèles locaux que le panneau d'activation propose.
 *
 * Le catalogue est DÉCLARÉ ici plutôt que dérivé de `prebuiltAppConfig` :
 * cette liste vit dans le morceau WebLLM de 5,8 Mo, et l'importer pour
 * afficher quatre lignes ferait descendre le runtime entier avant même que
 * l'utilisateur ait choisi. Un test confronte chaque entrée à la liste qui
 * fait autorité — la dérive est donc impossible, sans coût à l'exécution.
 *
 * La VRAM est celle qu'annonce WebLLM, à contexte égal (4 096 jetons). Elle
 * compte plus que le poids téléchargé : sur un casque, le rendu se dispute la
 * même mémoire.
 */

export interface LocalModelChoice {
  /** Identifiant MLC, tel que WebLLM le connaît. */
  readonly id: string;
  readonly label: string;
  /** VRAM annoncée par WebLLM, en mégaoctets. */
  readonly vramMB: number;
  /** Ce qu'il faut savoir avant de choisir. Honnête, pas commercial. */
  readonly note: string;
}

/** Plafond du catalogue : au-delà, on ne propose pas sur un casque. */
export const LOCAL_MODEL_VRAM_CEILING_MB = 1024;

export const LOCAL_MODELS: readonly LocalModelChoice[] = [
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    label: 'SmolLM2 360M',
    vramMB: 376,
    note: 'Le plus léger, et de loin. Français faible et JSON fragile : à réserver aux machines contraintes.',
  },
  {
    id: 'gemma3-1b-it-q4f16_1-MLC',
    label: 'Gemma 3 1B',
    vramMB: 711,
    note: 'Le meilleur compromis : multilingue par conception, et moitié moins de VRAM que Qwen3-0.6B pour davantage de paramètres.',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B',
    vramMB: 879,
    note: 'Solide et éprouvé, multilingue officiel. Le repli naturel si Gemma déçoit.',
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 0.5B',
    vramMB: 945,
    note: 'Deux fois moins de paramètres que Gemma 3 pour PLUS de VRAM : peu de raisons de le préférer.',
  },
];

/**
 * Ce que le panneau propose d'abord. Choisi sur la VRAM et le multilinguisme,
 * pas sur une mesure de qualité — celle-ci reste à faire, sur nos propres
 * consignes et notre propre monde.
 */
export const DEFAULT_LOCAL_MODEL = 'gemma3-1b-it-q4f16_1-MLC';

export function localModel(id: string): LocalModelChoice | undefined {
  return LOCAL_MODELS.find((m) => m.id === id);
}
