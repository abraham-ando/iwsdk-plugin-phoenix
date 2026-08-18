export const ENGINE_NAME = '@iwsdk/cardinal-character-ui';

export type { PanelDocument, PanelElement } from './document';
export { show, setText } from './document';
export { CharacterUIRoute } from './components';
export { TabRouter, TAB_IDS, TAB_BUTTON_IDS, PANEL_IDS, type TabId } from './router';
export { renderGauge } from './gauge';
export { SettingsTab, GENE_ROW_IDS, GENE_STEP, NON_EDITABLE_GENES, type SettingsHooks } from './tabs/settings';
export { PersonaTab, NEED_ROW_IDS, PERSONA_IDS, type PersonaView, type NeedId } from './tabs/persona';
export { CharacterPickSystem } from './systems/CharacterPickSystem';
export { CharacterPanelPlacementSystem, placePanel } from './systems/CharacterPanelPlacementSystem';
export { installCharacterUI, type CharacterUI, type CharacterUIOptions } from './install';
