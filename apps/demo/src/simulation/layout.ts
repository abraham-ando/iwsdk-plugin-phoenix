/**
 * Village layout for the VR demo. The world data (objects, agents, places)
 * comes from the engine's DEFAULT_VILLAGE scenario — the SAME entries the
 * headless batch runner uses, so simulation and rendering can never diverge
 * (spec §3, §13.3). Only the visual settlement metadata (colors) lives here.
 */
import {
  DEFAULT_VILLAGE,
  SETTLEMENTS as ENGINE_SETTLEMENTS,
  type ScenarioAgent,
  type ScenarioObject,
} from '@iwsdk/cardinal-simulation';

export type LayoutAgent = ScenarioAgent;
export type LayoutObject = ScenarioObject;

export interface SettlementLayout {
  tribe: string;
  x: number;
  z: number;
  color: number;
}

/**
 * Seule la couleur appartient au rendu. Les coordonnées étaient recopiées ici,
 * ce que l'en-tête ci-dessus affirmait déjà ne pas être le cas : déplacer un
 * campement côté moteur laissait la démo dessiner les feux à l'ancien endroit.
 */
const TRIBE_COLORS: Record<string, number> = {
  Aube: 0x3b82f6,
  Rive: 0xef4444,
  Pic: 0x10b981,
};

const SETTLEMENTS: SettlementLayout[] = ENGINE_SETTLEMENTS.map((s) => ({
  tribe: s.tribe,
  x: s.x,
  z: s.z,
  color: TRIBE_COLORS[s.tribe] ?? 0xffffff,
}));

export const VILLAGE_LAYOUT = {
  settlements: SETTLEMENTS,
  objects: DEFAULT_VILLAGE.objects,
  agents: DEFAULT_VILLAGE.agents,
  places: DEFAULT_VILLAGE.places,
};
