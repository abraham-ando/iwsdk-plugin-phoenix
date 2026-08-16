/**
 * Village layout for the VR demo. The world data (objects, agents, places)
 * comes from the engine's DEFAULT_VILLAGE scenario — the SAME entries the
 * headless batch runner uses, so simulation and rendering can never diverge
 * (spec §3, §13.3). Only the visual settlement metadata (colors) lives here.
 */
import { DEFAULT_VILLAGE, type ScenarioAgent, type ScenarioObject } from '@iwsdk/cardinal-simulation';

export type LayoutAgent = ScenarioAgent;
export type LayoutObject = ScenarioObject;

export interface SettlementLayout {
  tribe: string;
  x: number;
  z: number;
  color: number;
}

const SETTLEMENTS: SettlementLayout[] = [
  { tribe: 'Aube', x: 0, z: -4.5, color: 0x3b82f6 },
  { tribe: 'Rive', x: 5.5, z: -3.0, color: 0xef4444 },
  { tribe: 'Pic', x: -5.5, z: -3.0, color: 0x10b981 },
];

export const VILLAGE_LAYOUT = {
  settlements: SETTLEMENTS,
  objects: DEFAULT_VILLAGE.objects,
  agents: DEFAULT_VILLAGE.agents,
  places: DEFAULT_VILLAGE.places,
};
