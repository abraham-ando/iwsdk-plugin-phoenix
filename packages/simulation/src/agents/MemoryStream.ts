import { TICKS_PER_DAY } from '../kernel/SimKernel';

/**
 * Deterministic episodic memory (spec §7.3, Smallville scoring). Retrieval is
 * lexical (token overlap), not vector-based: the engine stays deterministic
 * and dependency-free. Vector RAG via packages/ai is a later, renderer-side
 * enrichment.
 */
export type MemoryKind = 'event' | 'dialogue' | 'reflection';

export interface MemoryEntry {
  tick: number;
  text: string;
  importance: number; // 0-10
  kind: MemoryKind;
}

export const MEMORY_CAPACITY = 200;

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2)
  );
}

export class MemoryStream {
  private entries: MemoryEntry[] = [];

  add(entry: MemoryEntry): void {
    this.entries.push({ ...entry });
    if (this.entries.length > MEMORY_CAPACITY) {
      // Evict the weakest by importance × recency (relative to newest tick).
      const now = entry.tick;
      let weakest = 0;
      let weakestScore = Infinity;
      for (let i = 0; i < this.entries.length; i++) {
        const e = this.entries[i]!;
        const score = (e.importance / 10) * Math.exp(-(now - e.tick) / TICKS_PER_DAY);
        if (score < weakestScore) {
          weakestScore = score;
          weakest = i;
        }
      }
      this.entries.splice(weakest, 1);
    }
  }

  retrieve(query: string, nowTick: number, k = 6): MemoryEntry[] {
    const queryTokens = tokens(query);
    const scored = this.entries.map((e) => {
      const recency = Math.exp(-(nowTick - e.tick) / TICKS_PER_DAY);
      let overlap = 0;
      if (queryTokens.size > 0) {
        for (const t of tokens(e.text)) if (queryTokens.has(t)) overlap++;
      }
      return { entry: e, score: (e.importance / 10) * recency * (1 + overlap) };
    });
    scored.sort(
      (a, b) =>
        b.score - a.score || b.entry.tick - a.entry.tick || a.entry.text.localeCompare(b.entry.text)
    );
    return scored.slice(0, k).map((s) => ({ ...s.entry }));
  }

  all(): readonly MemoryEntry[] {
    return this.entries;
  }

  toJSON(): MemoryEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  static fromJSON(entries: MemoryEntry[]): MemoryStream {
    const stream = new MemoryStream();
    for (const e of entries) stream.entries.push({ ...e });
    return stream;
  }
}
