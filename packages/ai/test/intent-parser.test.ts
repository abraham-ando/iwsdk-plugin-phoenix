import { describe, it, expect } from 'vitest';
import { IntentParser, IntentDispatcher } from '../src/intents/IntentParser';

describe('IntentParser & IntentDispatcher', () => {
  it('parses structured action tags and cleans spoken dialogue', () => {
    const rawOutput =
      'Prenez ceci, aventurier ! [ACTION: GIVE_ITEM id=42 count=3 isRare=true] Faites-en bon usage.';

    const parsed = IntentParser.parse(rawOutput);

    expect(parsed.cleanDialogue).toBe('Prenez ceci, aventurier ! Faites-en bon usage.');
    expect(parsed.intents).toHaveLength(1);
    expect(parsed.intents[0]?.type).toBe('GIVE_ITEM');
    expect(parsed.intents[0]?.params.id).toBe(42);
    expect(parsed.intents[0]?.params.count).toBe(3);
    expect(parsed.intents[0]?.params.isRare).toBe(true);
  });

  it('dispatches parsed intents to registered handlers', async () => {
    const dispatcher = new IntentDispatcher();
    let handledItem: any = null;

    dispatcher.on('GIVE_ITEM', (intent, entityId) => {
      handledItem = { intent, entityId };
    });

    const parsed = IntentParser.parse('Tiens ! [ACTION: GIVE_ITEM id=101 count=1]');
    await dispatcher.dispatch(parsed.intents, 7);

    expect(handledItem).not.toBeNull();
    expect(handledItem.entityId).toBe(7);
    expect(handledItem.intent.params.id).toBe(101);
  });
});
