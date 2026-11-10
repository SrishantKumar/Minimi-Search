import type Database from 'better-sqlite3';

export interface VectorIndexMatch {
  id: string;
  score: number;
}

export interface VectorIndex {
  insert(id: string, vector: Float32Array): void;
  search(queryVector: Float32Array, topK?: number): VectorIndexMatch[];
  delete(id: string): void;
}

export class SqliteBlobVectorIndex implements VectorIndex {
  private readonly insertStmt: Database.Statement;
  private readonly selectAllStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT OR REPLACE INTO message_embeddings (message_id, dim, vec)
      VALUES (?, ?, ?)
    `);

    this.selectAllStmt = db.prepare(`
      SELECT message_id, dim, vec FROM message_embeddings
    `);

    this.deleteStmt = db.prepare(`
      DELETE FROM message_embeddings WHERE message_id = ?
    `);
  }

  insert(id: string, vector: Float32Array): void {
    const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    this.insertStmt.run(id, vector.length, buffer);
  }

  search(queryVector: Float32Array, topK = 10): VectorIndexMatch[] {
    const rows = this.selectAllStmt.all() as Array<{
      message_id: string;
      dim: number;
      vec: Buffer;
    }>;

    const queryNorm = vectorNorm(queryVector);
    if (queryNorm === 0) return [];

    const matches: VectorIndexMatch[] = [];

    for (const row of rows) {
      if (row.dim !== queryVector.length) continue;
      const targetVector = new Float32Array(
        row.vec.buffer,
        row.vec.byteOffset,
        row.dim
      );

      const targetNorm = vectorNorm(targetVector);
      if (targetNorm === 0) continue;

      let dotProduct = 0;
      for (let i = 0; i < queryVector.length; i++) {
        dotProduct += queryVector[i] * targetVector[i];
      }

      const cosineSimilarity = dotProduct / (queryNorm * targetNorm);
      matches.push({
        id: row.message_id,
        score: Math.max(0, Math.min(1, cosineSimilarity)),
      });
    }

    return matches.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }
}

function vectorNorm(v: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    sumSq += v[i] * v[i];
  }
  return Math.sqrt(sumSq);
}

