/**
 * Hybrid RAG retriever: blends dense embedding similarity with keyword scoring.
 *
 * finalScore(doc) = α·cosineNorm(query, doc) + (1−α)·keywordNorm(query, doc)
 *
 * Falls back to pure keyword search when embeddings are unavailable (CI, no
 * API key, or network error) — EMBEDDING_ENABLED=false short-circuits before
 * any network call.
 *
 * Production upgrade path: when the KB grows to 100s+ articles, move
 * pre-computed embeddings to pgvector (Postgres extension) or a dedicated
 * service (Qdrant/Pinecone). Trigger points: cold-start latency becomes
 * user-visible, multi-replica deploys make per-replica embedding wasteful,
 * or embedding-model versioning requires tracking vector provenance.
 */

import { KNOWLEDGE_BASE, KnowledgeEntry, scoreKeyword, searchKnowledgeBase } from "../fixtures/knowledgeBase.js";
import { EMBEDDING_ENABLED, HYBRID_ALPHA } from "../config.js";
import { embed } from "./embedder.js";
import { VectorStore } from "./vectorStore.js";

let storePromise: Promise<VectorStore<KnowledgeEntry> | null> | null = null;

function getStore(): Promise<VectorStore<KnowledgeEntry> | null> {
  if (!storePromise) {
    storePromise = initStore().catch(() => null);
  }
  return storePromise;
}

async function initStore(): Promise<VectorStore<KnowledgeEntry> | null> {
  if (!EMBEDDING_ENABLED) return null;

  const texts = KNOWLEDGE_BASE.map(
    (e) => `${e.title}\n${e.content}\n${e.tags.join(" ")}`
  );
  const embeddings = await embed(texts);

  const vs = new VectorStore<KnowledgeEntry>();
  for (let i = 0; i < KNOWLEDGE_BASE.length; i++) {
    vs.add(KNOWLEDGE_BASE[i], embeddings[i]);
  }
  return vs;
}

function minMaxNormalize(scores: number[]): number[] {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max === min) return scores.map(() => 0);
  return scores.map((s) => (s - min) / (max - min));
}

export async function semanticSearch(query: string, topK = 3): Promise<KnowledgeEntry[]> {
  const store = await getStore();

  if (!store) {
    return searchKnowledgeBase(query, topK);
  }

  const [queryEmbedding] = await embed([query]);

  const cosineScored = store.scoreAll(queryEmbedding);
  const keywordScored = scoreKeyword(query);

  const cosineNorm = minMaxNormalize(cosineScored.map((s) => s.score));
  const keywordMax = Math.max(...keywordScored.map((s) => s.score));
  const keywordNorm = keywordMax === 0
    ? keywordScored.map(() => 0)
    : keywordScored.map((s) => s.score / keywordMax);

  const blended = KNOWLEDGE_BASE.map((entry, i) => ({
    entry,
    score: HYBRID_ALPHA * cosineNorm[i] + (1 - HYBRID_ALPHA) * keywordNorm[i],
  }));

  return blended
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.entry);
}

export function resetRetriever(): void {
  storePromise = null;
}
