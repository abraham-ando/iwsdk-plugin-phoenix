export interface LoreDocument {
  id: string;
  title: string;
  content: string;
  sector?: string;
  tags?: string[];
  embedding?: Float32Array;
}

export interface SearchResult {
  doc: LoreDocument;
  score: number;
}

/**
 * Lightweight in-memory spatial vector store for WebXR client-side RAG.
 */
export class SpatialVectorStore {
  private documents: LoreDocument[] = [];

  /**
   * Add a lore document to the knowledge store.
   */
  public addDocument(doc: LoreDocument): void {
    if (!doc.embedding) {
      doc.embedding = this.computeTermEmbedding(doc.title + ' ' + doc.content);
    }
    this.documents.push(doc);
  }

  /**
   * Search knowledge base with cosine similarity and optional spatial/sector filter.
   */
  public search(query: string, options: { topK?: number; sector?: string; minScore?: number } = {}): SearchResult[] {
    const topK = options.topK ?? 3;
    const minScore = options.minScore ?? 0.1;
    const queryEmb = this.computeTermEmbedding(query);

    const scored: SearchResult[] = [];

    for (const doc of this.documents) {
      if (options.sector && doc.sector && doc.sector !== options.sector) {
        continue;
      }

      const score = this.cosineSimilarity(queryEmb, doc.embedding!);
      if (score >= minScore) {
        scored.push({ doc, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Cosine similarity between two float vectors.
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    const len = Math.min(a.length, b.length);
    let dot = 0.0;
    let normA = 0.0;
    let normB = 0.0;

    for (let i = 0; i < len; i++) {
      const valA = a[i]!;
      const valB = b[i]!;
      dot += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Fast hashed character n-gram / term-frequency vectorizer (dimension 128).
   */
  private computeTermEmbedding(text: string): Float32Array {
    const dim = 128;
    const emb = new Float32Array(dim);
    const words = text.toLowerCase().replace(/[^a-z0-9à-ÿ\s]/g, '').split(/\s+/);

    for (const word of words) {
      if (!word) continue;
      let hash = 5381;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) + hash) + word.charCodeAt(i);
        hash = hash & hash;
      }
      const idx = Math.abs(hash) % dim;
      emb[idx]! += 1.0;
    }

    // Normalize
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += emb[i]! * emb[i]!;
    if (norm > 0) {
      const sqrtNorm = Math.sqrt(norm);
      for (let i = 0; i < dim; i++) emb[i]! /= sqrtNorm;
    }

    return emb;
  }
}
