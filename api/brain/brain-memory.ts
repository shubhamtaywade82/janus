/**
 * Brain Memory — PostgreSQL + pgvector
 *
 * Replaces Qdrant with native PostgreSQL vector similarity.
 * Stores embeddings in the brain_episodes.embedding column.
 */

import { getDb } from "../queries/connection";
import { brainEpisodes } from "@db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Generates vector embeddings for a given text
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const openaiKey = process.env.OPENAI_API_KEY;

  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: "text-embedding-3-small", input: text })
      });
      const json: any = await res.json();
      if (json.data?.[0]?.embedding) {
        return json.data[0].embedding;
      }
    } catch (e) {
      console.warn("[Brain Memory] OpenAI Embedding failed, attempting Ollama fallback:", e);
    }
  }

  // Fallback to Ollama embedding API
  const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.2";

  const res = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text })
  });

  const json: any = await res.json();
  if (json.embedding) {
    return json.embedding;
  }

  throw new Error("Failed to generate vector embedding from both OpenAI and Ollama.");
}

export const memoryStore = {
  /**
   * Save episode to SQL with vector embedding
   */
  saveEpisode: async (episode: any): Promise<number> => {
    const db = getDb();

    let embedding: number[] | undefined;
    try {
      const textToEmbed = `${JSON.stringify(episode.observation)} ${episode.reasoning || ""}`;
      embedding = await getEmbedding(textToEmbed);
    } catch (err: any) {
      console.error(`[Brain Memory] Embedding generation failed:`, err.message);
      // Continue without embedding — episode is still valuable
    }

    const [result] = await db.insert(brainEpisodes).values({
      ...episode,
      embedding: embedding ? JSON.stringify(embedding) : undefined,
    }).returning({ id: brainEpisodes.id });

    const id = result.id;
    console.log(`[Brain Memory] Saved episode ${id}${embedding ? " with embedding" : " (no embedding)"}`);
    return id;
  },

  /**
   * Search for similar episodes using pgvector cosine similarity
   */
  getSimilarEpisodes: async (observationText: string, limit = 5): Promise<any[]> => {
    const db = getDb();

    let queryVector: number[];
    try {
      queryVector = await getEmbedding(observationText);
    } catch (err: any) {
      console.error("[Brain Memory] Embedding failed for similarity search:", err.message);
      // Fallback: return most recent episodes
      return db
        .select()
        .from(brainEpisodes)
        .orderBy(sql`${brainEpisodes.timestamp} DESC`)
        .limit(limit);
    }

    // pgvector cosine similarity query
    // The <-> operator is Euclidean distance; for cosine similarity we use <=> or normalize
    // Using cosine distance operator: 1 - cosine_similarity
    const vectorLiteral = `[${queryVector.join(",")}]`;

    try {
      const rows = await db.execute(sql`
        SELECT *, embedding <=> ${vectorLiteral}::vector AS distance
        FROM ${brainEpisodes}
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${vectorLiteral}::vector
        LIMIT ${limit}
      `);
      // postgres-js returns a RowList (array-like); pg's node driver returns { rows }.
      return (Array.isArray(rows) ? rows : (rows as any).rows) ?? [];
    } catch (err: any) {
      // pgvector not installed / embedding column absent (e.g. local dev) — degrade gracefully.
      console.warn("[Brain Memory] Vector search unavailable, falling back to recent episodes:", err.message);
      return db
        .select()
        .from(brainEpisodes)
        .orderBy(sql`${brainEpisodes.timestamp} DESC`)
        .limit(limit);
    }
  },

  getEpisode: async (id: number) => {
    const db = getDb();
    const rows = await db.select().from(brainEpisodes).where(eq(brainEpisodes.id, id)).limit(1);
    return rows[0] || null;
  },

  updateEpisodeOutcome: async (id: number, outcome: { pnl: number; action: any; reflection?: string }) => {
    const db = getDb();
    await db
      .update(brainEpisodes)
      .set({
        outcomePnl: outcome.pnl.toString(),
        actualAction: outcome.action,
        outcomeTime: new Date(),
        reflection: outcome.reflection || null,
      })
      .where(eq(brainEpisodes.id, id));
  }
};
