import type { SmartObjectRegistry } from '../world/SmartObject';

/**
 * v1 content catalog (spec §4.1). Content declares the world's verbs; the
 * engine stays generic. Durations are in 100 ms ticks (30 ticks = 3 s).
 * Actor-need effects (warmth, energy) arrive with the AgentRuntime in étape 2;
 * v1 effects touch only object state and actor inventory.
 */
export function registerDefaultContent(registry: SmartObjectRegistry): void {
  registry.define('berry_bush', {
    affordances: [
      {
        verb: 'gather_berries',
        durationTicks: 30,
        preconditions: { objectState: { berriesLeft: '>0' }, actorDistance: '<1.5' },
        effects: { object: { berriesLeft: -2 }, actorInventory: { berries: 2 } },
      },
    ],
    state: { berriesLeft: 12 },
    regrowth: [{ field: 'berriesLeft', perDay: 4, max: 12 }],
  });

  registry.define('oak_tree', {
    affordances: [
      {
        verb: 'gather_wood',
        durationTicks: 40,
        preconditions: { objectState: { woodLeft: '>0' }, actorDistance: '<2' },
        effects: { object: { woodLeft: -1 }, actorInventory: { wood: 1 } },
      },
      {
        // L'outil multiplie le travail ; il ne le conditionne jamais. Ramasser
        // du bois mort reste possible à mains nues — c'est ce qui garantit que
        // la survie ne dépend d'aucune délibération, donc d'aucun service
        // externe.
        //
        // `woodLeft: '>=3'` n'est pas un détail : applyAffordance borne les
        // états à zéro, ce qui protège l'arbre mais non le bilan. Sans cette
        // précondition, un chêne où il reste deux bois en rendrait trois, et
        // la matière se créerait à partir de rien.
        verb: 'fell_tree',
        durationTicks: 90,
        preconditions: {
          objectState: { woodLeft: '>=3' },
          actorDistance: '<2',
          actorInventory: { flint_blade: '>=1' },
        },
        effects: {
          object: { woodLeft: -3 },
          actorInventory: { wood: 3, flint_blade: -1 },
        },
      },
    ],
    state: { woodLeft: 8 },
    regrowth: [{ field: 'woodLeft', perDay: 2, max: 8 }],
  });

  registry.define('flint_deposit', {
    affordances: [
      {
        verb: 'gather_flint',
        durationTicks: 50,
        preconditions: { objectState: { flintLeft: '>0' }, actorDistance: '<1.5' },
        effects: { object: { flintLeft: -1 }, actorInventory: { flint: 1 } },
      },
    ],
    state: { flintLeft: 6 },
    regrowth: [{ field: 'flintLeft', perDay: 1, max: 6 }],
  });

  registry.define('campfire', {
    affordances: [
      {
        verb: 'light_fire',
        durationTicks: 50,
        preconditions: {
          objectState: { lit: '==0' },
          actorDistance: '<2',
          actorInventory: { wood: '>=1', flint: '>=1' },
        },
        effects: { object: { lit: 1 }, actorInventory: { wood: -1 } },
      },
      {
        verb: 'add_wood',
        durationTicks: 20,
        preconditions: { objectState: { lit: '==1' }, actorDistance: '<2', actorInventory: { wood: '>=1' } },
        effects: { object: { fuel: 1 }, actorInventory: { wood: -1 } },
      },
      {
        verb: 'rest_nearby',
        durationTicks: 100,
        preconditions: { objectState: { lit: '==1' }, actorDistance: '<3' },
        effects: { actorNeeds: { warmth: 20, energy: 10 } },
      },
    ],
    state: { lit: 0, fuel: 0 },
  });

  registry.define('river_bank', {
    affordances: [
      {
        verb: 'drink',
        durationTicks: 20,
        preconditions: { actorDistance: '<2' },
        effects: { actorNeeds: { stress: -5 } },
      },
      {
        // La rivière porte une population, comme les terrains de chasse. Sans
        // elle, `fish` était un garde-manger infini à 4 m du village : mesuré,
        // 18 % des repas venaient de là sans que rien ne s'épuise jamais, et
        // aucune rareté ailleurs ne pouvait faire voyager personne.
        verb: 'fish',
        durationTicks: 80,
        preconditions: { objectState: { fishLeft: '>0' }, actorDistance: '<2' },
        effects: { object: { fishLeft: -1 }, actorInventory: { fish: 1 } },
      },
      {
        // Un rognon de silex donne plusieurs lames — c'est littéralement vrai
        // de la taille du silex, et c'est ce qui fait de `flint_blade` un
        // compteur de durabilité sans qu'aucun état nouveau soit nécessaire.
        verb: 'knap_flint',
        durationTicks: 60,
        preconditions: { actorDistance: '<2', actorInventory: { flint: '>=1' } },
        effects: { actorInventory: { flint_blade: 3, flint: -1 } },
      },
      {
        // Assembler se fait là où l'on taille. Aucun établi : le lieu suffit,
        // et un objet de plus dans le monde n'apporterait rien au modèle.
        verb: 'craft_spear',
        durationTicks: 90,
        preconditions: {
          actorDistance: '<2',
          actorInventory: { flint_blade: '>=1', wood: '>=1' },
        },
        effects: { actorInventory: { spear: 1, flint_blade: -1, wood: -1 } },
      },
    ],
    // Deux berges à +2 par jour font 4 poissons soutenables, pour une demande
    // mesurée de 4,6 par jour à onze agents : la rivière contribue sans plus
    // nourrir le village à elle seule.
    state: { fishLeft: 6 },
    regrowth: [{ field: 'fishLeft', perDay: 2, max: 6 }],
  });

  registry.define('shelter', {
    affordances: [
      {
        verb: 'build',
        durationTicks: 60,
        preconditions: {
          objectState: { progress: '<5' },
          actorDistance: '<2.5',
          actorInventory: { wood: '>=1' },
        },
        effects: { object: { progress: 1 }, actorInventory: { wood: -1 } },
      },
      {
        verb: 'sleep_inside',
        durationTicks: 200,
        // On ne dort pas quand on n'a pas sommeil. Sans cette condition,
        // `sleep_inside` — sans coût, à distance nulle, +60 énergie et
        // +15 chaleur — battait toute chaîne de trois étapes : mesuré, il
        // l'emportait jusqu'à chaleur 1 avec tous les autres besoins comblés.
        preconditions: { objectState: { progress: '>=5' }, actorDistance: '<2.5', actorNeeds: { energy: '<60' } },
        effects: { actorNeeds: { energy: 60, warmth: 15 } },
      },
    ],
    state: { progress: 0 },
  });

  registry.define('hunting_ground', {
    affordances: [
      {
        verb: 'hunt',
        durationTicks: 80,
        preconditions: { objectState: { gameLeft: '>0' }, actorDistance: '<3' },
        effects: { object: { gameLeft: -1 }, actorInventory: { meat: 1 } },
      },
      {
        // Le javelot ne donne pas plus de bêtes : il en tire davantage. Le
        // stock baisse d'une unité comme à mains nues, ce qui interdit à
        // l'outil de multiplier la ressource elle-même.
        verb: 'hunt_spear',
        durationTicks: 80,
        preconditions: {
          objectState: { gameLeft: '>0' },
          actorDistance: '<3',
          actorInventory: { spear: '>=1' },
        },
        effects: { object: { gameLeft: -1 }, actorInventory: { meat: 3, spear: -1 } },
      },
    ],
    state: { gameLeft: 5 },
    regrowth: [{ field: 'gameLeft', perDay: 1, max: 5 }],
  });

  registry.define('camp_storage', {
    affordances: [
      {
        verb: 'deposit_berries',
        durationTicks: 10,
        preconditions: { actorDistance: '<1.5', actorInventory: { berries: '>=1' } },
        effects: { object: { berries: 1 }, actorInventory: { berries: -1 } },
      },
      {
        verb: 'take_berries',
        durationTicks: 10,
        preconditions: { objectState: { berries: '>0' }, actorDistance: '<1.5' },
        effects: { object: { berries: -1 }, actorInventory: { berries: 1 } },
      },
      {
        verb: 'deposit_wood',
        durationTicks: 10,
        preconditions: { actorDistance: '<1.5', actorInventory: { wood: '>=1' } },
        effects: { object: { wood: 1 }, actorInventory: { wood: -1 } },
      },
      {
        verb: 'take_wood',
        durationTicks: 10,
        preconditions: { objectState: { wood: '>0' }, actorDistance: '<1.5' },
        effects: { object: { wood: -1 }, actorInventory: { wood: 1 } },
      },
    ],
    state: { berries: 0, wood: 0 },
  });
}
