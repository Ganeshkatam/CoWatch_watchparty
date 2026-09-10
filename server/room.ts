import config from "./config.ts";
import axios from "axios";
import { Server, Socket } from "socket.io";
import { getUser, validateUserToken } from "./utils/supabase.ts";
import { redis, redisCount, redisCountDistinct } from "./utils/redis.ts";
import { type AssignedVM } from "./vm/base.ts";
import { getStartOfDay } from "./utils/time.ts";
import { postgres, updateObject, upsertObject } from "./utils/postgres.ts";
import { hashRoomPasscode, verifyRoomPasscode, isBcryptHash } from "./utils/roomPasscode.ts";
import {
  fetchYoutubeVideo,
  getYoutubeVideoID,
  normalizeYouTubeUrl,
  isYouTube,
} from "./utils/youtube.ts";
import { sanitizeRoomId } from "./strip_slashes.ts";
import { findPlaylistVideoByUrl } from "./utils/playlist.ts";
//@ts-expect-error
import twitch from "twitch-m3u8";
import { type QueryResult } from "pg";
import { getVBrowserProvider, VBrowserDisabledError } from "./vm/provider.ts";
export interface RoomMessageRow {
  id: string;
  roomId: string;
  user_id: string | null;
  message: string;
  message_type: 'user' | 'system';
  event_type: string | null;
  metadata: any | null;
  created_at: Date;
  updated_at: Date | null;
  profile_name?: string;
  profile_picture?: string;
}

export async function persistRoomMessage(
  roomId: string,
  userId: string,
  message: string,
  messageType: 'user' | 'system' = 'user',
  eventType: string | null = null,
  metadata: any | null = null,
  clientMessageId: string | null = null
): Promise<RoomMessageRow | null> {
  if (!postgres) return null;

  try {
    const result = await postgres.query(
      `INSERT INTO room_messages (room_id, user_id, message, message_type, event_type, metadata, client_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (room_id, user_id, client_message_id) DO NOTHING
       RETURNING id, room_id as "roomId", user_id, message, message_type, event_type, metadata, created_at, updated_at`,
      [roomId, userId, message, messageType, eventType, metadata, clientMessageId]
    );
    if (result.rowCount === 0 && clientMessageId) {
      // Duplicate client_message_id for this room/user, fetch the existing one
      const existingResult = await postgres.query(
        `SELECT id, room_id as "roomId", user_id, message, message_type, event_type, metadata, created_at, updated_at
         FROM room_messages
         WHERE room_id = $1 AND user_id = $2 AND client_message_id = $3`,
        [roomId, userId, clientMessageId]
      );
      return existingResult.rows[0] || null;
    }
    return result.rows[0];
  } catch (e) {
    console.error("Failed to persist room message:", e);
    return null;
  }
}

export async function loadRoomMessages(roomId: string, limit: number = 50, beforeCursor?: string | { createdAt: string; id: string }): Promise<RoomMessageRow[]> {
  if (!postgres) return [];

  try {
    let query = `
      SELECT rm.id, rm.room_id as "roomId", rm.user_id, rm.message, rm.message_type, rm.event_type, rm.metadata, rm.created_at, rm.updated_at, p.display_name as profile_name, p.avatar_url as profile_picture
      FROM room_messages rm
      LEFT JOIN profiles p ON rm.user_id = p.id
      WHERE rm.room_id = $1
    `;
    const params: any[] = [roomId];
    
    if (beforeCursor) {
      if (typeof beforeCursor === 'string') {
        query += ` AND rm.created_at < $2`;
        params.push(beforeCursor);
      } else {
        query += ` AND (rm.created_at, rm.id) < ($2, $3)`;
        params.push(beforeCursor.createdAt);
        params.push(beforeCursor.id);
      }
    }
    
    query += ` ORDER BY rm.created_at DESC, rm.id DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    
    const result = await postgres.query(query, params);
    return result.rows.reverse(); // Return in chronological order
  } catch (e) {
    console.error("Failed to load room messages:", e);
    return [];
  }
}


// Extend the interface
declare module "socket.io" {
  interface Socket {
    clientId: string;
    uid: string;
  }
}

export class Room {
  // Serialized state
  public video: string | null = "";
  public videoTS = 0;
  public subtitle = "";
  public playbackRate = 1;
  public paused = false;
  public loop = false;
  private chat: ChatMessage[] = [];
  private nameMap: StringDict = {};
  private pictureMap: StringDict = {};
  public vBrowser: AssignedVM | undefined = undefined;
  public creator: string | undefined = undefined; // email of the user who created the room (just used for stats)
  public lock: string | undefined = undefined; // uid of the user who locked the room
  public playlist: PlaylistVideo[] = [];

  // Non-serialized state
  public roomId: string;
  public roster: User[] = [];
  private lastTsMap = Date.now();
  private tsMap: NumberDict = {};
  private io: Server;
  private socketIdMap: StringDict = {};
  private tsInterval: NodeJS.Timeout | undefined = undefined;
  private inactivityTimeout: NodeJS.Timeout | undefined = undefined;
  public isChatDisabled: boolean | undefined = undefined;
  public status: 'scheduled' | 'active' | 'inactive' | 'ended' | 'expired' = 'active';
  public expiresAt: Date | undefined = undefined;
  public startedAt: Date | undefined = undefined;
  public owner_id: string = '';
  public currentHostClientId: string = '';
  public currentHostUid: string = '';
  private clientToUidMap: StringDict = {};
  public roomTitle: string | undefined = undefined;
  public roomDescription: string | undefined = undefined;
  public mediaPath: string | undefined = undefined;
  public isPermanent: boolean = false;
  public lastUpdateTime: Date = new Date();
  private preventTSUpdate = false;
  // Not really a queue since there's no ordering, we just retry as long as this is set
  // If we want a real queue then we need external processing of the jobs and a way to update the room from outside
  public vBrowserQueue:
    | {
      roomId: string;
      queueTime: Date;
      isLarge: boolean;
      region: string;
      uid: string;
      clientId: string;
    }
    | undefined = undefined;

  constructor(
    io: Server,
    roomId: string,
    roomData?: string | null | undefined,
  ) {
    this.roomId = sanitizeRoomId(roomId);
    this.io = io;

    if (roomData) {
      this.deserialize(roomData);
    }

    this.tsInterval = setInterval(async () => {
      // console.log(roomId, this.video, this.roster, this.tsMap, this.nameMap);
      // Clean up the data of users who aren't in the room anymore
      const memberIds = this.roster.map((p) => p.id);
      Object.keys(this.tsMap).forEach((key) => {
        if (!memberIds.includes(key)) {
          delete this.tsMap[key];
        }
      });
      if (this.video) {
        this.lastTsMap = Date.now();
        io.of(roomId).emit("REC:tsMap", this.tsMap);
      }
    }, 1000);

    io.of(roomId).use(async (socket, next) => {
      if (postgres) {
        const result = await postgres.query(
          `SELECT passcode, owner_id, "isSubRoom", status, "expiresAt", "isPermanent", "startedAt" FROM rooms where "roomId" = $1`,
          [this.roomId],
        );
        const roomRow = result.rows[0];
        const passcode = (socket.handshake.query?.passcode as string) || "";
        const roomPasscode = roomRow?.passcode;
        const owner_id = roomRow?.owner_id;
        const dbStatus = roomRow?.status;
        const isPermanent = Boolean(roomRow?.isPermanent);

        if (owner_id) {
          this.owner_id = owner_id;
        }
        this.isPermanent = isPermanent;
        if (roomRow?.expiresAt) {
          this.expiresAt = new Date(roomRow.expiresAt);
        }
        if (roomRow?.startedAt) {
          this.startedAt = new Date(roomRow.startedAt);
        }

        const uid = socket.handshake.auth?.uid;
        const token = socket.handshake.auth?.token;
        let isOwner = false;

        // Authenticate the user first, then check ownership
        if (uid && token) {
          try {
            const decoded = await validateUserToken(uid, token);
            if (decoded && decoded !== "EMAIL_NOT_VERIFIED") {
              socket.uid = uid;
              isOwner = Boolean(owner_id && owner_id === uid);
            }
          } catch (e) {
            console.error("Token validation failed in socket connect", e);
          }
        }

        const currentDbStatus = dbStatus || this.status;

        // Expired or ended rooms cannot be joined by anyone
        if (currentDbStatus === "expired" || currentDbStatus === "ended") {
          this.status = currentDbStatus;
          next(new Error("This room has ended or expired."));
          return;
        }

        // Passcode validation (authoritative security boundary for non-owners)
        if (roomPasscode && !isOwner) {
          if (!passcode) {
            next(new Error("passcode"));
            return;
          }
          if (isBcryptHash(roomPasscode)) {
            const valid = await verifyRoomPasscode(passcode, roomPasscode);
            if (!valid) {
              next(new Error("passcode"));
              return;
            }
          } else {
            // Lazy migration
            if (passcode !== roomPasscode) {
              next(new Error("passcode"));
              return;
            }
            // Best-effort hash upgrade
            try {
              const newHash = await hashRoomPasscode(passcode);
              if (newHash) {
                await postgres.query(
                  `UPDATE rooms SET passcode = $1 WHERE "roomId" = $2 AND passcode = $3`,
                  [newHash, this.roomId, roomPasscode]
                );
              }
            } catch (e) {
              console.error("Failed lazy passcode migration", e);
            }
          }
        }

        // Host-initiated room access control:
        // When room is not active (inactive or scheduled), non-owners with valid passcode are held in waiting state
        if (currentDbStatus !== "active") {
          if (!isOwner) {
            next(new Error("ROOM_NOT_STARTED"));
            return;
          }

          // Authenticated owner connecting to an inactive room: atomically activate
          if (currentDbStatus === "inactive") {
            try {
              const activateResult = await postgres.query(
                `UPDATE rooms
                 SET
                   status = 'active',
                   "lastActiveAt" = NOW(),
                   "startedAt" = NOW(),
                   "expiresAt" = CASE WHEN "isPermanent" = true THEN NULL ELSE NOW() + INTERVAL '3 hours' END
                 WHERE "roomId" = $1
                   AND owner_id = $2
                   AND status = 'inactive'
                 RETURNING status, "startedAt", "expiresAt", "lastActiveAt", "isPermanent"`,
                [this.roomId, uid]
              );

              if (activateResult.rowCount && activateResult.rowCount > 0) {
                const row = activateResult.rows[0];
                this.status = "active";
                this.startedAt = new Date(row.startedAt);
                this.expiresAt = row.expiresAt ? new Date(row.expiresAt) : undefined;
                this.lastUpdateTime = new Date();

                // Idempotent audit logging for session activation
                await postgres.query(
                  `INSERT INTO room_lifecycle_events 
                   ("roomId", actor, event, "previousStatus", "newStatus", "newExpiresAt", reason)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  [this.roomId, uid, "room.started", "inactive", "active", row.expiresAt, "host joined and started room"]
                ).catch((e) => console.error("Failed to insert lifecycle event for started room:", e));
              } else {
                // Recheck if another concurrent owner socket already activated the room
                const recheck = await postgres.query(
                  `SELECT status, "startedAt", "expiresAt" FROM rooms WHERE "roomId" = $1`,
                  [this.roomId]
                );
                const recheckStatus = recheck.rows[0]?.status;
                if (recheckStatus === "active") {
                  this.status = "active";
                  if (recheck.rows[0]?.startedAt) this.startedAt = new Date(recheck.rows[0].startedAt);
                  if (recheck.rows[0]?.expiresAt) this.expiresAt = new Date(recheck.rows[0].expiresAt);
                } else {
                  next(new Error("ROOM_NOT_STARTED"));
                  return;
                }
              }
            } catch (err) {
              console.error("Failed atomic room activation:", err);
              next(new Error("Failed to activate room."));
              return;
            }
          } else if (currentDbStatus === "scheduled") {
            this.status = "scheduled";
          }
        } else {
          this.status = "active";
        }
        // Check if room is at capacity
        const isSubRoom = roomRow?.isSubRoom;
        const roomCapacity = isSubRoom
          ? config.ROOM_CAPACITY_SUB
          : config.ROOM_CAPACITY;
        if (roomCapacity && this.roster.length >= roomCapacity) {
          next(new Error("This room is full"));
          return;
        }
      }
      // clientId is meant for things that shouldn't require login
      // Anything sensitive (e.g. subscriber features, room lock) should be validated with uid and require login
      // vbrowser controller, identify chat messages, video chat/screenshare signaling
      // Used as keys for ephemeral room state (e.g. name, picture, timestamp)

      // redis-based clientId spoof protection (session)
      // Keep a map of clientIds to sessionIDs (a secret generated by client and stored in localstorage)
      // If a clientId already exists in map, a matching sessionId must be provided, otherwise fail
      // Otherwise, store it with some expiry
      // Refresh the expiry on each successful connection
      // Attacker can't spoof unless the user doesn't connect for a long time

      // ALTERNATIVE: using crypto?
      // What if we send back the client an encrypt or hmac of their clientID?
      // Client can store in localstorage
      // Can't be spoofed without the server's encryption key
      // Attacker could try to bruteforce the key by trying all possibilities
      // Client sends both the clear clientId and the hmac
      // During transition, accept requests with no hmac
      // We would need to turn on enforcement after a while (after all clients have updated)
      // On connection, compute hmac of clear clientId and verify it matches what client sent
      // We can accept query param clientHmac?

      const clientId = socket.handshake.query?.clientId;
      const sessionId = socket.handshake.auth.sessionId;
      if (typeof clientId !== "string") {
        next(new Error("Invalid clientId type"));
        return;
      }
      // validate clientId is UUID, prevents prototype pollution
      if (!isValidUUID(clientId)) {
        next(new Error("Invalid clientId format"));
        return;
      }
      // If Redis isn't enabled we'll just allow
      if (redis) {
        const key = "session:" + clientId;
        const savedSession = await redis.get(key);
        if (savedSession) {
          // passed ID must match, otherwise error
          if (savedSession !== sessionId) {
            next(new Error("Incorrect sessionId"));
            return;
          } else {
            // Refresh expiry
            await redis.expire(key, 60 * 24 * 7);
          }
        } else {
          // Create new session
          if (sessionId) {
            await redis.setex(key, 60 * 24 * 7, sessionId);
          }
        }
      }

      next();
    });
    io.of(roomId).on("connection", async (socket: Socket) => {
      const clientId = socket.handshake.query?.clientId;
      if (typeof clientId !== "string") {
        // We already validated in middleware above, this is just to satisfy TS
        return;
      }

      socket.clientId = clientId;
      
      // -- Start socket state initialization --
      
      // Disconnect other sockets with this clientId
      if (this.socketIdMap[clientId]) {
        this.io.of(this.roomId).sockets.get(this.socketIdMap[clientId])?.disconnect(true);
      }
      // Keep track of the current socketID associated with this client (only used for signaling and kicking)
      this.socketIdMap[clientId] = socket.id;
      if (!this.roster.find(user => user.id === clientId)) {
        this.roster.push({ id: clientId });
      }

      if (this.inactivityTimeout) {
        clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = undefined;
      }
      
      socket.on("disconnect", () => this.onDisconnect(socket));
      // -- End socket state initialization --

      // Preserve uid if already set by the middleware (owner auth bypass)
      if (!socket.uid) {
        socket.uid = "";
      } else {
        this.clientToUidMap[clientId] = socket.uid;
      }

      // Check if this socket is the room owner (creator) returning to the room
      if (socket.uid && this.owner_id && socket.uid === this.owner_id) {
        this.reclaimHostForOwner(socket);
      } else if (!this.currentHostClientId && this.roster.length > 0) {
        // Initial room participant or session reconstruction
        this.currentHostClientId = this.roster[0].id;
        this.currentHostUid = this.clientToUidMap[this.roster[0].id] || "";
      }

      redisCount("connectStarts");
      redisCountDistinct("connectStartsDistinct", clientId);

      if (this.status === 'expired' || this.status === 'ended') {
        socket.emit("errorMessage", "This room has ended or expired.");
        socket.disconnect(true);
        return;
      }

      // Check if this socket matches this.lock UID or is the room host
      const validateLock = () => {
        const isHost = this.isHost(socket);
        return !this.lock || socket.uid === this.lock || isHost;
      };

      // Check if this room is expired
      const validateNotExpired = () => {
        if (this.status === 'expired' || this.status === 'ended') {
          socket.emit("errorMessage", "This room has ended or expired.");
          return false;
        }

        // Permanent rooms never expire
        if (this.isPermanent) {
          return true;
        }
        if (this.expiresAt && this.expiresAt.getTime() <= Date.now()) {
          this.status = 'expired';
          socket.emit("errorMessage", "This room has ended or expired.");
          if (postgres) {
            postgres.query(
              `UPDATE rooms SET status = 'expired', "endedAt" = NOW() WHERE "roomId" = $1`,
              [this.roomId]
            ).catch(e => console.error("Failed to update status on real-time check:", e));
          }
          if (this.vBrowser) {
            this.stopVBrowserInternal();
          }
          this.disconnectAllSockets();
          return false;
        }
        return true;
      };

      // Check if this socket matches the room owner UID
      const validateOwner = async () => {
        const result = await postgres?.query(
          'SELECT owner_id FROM rooms where "roomId" = $1',
          [this.roomId],
        );
        const owner = result?.rows[0]?.owner_id;
        return !owner || socket.uid === owner;
      };

      socket.on("CMD:name", (data: unknown) =>
        this.changeUserName(socket, String(data)),
      );
      socket.on("CMD:picture", (data: unknown) =>
        this.changeUserPicture(socket, String(data)),
      );
      socket.on("CMD:uid", async (raw: unknown) => {
        let data = raw as { uid: string; token: string };
        // Called when the user logs in, sets the socket's auth state
        if (!data || !data.uid || !data.token) {
          return;
        }
        const decoded = await validateUserToken(data.uid, data.token);
        if (decoded === "EMAIL_NOT_VERIFIED") {
          socket.emit("CMD:error", "Email verification is required.");
          return;
        }
        if (decoded?.uid) {
          // This socket is now confirmed to be this UID
          socket.uid = decoded?.uid;
          this.clientToUidMap[socket.clientId] = decoded.uid;
          if (this.owner_id && decoded.uid === this.owner_id) {
            this.reclaimHostForOwner(socket);
          }
          if (postgres) {
            try {
              const profileRes = await postgres.query(
                "SELECT display_name, username, avatar_url FROM profiles WHERE id = $1 LIMIT 1",
                [decoded.uid]
              );
              if (profileRes.rows && profileRes.rows.length > 0) {
                const profile = profileRes.rows[0];
                const resolvedName = profile.display_name?.trim() || profile.username?.trim();
                if (resolvedName && (!this.nameMap[socket.clientId] || this.nameMap[socket.clientId].startsWith("Guest") || this.nameMap[socket.clientId] === socket.clientId)) {
                  this.nameMap[socket.clientId] = resolvedName;
                  this.io.of(this.roomId).emit("REC:nameMap", this.nameMap);
                }
                if (profile.avatar_url && !this.pictureMap[socket.clientId]) {
                  this.pictureMap[socket.clientId] = profile.avatar_url;
                  this.io.of(this.roomId).emit("REC:pictureMap", this.pictureMap);
                }
              }
            } catch (err) {
              console.warn("Failed to fetch profile in CMD:uid", err);
            }
          }
        }
      });
      socket.on("CMD:host", (data: unknown) => {
        validateLock() && validateNotExpired() && this.startHosting(socket, String(data));
      });
      socket.on("CMD:play", () => {
        validateLock() && validateNotExpired() && this.playVideo(socket);
      });
      socket.on("CMD:pause", () => {
        validateLock() && validateNotExpired() && this.pauseVideo(socket);
      });
      socket.on("CMD:seek", (data: unknown) => {
        validateLock() && validateNotExpired() && this.seekVideo(socket, Number(data));
      });
      socket.on("CMD:playbackRate", (data: unknown) => {
        validateLock() && validateNotExpired() && this.setPlaybackRate(socket, Number(data));
      });
      socket.on("CMD:loop", (data: unknown) => {
        validateLock() && validateNotExpired() && this.setLoop(Boolean(data));
      });
      socket.on("CMD:ts", (data: unknown) =>
        validateNotExpired() && this.setTimestamp(socket, Number(data)),
      );
      socket.on("CMD:chat", (data: unknown) =>
        validateNotExpired() && this.sendChatMessage(socket, String(data)),
      );
      socket.on("CMD:chatV2", (data: unknown) =>
        validateNotExpired() && this.sendChatMessage(socket, data),
      );
      socket.on("CMD:editMessage", (data: unknown) => {
        validateNotExpired() && this.editMessage(socket, data);
      });
      socket.on("CMD:addReaction", (data: unknown) =>
        validateNotExpired() && this.addReaction(socket, data),
      );
      socket.on("CMD:removeReaction", (data: unknown) => {
        validateNotExpired() && this.removeReaction(socket, data);
      });
      socket.on("CMD:loadMessages", async (data: any) => {
        if (!validateNotExpired()) return;
        const beforeCursor = data?.beforeCursor;
        const messages = await loadRoomMessages(this.roomId, 50, beforeCursor);
        const formattedMessages = messages.map((row: any) => ({
          id: row.metadata?.clientId || 'unknown',
          msg: row.message,
          cmd: row.event_type || undefined,
          timestamp: row.created_at.toISOString(),
          videoTS: row.metadata?.videoTS,
          dbId: row.id,
          name: row.profile_name || row.metadata?.name,
          picture: row.profile_picture || row.metadata?.picture,
          userId: row.user_id || undefined,
          updatedAt: row.updated_at ? row.updated_at.toISOString() : undefined,
        }));
        socket.emit("ROOM_MESSAGES", formattedMessages.reverse());
      });
      socket.on("CMD:joinVideo", () => validateNotExpired() && this.joinVideo(socket));
      socket.on("CMD:leaveVideo", () => validateNotExpired() && this.leaveVideo(socket));
      socket.on("CMD:joinScreenShare", (data) => {
        validateLock() && validateNotExpired() && this.joinScreenSharing(socket, data);
      });
      socket.on("CMD:userMute", (data: unknown) =>
        validateNotExpired() && this.setUserMute(socket, data),
      );
      socket.on("CMD:leaveScreenShare", () => validateNotExpired() && this.leaveScreenSharing(socket));
      socket.on("CMD:startVBrowser", (data: unknown) => {
        validateLock() && validateNotExpired() && this.startVBrowser(socket, data);
      });
      socket.on("CMD:stopVBrowser", () => {
        validateLock() && validateNotExpired() && this.stopVBrowser();
      });
      socket.on("CMD:changeController", (data: unknown) => {
        validateLock() && validateNotExpired() && this.changeController(String(data));
      });
      socket.on("CMD:subtitle", (data: unknown) => {
        validateLock() && validateNotExpired() && this.addSubtitles(String(data));
      });
      socket.on("CMD:lock", async (data: unknown) => {
        if (!validateNotExpired()) return;
        const isHost = this.isHost(socket);
        const isCurrentLockHolder = Boolean(this.lock && socket.uid === this.lock);
        if (!this.lock || isHost || isCurrentLockHolder) {
          await this.lockRoom(socket, data);
        } else {
          socket.emit("errorMessage", "Only the room host can change the lock");
        }
      });
      socket.on("CMD:askHost", () => {
        validateNotExpired() && socket.emit("REC:host", this.getHostState());
      });
      socket.on("CMD:assignHost", (data: unknown) => {
        if (!validateNotExpired()) return;
        const req = data as { newHostClientId: string };
        if (req && req.newHostClientId) {
          this.assignHost(socket, String(req.newHostClientId));
        }
      });
      socket.on("CMD:getRoomState", () => validateNotExpired() && this.getRoomState(socket));
      socket.on("CMD:setRoomState", async (data: unknown) => {
        socket.emit("errorMessage", "Room settings cannot be changed while the room is active");
      });
      socket.on("CMD:setRoomOwner", async (data: unknown) => {
        socket.emit("errorMessage", "Room settings cannot be changed while the room is active");
      });
      socket.on("CMD:playlistNext", (data: unknown) => {
        validateLock() && validateNotExpired() && this.playlistNext(data);
      });
      socket.on("CMD:playlistAdd", (data: unknown) => {
        validateLock() && validateNotExpired() && this.playlistAdd(socket, String(data));
      });
      socket.on("CMD:playlistMove", (data: unknown) => {
        validateLock() && validateNotExpired() && this.playlistMove(data);
      });
      socket.on("CMD:playlistDelete", (data: unknown) => {
        validateLock() && validateNotExpired() && this.playlistDelete(Number(data));
      });
      socket.on("CMD:kickUser", async (data: unknown) => {
        if (this.isHost(socket) && validateNotExpired()) {
          this.kickUser(data);
        } else {
          socket.emit("errorMessage", "Only the room host can kick participants");
        }
      });
      socket.on("CMD:deleteChatMessages", async (data: unknown) => {
        if (this.isHost(socket) && validateNotExpired()) {
          this.deleteChatMessages(data);
        } else {
          socket.emit("errorMessage", "Only the room host can delete chat messages");
        }
      });

      socket.on("signal", (data: unknown) =>
        validateNotExpired() && this.sendSignal(socket, data, "signal"),
      );
      socket.on("signalSS", (data: unknown) =>
        validateNotExpired() && this.sendSignal(socket, data, "signalSS"),
      );

      // Attempt to resolve profile from auth token if passed in handshake
      const authUid = socket.handshake.auth?.uid;
      const authToken = socket.handshake.auth?.token;
      if (authUid && authToken) {
        try {
          const decoded = await validateUserToken(authUid, authToken);
          if (decoded && decoded !== "EMAIL_NOT_VERIFIED" && decoded.uid) {
            socket.uid = decoded.uid;
            this.clientToUidMap[clientId] = decoded.uid;
            if (this.owner_id && decoded.uid === this.owner_id) {
              this.reclaimHostForOwner(socket);
            }
            if (postgres) {
              const profileRes = await postgres.query(
                "SELECT display_name, username, avatar_url FROM profiles WHERE id = $1 LIMIT 1",
                [decoded.uid]
              );
              if (profileRes.rows && profileRes.rows.length > 0) {
                const profile = profileRes.rows[0];
                const resolvedName = profile.display_name?.trim() || profile.username?.trim();
                if (resolvedName && (!this.nameMap[clientId] || this.nameMap[clientId].startsWith("Guest") || this.nameMap[clientId] === clientId)) {
                  this.nameMap[clientId] = resolvedName;
                }
                if (profile.avatar_url && !this.pictureMap[clientId]) {
                  this.pictureMap[clientId] = profile.avatar_url;
                }
              }
            }
          }
        } catch (e) {
          console.warn("Failed resolving auth on connection", e);
        }
      }

      // Async initialization (must happen after registering synchronous listeners to avoid dropping immediate client emits)
      socket.emit("REC:host", this.getHostState());
      socket.emit("REC:hostChange", {
        hostId: this.currentHostUid || this.currentHostClientId,
        hostClientId: this.currentHostClientId,
        hostName: this.getHostDisplayName(),
        isOwner: Boolean(this.owner_id && this.currentHostUid && this.currentHostUid === this.owner_id),
        reason: "initial",
      });
      socket.emit("REC:nameMap", this.nameMap);
      socket.emit("REC:pictureMap", this.pictureMap);
      socket.emit("REC:tsMap", this.tsMap);
      socket.emit("REC:lock", this.lock);
      const recentMessages = await loadRoomMessages(this.roomId, 50);
      const formattedMessages = recentMessages.map((row: any) => ({
        id: row.metadata?.clientId || 'unknown',
        msg: row.message,
        cmd: row.event_type || undefined,
        timestamp: row.created_at.toISOString(),
        videoTS: row.metadata?.videoTS,
        dbId: row.id,
        name: row.profile_name || row.metadata?.name,
        picture: row.profile_picture || row.metadata?.picture,
        userId: row.user_id || undefined,
        updatedAt: row.updated_at ? row.updated_at.toISOString() : undefined,
      }));
      socket.emit("chatinit", formattedMessages.reverse());
      socket.emit("ROOM_MESSAGES", formattedMessages);
      socket.emit("playlist", this.playlist);
      this.getRoomState(socket);
      io.of(roomId).emit("roster", this.getRosterForApp());
    });
  }

  public serialize = () => {
    // We no longer serialize chat messages to memory state
    const chatIDs = new Set<string>();
    const abbrNameMap: StringDict = {};
    Object.keys(this.nameMap).forEach((id) => {
      if (chatIDs.has(id)) {
        abbrNameMap[id] = this.nameMap[id];
      }
    });
    const abbrPictureMap: StringDict = {};
    Object.keys(this.pictureMap).forEach((id) => {
      if (chatIDs.has(id)) {
        abbrPictureMap[id] = this.pictureMap[id];
      }
    });
    return JSON.stringify({
      video: this.video,
      videoTS: this.videoTS,
      subtitle: this.subtitle,
      playbackRate: this.playbackRate,
      paused: this.paused,
      nameMap: abbrNameMap,
      pictureMap: abbrPictureMap,
      vBrowser: this.vBrowser,
      lock: this.lock,
      creator: this.creator,
      playlist: this.playlist,
      loop: this.loop,
    });
  };

  private deserialize = (roomData: string) => {
    const roomObj = JSON.parse(roomData);
    this.video = roomObj.video;
    this.videoTS = roomObj.videoTS;
    if (roomObj.subtitle) {
      this.subtitle = roomObj.subtitle;
    }
    if (roomObj.paused !== undefined) {
      this.paused = roomObj.paused;
    }
    if (roomObj.nameMap) {
      this.nameMap = roomObj.nameMap;
    }
    if (roomObj.pictureMap) {
      this.pictureMap = roomObj.pictureMap;
    }
    if (roomObj.vBrowser) {
      this.vBrowser = roomObj.vBrowser;
    }
    if (roomObj.lock) {
      this.lock = roomObj.lock;
    }
    if (roomObj.creator) {
      this.creator = roomObj.creator;
    }
    if (roomObj.playlist) {
      this.playlist = roomObj.playlist;
    }
    if (roomObj.playbackRate) {
      this.playbackRate = roomObj.playbackRate;
    }
    if (roomObj.loop) {
      this.loop = roomObj.loop;
    }
  };

  public saveRoom = async () => {
    if (postgres) {
      try {
        const roomString = this.serialize();
        await postgres.query(
          `UPDATE rooms SET
          "lastUpdateTime" = $1, data = $2
          WHERE "roomId" = $3`,
          [this.lastUpdateTime ?? new Date(), roomString, this.roomId],
        );
      } catch (e) {
        console.warn(e);
      }
    }
  };

  public destroy = () => {
    if (this.tsInterval) {
      clearInterval(this.tsInterval);
    }
  };

  public getRosterForStats = () => {
    return this.roster.map((p) => ({
      id: p.id,
      name: this.nameMap[p.id] || p.id,
      ts: this.tsMap[p.id],
      // TODO this will not work behind nginx reverse proxy, pass it and read from X-Real-IP instead
      // socket.handshake.headers["x-real-ip"]
      // ip: this.io.of(this.roomId).sockets.get(p.id)?.request?.socket
      //   ?.remoteAddress,
    }));
  };

  protected getSharerId = (): string => {
    let sharerId = "";
    if (this.video?.startsWith("screenshare://")) {
      sharerId = this.video?.slice("screenshare://".length).split("@")[0];
    } else if (this.video?.startsWith("fileshare://")) {
      sharerId = this.video?.slice("fileshare://".length).split("@")[0];
    }
    return sharerId;
  };

  protected getRosterForApp = (): User[] => {
    return this.roster.map((p) => {
      return {
        ...p,
        isScreenShare: p.id === this.getSharerId(),
      };
    });
  };

  private getHostState = (): HostState => {
    return {
      video: this.video ?? "",
      videoTS: this.videoTS,
      subtitle: this.subtitle,
      playbackRate: this.playbackRate,
      paused: this.paused,
      isVBrowserLarge: Boolean(this.vBrowser && this.vBrowser.large),
      controller: this.vBrowser?.controllerClient,
      loop: this.loop,
    };
  };

  public isHost = (socket: Socket | null | undefined): boolean => {
    if (!socket) return false;
    return Boolean(this.currentHostClientId && socket.clientId === this.currentHostClientId);
  };

  public getHostDisplayName = (): string => {
    if (this.currentHostClientId && this.nameMap[this.currentHostClientId]) {
      return this.nameMap[this.currentHostClientId];
    }
    return "Host";
  };

  public broadcastHostChange = (reason: "assigned" | "auto_assigned" | "owner_returned" | "initial" | "name_update") => {
    const isOwner = Boolean(this.owner_id && this.currentHostUid && this.currentHostUid === this.owner_id);
    const hostPayload = {
      hostId: this.currentHostUid || this.currentHostClientId,
      hostClientId: this.currentHostClientId,
      hostName: this.getHostDisplayName(),
      isOwner,
      reason,
    };
    this.io.of(this.roomId).emit("REC:hostChange", hostPayload);
    this.io.of(this.roomId).emit("REC:getRoomState", {
      owner: this.owner_id,
      currentHostId: this.currentHostUid || this.currentHostClientId,
      currentHostClientId: this.currentHostClientId,
      hostName: this.getHostDisplayName(),
      isHost: false, // Per-socket value evaluated in getRoomState()
      isChatDisabled: this.isChatDisabled,
      roomTitle: this.roomTitle,
      roomDescription: this.roomDescription,
      mediaPath: this.mediaPath,
    });
  };

  public reclaimHostForOwner = (ownerSocket: Socket) => {
    if (!this.owner_id || ownerSocket.uid !== this.owner_id) return;
    const previousHostClientId = this.currentHostClientId;
    this.currentHostClientId = ownerSocket.clientId;
    this.currentHostUid = ownerSocket.uid;
    this.clientToUidMap[ownerSocket.clientId] = ownerSocket.uid;

    if (previousHostClientId !== ownerSocket.clientId) {
      this.broadcastHostChange("owner_returned");
      const chatMsg = {
        id: ownerSocket.clientId,
        cmd: "system",
        msg: "The room creator has returned and resumed hosting.",
      };
      this.addChatMessage(ownerSocket, chatMsg);
    }
  };

  public assignHost = (socket: Socket, newHostClientId: string): boolean => {
    if (!this.isHost(socket)) {
      socket.emit("errorMessage", "Only the current room host can assign a new host.");
      return false;
    }
    const targetParticipant = this.roster.find((p) => p.id === newHostClientId);
    if (!targetParticipant) {
      socket.emit("errorMessage", "Selected participant is no longer in the room.");
      return false;
    }
    if (newHostClientId === this.currentHostClientId) {
      return true; // Already host
    }

    const previousHostName = this.getHostDisplayName();
    this.currentHostClientId = newHostClientId;
    this.currentHostUid = this.clientToUidMap[newHostClientId] || "";
    const newHostName = this.getHostDisplayName();

    this.broadcastHostChange("assigned");
    const chatMsg = {
      id: socket.clientId,
      cmd: "system",
      msg: `${previousHostName} assigned ${newHostName} as the room host.`,
    };
    this.addChatMessage(socket, chatMsg);
    return true;
  };

  public stopVBrowserInternal = async () => {
    const assignTime = this.vBrowser && this.vBrowser.assignTime;
    const id = this.vBrowser?.id;
    const provider = this.vBrowser?.provider;
    const isLarge = this.vBrowser?.large ?? false;
    const region = this.vBrowser?.region ?? "";
    const uid = this.vBrowser?.creatorUID ?? "";
    this.vBrowser = undefined;
    this.cmdHost(null, "");
    // Force a save because this might change in unattended rooms
    this.lastUpdateTime = new Date();
    this.saveRoom();
    if (redis && assignTime) {
      await redis.lpush("vBrowserSessionMS", Date.now() - assignTime);
      await redis.ltrim("vBrowserSessionMS", 0, 19);
    }

    if (id) {
      try {
        const vBrowserProvider = getVBrowserProvider();
        await vBrowserProvider.release({
          id,
          provider,
          isLarge,
          region,
          roomId: this.roomId,
        });
      } catch (e) {
        console.warn("Failed to release VBrowser:", e);
      }
    }
  };

  private cmdHost = (socket: Socket | null, data: string) => {
    if (data && data.length > 50000) {
      return;
    }
    this.video = data;
    this.videoTS = 0;
    this.paused = false;
    this.subtitle = "";
    this.loop = false;
    this.playbackRate = 1;
    this.tsMap = {};
    this.preventTSUpdate = true;
    setTimeout(() => (this.preventTSUpdate = false), 1000);
    this.io.of(this.roomId).emit("REC:tsMap", this.tsMap);
    this.io.of(this.roomId).emit("REC:host", this.getHostState());
    if (socket && data) {
      const chatMsg = { id: socket.clientId, cmd: "host", msg: data };
      this.addChatMessage(socket, chatMsg);
    }
    if (data === "") {
      this.playlistNext(null);
    }
    // The room video is changing so remove room from vbrowser queue
    this.vBrowserQueue = undefined;
    // Resend the roster (updates screenshare state etc)
    this.io.of(this.roomId).emit("roster", this.getRosterForApp());
  };

  /**
   * Check whether a given user ID is the owner of this room.
   * Uses the in-memory owner_id first; falls back to the database
   * if the in-memory value hasn't been populated yet.
   */
  public isRoomOwner = async (uid: string | undefined): Promise<boolean> => {
    if (!uid) return false;
    // Fast path: check the in-memory property
    if (this.owner_id) {
      return this.owner_id === uid;
    }
    // Slow path: query the database
    if (!postgres) return false;
    const result = await postgres.query(
      'SELECT owner_id FROM rooms WHERE "roomId" = $1',
      [this.roomId],
    );
    const dbOwner = result?.rows[0]?.owner_id;
    if (dbOwner) {
      this.owner_id = dbOwner; // cache for future calls
    }
    return dbOwner === uid;
  };

  public addChatMessage = async (socket: Socket | null, chatMsg: ChatMessageBase) => {
    if (this.isChatDisabled && !chatMsg.cmd) {
      return;
    }
    const chatWithTime: ChatMessage = {
      ...chatMsg,
      timestamp: new Date().toISOString(),
      videoTS: socket?.clientId ? this.tsMap[socket.clientId] : undefined,
      name: socket?.clientId ? this.nameMap[socket.clientId] : undefined,
      picture: socket?.clientId ? this.pictureMap[socket.clientId] : undefined,
    };
    
    // Determine persistence rules
    const isCmd = Boolean(chatMsg.cmd);
    const messageType = isCmd ? 'system' : 'user';
    const eventType = isCmd ? chatMsg.cmd : null;

    // Every persisted message must have a user_id
    if (!socket?.uid) {
      if (!isCmd && socket) {
        socket.emit("ROOM_MESSAGE", {
          cmd: "system",
          msg: "You must be logged in to send messages.",
          timestamp: new Date().toISOString()
        });
      }
      // System events without a uid are still emitted live but never persisted
      this.io.of(this.roomId).emit("REC:chat", chatWithTime);
      this.io.of(this.roomId).emit("ROOM_MESSAGE", chatWithTime);
      return;
    }
    
    const shouldPersist = !isCmd || (isCmd && ['room.inactive', 'room.reactivated', 'room.expired'].includes(chatMsg.cmd!));

    let dbId: string | undefined = undefined;
    if (shouldPersist) {
      const dbRow = await persistRoomMessage(
        this.roomId,
        socket.uid,
        chatMsg.msg || "",
        messageType,
        eventType,
        { clientId: socket?.clientId, videoTS: chatWithTime.videoTS, name: socket?.clientId ? this.nameMap[socket.clientId] : undefined, picture: socket?.clientId ? this.pictureMap[socket.clientId] : undefined },
        chatMsg.clientMessageId
      );
      if (dbRow) {
        dbId = dbRow.id;
      }
    }

    // Still emit REC:chat for legacy UI compatibility while we transition
    this.io.of(this.roomId).emit("REC:chat", { ...chatWithTime, dbId, userId: socket.uid });
    // Emit new ROOM_MESSAGE event for the refactored frontend
    this.io.of(this.roomId).emit("ROOM_MESSAGE", { ...chatWithTime, dbId, userId: socket.uid });
  };

  private changeUserName = (socket: Socket, data: string) => {
    if (!data) {
      return;
    }
    if (data && data.length > 50) {
      return;
    }
    this.nameMap[socket.clientId] = data;
    this.io.of(this.roomId).emit("REC:nameMap", this.nameMap);
    if (socket.clientId === this.currentHostClientId) {
      this.io.of(this.roomId).emit("REC:hostChange", {
        hostId: this.currentHostUid || this.currentHostClientId,
        hostClientId: this.currentHostClientId,
        hostName: data,
        isOwner: Boolean(this.owner_id && this.currentHostUid === this.owner_id),
        reason: "name_update",
      });
    }
  };

  private changeUserPicture = (socket: Socket, data: string) => {
    if (data && data.length > 10000) {
      return;
    }
    this.pictureMap[socket.clientId] = data;
    this.io.of(this.roomId).emit("REC:pictureMap", this.pictureMap);
  };

  private startHosting = async (socket: Socket, data: string) => {
    if (this.vBrowser) {
      socket.emit(
        "errorMessage",
        `Can't update the video while vbrowser is running`,
      );
      return;
    }
    redisCount("urlStarts");
    if (config.STREAM_PATH && data?.startsWith(config.STREAM_PATH)) {
      redisCount("streamStarts");
    }
    if (config.CONVERT_PATH && data?.startsWith(config.CONVERT_PATH)) {
      redisCount("convertStarts");
    }
    // If a reddit URL, extract video URL
    if (
      data?.startsWith("https://www.reddit.com") ||
      data?.startsWith("https://old.reddit.com") ||
      data?.startsWith("https://reddit.com")
    ) {
      if (data.endsWith("/")) {
        // Remove trailing slash
        data = data.slice(0, -1);
      }
      data = data + ".json";
      // Extract fallback_url
      const resp = await axios.get(data);
      const json = resp.data;
      let reddit_m3u8 =
        json?.[0]?.data?.children?.[0]?.data?.secure_media?.reddit_video
          ?.hls_url;
      let reddit_mp4 =
        json?.[0]?.data?.children?.[0]?.data?.secure_media?.reddit_video
          ?.fallback_url;
      // prefer reddit m3u8 streams over the mp4 links as the m3u8 streams contain audio.
      data = reddit_m3u8 || reddit_mp4 || data;
    } else if (
      data?.startsWith("https://www.twitch.tv") ||
      data?.startsWith("https://twitch.tv")
    ) {
      try {
        // Extract m3u8 data
        // Note this won't work directly since Twitch will reject requests from the wrong origin--need to proxy the m3u8 playlist
        const channel = data.split("/").slice(-1)[0];
        const isStream = isNaN(Number(channel));
        let streams = [];
        if (isStream) {
          streams = await twitch.getStream(channel);
        } else {
          streams = await twitch.getVod(channel);
        }
        // console.log(streams);
        const target =
          streams.find((str: any) => str.quality.includes("(source)")) ||
          streams[0];
        const parsed = new URL(target?.url);
        const newUrl = new URL(config.TWITCH_PROXY_PATH);
        newUrl.pathname = "/proxy" + parsed.pathname;
        newUrl.searchParams.set("host", parsed.host);
        newUrl.searchParams.set("displayName", data);
        newUrl.search = newUrl.searchParams.toString();
        data = newUrl.toString();
      } catch (e) {
        console.warn(e);
      }
    } else if (isYouTube(data)) {
      data = normalizeYouTubeUrl(data);
    }
    this.cmdHost(socket, data);
  };

  private playlistNext = (raw: unknown) => {
    const data = raw ? String(raw) : null;
    // Clients may pass the URL that should be the current one.
    // If we've already advanced the playlist, we can ignore duplicate calls
    if (
      data &&
      this.video &&
      data !== this.video &&
      getYoutubeVideoID(data) !== getYoutubeVideoID(this.video)
    ) {
      // Validation didn't match
      return;
    }
    const next = this.playlist.shift();
    this.io.of(this.roomId).emit("playlist", this.playlist);
    if (next) {
      this.cmdHost(null, next.url);
    }
  };

  public playlistAdd = async (socket: Socket | null, data: string) => {
    if (data && data.length > 20000) {
      return;
    }
    redisCount("playlistAdds");
    const youtubeVideoId = getYoutubeVideoID(data);
    const targetUrl = youtubeVideoId ? normalizeYouTubeUrl(data) : data;
    const item: PlaylistVideo = {
      name: data,
      channel: youtubeVideoId ? "YouTube" : "Video URL",
      duration: 0,
      url: targetUrl,
      type: youtubeVideoId ? "youtube" : data.startsWith("magnet:") ? "magnet" : "file",
    };
    let video: PlaylistVideo | null = null;
    const existing = findPlaylistVideoByUrl(this.playlist, targetUrl);
    if (existing) {
      video = { ...existing };
    } else {
      try {
        if (youtubeVideoId) {
          video = await fetchYoutubeVideo(youtubeVideoId);
        }
      } catch (e) {
        // Failed to fetch YouTube video info but can still add the URL
        console.warn(e);
      }
    }
    if (video) {
      this.playlist.push(video);
    } else {
      this.playlist.push(item);
    }
    this.io.of(this.roomId).emit("playlist", this.playlist);
    const clientId = socket?.clientId;
    if (clientId) {
      const chatMsg = {
        id: clientId,
        cmd: "playlistAdd",
        msg: data,
      };
      this.addChatMessage(socket, chatMsg);
    }
    if (!this.video) {
      this.playlistNext(null);
    }
  };

  private playlistDelete = (index: number) => {
    if (index !== -1) {
      this.playlist.splice(index, 1);
      this.io.of(this.roomId).emit("playlist", this.playlist);
    }
  };

  private playlistMove = (raw: unknown) => {
    const data = raw as { index: number; toIndex: number };
    if (!data) {
      return;
    }
    if (data.index !== -1) {
      const items = this.playlist.splice(data.index, 1);
      this.playlist.splice(data.toIndex, 0, items[0]);
      this.io.of(this.roomId).emit("playlist", this.playlist);
    }
  };

  private playVideo = (socket: Socket) => {
    socket.broadcast.emit("REC:play", this.video);
    const chatMsg = {
      id: socket.clientId,
      cmd: "play",
      msg: this.tsMap[socket.clientId]?.toString(),
    };
    this.paused = false;
    this.addChatMessage(socket, chatMsg);
  };

  private pauseVideo = (socket: Socket) => {
    socket.broadcast.emit("REC:pause");
    const chatMsg = {
      id: socket.clientId,
      cmd: "pause",
      msg: this.tsMap[socket.clientId]?.toString(),
    };
    this.paused = true;
    this.addChatMessage(socket, chatMsg);
  };

  private seekVideo = (socket: Socket, data: number) => {
    if (String(data).length > 100) {
      return;
    }
    this.videoTS = data;
    socket.broadcast.emit("REC:seek", data);
    const chatMsg = { id: socket.clientId, cmd: "seek", msg: data?.toString() };
    this.addChatMessage(socket, chatMsg);
  };

  private setPlaybackRate = (socket: Socket, data: number) => {
    if (String(data).length > 100) {
      return;
    }
    this.playbackRate = Number(data);
    this.io.of(this.roomId).emit("REC:playbackRate", Number(data));
    const chatMsg = {
      id: socket.clientId,
      cmd: "playbackRate",
      msg: data?.toString(),
    };
    this.addChatMessage(socket, chatMsg);
  };

  private setLoop = (data: boolean) => {
    if (String(data).length > 100) {
      return;
    }
    this.loop = data;
    this.io.of(this.roomId).emit("REC:loop", data);
  };

  private setTimestamp = (socket: Socket, data: number) => {
    if (String(data).length > 100) {
      return;
    }
    // Prevent lagging TS updates from the old video from messing up our timestamps
    if (this.preventTSUpdate) {
      return;
    }
    // This is negative for live streams, so allow overwriting
    // Otherwise, only increment this value to prevent a lagging viewer from holding up the room state
    if (data < 0 || data > this.videoTS) {
      this.videoTS = data;
    }
    // Normalize the received TS based on how long since the last tsMap emit
    // Later sends will have higher values so subtract the difference
    // Add 1 as we will emit 1 second from the last one
    const timeSinceTsMap = Date.now() - this.lastTsMap;
    // console.log(socket.clientId, 'offset', offset, 'ms');
    this.tsMap[socket.clientId] = data - timeSinceTsMap / 1000 + 1;
  };

  private isValidChatMessage = (msg: string | undefined) => {
    return Boolean(msg && msg.length <= 10000);
  };

  private sendChatMessage = (socket: Socket, raw: unknown) => {
    // Support legacy string and V2 object chat payloads.
    const payload = typeof raw === "string" ? { msg: raw } : raw;
    if (!payload || typeof payload !== "object") {
      return;
    }

    // Validate supported fields.
    const data = payload as Record<string, unknown>;
    const msg = typeof data.msg === "string" ? data.msg : undefined;
    const replyToId =
      typeof data.replyToId === "string" ? data.replyToId : undefined;
    const replyToTimestamp =
      typeof data.replyToTimestamp === "string"
        ? data.replyToTimestamp
        : undefined;
    const clientMessageId = typeof data.clientMessageId === "string" ? data.clientMessageId : undefined;

    if (!msg || !this.isValidChatMessage(msg)) {
      return;
    }

    // Require both reply fields or neither.
    if (Boolean(replyToId) !== Boolean(replyToTimestamp)) {
      return;
    }

    const baseMsg: ChatMessageBase = { id: socket.clientId, msg, clientMessageId };
    const emitChatMessage = (chatMsg: ChatMessageBase) => {
      redisCount("chatMessages");
      this.addChatMessage(socket, chatMsg);
    };

    // No reply metadata -> regular message.
    if (!replyToId || !replyToTimestamp) {
      emitChatMessage(baseMsg);
      return;
    }

    // We no longer have target message in memory for reply text rendering on the server
    // For now we just emit the reply and let the client handle it if needed
    emitChatMessage({
      ...baseMsg,
      replyToId,
      replyToTimestamp,
      replyToUserId: replyToId,
      replyToMsg: "",
    });
  };

  private editMessage = async (socket: Socket, raw: unknown) => {
    if (!socket.uid) return; // Must be authenticated to edit
    const data = raw as { messageId: string; newMessage: string };
    if (!data || typeof data.messageId !== 'string' || typeof data.newMessage !== 'string') return;
    const trimmedMsg = data.newMessage.trim();
    if (trimmedMsg.length === 0 || trimmedMsg.length > 50000) return;

    if (!postgres) return;

    try {
      const query = `
        UPDATE room_messages
        SET message = $1, updated_at = NOW()
        WHERE id = $2 AND room_id = $3 AND user_id = $4 AND message_type = 'user'
        RETURNING id, room_id as "roomId", user_id, message, message_type, event_type, metadata, created_at, updated_at
      `;
      const result = await postgres.query(query, [trimmedMsg, data.messageId, this.roomId, socket.uid]);

      if (result.rowCount === 0) {
        return; // Message not found or not owned by user
      }

      const row = result.rows[0];
      // Fetch profile data just like loadRoomMessages does, for the broadcast
      let profile_name, profile_picture;
      const profileResult = await postgres.query('SELECT display_name, avatar_url FROM profiles WHERE id = $1', [row.user_id]);
      if ((profileResult.rowCount ?? 0) > 0) {
        profile_name = profileResult.rows[0].display_name;
        profile_picture = profileResult.rows[0].avatar_url;
      }

      const updatedMsg = {
        id: row.metadata?.clientId || 'unknown',
        msg: row.message,
        cmd: row.event_type || undefined,
        timestamp: row.created_at.toISOString(),
        videoTS: row.metadata?.videoTS,
        dbId: row.id,
        name: profile_name || row.metadata?.name,
        picture: profile_picture || row.metadata?.picture,
        userId: row.user_id || undefined,
        updatedAt: row.updated_at.toISOString(),
      };

      this.io.of(this.roomId).emit("REC:editMessage", updatedMsg);
    } catch (e) {
      console.error("Failed to edit message:", e);
    }
  };

  private addReaction = (socket: Socket, raw: unknown) => {
    const data = raw as { value: string; msgId: string; msgTimestamp: string };
    if (!data || !data.value || !data.msgId || !data.msgTimestamp) {
      return;
    }
    // Emojis can be multiple bytes
    if (data.value.length > 8) {
      return;
    }
    const reaction: Reaction = { user: socket.clientId, ...data };
    redisCount("addReaction");
    this.io.of(this.roomId).emit("REC:addReaction", reaction);
  };

  private removeReaction = (socket: Socket, raw: unknown) => {
    const data = raw as { value: string; msgId: string; msgTimestamp: string };
    if (!data || !data.value || !data.msgId || !data.msgTimestamp) {
      return;
    }
    // Emojis can be multiple bytes
    if (data.value.length > 8) {
      return;
    }
    const reaction: Reaction = { user: socket.clientId, ...data };
    this.io.of(this.roomId).emit("REC:removeReaction", reaction);
  };

  private joinVideo = async (socket: Socket) => {
    const match = this.roster.find((user) => user.id === socket.clientId);
    if (match) {
      match.isVideoChat = true;
      redisCount("videoChatStarts");
    }
    this.io.of(this.roomId).emit("roster", this.getRosterForApp());
  };

  private leaveVideo = async (socket: Socket) => {
    const match = this.roster.find((user) => user.id === socket.clientId);
    if (match) {
      match.isVideoChat = false;
    }
    this.io.of(this.roomId).emit("roster", this.getRosterForApp());
  };

  private setUserMute = (socket: Socket, raw: unknown) => {
    const data = raw as { isMuted: boolean };
    if (!data) {
      return;
    }
    const match = this.roster.find((user) => user.id === socket.clientId);
    if (match) {
      match.isMuted = data.isMuted;
    }
    this.io.of(this.roomId).emit("roster", this.getRosterForApp());
  };

  private joinScreenSharing = (socket: Socket, raw: unknown) => {
    const data = raw as { file: boolean; mediasoup?: boolean };
    if (!data) {
      return;
    }
    const sharer = this.getRosterForApp().find((user) => user.isScreenShare);
    if (sharer) {
      // Someone's already sharing
      socket.emit(
        "errorMessage",
        "There is already an active share in this room",
      );
      return;
    }
    let mediasoupSuffix = "";
    if (data?.mediasoup) {
      // TODO validate the user has permissions to ask for a mediasoup
      // TODO set up the room on the remote server rather than letting the remote server create
      mediasoupSuffix =
        "@" + config.MEDIASOUP_SERVER + "/" + crypto.randomUUID();
      redisCount("mediasoupStarts");
    }
    if (data && data.file) {
      this.cmdHost(socket, "fileshare://" + socket.clientId + mediasoupSuffix);
      redisCount("fileShareStarts");
    } else {
      this.cmdHost(
        socket,
        "screenshare://" + socket.clientId + mediasoupSuffix,
      );
      redisCount("screenShareStarts");
    }
    this.io.of(this.roomId).emit("roster", this.getRosterForApp());
  };

  private leaveScreenSharing = (socket: Socket) => {
    const sharer = this.getRosterForApp().find((user) => user.isScreenShare);
    if (!sharer || sharer?.id !== socket.clientId) {
      socket.emit("errorMessage", "Not the active sharer");
      return;
    }
    this.cmdHost(socket, "");
    this.io.of(this.roomId).emit("roster", this.getRosterForApp());
  };

  private startVBrowser = async (socket: Socket, raw: unknown) => {
    const data = raw as {
      options?: { size: string; region: string; provider: string };
    };
    if (!data) {
      socket.emit("errorMessage", "Invalid vBrowser input");
      return;
    }
    const { clientId, uid } = socket;
    // these checks are skipped if auth not provided
    if (config.SUPABASE_URL) {
      const user = await getUser(uid);
      // Validate verified email if not a third-party auth provider
      if (
        user?.app_metadata?.provider === "email" &&
        !user?.email_confirmed_at
      ) {
        socket.emit(
          "errorMessage",
          "A verified email is required to start a VBrowser.",
        );
        return;
      }

      // Log the vbrowser creation by uid and clientid
      if (redis) {
        const expireTime = getStartOfDay() / 1000 + 86400;
        if (clientId) {
          const clientCount = await redis.zincrby(
            "vBrowserClientIDs",
            1,
            clientId,
          );
          redis.expireat("vBrowserClientIDs", expireTime);
          const clientMinutes = await redis.zincrby(
            "vBrowserClientIDMinutes",
            1,
            clientId,
          );
          redis.expireat("vBrowserClientIDMinutes", expireTime);
        }
        if (uid) {
          const uidCount = await redis.zincrby("vBrowserUIDs", 1, uid);
          redis.expireat("vBrowserUIDs", expireTime);
          const uidMinutes = await redis.zincrby("vBrowserUIDMinutes", 1, uid);
          redis.expireat("vBrowserUIDMinutes", expireTime);
          // TODO limit users based on client or uid usage
        }
      }
      // check if the user already has a VM already in postgres
      if (postgres) {
        const { rows } = await postgres.query(
          "SELECT count(1) from vbrowser WHERE uid = $1",
          [uid],
        );
        if (rows[0].count >= 2) {
          socket.emit(
            "errorMessage",
            "There is already an active vBrowser for this user.",
          );
          return;
        }
      }
    }
    let isLarge = false;
    let region = "";
    // allow sub options
    if (uid || !config.SUPABASE_URL) {
      isLarge = data.options?.size === "large";
      if (data.options?.region) {
        region = data.options?.region;
      }
    }

    const vBrowserProvider = getVBrowserProvider();
    if (!vBrowserProvider.isEnabled) {
      socket.emit("errorMessage", "Virtual Browser is disabled on this server.");
      return;
    }

    redisCount("vBrowserStarts");
    this.cmdHost(socket, "vbrowser://");
    // Put the room in the vbrowser queue
    this.vBrowserQueue = {
      roomId: this.roomId,
      queueTime: new Date(),
      isLarge,
      region,
      uid,
      clientId,
    };
    // Check if a vbrowser is available
    while (this.vBrowserQueue) {
      const { queueTime, isLarge, region, uid, roomId, clientId } =
        this.vBrowserQueue;
      let assignment: AssignedVM | undefined = undefined;
      try {
        assignment =
          (await vBrowserProvider.assign({
            isLarge,
            region,
            uid,
            roomId,
          })) || undefined;
      } catch (e: any) {
        if (e instanceof VBrowserDisabledError) {
          socket.emit("errorMessage", "Virtual Browser is disabled on this server.");
          this.vBrowserQueue = undefined;
          return;
        }
        console.warn("VBrowser assignment failed:", e?.message || e);
      }
      if (assignment) {
        this.vBrowser = assignment;
        this.vBrowser.controllerClient = clientId;
        this.vBrowser.creatorUID = uid;
        this.vBrowser.creatorClientID = clientId;
        const assignEnd = Date.now();
        const assignElapsed = assignEnd - Number(queueTime);
        await redis?.lpush("vBrowserStartMS", assignElapsed);
        await redis?.ltrim("vBrowserStartMS", 0, 19);
        console.log(
          "[ASSIGN] %s to %s in %s",
          assignment.provider + ":" + assignment.id,
          roomId,
          assignElapsed + "ms",
        );
        this.cmdHost(
          null,
          "vbrowser://" + this.vBrowser.pass + "@" + this.vBrowser.host,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };

  private stopVBrowser = async () => {
    if (!this.vBrowser && this.video !== "vbrowser://") {
      return;
    }
    await this.stopVBrowserInternal();
    redisCount("vBrowserTerminateManual");
  };

  private changeController = (data: string) => {
    if (data && data.length > 100) {
      return;
    }
    if (this.vBrowser) {
      this.vBrowser.controllerClient = data;
      this.io.of(this.roomId).emit("REC:changeController", data);
    }
  };

  private addSubtitles = async (data: string) => {
    if (data && data.length > 10000) {
      return;
    }
    this.subtitle = data;
    this.io.of(this.roomId).emit("REC:subtitle", this.subtitle);
  };

  private lockRoom = async (socket: Socket, raw: unknown) => {
    const data = raw as { locked: boolean };
    if (!data) {
      return;
    }
    const { uid, clientId } = socket;
    this.lock = data.locked ? uid : "";
    this.io.of(this.roomId).emit("REC:lock", this.lock);
    const chatMsg = {
      id: clientId,
      cmd: data.locked ? "lock" : "unlock",
      msg: "",
    };
    this.addChatMessage(socket, chatMsg);
  };

  private setRoomOwner = async (socket: Socket, raw: unknown) => {
    const data = raw as {
      undo: boolean;
    };
    if (!data) {
      return;
    }
    if (!postgres) {
      socket.emit("errorMessage", "Database is not available");
      return;
    }
    const { uid } = socket;
    if (data.undo) {
      const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
      this.expiresAt = expiresAt;
      this.status = 'active';
      this.isPermanent = false;
      await updateObject(
        postgres,
        "rooms",
        {
          passcode: null,

          isChatDisabled: false,
          isSubRoom: null,
          roomTitle: "Watch Party Room",
          roomDescription: null,
          mediaPath: null,
          expiresAt: expiresAt,
          status: 'active',
          isPermanent: false,
        },
        { roomId: this.roomId },
      );
      socket.emit("REC:getRoomState", {});
    } else {
      // validate room count
      const roomCount = (
        await postgres.query(
          'SELECT count(1) from room where owner_id = $1 AND "roomId" != $2',
          [uid, this.roomId],
        )
      ).rows[0].count;
      const limit = config.SUBSCRIBER_ROOM_LIMIT;
      if (roomCount >= limit) {
        socket.emit(
          "errorMessage",
          `You've exceeded the permanent room limit. Subscribe for additional permanent rooms.`,
        );
        return;
      }
      const roomObj = {
        roomId: this.roomId,
        owner_id: uid,
        isSubRoom: true,
        expiresAt: null,
        status: 'active',
        isPermanent: true,
      };
      this.expiresAt = undefined;
      this.status = 'active';
      this.owner_id = uid;
      this.isPermanent = true;
      let result: QueryResult | null = null;
      result = await upsertObject(postgres, "rooms", roomObj, {
        roomId: true,
      });
      const row = result?.rows?.[0];
      // console.log(result, row);
      socket.emit("REC:getRoomState", {
        passcode: row?.passcode,

        owner: row?.owner_id,
      });
    }
  };

  private getRoomState = async (socket: Socket) => {
    if (!postgres) {
      return;
    }
    const result = await postgres.query(
      `SELECT passcode, owner_id, "isChatDisabled", "roomTitle", "roomDescription", "mediaPath" FROM rooms where "roomId" = $1`,
      [this.roomId],
    );
    const first = result.rows[0];
    if (this.isChatDisabled === undefined) {
      this.isChatDisabled = Boolean(first?.isChatDisabled);
    }
    if (first?.roomTitle !== undefined) this.roomTitle = first.roomTitle;
    if (first?.roomDescription !== undefined) this.roomDescription = first.roomDescription;
    if (first?.mediaPath !== undefined) this.mediaPath = first.mediaPath;
    if (first?.owner_id) this.owner_id = first.owner_id;

    socket.emit("REC:getRoomState", {
      owner: first?.owner_id || this.owner_id,
      currentHostId: this.currentHostUid || this.currentHostClientId,
      currentHostClientId: this.currentHostClientId,
      hostName: this.getHostDisplayName(),
      isHost: this.isHost(socket),
      isChatDisabled: first?.isChatDisabled,
      roomTitle: first?.roomTitle,
      roomDescription: first?.roomDescription,
      mediaPath: first?.mediaPath,
    });
  };

  private setRoomState = async (socket: Socket, raw: unknown) => {
    const data = raw as {
      passcode: string;

      isChatDisabled: boolean;
      roomTitle: string;
      roomDescription: string;
      mediaPath: string;
    };
    if (!postgres) {
      socket.emit("errorMessage", "Database is not available");
      return;
    }
    if (!data) {
      return;
    }
    const {
      passcode,

      isChatDisabled,
      roomTitle,
      roomDescription,
      mediaPath,
    } = data;
    if (passcode) {
      if (passcode.length > 100) {
        socket.emit("errorMessage", "Password too long");
        return;
      }
    }

    let normalizedTitle: string | undefined = undefined;
    if (typeof roomTitle !== "undefined") {
      normalizedTitle = typeof roomTitle === "string" ? roomTitle.trim() : "";
      if (normalizedTitle.length === 0) {
        socket.emit("errorMessage", "Room title is required");
        return;
      }
      if (normalizedTitle.length > 50) {
        socket.emit("errorMessage", "Room title too long");
        return;
      }
    }
    if (roomDescription && roomDescription.length > 120) {
      socket.emit("errorMessage", "Room description too long");
      return;
    }

    if (mediaPath && mediaPath.length > 1000) {
      socket.emit("errorMessage", "Media source too long");
      return;
    }

    const roomObj: any = {
      roomId: this.roomId,
      passcode: await hashRoomPasscode(passcode),
      isChatDisabled: isChatDisabled,
      mediaPath: mediaPath,
    };
    const { uid } = socket;
    if (uid) {
      if (normalizedTitle !== undefined) roomObj.roomTitle = normalizedTitle;
      if (roomDescription !== undefined) roomObj.roomDescription = roomDescription;
    }
    
    // Remove undefined fields so they aren't part of the Postgres UPDATE query
    Object.keys(roomObj).forEach(key => roomObj[key] === undefined && delete roomObj[key]);
    try {
      const query = `UPDATE rooms
        SET ${Object.keys(roomObj).map((k, i) => `"${k}" = $${i + 1}`)}
        WHERE "roomId" = $${Object.keys(roomObj).length + 1}
        AND owner_id = $${Object.keys(roomObj).length + 2}
        RETURNING *`;
      const result = await postgres.query(query, [
        ...Object.values(roomObj),
        this.roomId,
        uid,
      ]);
      const row = result.rows[0];
      this.isChatDisabled = Boolean(row?.isChatDisabled);
      this.io.of(this.roomId).emit("REC:getRoomState", {
        owner: row?.owner_id,
        isChatDisabled: row?.isChatDisabled,
        roomTitle: row?.roomTitle,
        roomDescription: row?.roomDescription,
        mediaPath: row?.mediaPath,
      });
      socket.emit("successMessage", "Saved admin settings");
    } catch (e) {
      console.warn(e);
    }
  };

  private sendSignal = (
    socket: Socket,
    raw: unknown,
    eventName: "signal" | "signalSS",
  ) => {
    const data = raw as { to: string; msg: string; sharer?: boolean };
    if (!data) {
      return;
    }
    const fromClientId = socket.clientId;
    const toId = this.socketIdMap[data.to];
    if (toId) {
      this.io.of(this.roomId).to(toId).emit(eventName, {
        from: fromClientId,
        msg: data.msg,
        sharer: data.sharer,
      });
    }
  };

  private onDisconnect = (socket: Socket) => {
    const { clientId } = socket;
    // Disconnecting socket is the current one
    if (socket.id === this.socketIdMap[clientId]) {
      const wasHost = Boolean(this.currentHostClientId && this.currentHostClientId === clientId);

      let index = this.roster.findIndex((user) => user.id === clientId);
      if (index > -1) {
        this.roster.splice(index, 1);
      }
      this.io.of(this.roomId).emit("roster", this.getRosterForApp());
      delete this.tsMap[clientId];
      delete this.socketIdMap[clientId];
      delete this.clientToUidMap[clientId];

      if (wasHost) {
        if (this.roster.length > 0) {
          // Deterministic auto-promotion: promote first remaining participant in active roster
          const nextHost = this.roster[0];
          const oldHostName = this.getHostDisplayName();
          this.currentHostClientId = nextHost.id;
          this.currentHostUid = this.clientToUidMap[nextHost.id] || "";
          const newHostName = this.getHostDisplayName();

          this.broadcastHostChange("auto_assigned");
          const chatMsg = {
            id: nextHost.id,
            cmd: "system",
            msg: `${oldHostName} left. ${newHostName} is now the room host.`,
          };
          this.addChatMessage(null, chatMsg);
        } else {
          // No participants remaining
          this.currentHostClientId = "";
          this.currentHostUid = "";
        }
      }

      if (this.roster.length === 0) {
        if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = setTimeout(async () => {
          if (this.roster.length === 0 && this.status === 'active') {
            this.status = 'inactive';
            this.lastUpdateTime = new Date();
            if (postgres) {
              await updateObject(postgres, "rooms", { status: 'inactive', "lastActiveAt": new Date() }, { "roomId": this.roomId });
            }
          }
        }, 120 * 1000);
      }
    }
    // Keep namemap/picturemap so old chat messages still render correctly after disconnect
    // When serializing we only write values with messages in chat
    // This will keep growing in memory until the room is unloaded
  };

  private kickUser = async (raw: unknown) => {
    const data = raw as { userToBeKicked: string };
    if (!data) {
      return;
    }
    const userToBeKickedSocket = this.io
      .of(this.roomId)
      .sockets.get(this.socketIdMap[data.userToBeKicked]);
    if (userToBeKickedSocket) {
      userToBeKickedSocket.emit("kicked");
      userToBeKickedSocket.disconnect();
    }
  };

  public disconnectAllSockets = () => {
    this.io.of(this.roomId).disconnectSockets();
  };

  private deleteChatMessages = async (raw: unknown) => {
    const data = raw as {
      author?: string;
      timestamp?: string;
    };
    if (!data) return;

    if (postgres) {
      if (!data.timestamp && !data.author) {
        // Clear all
        await postgres.query(`DELETE FROM room_messages WHERE room_id = $1`, [this.roomId]);
      } else if (data.timestamp && data.author) {
        // Delete specific message
        await postgres.query(`DELETE FROM room_messages WHERE room_id = $1 AND (user_id = $2 OR metadata->>'clientId' = $2) AND created_at = $3`, [this.roomId, data.author, data.timestamp]);
      } else if (data.author) {
        // Delete by author
        await postgres.query(`DELETE FROM room_messages WHERE room_id = $1 AND (user_id = $2 OR metadata->>'clientId' = $2)`, [this.roomId, data.author]);
      }
    }

    // Refresh for everyone (legacy UI sync)
    const recentMessages = await loadRoomMessages(this.roomId, 50);
    const formattedMessages = recentMessages.map((row: any) => ({
      id: row.metadata?.clientId || row.user_id,
      msg: row.message,
      cmd: row.event_type || undefined,
      timestamp: row.created_at.toISOString(),
      videoTS: row.metadata?.videoTS,
      dbId: row.id,
    }));
    this.io.of(this.roomId).emit("chatinit", formattedMessages.reverse());
    this.io.of(this.roomId).emit("ROOM_MESSAGES", formattedMessages);
  };
}

function isValidUUID(id: string) {
  return /^[0-9A-F]{8}-[0-9A-F]{4}-[4][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i.test(
    id,
  );
}
