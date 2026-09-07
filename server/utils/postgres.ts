import { Pool, type PoolClient, type QueryResult } from "pg";
import config from "../config.ts";

export type PostgresClient = Pool | PoolClient;

export let postgres: Pool | undefined = undefined;
if (config.DATABASE_URL) {
  postgres = createPool(config.DATABASE_URL);
}

function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Handle errors on idle clients in the pool to prevent unhandled ECONNRESET crashes
  pool.on("error", (err) => {
    console.error("PostgreSQL pool idle client error:", err.message);
  });

  return pool;
}

/**
 * Use this if we need a new connection pool instead of sharing.
 * Guarantees we'll return a pool because we throw if we don't have it configured
 * @returns
 */
export function newPostgres(): Pool {
  if (!config.DATABASE_URL) {
    throw new Error("postgres not configured");
  }
  return postgres || createPool(config.DATABASE_URL);
}

export async function updateObject(
  postgres: PostgresClient,
  table: string,
  object: AnyDict,
  condition: AnyDict,
): Promise<QueryResult<any>> {
  const columns = Object.keys(object);
  const values = Object.values(object);
  // TODO support compound conditions, not just one
  let query = `UPDATE ${table} SET ${columns
    .map((c, i) => `"${c}" = $${i + 1}`)
    .join(",")}
    WHERE "${Object.keys(condition)[0]}" = $${Object.keys(object).length + 1}
    RETURNING *`;
  //console.log(query);
  const result = await postgres.query(query, [
    ...values,
    condition[Object.keys(condition)[0]],
  ]);
  return result;
}

export async function insertObject(
  postgres: PostgresClient,
  table: string,
  object: AnyDict,
): Promise<QueryResult<any>> {
  const columns = Object.keys(object);
  const values = Object.values(object);
  let query = `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(",")})
    VALUES (${values.map((_, i) => "$" + (i + 1)).join(",")})
    RETURNING *`;
  // console.log(query);
  const result = await postgres.query(query, values);
  return result;
}

export async function upsertObject(
  postgres: PostgresClient,
  table: string,
  object: AnyDict,
  conflict: BooleanDict,
): Promise<QueryResult<any>> {
  const columns = Object.keys(object);
  const values = Object.values(object);
  let query = `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(",")})
    VALUES (${values.map((_, i) => "$" + (i + 1)).join(",")})
    ON CONFLICT (${Object.keys(conflict)
      .map((k) => `"${k}"`)
      .join(",")})
    DO UPDATE SET ${Object.keys(object)
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(",")}
    RETURNING *`;
  // console.log(query);
  const result = await postgres.query(query, values);
  return result;
}

