import { postgres } from "./utils/postgres.ts";

cleanupPostgres();
setInterval(cleanupPostgres, 5 * 60 * 1000);

/**
 * Authoritative background cleanup:
 * Reclaims expired rooms across accounts with universal lock-first serialization.
 */
async function cleanupPostgres() {
  if (!postgres) {
    return;
  }
  console.time("[CLEANUP]");
  try {
    const result = await postgres.query(`
      SELECT room_id, owner_id, room_kind, previous_expires_at, ended_at 
      FROM public.expire_rooms_authoritative()
    `);
    const count = result.rowCount ?? 0;
    if (count > 0) {
      console.log(`[CLEANUP] Authoritatively expired and reclaimed ${count} rooms`);
    }
  } catch (e) {
    console.error("[CLEANUP] Error running authoritative cleanup:", e);
  }
  console.timeEnd("[CLEANUP]");
}
