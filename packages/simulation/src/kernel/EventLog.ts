/**
 * External inputs (LLM plans, player actions) are the only non-deterministic
 * inputs to the engine. They are journaled with their delivery tick so a run
 * can be replayed exactly by re-injecting the log (spec §8.3).
 */
export interface ExternalEvent {
  tick: number;
  type: string;
  payload: unknown;
}

export class EventLog {
  private events: ExternalEvent[] = [];

  record(event: ExternalEvent): void {
    const last = this.events[this.events.length - 1];
    if (last !== undefined && event.tick < last.tick) {
      throw new Error(
        `EventLog.record: tick ${event.tick} is earlier than last recorded tick ${last.tick}`
      );
    }
    this.events.push(event);
  }

  forTick(tick: number): ExternalEvent[] {
    return this.events.filter((e) => e.tick === tick);
  }

  all(): readonly ExternalEvent[] {
    return this.events;
  }

  toJSON(): ExternalEvent[] {
    return [...this.events];
  }

  static fromJSON(events: ExternalEvent[]): EventLog {
    const log = new EventLog();
    for (const e of events) log.record(e);
    return log;
  }
}
