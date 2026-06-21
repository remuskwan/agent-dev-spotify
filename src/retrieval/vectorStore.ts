export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class VectorStore<T> {
  private entries: Array<{ item: T; embedding: number[] }> = [];

  add(item: T, embedding: number[]): void {
    this.entries.push({ item, embedding });
  }

  scoreAll(queryEmbedding: number[]): { item: T; score: number }[] {
    return this.entries.map((e) => ({
      item: e.item,
      score: cosineSimilarity(queryEmbedding, e.embedding),
    }));
  }

  search(queryEmbedding: number[], topK: number): T[] {
    return this.scoreAll(queryEmbedding)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((e) => e.item);
  }
}
