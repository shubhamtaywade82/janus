import { getDb } from "../queries/connection";
import { brainEpisodes } from "@db/schema";
import { eq } from "drizzle-orm";

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const COLLECTION = "janus_episodes";

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

/**
 * Initializes the Qdrant collection, dynamically resolving the vector size
 */
export async function initVectorStore() {
  try {
    // 1. Get a test embedding to measure dimensions
    const testVector = await getEmbedding("test dimension query");
    const vectorSize = testVector.length;
    console.log(`[Brain Memory] Embedding dimension measured: ${vectorSize}`);

    // 2. Check if collection exists in Qdrant
    const listRes = await fetch(`${QDRANT_URL}/collections`);
    const listJson: any = await listRes.json();
    const exists = listJson.result?.collections?.some((c: any) => c.name === COLLECTION);

    if (!exists) {
      console.log(`[Brain Memory] Creating Qdrant collection '${COLLECTION}' with size ${vectorSize}...`);
      const createRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vectors: { size: vectorSize, distance: "Cosine" }
        })
      });
      const createJson = await createRes.json();
      console.log("[Brain Memory] Qdrant collection status:", JSON.stringify(createJson));
    } else {
      console.log(`[Brain Memory] Qdrant collection '${COLLECTION}' already exists.`);
    }
  } catch (err: any) {
    console.error("[Brain Memory] Vector Store Init Failed:", err.message);
  }
}

export const memoryStore = {
  /**
   * Save episode to SQL and insert vectorized key to Qdrant
   */
  saveEpisode: async (episode: any): Promise<number> => {
    const db = getDb();
    const [result] = await db.insert(brainEpisodes).values(episode).returning({ id: brainEpisodes.id });
    const id = result.id;

    try {
      const textToEmbed = `${JSON.stringify(episode.observation)} ${episode.reasoning || ""}`;
      const vector = await getEmbedding(textToEmbed);

      await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points?wait=true`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points: [{
            id: id,
            vector: vector,
            payload: { episodeId: id, symbol: episode.marketSymbol }
          }]
        })
      });
      console.log(`[Brain Memory] Vector indexed for episode ${id}`);
    } catch (err: any) {
      console.error(`[Brain Memory] Vector index failed for episode ${id}:`, err.message);
    }

    return id;
  },

  /**
   * Search vector memory for similar episodes
   */
  getSimilarEpisodes: async (observationText: string, limit = 5): Promise<any[]> => {
    try {
      const vector = await getEmbedding(observationText);
      const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vector,
          limit,
          with_payload: true
        })
      });
      const json: any = await res.json();
      const ids = json.result?.map((r: any) => r.payload?.episodeId as number) || [];
      if (!ids.length) return [];

      const db = getDb();
      return await db.select().from(brainEpisodes).where(eq(brainEpisodes.id, ids));
    } catch (err: any) {
      console.error("[Brain Memory] Semantic search failed:", err.message);
      return [];
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
        reflection: outcome.reflection || null
      })
      .where(eq(brainEpisodes.id, id));
  }
};
