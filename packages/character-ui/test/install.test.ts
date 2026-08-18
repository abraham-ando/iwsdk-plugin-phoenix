import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Group, Object3D, Pressed, RayInteractable, World } from '@iwsdk/core';
import {
  CharacterIdentity, CharacterFace, CharacterStructure,
  installCharacterThree,
} from '@iwsdk/cardinal-character-three';
import { installCharacterUI } from '../src/install';
import { CharacterUIRoute } from '../src/components';
import { CharacterPickSystem } from '../src/systems/CharacterPickSystem';
import { CharacterPanelPlacementSystem } from '../src/systems/CharacterPanelPlacementSystem';
import { PANEL_IDS, TAB_IDS, TAB_BUTTON_IDS } from '../src/router';
import { GENE_ROW_IDS, GENE_STEP } from '../src/tabs/settings';
import { NEED_ROW_IDS, PERSONA_IDS, type PersonaView } from '../src/tabs/persona';
import type { PanelElement } from '../src/document';

/**
 * Tous les identifiants que les contrôleurs installés peuvent demander — le
 * même inventaire que `uikitml-ids.test.ts` de la démo, mais ici c'est le
 * document FACTICE qui les porte, pas le fichier réel.
 */
function tousLesIds(): string[] {
  return [
    ...Object.values(PANEL_IDS),
    ...Object.values(TAB_IDS),
    ...Object.values(TAB_BUTTON_IDS),
    ...Object.values(GENE_ROW_IDS).flatMap((r) => Object.values(r)),
    ...Object.values(NEED_ROW_IDS).flatMap((r) => Object.values(r)),
    ...Object.values(PERSONA_IDS),
  ];
}

/**
 * Un `Group` réel (donc un `Object3D` de plein droit, montable par
 * `world.createTransformEntity`) enrichi des deux méthodes qu'`UIKitMLAsset`
 * porte : `getElementById` et `dispose`. C'est ce qu'`installCharacterUI`
 * reçoit de `world.assets.instantiate` en production ; ici, un test Node n'a
 * ni analyseur UIKitML ni police, donc c'est cette doublure qui en tient
 * lieu — exactement le même motif que `makeFakeDocument` dans
 * `test/fixtures/fakeDocument.ts`, étendu pour porter aussi le nœud 3D.
 */
function makeFakePanel(ids: readonly string[]) {
  const props = new Map<string, Record<string, unknown>>();
  const texts = new Map<string, string>();
  const clicks = new Map<string, () => void>();
  const elements = new Map<string, PanelElement>();

  for (const id of ids) {
    elements.set(id, {
      setProperties(p) {
        props.set(id, { ...(props.get(id) ?? {}), ...p });
      },
      setText(t) {
        texts.set(id, t);
      },
      addEventListener(type, handler) {
        if (type === 'click') clicks.set(id, handler);
      },
    });
  }

  let disposeCount = 0;
  const panel = Object.assign(new Group(), {
    getElementById: (id: string) => elements.get(id) ?? null,
    dispose: () => {
      disposeCount++;
    },
  });

  return { panel, props, texts, clicks, disposeCount: () => disposeCount };
}

/**
 * Un monde réel, `@iwsdk/cardinal-character-three` installé (composants et
 * `CharacterCompileSystem`), et `world.assets.instantiate` remplacé par une
 * doublure qui rend le panneau factice au lieu de charger un vrai
 * `.uikitml`. C'est la même frontière que celle que `installCharacterUI`
 * traverse en production — seul le CHARGEMENT est simulé, tout le reste
 * (composants, systèmes, entités) est le code réel.
 */
function build(idsSupplémentaires: readonly string[] = []) {
  const world = new World();
  installCharacterThree(world);
  const fake = makeFakePanel([...tousLesIds(), ...idsSupplémentaires]);
  const instantiate = vi.fn(async () => fake.panel);
  // `new World()` — le constructeur `elics` pur qu'utilisent déjà les tests
  // de `character-three` — ne pose PAS `world.assets` : ce champ n'existe
  // qu'après `World.create()`, qui exige un DOM. `installCharacterUI` n'en
  // demande qu'une méthode, `instantiate` ; c'est la seule qu'on fournit.
  (world as unknown as { assets: { instantiate: typeof instantiate } }).assets = { instantiate };
  return { world, instantiate, ...fake };
}

function villageois(world: World): ReturnType<World['createTransformEntity']> {
  const e = world.createTransformEntity(new Object3D());
  e.addComponent(CharacterIdentity, { family: 'humanoid', age: 30 });
  e.addComponent(CharacterStructure, {});
  e.addComponent(CharacterFace, {});
  return e;
}

/** Presse un villageois et fait tourner CharacterPickSystem pour le sélectionner. */
function selectionner(world: World, entity: ReturnType<World['createTransformEntity']>, time = 16): void {
  entity.addComponent(Pressed, {});
  world.getSystem(CharacterPickSystem)!.update(0.016, time);
}

const VUE: PersonaView = {
  name: 'Mira', tribe: 'Aube', role: 'Mère & Gardienne', persona: 'Douce et prévoyante',
  needs: { hunger: 80, warmth: 60, energy: 100, affection: 40, stress: 10 },
  action: 'gather_berries', plan: ['nourrir la famille'],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('installCharacterUI — enregistrement', () => {
  it('enregistre CharacterUIRoute, CharacterPickSystem et CharacterPanelPlacementSystem', async () => {
    const { world } = build();
    await installCharacterUI(world);
    expect(world.getSystem(CharacterPickSystem)).toBeDefined();
    expect(world.getSystem(CharacterPanelPlacementSystem)).toBeDefined();
  });

  it('rend le nœud du panneau instancié, et le pose sur le système de placement', async () => {
    const { world, panel } = build();
    const ui = await installCharacterUI(world);
    expect(ui.node).toBe(panel);
    expect(world.getSystem(CharacterPanelPlacementSystem)!.panel).toBe(panel);
  });

  it("monte le panneau dans le graphe de scène via createTransformEntity", async () => {
    const { world, panel } = build();
    const spy = vi.spyOn(world, 'createTransformEntity');
    await installCharacterUI(world);
    expect(spy).toHaveBeenCalledWith(panel);
  });

  it("donne RayInteractable au nœud du panneau, sans quoi aucun clic ne l atteint en immersion", async () => {
    // Le symétrique de `apps/demo/test/villager-body.test.ts` (« le rig est
    // visable au rayon »), pour l'autre bout de la chaîne. En immersion,
    // `InputSystem` restreint `scene.rayDescendants` aux entités qui portent
    // ce composant, et le pointeur rayon n'intersecte que cette liste : sans
    // lui, `[+]`, `[−]` et les onglets sont inertes DANS LE CASQUE. Hors
    // immersion le cœur retombe sur la scène entière — ce qui a masqué le
    // défaut pendant toute l'étape, et pourquoi aucun autre test ne pouvait
    // l'attraper : tous appellent le gestionnaire en direct.
    const { world } = build();
    // Enregistré d'avance pour que l'assertion tombe sur un `false` net : un
    // composant jamais enregistré n'a pas de masque de bits, et
    // `hasComponent` lève au lieu de répondre.
    world.registerComponent(RayInteractable);
    const spy = vi.spyOn(world, 'createTransformEntity');
    await installCharacterUI(world);
    const panneau = spy.mock.results[0]!.value as ReturnType<World['createTransformEntity']>;
    expect(panneau.hasComponent(RayInteractable)).toBe(true);
  });

  it("instancie 'character-panel' par défaut, ou l assetId fourni", async () => {
    const a = build();
    await installCharacterUI(a.world);
    expect(a.instantiate).toHaveBeenCalledWith('character-panel');

    const b = build();
    await installCharacterUI(b.world, { assetId: 'panneau-perso' });
    expect(b.instantiate).toHaveBeenCalledWith('panneau-perso');
  });
});

describe("installCharacterUI — le pied de page suit la sélection", () => {
  it("affiche 'Aucune cible' tant que rien n est sélectionné", async () => {
    const { world, texts } = build();
    await installCharacterUI(world);
    vi.advanceTimersByTime(100);
    expect(texts.get(PANEL_IDS.targetName)).toBe('Aucune cible');
  });

  it('affiche le nom générique dès qu un villageois est sélectionné au rayon', async () => {
    const { world, texts } = build();
    await installCharacterUI(world);
    selectionner(world, villageois(world));
    vi.advanceTimersByTime(100);
    expect(texts.get(PANEL_IDS.targetName)).toBe('Villageois');
  });
});

describe("installCharacterUI — l onglet Réglages écrit sur le BON composant", () => {
  // C est le risque nommé par la revue de tâche : un gestionnaire câblé sur
  // la mauvaise clé (ou sur le mauvais composant) passerait un test à
  // hooks factices sans jamais toucher une entité réelle. Ici l entité est
  // réelle, les composants sont réels, et c est `installCharacterUI` — pas
  // une copie — qui route l écriture.
  it("« + » sur un gène de STRUCTURE avance CharacterStructure, pas CharacterFace", async () => {
    const { world, clicks } = build();
    await installCharacterUI(world);
    const cible = villageois(world);
    selectionner(world, cible);

    clicks.get(GENE_ROW_IDS['stature']!.plus)?.();

    expect(cible.getValue(CharacterStructure, 'stature')).toBeCloseTo(0.5 + GENE_STEP, 5);
    expect(cible.getValue(CharacterFace, 'jawWidth')).toBeCloseTo(0.5, 5);
  });

  it("« + » sur un gène de VISAGE avance CharacterFace, pas CharacterStructure", async () => {
    const { world, clicks } = build();
    await installCharacterUI(world);
    const cible = villageois(world);
    selectionner(world, cible);

    clicks.get(GENE_ROW_IDS['jawWidth']!.plus)?.();

    expect(cible.getValue(CharacterFace, 'jawWidth')).toBeCloseTo(0.5 + GENE_STEP, 5);
    expect(cible.getValue(CharacterStructure, 'stature')).toBeCloseTo(0.5, 5);
  });

  it('un clic sans cible sélectionnée n écrit sur aucune entité', async () => {
    const { world, clicks } = build();
    await installCharacterUI(world);
    const cible = villageois(world);
    // Jamais sélectionné : la cible du contrôleur reste `null`.
    expect(() => clicks.get(GENE_ROW_IDS['stature']!.plus)?.()).not.toThrow();
    expect(cible.getValue(CharacterStructure, 'stature')).toBeCloseTo(0.5, 5);
  });

  it("ne rafraîchit plus Réglages quand l onglet Persona est actif", async () => {
    // `refresh()` tournait à chaque tick de 100 ms, onglet caché ou non :
    // 65 `setProperties` et 13 `setText` uikit par tick, soit ~650 appels par
    // seconde, chacun allouant, dans un budget de 11–14 ms par frame — treize
    // fois le coût de Persona, que le code limitait déjà soigneusement.
    // `inertGenes` est le premier appel de `refresh()` : le compter dit si la
    // boucle tourne, sans rien mesurer d autre.
    const inertGenes = vi.fn((_e: unknown) => new Set<string>());
    const { world, clicks } = build();
    await installCharacterUI(world, { inertGenes: inertGenes as never });
    selectionner(world, villageois(world));

    vi.advanceTimersByTime(100);
    expect(inertGenes).toHaveBeenCalledTimes(1);

    clicks.get(TAB_BUTTON_IDS.persona)?.();
    vi.advanceTimersByTime(1000); // dix ticks de plus, onglet Réglages caché
    expect(inertGenes).toHaveBeenCalledTimes(1);

    // Et il repart dès qu on y revient : la mémoire de changement vit dans le
    // contrôleur, pas dans le minuteur.
    clicks.get(TAB_BUTTON_IDS.settings)?.();
    vi.advanceTimersByTime(100);
    expect(inertGenes).toHaveBeenCalledTimes(2);
  });

  it("transmet `inertGenes` de l entité sélectionnée, et ne l interroge jamais sans cible", async () => {
    const inertGenes = vi.fn((_e: unknown) => new Set(['jawWidth']));
    const { world, props } = build();
    await installCharacterUI(world, { inertGenes: inertGenes as never });

    vi.advanceTimersByTime(100);
    expect(inertGenes).not.toHaveBeenCalled();

    selectionner(world, villageois(world));
    vi.advanceTimersByTime(100);
    expect(inertGenes).toHaveBeenCalled();
    expect(props.get(GENE_ROW_IDS['jawWidth']!.plus)?.display).toBe('none');
    expect(props.get(GENE_ROW_IDS['stature']!.plus)?.display).toBe('flex');
  });
});

describe('installCharacterUI — l onglet Persona', () => {
  it("sans hook `persona`, affiche l absence plutôt que de lever", async () => {
    const { world, clicks, props } = build();
    await installCharacterUI(world);
    clicks.get(TAB_BUTTON_IDS.persona)?.();
    selectionner(world, villageois(world));
    vi.advanceTimersByTime(100);
    expect(props.get(PERSONA_IDS.absent)?.display).toBe('flex');
  });

  it('relit la vue au plus 4 fois par seconde, pas à chaque tick de 100 ms', async () => {
    let vues = 0;
    const { world, clicks, texts } = build();
    await installCharacterUI(world, {
      persona: () => {
        vues++;
        return VUE;
      },
    });
    clicks.get(TAB_BUTTON_IDS.persona)?.();
    selectionner(world, villageois(world));

    vi.advanceTimersByTime(100); // premier tick : dernier=0, l écart est énorme → rendu
    expect(vues).toBe(1);
    expect(texts.get(PERSONA_IDS.role)).toContain('Mira');

    vi.advanceTimersByTime(100); // +100 ms depuis le dernier rendu : sous le seuil de 250 ms
    expect(vues).toBe(1);

    vi.advanceTimersByTime(200); // +300 ms cumulés depuis le dernier rendu : au-dessus
    expect(vues).toBe(2);
  });

  it("ne relit jamais persona quand l onglet Réglages est actif", async () => {
    let vues = 0;
    const { world } = build();
    await installCharacterUI(world, { persona: () => { vues++; return VUE; } });
    selectionner(world, villageois(world));
    vi.advanceTimersByTime(500);
    expect(vues).toBe(0);
  });
});

describe('installCharacterUI — dispose', () => {
  it('coupe le minuteur et dispose le document UIKitML', async () => {
    const { world, disposeCount, texts } = build();
    const ui = await installCharacterUI(world);
    vi.advanceTimersByTime(100);

    ui.dispose();
    expect(disposeCount()).toBe(1);

    const avant = texts.get(PANEL_IDS.targetName);
    selectionner(world, villageois(world));
    vi.advanceTimersByTime(1000);
    // Le minuteur est coupé : plus aucune écriture, quoi que fasse le monde.
    expect(texts.get(PANEL_IDS.targetName)).toBe(avant);
  });
});


describe("installCharacterUI — CharacterUIRoute EST la route", () => {
  // Spec §4.3, README et le commentaire du composant l affirmaient tous les
  // trois : `CharacterUIRoute { tab }` est l unique source de vérité. Le
  // routeur tenait pourtant son état dans un champ privé et ne touchait jamais
  // le composant — enregistré, posé sur l entité de sélection, et mort. Aucun
  // test ne pouvait tomber là-dessus : `install.test.ts` vérifiait seulement
  // que les systèmes étaient enregistrés.

  /** L entité de sélection : le seul `world.createEntity()` que fait l install. */
  function entiteDeSelection(world: World, spy: ReturnType<typeof vi.spyOn>) {
    void world;
    return spy.mock.results[0]!.value as ReturnType<World['createEntity']>;
  }

  it('un clic sur l onglet Persona ÉCRIT le composant', async () => {
    const { world, clicks } = build();
    const spy = vi.spyOn(world, 'createEntity');
    await installCharacterUI(world);
    const selection = entiteDeSelection(world, spy);

    expect(selection.getValue(CharacterUIRoute, 'tab')).toBe('settings');
    clicks.get(TAB_BUTTON_IDS.persona)?.();
    expect(selection.getValue(CharacterUIRoute, 'tab')).toBe('persona');
    clicks.get(TAB_BUTTON_IDS.settings)?.();
    expect(selection.getValue(CharacterUIRoute, 'tab')).toBe('settings');
  });

  it('écrire le composant depuis l extérieur CHANGE l écran au tick suivant', async () => {
    // L autre sens : l inspecteur de l éditeur managé, un état restauré. Sans
    // lui, écrire `tab = 'persona'` ne changeait rien du tout.
    const { world, props } = build();
    const spy = vi.spyOn(world, 'createEntity');
    await installCharacterUI(world);
    const selection = entiteDeSelection(world, spy);

    expect(props.get(TAB_IDS.persona)?.display).toBe('none');
    selection.setValue(CharacterUIRoute, 'tab', 'persona');
    vi.advanceTimersByTime(100);
    expect(props.get(TAB_IDS.persona)?.display).toBe('flex');
    expect(props.get(TAB_IDS.settings)?.display).toBe('none');
  });
});
