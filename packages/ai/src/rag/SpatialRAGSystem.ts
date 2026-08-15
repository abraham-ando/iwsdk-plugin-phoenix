import { Types, createSystem } from '@iwsdk/core';
import { SpatialVectorStore, type LoreDocument } from './SpatialVectorStore';

export class SpatialRAGSystem extends createSystem(
  {},
  {
    enabled: { type: Types.Boolean, default: true },
    maxLoreFragments: { type: Types.Int32, default: 2 },
  },
) {
  public store = new SpatialVectorStore();

  /**
   * Seed world lore documents into the store.
   */
  public registerLore(docs: LoreDocument[]): void {
    for (const doc of docs) {
      this.store.addDocument(doc);
    }
  }

  /**
   * Retrieve formatted lore context to inject into LLM prompts.
   */
  public getLoreContext(query: string, sector?: string): string {
    const results = this.store.search(query, {
      topK: this.config.maxLoreFragments.value,
      sector,
      minScore: 0.15,
    });

    if (results.length === 0) return '';

    const fragments = results.map((r) => `- [${r.doc.title}] : ${r.doc.content}`);
    return `### CONNAISSANCES DE LORE PERTINENTES :\n${fragments.join('\n')}`;
  }

  override update(_delta: number, _time: number): void {
    // Spatial RAG operates on-demand per inference query
  }
}
