import { show, type PanelDocument } from './document';

export type TabId = 'settings' | 'persona';

/** Les conteneurs d'onglet dans le document. */
export const TAB_IDS: Readonly<Record<TabId, string>> = {
  settings: 'tab-settings',
  persona: 'tab-persona',
};

/** Les boutons du pied de page qui les appellent. */
export const TAB_BUTTON_IDS: Readonly<Record<TabId, string>> = {
  settings: 'btn-tab-settings',
  persona: 'btn-tab-persona',
};

/** Les éléments du panneau qui n'appartiennent à aucun onglet. */
export const PANEL_IDS = Object.freeze({
  root: 'panel-root',
  targetName: 'target-name',
});

const ORDRE: readonly TabId[] = ['settings', 'persona'];

/**
 * Un onglet visible, les autres en `display: none`.
 *
 * IWSDK ne fournit AUCUNE navigation entre panneaux — la documentation
 * l'énonce. Le routeur est donc trois lignes de `classList` et de `display`,
 * et son seul devoir est de ne jamais laisser deux onglets allumés.
 */
export class TabRouter {
  private tab: TabId = 'settings';

  constructor(private readonly doc: PanelDocument) {
    for (const id of ORDRE) {
      this.doc
        .getElementById(TAB_BUTTON_IDS[id])
        ?.addEventListener?.('click', () => this.show(id));
    }
    this.apply();
  }

  get current(): TabId {
    return this.tab;
  }

  show(tab: TabId): void {
    this.tab = tab;
    this.apply();
  }

  private apply(): void {
    for (const id of ORDRE) {
      show(this.doc.getElementById(TAB_IDS[id]), id === this.tab);
      // Le bouton actif est plein, les autres translucides. `backgroundOpacity`
      // plutôt qu'une classe : `classList` est additif et oublier le `remove`
      // laisserait deux boutons allumés sans rien casser de visible.
      this.doc.getElementById(TAB_BUTTON_IDS[id])?.setProperties({
        backgroundOpacity: id === this.tab ? 1 : 0.35,
      });
    }
  }
}
