import { CURRENT_SCHEMA_VERSION, type RoomSnapshot, type RoomLifecycleStatus } from "./types.ts";
import { TimelineAuthority } from "../timelineAuthority.ts";
import { Room } from "../room.ts";
import { Server } from "socket.io";
import type { DatabasePool } from "./admissionCoordinator.ts";

export type ReconstructRoomInput = PersistentRoom | {
  roomId: string;
  data?: unknown;
  status?: string;
  owner_id?: string;
  isPermanent?: boolean | null;
  expiresAt?: string | Date | null;
  startedAt?: string | Date | null;
  roomTitle?: string | null;
  roomDescription?: string | null;
  mediaPath?: string | null;
  participants_locked?: boolean | null;
  max_participants?: number | null;
};

export class RoomReconstructor {
  private db: DatabasePool | null;

  constructor(db: DatabasePool | null | undefined) {
    this.db = db ?? null;
  }

  public async reconstructRoom(
    row: ReconstructRoomInput,
    io: Server
  ): Promise<{ room: Room; snapshot?: RoomSnapshot; error?: string }> {
    const rawData = row.data;
    let snapshot: RoomSnapshot | null = null;

    if (rawData) {
      const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
      if (parsed.schemaVersion && parsed.schemaVersion > CURRENT_SCHEMA_VERSION) {
        throw new Error(`UNSUPPORTED_FUTURE_SCHEMA_VERSION: ${parsed.schemaVersion}`);
      }
      snapshot = parsed as RoomSnapshot;
    }

    const roomId = row.roomId;
    const room = new Room(io, roomId, snapshot ? JSON.stringify(snapshot) : undefined);

    // Hydrate lifecycle properties
    room.status = (row.status as RoomLifecycleStatus) || "active";
    room.owner_id = row.owner_id || "";
    room.isPermanent = Boolean(row.isPermanent);
    room.expiresAt = row.expiresAt ? new Date(row.expiresAt) : undefined;
    room.startedAt = row.startedAt ? new Date(row.startedAt) : undefined;
    room.roomTitle = row.roomTitle || undefined;
    room.roomDescription = row.roomDescription || undefined;
    room.mediaPath = (row as { mediaPath?: string | null }).mediaPath || undefined;
    room.participantsLocked = Boolean(row.participants_locked);
    room.maxParticipants = typeof row.max_participants === "number" ? row.max_participants : 10;

    // Hydrate TimelineAuthority
    if (snapshot?.timeline) {
      room.timeline = new TimelineAuthority(snapshot.timeline);
      room.paused = snapshot.timeline.paused;
      room.playbackRate = snapshot.timeline.playbackRate;
      room.video = snapshot.timeline.mediaSource || snapshot.video || "";
    } else if (snapshot) {
      room.timeline = new TimelineAuthority({
        anchorTime: snapshot.videoTS || 0,
        anchorWallClock: Date.now(),
        paused: snapshot.paused !== undefined ? snapshot.paused : true,
        playbackRate: snapshot.playbackRate || 1.0,
        mediaSource: snapshot.video || "",
      });
      room.paused = room.timeline.isPaused();
      room.playbackRate = room.timeline.getPlaybackRate();
      room.video = room.timeline.getMediaSource();
    }

    // Hydrate L1 Ban Cache from PostgreSQL
    if (this.db) {
      try {
        const bansRes = await this.db.query(
          `SELECT client_identity, user_id FROM room_bans WHERE room_id = $1`,
          [roomId]
        );
        if (bansRes.rows) {
          for (const b of bansRes.rows as Array<{ client_identity?: string; user_id?: string }>) {
            if (b.client_identity) room.addBannedIdentity(b.client_identity);
            if (b.user_id) room.addBannedIdentity(b.user_id);
          }
        }
      } catch (err) {
        console.warn(`Failed to hydrate ban cache for room ${roomId}:`, err);
      }
    }

    return { room, snapshot: snapshot || undefined };
  }
}
