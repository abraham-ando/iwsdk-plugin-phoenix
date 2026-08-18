import { RayInteractable, UIKitMLAsset, type Entity, type Object3D, type World } from '@iwsdk/core';
import { CharacterSelection, CharacterStructure, CharacterFace } from '@iwsdk/cardinal-character-three';
import { CharacterUIRoute } from './components';
import { TabRouter, PANEL_IDS, type TabId } from './router';
import { SettingsTab } from './tabs/settings';
import { PersonaTab, type PersonaView } from './tabs/persona';
import { CharacterPickSystem } from './systems/CharacterPickSystem';
import { CharacterPanelPlacementSystem } from './systems/CharacterPanelPlacementSystem';
import { setText, type PanelDocument } from './document';

export interface CharacterUIOptions {
  /** Identifiant du panneau au manifeste. */
  assetId?: string;
  /** Résout l'état de persona d'une entité. Sans lui, l'onglet le dit. */
  persona?: (entity: Entity) => PersonaView | null;
  /** Les gènes sans effet sur ce rig, dérivés de son rapport d'import. */
  inertGenes?: (entity: Entity) => ReadonlySet<string>;
}

export interface CharacterUI {
  readonly node: Object3D;
  dispose(): void;
}

/** Persona se relit quatre fois par seconde, pas quatre-vingt-dix. */
const PERSONA_PERIOD_MS = 250;

/**
 * Installe le panneau de personnage : composant de route, systèmes de
 * sélection au rayon et de placement, et la boucle de rafraîchissement du
 * document. Un seul appel par monde — l'installer deux fois enregistrerait
 * deux fois les mêmes systèmes et composants, et elics lève sur le second
 * enregistrement d'un composant déjà connu.
 */
export async function installCharacterUI(
  world: World,
  options: CharacterUIOptions = {},
): Promise<CharacterUI> {
  world.registerComponent(CharacterUIRoute);
  world.registerSystem(CharacterPickSystem, { priority: 90 });
  world.registerSystem(CharacterPanelPlacementSystem, { priority: 92 });

  const panel = await world.assets.instantiate<UIKitMLAsset>(options.assetId ?? 'character-panel');
  const doc = panel as unknown as PanelDocument;
  const node = panel as unknown as Object3D;

  // Entité d'état, SANS objet 3D : elle ne porte que la cible de sélection et
  // la route d'onglet. `CharacterSelection` est un singleton (voir son
  // commentaire dans `character-three`) — un seul appel à `installCharacterUI`
  // par monde en crée un seul.
  const selection = world.createEntity();
  selection.addComponent(CharacterSelection, {});
  selection.addComponent(CharacterUIRoute, {});
  // Le panneau, lui, EST un objet 3D : il entre dans le graphe de scène pour
  // que `CharacterPanelPlacementSystem` puisse le déplacer et le mettre à
  // l'échelle face à la caméra.
  const panneau = world.createTransformEntity(node);
  // « Give the panel node `RayInteractable` so clicks land »
  // (`apps/demo/public/ui/AGENTS.md`). Ce n'est pas décoratif : en immersion,
  // `InputSystem.updateDescendantArrays()` ne remplit `scene.rayDescendants`
  // qu'avec les `object3D` des entités qui portent ce composant, et le
  // pointeur RAYON n'intersecte que cette liste. Sans lui, `[+]`, `[−]` et les
  // deux onglets sont inertes DANS LE CASQUE. Hors immersion le défaut est
  // invisible : le cœur remet `rayDescendants` à `undefined` et
  // `CanvasPointerSystem` retombe sur la scène entière, donc le clic souris
  // atteint le panneau quand même.
  panneau.addComponent(RayInteractable, {});

  // Spec §4.3 : `CharacterUIRoute` est l'UNIQUE source de vérité de la route.
  // Le routeur ne garde donc aucune copie privée — il lit et écrit ici. Sans
  // cela le composant était enregistré, posé sur l'entité, et mort : basculer
  // sur Persona depuis le panneau laissait `tab` à `'settings'` pour toujours,
  // et l'écrire depuis l'inspecteur ne changeait rien à l'écran.
  const router = new TabRouter(doc, {
    get: () => (selection.getValue(CharacterUIRoute, 'tab') as TabId | null) ?? 'settings',
    set: (tab) => {
      selection.setValue(CharacterUIRoute, 'tab', tab);
    },
  });
  const persona = new PersonaTab(doc);

  const cible = (): Entity | null =>
    (selection.getValue(CharacterSelection, 'target') as Entity | null) ?? null;

  const settings = new SettingsTab(doc, {
    read: (gene) => {
      const e = cible();
      if (e === null) return 0.5;
      const composant = gene in CharacterStructure.schema ? CharacterStructure : CharacterFace;
      return (e.getValue(composant as never, gene) as number | null) ?? 0.5;
    },
    write: (gene, valeur) => {
      const e = cible();
      if (e === null) return;
      // Deux composants seulement : les gènes de surface ne sont pas
      // éditables (voir NON_EDITABLE_GENES), et `SettingsTab` ne les fait
      // jamais parvenir jusqu'ici.
      const composant = gene in CharacterStructure.schema ? CharacterStructure : CharacterFace;
      e.setValue(composant as never, gene, valeur);
    },
    inertGenes: () => {
      const e = cible();
      return e === null ? new Set<string>() : (options.inertGenes?.(e) ?? new Set<string>());
    },
  });

  const placement = world.getSystem(CharacterPanelPlacementSystem);
  if (placement !== undefined) placement.panel = node;

  let dernier = 0;
  const tick = (now: number): void => {
    const e = cible();
    // Une écriture de `CharacterUIRoute.tab` venue d'ailleurs — l'inspecteur
    // de l'éditeur managé, un état restauré — atteint l'écran ici. Une
    // comparaison de chaînes par tick ; le document n'est réécrit que si la
    // route a réellement bougé.
    router.sync();
    setText(doc.getElementById(PANEL_IDS.targetName), e === null ? 'Aucune cible' : 'Villageois');
    // Un onglet en `display: none` n'a rien à montrer. Sans cette garde,
    // `refresh()` réécrivait treize lignes dix fois par seconde même caché —
    // ~650 `setProperties` uikit par seconde, chacun allouant — soit treize
    // fois le coût de Persona, que le commentaire ci-dessous prend soin de
    // limiter. `refresh()` ne réécrit par ailleurs que ce qui a changé.
    if (router.current === 'settings') settings.refresh();
    // Persona lit des données PAR FRAME : les relire à 90 Hz allouerait dans
    // la boucle de rendu pour un texte que l'œil ne suit pas.
    if (router.current === 'persona' && now - dernier >= PERSONA_PERIOD_MS) {
      dernier = now;
      persona.render(e === null ? null : (options.persona?.(e) ?? null));
    }
  };

  const timer = setInterval(() => tick(Date.now()), 100);

  return {
    node,
    dispose(): void {
      clearInterval(timer);
      // Un document UIKitML non disposé fuit — même famille de règle que
      // `entity.dispose()` plutôt que `destroy()`.
      (panel as unknown as { dispose?: () => void }).dispose?.();
    },
  };
}
