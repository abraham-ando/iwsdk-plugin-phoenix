/**
 * Single source of truth for the village: the engine spawns its smart objects
 * from these entries and the 3D scene builds its visuals from the SAME
 * entries — simulation and rendering can never diverge (spec §3, §13.3).
 * Coordinates follow the historical settlement placement of the demo.
 */
export interface LayoutObject {
  type: string;
  x: number;
  z: number;
}

export interface LayoutAgent {
  id: string;
  name: string;
  tribe: 'Aube' | 'Rive' | 'Pic';
  role: string;
  gender: 'masculine' | 'feminine';
  x: number;
  z: number;
}

export interface SettlementLayout {
  tribe: 'Aube' | 'Rive' | 'Pic';
  x: number;
  z: number;
  color: number;
}

const SETTLEMENTS: SettlementLayout[] = [
  { tribe: 'Aube', x: 0, z: -4.5, color: 0x3b82f6 },
  { tribe: 'Rive', x: 5.5, z: -3.0, color: 0xef4444 },
  { tribe: 'Pic', x: -5.5, z: -3.0, color: 0x10b981 },
];

/** Per-settlement objects at fixed offsets (campfire at center). */
function settlementObjects(s: SettlementLayout): LayoutObject[] {
  return [
    { type: 'campfire', x: s.x, z: s.z },
    { type: 'shelter', x: s.x, z: s.z - 1.3 },
    { type: 'berry_bush', x: s.x + 1.5, z: s.z + 0.6 },
    { type: 'flint_deposit', x: s.x - 1.4, z: s.z + 0.8 },
    { type: 'camp_storage', x: s.x + 0.9, z: s.z - 0.7 },
  ];
}

const SHARED_OBJECTS: LayoutObject[] = [
  // Oaks close to the camps (subset of the visual oak grove) — wood sources.
  { type: 'oak_tree', x: -6.5, z: 2.0 },
  { type: 'oak_tree', x: 7.0, z: -1.0 },
  { type: 'oak_tree', x: -2.0, z: -13.0 },
  { type: 'oak_tree', x: 4.5, z: -14.0 },
  // River access points (river center x = 4 + sin(z*0.12)*3.5).
  { type: 'river_bank', x: 4.0, z: 0.0 },
  { type: 'river_bank', x: 2.9, z: -8.0 },
];

const AGENTS: LayoutAgent[] = [
  // Tribu de l'Aube (famille)
  { id: 'haran', name: 'Haran', tribe: 'Aube', role: 'Père & Éclaireur', gender: 'masculine', x: 1.0, z: -3.8 },
  { id: 'mira', name: 'Mira', tribe: 'Aube', role: 'Mère & Gardienne', gender: 'feminine', x: -1.0, z: -3.8 },
  { id: 'lio', name: 'Lio', tribe: 'Aube', role: 'Fils Aîné', gender: 'masculine', x: 0.8, z: -5.4 },
  { id: 'aya', name: 'Aya', tribe: 'Aube', role: 'Petite Fille', gender: 'feminine', x: -0.8, z: -5.4 },
  // Tribu de la Rive (chasseurs-artisans)
  { id: 'dagan', name: 'Dagan', tribe: 'Rive', role: 'Chef & Chasseur', gender: 'masculine', x: 6.5, z: -2.4 },
  { id: 'sira', name: 'Sira', tribe: 'Rive', role: 'Artisane', gender: 'feminine', x: 4.6, z: -2.4 },
  { id: 'nia', name: 'Nia', tribe: 'Rive', role: 'Jeune Apprentie', gender: 'feminine', x: 6.2, z: -3.9 },
  { id: 'kan', name: 'Kan', tribe: 'Rive', role: 'Guerrier Solitaire', gender: 'masculine', x: 4.8, z: -4.0 },
  // Tribu du Pic (survivants)
  { id: 'narek', name: 'Narek', tribe: 'Pic', role: 'Pisteur Expérimenté', gender: 'masculine', x: -4.6, z: -2.4 },
  { id: 'ivan', name: 'Ivan', tribe: 'Pic', role: 'Tailleur de Silex', gender: 'masculine', x: -6.4, z: -2.4 },
  { id: 'tao', name: 'Tao', tribe: 'Pic', role: 'Sentinelle du Froid', gender: 'masculine', x: -5.5, z: -4.1 },
];

export const VILLAGE_LAYOUT = {
  settlements: SETTLEMENTS,
  objects: [...SETTLEMENTS.flatMap(settlementObjects), ...SHARED_OBJECTS],
  agents: AGENTS,
  places: [
    { name: 'camp_aube', x: 0, z: -4.5, radius: 4 },
    { name: 'camp_rive', x: 5.5, z: -3.0, radius: 4 },
    { name: 'camp_pic', x: -5.5, z: -3.0, radius: 4 },
    { name: 'riviere', x: 4.0, z: 0.0, radius: 5 },
  ],
};
