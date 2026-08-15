import { describe, it, expect } from 'vitest';
import { EventLog, type ExternalEvent } from '../src/kernel/EventLog';

describe('EventLog', () => {
  it('records events and returns them per tick in insertion order', () => {
    const log = new EventLog();
    log.record({ tick: 5, type: 'llm_plan', payload: { agent: 'mira' } });
    log.record({ tick: 5, type: 'player_action', payload: { verb: 'wave' } });
    log.record({ tick: 9, type: 'llm_plan', payload: { agent: 'haran' } });

    expect(log.forTick(5).map((e) => e.type)).toEqual(['llm_plan', 'player_action']);
    expect(log.forTick(9)).toHaveLength(1);
    expect(log.forTick(6)).toEqual([]);
    expect(log.all()).toHaveLength(3);
  });

  it('rejects events recorded out of tick order', () => {
    const log = new EventLog();
    log.record({ tick: 10, type: 'a', payload: null });
    expect(() => log.record({ tick: 9, type: 'b', payload: null })).toThrow(
      'EventLog.record: tick 9 is earlier than last recorded tick 10'
    );
  });

  it('JSON round-trips', () => {
    const log = new EventLog();
    log.record({ tick: 1, type: 'x', payload: { n: 1 } });
    log.record({ tick: 2, type: 'y', payload: 'str' });
    const restored = EventLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())) as ExternalEvent[]);
    expect(restored.all()).toEqual(log.all());
  });
});
