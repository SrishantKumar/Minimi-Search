import type { Client } from '@libsql/client';

export interface VectorIndexMatch {
  id: string;
  score: number;
}

export interface VectorIndex {
  insert(id: string, vector: Float32Array): Promise<void>;
  search(queryVector: Float32Array, topK?: number): Promise<VectorIndexMatch[]>;
  delete(id: string): Promise<void>;
}

export class SqliteBlobVectorIndex implements VectorIndex {
  constructor(private readonly db: Client) {}

  async insert(id: string, vector: Float32Array): Promise<void> {
    const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    await this.db.execute({
      sql: 'INSERT OR REPLACE INTO message_embeddings (message_id, dim, vec) VALUES (?, ?, ?)',
      args: [id, vector.length, buffer],
    });
  }

  async search(queryVector: Float32Array, topK = 10): Promise<VectorIndexMatch[]> {
    const res = await this.db.execute('SELECT message_id, dim, vec FROM message_embeddings');
    const rows = res.rows as unknown as Array<{
      message_id: string;
      dim: number;
      vec: ArrayBuffer | Buffer;
    }>;

    const queryNorm = vectorNorm(queryVector);
    if (queryNorm === 0) return [];

    const matches: VectorIndexMatch[] = [];

    for (const row of rows) {
      if (Number(row.dim) !== queryVector.length) continue;
      const buf = Buffer.isBuffer(row.vec) ? row.vec : Buffer.from(row.vec);
      const targetVector = new Float32Array(
        buf.buffer,
        buf.byteOffset,
        Number(row.dim)
      );

      const targetNorm = vectorNorm(targetVector);
      if (targetNorm === 0) continue;

      let dotProduct = 0;
      for (let i = 0; i < queryVector.length; i++) {
        dotProduct += queryVector[i] * targetVector[i];
      }

      const cosineSimilarity = dotProduct / (queryNorm * targetNorm);
      matches.push({
        id: String(row.message_id),
        score: Math.max(0, Math.min(1, cosineSimilarity)),
      });
    }

    return matches.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  async delete(id: string): Promise<void> {
    await this.db.execute({
      sql: 'DELETE FROM message_embeddings WHERE message_id = ?',
      args: [id],
    });
  }
}

function vectorNorm(v: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    sumSq += v[i] * v[i];
  }
  return Math.sqrt(sumSq);
}
