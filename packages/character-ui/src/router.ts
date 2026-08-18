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
 * Où vit l'onglet courant — et il n'y a QU'UN endroit.
 *
 * La spec §4.3 le demande explicitement : `CharacterUIRoute { tab }` est
 * l'unique source de vérité. Le routeur tenait pourtant son état dans un champ
 * privé, et le composant, enregistré et posé sur l'entité de sélection,
 * n'était ni lu ni écrit — l'inspecteur de l'éditeur managé y voyait
 * `'settings'` pour toujours, et y écrire ne changeait rien à l'écran. Le
 * routeur passe donc par ce contrat, dont `installCharacterUI` fournit
 * l'implémentation ECS.
 */
export interface RouteStore {
  get(): TabId;
  set(tab: TabId): void;
}

/**
 * Le repli : un état en mémoire, pour un routeur employé sans monde ECS — les
 * tests d'unité, et l'usage nu documenté dans le README. Une seule source de
 * vérité malgré tout : le champ vit ICI, pas dans le routeur.
 */
function memoryStore(): RouteStore {
  let tab: TabId = 'settings';
  return {
    get: () => tab,
    set: (suivant) => {
      tab = suivant;
    },
  };
}

/**
 * Un onglet visible, les autres en `display: none`.
 *
 * IWSDK ne fournit AUCUNE navigation entre panneaux — la documentation
 * l'énonce. Le routeur est donc trois lignes de `classList` et de `display`,
 * et son seul devoir est de ne jamais laisser deux onglets allumés.
 */
export class TabRouter {
  /**
   * Le dernier onglet APPLIQUÉ au document — jamais une seconde source de
   * vérité, seulement la mémoire de ce que le document affiche. C'est ce qui
   * permet à `sync()` de repérer une écriture venue d'ailleurs sans réécrire
   * le document à chaque tick.
   */
  private applique: TabId | null = null;

  constructor(
    private readonly doc: PanelDocument,
    private readonly store: RouteStore = memoryStore(),
  ) {
    for (const id of ORDRE) {
      this.doc
        .getElementById(TAB_BUTTON_IDS[id])
        ?.addEventListener?.('click', () => this.show(id));
    }
    this.apply();
  }

  get current(): TabId {
    return this.store.get();
  }

  show(tab: TabId): void {
    this.store.set(tab);
    this.apply();
  }

  /**
   * Réapplique si la source de vérité a bougé sans passer par `show()` :
   * l'inspecteur de l'éditeur, un état restauré, une future synchro réseau.
   * Sans elle, la route ne serait vraie que dans un sens.
   */
  sync(): void {
    if (this.store.get() !== this.applique) this.apply();
  }

  private apply(): void {
    const courant = this.store.get();
    this.applique = courant;
    for (const id of ORDRE) {
      show(this.doc.getElementById(TAB_IDS[id]), id === courant);
      // Le bouton actif est plein, les autres translucides. `backgroundOpacity`
      // plutôt qu'une classe : `classList` est additif et oublier le `remove`
      // laisserait deux boutons allumés sans rien casser de visible.
      this.doc.getElementById(TAB_BUTTON_IDS[id])?.setProperties({
        backgroundOpacity: id === courant ? 1 : 0.35,
      });
    }
  }
}
