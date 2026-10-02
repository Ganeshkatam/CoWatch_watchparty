import { postgres } from "./utils/postgres.ts";
import type { Pool, PoolClient } from "pg";

export interface DatabaseClient {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

export interface DatabaseTransaction extends DatabaseClient {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

export interface DatabasePool extends DatabaseClient {
  connect?(): Promise<PoolClient>;
  transaction?<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
}

/**
 * Executes a scoped database transaction.
 * In production with pg.Pool, acquires a dedicated client, issues BEGIN/COMMIT/ROLLBACK.
 * Supports mock database implementations in test environments.
 */
export async function transaction<T>(
  pool: DatabasePool | Pool | null | undefined,
  fn: (tx: DatabaseTransaction) => Promise<T>
): Promise<T> {
  const targetPool = pool || postgres;
  if (!targetPool) {
    throw new Error("Database pool unavailable");
  }

  const candidatePool = targetPool as DatabasePool | Pool;

  if ("transaction" in candidatePool && typeof candidatePool.transaction === "function") {
    return candidatePool.transaction(fn);
  }

  if ("connect" in candidatePool && typeof candidatePool.connect === "function") {
    const client: PoolClient = await candidatePool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client as unknown as DatabaseTransaction);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Fallback for simple mock clients without connection management
  const fallbackClient = targetPool as DatabaseClient;
  await fallbackClient.query("BEGIN").catch(() => {});
  try {
    const result = await fn(fallbackClient as unknown as DatabaseTransaction);
    await fallbackClient.query("COMMIT").catch(() => {});
    return result;
  } catch (err) {
    await fallbackClient.query("ROLLBACK").catch(() => {});
    throw err;
  }
}
