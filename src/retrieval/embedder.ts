import OpenAI from "openai";
import { OPENAI_API_KEY, EMBEDDING_MODEL } from "../config.js";

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

export async function embed(texts: string[]): Promise<number[][]> {
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}
