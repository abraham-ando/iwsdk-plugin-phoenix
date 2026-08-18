import { describe, it, expect } from 'vitest';
import { Group, Pressed, World } from '@iwsdk/core';
import { HUMANOID, defaultGenome } from '@iwsdk/cardinal-character';
import {
  CharacterCompileSystem, CharacterStructure, createCharacter, installCharacterThree,
} from '@iwsdk/cardinal-character-three';
import {
  CharacterPickSystem, GENE_ROW_IDS, GENE_STEP, installCharacterUI,
  type PanelElement,
} from '@iwsdk/cardinal-character-ui';
// Même rig de test que `villager-body.test.ts` et `components.test.ts` : il
// vit dans `@iwsdk/cardinal-character-three`, avec l'invariant qu'il encode
// (les 19 rôles d'os de HUMANOID), et le dupliquer ici le laisserait diverger
// en silence. Alias déclaré dans `vitest.config.ts` / `tsconfig.json`.
import { humanoidPuppet } from '@character-three/fixtures/humanoidPuppet';

/**
 * Le test que l'étape 3 aurait dû avoir (voir l'auto-revue du plan de
 * l'étape 4, tâche 7) : il ne s'arrête pas au composant, comme
 * `packages/character-ui/test/install.test.ts` le fait déjà, mais monte un
 * PERSONNAGE RÉEL, fait tourner `CharacterCompileSystem`, et vérifie qu'un OS
 * a bougé. Un gestionnaire câblé sur la mauvaise clé — ou sur le mauvais
 * composant — passerait le premier maillon (le composant écrit) et tomberait
 * ici (le squelette compilé ne bouge pas).
 *
 * Seul le CHARGEMENT du panneau est simulé (`world.assets.instantiate`, qui
 * exige un navigateur pour un vrai `.uikitml`) : `installCharacterUI`,
 * `CharacterPickSystem` et `CharacterCompileSystem` sont le code réel, sans
 * doublure.
 */
function makeFakePanel(ids: readonly string[]) {
  const clicks = new Map<string, () => void>();
  const elements = new Map<string, PanelElement>();
  for (const id of ids) {
    elements.set(id, {
      setProperties() {},
      setText() {},
      addEventListener(type, handler) {
        if (type === 'click') clicks.set(id, handler);
      },
    });
  }
  const panel = Object.assign(new Group(), {
    getElementById: (id: string) => elements.get(id) ?? null,
    dispose: () => {},
  });
  return { panel, clicks };
}

describe('le panneau de personnage installé, jusqu au squelette compilé', () => {
  it('cliquer [+] sur stature DÉPLACE un os du villageois sélectionné', async () => {
    const world = new World();
    installCharacterThree(world);

    // Le villageois : un vrai personnage, un vrai squelette — la fixture
    // marionnette suffit, `PuppetApplicator` écrit `position` exactement
    // comme `SkinnedApplicator` (voir son commentaire : « déplacer un nœud
    // déplace ce qui pend dessous »).
    const { root, bones } = humanoidPuppet('rpm');
    const { entity } = createCharacter(world, {
      familyId: HUMANOID.id,
      genome: defaultGenome(HUMANOID),
      age: 30,
      rigRoot: root,
    });
    const compiler = world.getSystem(CharacterCompileSystem)!;
    compiler.update(); // première compilation, au génome par défaut (stature = 0.5)
    const jambeAvant = bones['legL']!.position.y;

    // Le panneau : `world.assets.instantiate` n'existe même pas sur un
    // `new World()` sans DOM (voir `install.test.ts`) — on lui fournit la
    // seule méthode qu'`installCharacterUI` appelle.
    const idsRequis = Object.values(GENE_ROW_IDS).flatMap((r) => Object.values(r));
    const { panel, clicks } = makeFakePanel(idsRequis);
    (world as unknown as { assets: { instantiate: () => Promise<typeof panel> } }).assets = {
      instantiate: async () => panel,
    };

    await installCharacterUI(world);

    // La sélection : le même chemin que la démo — un rayon (simulé ici par
    // `Pressed`, exactement comme `pick.test.ts`) fait passer l'entité par
    // `CharacterPickSystem`, que `installCharacterUI` a enregistré lui-même.
    entity.addComponent(Pressed, {});
    world.getSystem(CharacterPickSystem)!.update(0.016, 16);

    // Le CLIC : capturé sur le gestionnaire posé par le contrôleur RÉEL —
    // celui qu'`installCharacterUI` construit, pas une reproduction de sa
    // logique. Si `write` routait `stature` vers le mauvais composant, ou si
    // la cible lue n'était pas la bonne entité, c'est cette ligne qui ne
    // produirait aucun changement de composant.
    clicks.get(GENE_ROW_IDS['stature']!.plus)?.();
    expect(entity.getValue(CharacterStructure, 'stature')).toBeCloseTo(0.5 + GENE_STEP, 5);

    // Le SQUELETTE : la moitié que la revue de tâche dit manquante. Le
    // composant a changé — la ligne au-dessus le prouve — mais rien ne dit
    // encore que `CharacterCompileSystem` l'a vu.
    compiler.update();
    const jambeApres = bones['legL']!.position.y;

    expect(Math.abs(jambeApres - jambeAvant)).toBeGreaterThan(1e-4);
  });

  it("sans clic, le squelette ne bouge pas — le test précédent prouve le bon changement, pas n importe lequel", () => {
    const world = new World();
    installCharacterThree(world);
    const { root, bones } = humanoidPuppet('rpm');
    createCharacter(world, {
      familyId: HUMANOID.id, genome: defaultGenome(HUMANOID), age: 30, rigRoot: root,
    });
    const compiler = world.getSystem(CharacterCompileSystem)!;
    compiler.update();
    const avant = bones['legL']!.position.y;
    compiler.update();
    compiler.update();
    expect(bones['legL']!.position.y).toBe(avant);
  });
});
