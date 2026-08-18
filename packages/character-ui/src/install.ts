import { UIKitMLAsset, type Entity, type Object3D, type World } from '@iwsdk/core';
import { CharacterSelection, CharacterStructure, CharacterFace } from '@iwsdk/cardinal-character-three';
import { CharacterUIRoute } from './components';
import { TabRouter, PANEL_IDS } from './router';
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
  world.createTransformEntity(node);

  const router = new TabRouter(doc);
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
    setText(doc.getElementById(PANEL_IDS.targetName), e === null ? 'Aucune cible' : 'Villageois');
    settings.refresh();
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
