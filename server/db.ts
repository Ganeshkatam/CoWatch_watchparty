import { postgres } from "./utils/postgres.ts";
import type { Pool, PoolClient } from "pg";

export interface DatabaseClient {
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
}

export interface DatabaseTransaction extends DatabaseClient {
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
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

  if (typeof (targetPool as DatabasePool).transaction === "function") {
    return (targetPool as DatabasePool).transaction!(fn);
  }

  if (typeof (targetPool as any).connect === "function") {
    const client: PoolClient = await (targetPool as any).connect();
    try {
      await (client as any).query("BEGIN");
      const result = await fn(client as unknown as DatabaseTransaction);
      await (client as any).query("COMMIT");
      return result;
    } catch (err) {
      await (client as any).query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Fallback for simple mock clients without connection management
  await (targetPool as any).query("BEGIN").catch(() => {});
  try {
    const result = await fn(targetPool as unknown as DatabaseTransaction);
    await (targetPool as any).query("COMMIT").catch(() => {});
    return result;
  } catch (err) {
    await (targetPool as any).query("ROLLBACK").catch(() => {});
    throw err;
  }
}
