import { Client } from "pg";
import { loadEnvFile } from "node:process";
import fs from "node:fs";

if (fs.existsSync(".env")) {
  try {
    loadEnvFile();
  } catch (e) {
    // ignore
  }
}

/**
 * Strips all leading slash characters ('/') from a room ID string
 * after trimming surrounding whitespace.
 */
export function stripLeadingSlash(roomId?: string | null): string {
  if (!roomId || typeof roomId !== "string") {
    return "";
  }
  return roomId.trim().replace(/^\/+/, "");
}

/**
 * Canonical alias for room ID sanitization across server business logic.
 */
export const sanitizeRoomId = stripLeadingSlash;

export interface StripSlashesMigrationResult {
  roomsUpdated: number;
  lifecycleEventsUpdated: number;
}

/**
 * Transactional, idempotent database migration to normalize existing
 * room IDs with leading slashes in rooms and room_lifecycle_events tables.
 */
export async function stripSlashesFromDatabase(
  customClient?: Client,
): Promise<StripSlashesMigrationResult> {
  const client =
    customClient ??
    new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });

  const shouldDisconnect = !customClient;
  if (shouldDisconnect) {
    await client.connect();
  }

  try {
    await client.query("BEGIN");

    const res1 = await client.query(`
      UPDATE rooms 
      SET "roomId" = REGEXP_REPLACE("roomId", '^/+', '') 
      WHERE "roomId" LIKE '/%';
    `);

    const res2 = await client.query(`
      UPDATE room_lifecycle_events 
      SET "roomId" = REGEXP_REPLACE("roomId", '^/+', '') 
      WHERE "roomId" LIKE '/%';
    `);

    await client.query("COMMIT");

    const roomsUpdated = res1.rowCount ?? 0;
    const lifecycleEventsUpdated = res2.rowCount ?? 0;
    return { roomsUpdated, lifecycleEventsUpdated };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors if connection was lost
    }
    throw err;
  } finally {
    if (shouldDisconnect) {
      await client.end();
    }
  }
}

const isDirectCliExecution =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  Boolean(
    process.argv[1] &&
      process.argv[1].replace(/\\/g, "/").endsWith("server/strip_slashes.ts"),
  );

if (isDirectCliExecution) {
  stripSlashesFromDatabase()
    .then((res) => {
      console.log(
        `Database cleanup successful: ${res.roomsUpdated} rooms, ${res.lifecycleEventsUpdated} lifecycle events updated.`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
