import { Client } from 'pg';
import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch (e) {
  console.log(e);
}

async function stripSlashes() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to database.");

    const res1 = await client.query(`
      UPDATE rooms 
      SET "roomId" = SUBSTRING("roomId", 2) 
      WHERE "roomId" LIKE '/%';
    `);
    console.log(`Updated ${res1.rowCount} rows in rooms`);

    const res2 = await client.query(`
      UPDATE room_lifecycle_events 
      SET "roomId" = SUBSTRING("roomId", 2) 
      WHERE "roomId" LIKE '/%';
    `);
    console.log(`Updated ${res2.rowCount} rows in room_lifecycle_events`);

    console.log("Migration successful.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await client.end();
  }
}

stripSlashes();
