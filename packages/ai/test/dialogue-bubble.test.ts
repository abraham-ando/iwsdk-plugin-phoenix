import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@iwsdk/core';
import { SpatialDialogueUI } from '../src/components/SpatialDialogueUI';
import { SmartNPC } from '../src/components/SmartNPC';
import { DialogueBubbleSystem } from '../src/ui/DialogueBubbleSystem';

describe('DialogueBubbleSystem', () => {
  let world: World;
  let bubbleSystem: DialogueBubbleSystem;

  beforeEach(() => {
    world = new World();
    world.registerComponent(SpatialDialogueUI).registerComponent(SmartNPC);
    world.registerSystem(DialogueBubbleSystem);
    bubbleSystem = world.getSystem(DialogueBubbleSystem)!;
  });

  it('manages speech bubble text and word advancement', () => {
    const entity = world.createEntity();
    entity.addComponent(SpatialDialogueUI);
    entity.addComponent(SmartNPC);

    bubbleSystem.showSpeech(entity, 'Bienvenue dans notre cité des vents !');

    const state = bubbleSystem.getBubbleState(entity);
    expect(state).toBeDefined();
    expect(state?.text).toBe('Bienvenue dans notre cité des vents !');
    expect(state?.words.length).toBe(7);
    expect(state?.visible).toBe(true);

    bubbleSystem.update(0.5, 2000);
    expect(entity.getValue(SpatialDialogueUI, 'activeWordIndex')).toBeGreaterThanOrEqual(0);
  });

  it('avance le mot surligné sur l horloge du monde, pas sur celle de la page', () => {
    const entity = world.createEntity();
    entity.addComponent(SpatialDialogueUI);
    entity.addComponent(SmartNPC);

    // Le monde tourne depuis une minute quand le PNJ prend la parole : c'est le
    // cas normal, et c'est celui qui cassait. `displayStartTime` prenait
    // `performance.now()` — des dizaines de milliers de millisecondes depuis le
    // chargement de la page — tandis qu'`update` reçoit l'horloge d'elics. La
    // soustraction était négative pendant TOUTE la session ; l'ancienne
    // assertion `>= 0` ne le voyait que lorsque le processus de test avait vécu
    // plus de deux secondes, d'où un échec intermittent sous charge.
    bubbleSystem.update(0.016, 60_000);
    bubbleSystem.showSpeech(entity, 'Bienvenue dans notre cité des vents !');

    // 3,5 mots/seconde par défaut : à une seconde, le quatrième mot (indice 3).
    bubbleSystem.update(0.016, 61_000);
    expect(entity.getValue(SpatialDialogueUI, 'activeWordIndex')).toBe(3);

    // Et le surlignage progresse encore, au lieu de rester collé.
    bubbleSystem.update(0.016, 61_600);
    expect(entity.getValue(SpatialDialogueUI, 'activeWordIndex')).toBe(5);
  });

  it('shows a "..." thinking bubble while the NPC is reasoning', () => {
    const entity = world.createEntity();
    entity.addComponent(SpatialDialogueUI);
    entity.addComponent(SmartNPC, { isThinking: true });

    bubbleSystem.update(0.016, 1000);

    const state = bubbleSystem.getBubbleState(entity);
    expect(state?.isThinking).toBe(true);
    expect(state?.text).toBe('...');
    expect(state?.visible).toBe(true);
  });
});
