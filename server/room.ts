import config from "./config.ts";
import axios from "axios";
import { Server, Socket } from "socket.io";
import { randomUUID } from "crypto";
import { getUser, validateToken } from "./utils/supabase.ts";
import {
  authorizeRoomAction as pureAuthorizeRoomAction,
  type RoomAction,
  type AuthorizationContext,
  type ActionTarget,
  type AuthorizationResult,
} from "./roomAuthorization.ts";
import { metricsRedis, redisCount, redisCountDistinct, redisCore } from "./utils/redis.ts";

import { getStartOfDay } from "./utils/time.ts";
import { postgres } from "./utils/postgres.ts";
import { isBcryptHash, decryptPasscodeForOwner } from "./utils/roomPasscode.ts";
import { verifyAdmissionToken, fingerprintToken } from "./utils/admissionToken.ts";
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
import { TimelineAuthority } from "./timelineAuthority.ts";
import { notificationService } from "./notifications/notificationService.ts";
import { LocalMediaAuthority } from "./media/local/LocalMediaAuthority.ts";
import { LocalMediaSignaling } from "./media/local/LocalMediaSignaling.ts";
import type { ServerLocalMediaManifest } from "./media/local/LocalMediaSession.ts";
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
  is_deleted?: boolean;
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
       RETURNING id, room_id as "roomId", user_id, message, message_type, event_type, metadata, created_at, updated_at, is_deleted`,
      [roomId, userId, message, messageType, eventType, metadata, clientMessageId]
    );
    if (result.rowCount === 0 && clientMessageId) {
      // Duplicate client_message_id for this room/user, fetch the existing one
      const existingResult = await postgres.query(
        `SELECT id, room_id as "roomId", user_id, message, message_type, event_type, metadata, created_at, updated_at, is_deleted
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
      SELECT rm.id, rm.room_id as "roomId", rm.user_id, rm.message, rm.message_type, rm.event_type, rm.metadata, rm.created_at, rm.updated_at, rm.is_deleted, p.display_name as profile_name, p.avatar_url as profile_picture
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

export type HostMode = "owner" | "temporary" | "none";
export type HostTransitionReason =
  | "explicit_transfer"
  | "failover"
  | "owner_regain"
  | "initial"
  | "room_empty";

export class HostTransitionUnavailableError extends Error {
  public readonly code = "HOST_TRANSITION_UNAVAILABLE" as const;

  public constructor(message = "Host transition is temporarily unavailable.") {
    super(message);
    this.name = "HostTransitionUnavailableError";
  }
}

export interface HostAuthorityPayload {
  hostId: string;
  hostClientId: string;
  mode: HostMode;
  reason: HostTransitionReason;
  hostName?: string;
  isOwner?: boolean;
}

export interface AdmittedParticipantRecord {
  sessionId: string;
  uid?: string;
  admittedAt: number;
  lastConnectedAt: number;
  lastDisconnectedAt?: number;
  state: 'connected' | 'disconnected';
  admissionSequence: number;
  isKicked?: boolean;
}

export const ADMISSION_DISCONNECT_GRACE_MS = 10 * 60 * 1000; // 10 minutes
export const EMPTY_ROOM_INACTIVITY_TIMEOUT_MS = 30 * 1000; // 30 seconds

export type { RoomAction, AuthorizationContext, ActionTarget, AuthorizationResult };

export interface AuthorizeActionParams {
  actorSocket: Socket | null | undefined;
  action: RoomAction;
  targetUserId?: string;
  targetMessageAuthorId?: string;
  targetMessageRoomId?: string;
}

export class Room {
  sendRoster() {
    throw new Error("Method not implemented.");
  }
  // Serialized state
  public video: string | null = "";
  public get videoTS(): number {
    return this.timeline.getCanonicalTime();
  }
  public subtitle = "";
  public playbackRate = 1;
  public paused = false;
  public loop = false;
  private chat: ChatMessage[] = [];
  private nameMap: StringDict = {};
  private pictureMap: StringDict = {};
  private uidToNameMap: StringDict = {};
  private uidToPictureMap: StringDict = {};

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
  public status: 'scheduled' | 'active' | 'inactive' | 'ended' | 'expired' = 'inactive';
  public expiresAt: Date | undefined = undefined;
  public startedAt: Date | undefined = undefined;
  public owner_id: string = '';
  public currentHostClientId: string = '';
  public currentHostUid: string = '';
  public hostMode: HostMode = "none";
  public hostEpoch: number = 1;
  public admittedMembers: Set<string> = new Set();
  private nextAdmissionSequence: number = 1;
  private clientToUidMap: StringDict = {};
  public roomTitle: string | undefined = undefined;
  public roomDescription: string | undefined = undefined;
  public mediaPath: string | undefined = undefined;
  public isPermanent: boolean = false;
  public lastUpdateTime: Date = new Date();
  public participantsLocked: boolean = false;
  public maxParticipants: number = 10;
  private admittedParticipants: Map<string, AdmittedParticipantRecord> = new Map();
  private bannedIdentities: Set<string> = new Set();
  private processedOperations: Map<string, { operationId: string; timestamp: number }[]> = new Map();
  public timeline: TimelineAuthority = new TimelineAuthority();
  private localMediaSignaling: LocalMediaSignaling;
  public localMediaAuthority: LocalMediaAuthority;

  public hasProcessedOperation = (clientId: string, operationId?: string): boolean => {
    if (!operationId || !clientId) return false;
    const ops = this.processedOperations.get(clientId);
    if (!ops) return false;
    return ops.some((op) => op.operationId === operationId);
  };

  public recordProcessedOperation = (clientId: string, operationId?: string): void => {
    if (!operationId || !clientId) return;
    let ops = this.processedOperations.get(clientId);
    if (!ops) {
      ops = [];
      this.processedOperations.set(clientId, ops);
    }
    const now = Date.now();
    ops = ops.filter((op) => now - op.timestamp < 30000);
    ops.push({ operationId, timestamp: now });
    if (ops.length > 50) ops.shift();
    this.processedOperations.set(clientId, ops);
  };

  public isBanned = (clientId?: string, uid?: string): boolean => {
    if (clientId && this.bannedIdentities.has(clientId)) return true;
    if (uid && this.bannedIdentities.has(uid)) return true;
    return false;
  };

  public hasParticipantUid = (uid: string): boolean => {
    if (!uid) return false;
    if (this.owner_id && this.owner_id === uid) return true;
    if (this.admittedMembers.has(uid)) return true;
    for (const rec of this.admittedParticipants.values()) {
      if (rec.uid === uid && rec.state === 'connected' && !rec.isKicked) {
        return true;
      }
    }
    return false;
  };

  public buildAuthorizationContext = (socket: Socket | null | undefined): AuthorizationContext => {
    if (!socket) {
      return {
        actorUid: "",
        actorClientId: "",
        roomId: this.roomId,
        isMember: false,
        isHost: false,
        isOwner: false,
        isLockHolder: false,
        chatEnabled: !this.isChatDisabled,
        playbackLocked: Boolean(this.lock),
        hostEpoch: this.hostEpoch,
      };
    }

    const isOwner = Boolean(this.owner_id && socket.uid && socket.uid === this.owner_id);
    const isHost = this.isHost(socket);
    const isAdmittedByRoster = Boolean(socket.clientId && this.roster.some((u) => u.id === socket.clientId));
    const isAdmittedByRecord = Boolean(socket.clientId && this.admittedParticipants.has(socket.clientId));
    const isAdmittedByUid = Boolean(
      socket.uid &&
      (this.admittedMembers.has(socket.uid) || this.hasParticipantUid(socket.uid) || this.clientToUidMap[socket.clientId] === socket.uid)
    );
    const isMember = isOwner || isHost || isAdmittedByRoster || isAdmittedByRecord || isAdmittedByUid;
    const isLockHolder = Boolean(
      this.lock &&
      ((socket.uid && socket.uid === this.lock) || (socket.clientId && socket.clientId === this.lock))
    );

    return {
      actorUid: socket.uid || "",
      actorClientId: socket.clientId || "",
      roomId: this.roomId,
      isMember,
      isHost,
      isOwner,
      isLockHolder,
      chatEnabled: !this.isChatDisabled,
      playbackLocked: Boolean(this.lock),
      hostEpoch: this.hostEpoch,
    };
  };

  public authorizeRoomAction = (params: AuthorizeActionParams): AuthorizationResult => {
    const { actorSocket, action, targetUserId, targetMessageAuthorId, targetMessageRoomId } = params;
    if (!actorSocket) {
      return { allowed: false, code: "FORBIDDEN", reason: "UNAUTHENTICATED" };
    }

    // Target Room Scoping (Anti-Probing Defense)
    if (targetMessageRoomId && targetMessageRoomId !== this.roomId) {
      return { allowed: false, code: "ROOM_MISMATCH", reason: "ROOM_MISMATCH" };
    }

    const context = this.buildAuthorizationContext(actorSocket);
    const target: ActionTarget = {
      targetMessage: targetMessageAuthorId
        ? {
          id: "unknown",
          roomId: targetMessageRoomId || this.roomId,
          authorUid: targetMessageAuthorId,
        }
        : undefined,
      targetUserId,
      targetIsOwner: Boolean(
        targetUserId &&
        this.owner_id &&
        (targetUserId === this.owner_id || this.clientToUidMap[targetUserId] === this.owner_id)
      ),
    };

    return pureAuthorizeRoomAction(context, action, target);
  };

  public canModerate = (socket: Socket | null | undefined): boolean => {
    if (!socket) return false;
    const isHost = this.isHost(socket);
    const isOwner = Boolean(this.owner_id && socket.uid && socket.uid === this.owner_id);
    return isHost || isOwner;
  };

  public canControlPlayback = (socket: Socket | null | undefined): boolean => {
    if (!socket) return false;
    const context = this.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "room:play");
    return auth.allowed;
  };

  public isRoomFull = (isOwner?: boolean, sessionHint?: string, uid?: string): boolean => {
    if (isOwner) return false;
    // Reconnecting participant with server-recognized session does not consume an extra slot
    if (this.verifyAdmittedSession(sessionHint, uid)) {
      return false;
    }

    // Active admitted participants calculation: connected or within 10-minute grace period
    const now = Date.now();
    let activeAdmittedCount = 0;
    for (const [, rec] of this.admittedParticipants.entries()) {
      if (rec.state === 'connected') {
        activeAdmittedCount++;
      } else if (rec.state === 'disconnected' && rec.lastDisconnectedAt) {
        if (now - rec.lastDisconnectedAt <= ADMISSION_DISCONNECT_GRACE_MS) {
          activeAdmittedCount++;
        }
      }
    }

    return activeAdmittedCount >= this.maxParticipants;
  };

  public recordAdmittedParticipant = (clientId: string, sessionId?: string, uid?: string) => {
    if (!clientId) return;
    const now = Date.now();

    // Clean up any stale participant records for the same sessionId to prevent duplicates
    if (sessionId) {
      for (const [oldClientId, rec] of this.admittedParticipants.entries()) {
        if (oldClientId !== clientId && rec.sessionId === sessionId) {
          if (this.nameMap[oldClientId] && !this.nameMap[clientId]) {
            this.nameMap[clientId] = this.nameMap[oldClientId];
          }
          if (this.pictureMap[oldClientId] && !this.pictureMap[clientId]) {
            this.pictureMap[clientId] = this.pictureMap[oldClientId];
          }
          this.admittedParticipants.delete(oldClientId);
        }
      }
    }

    if (uid) {
      if (this.uidToNameMap[uid] && !this.nameMap[clientId]) {
        this.nameMap[clientId] = this.uidToNameMap[uid];
      }
      if (this.uidToPictureMap[uid] && !this.pictureMap[clientId]) {
        this.pictureMap[clientId] = this.uidToPictureMap[uid];
      }
    }

    const existing = this.admittedParticipants.get(clientId);
    const admissionSequence = existing?.admissionSequence || (this.nextAdmissionSequence++);
    this.admittedParticipants.set(clientId, {
      sessionId: sessionId || "",
      uid: uid || existing?.uid || undefined,
      admittedAt: existing?.admittedAt || now,
      lastConnectedAt: now,
      lastDisconnectedAt: undefined,
      state: 'connected',
      admissionSequence,
      isKicked: existing?.isKicked || false,
    });
  };

  public isParticipantEligibleForHost = (clientId: string): boolean => {
    if (!clientId) return false;
    const inRoster = this.roster.some((u) => u.id === clientId);
    if (!inRoster) return false;
    const rec = this.admittedParticipants.get(clientId);
    if (!rec || rec.state !== 'connected') return false;
    if (rec.isKicked) return false;
    if (!rec.sessionId) return false;
    // Must be authenticated with verified UID to hold host authority
    const uid = rec.uid || this.clientToUidMap[clientId];
    if (!uid) return false;
    return true;
  };

  public isHostUid = (uid: string): boolean => {
    if (!uid) return false;
    if (this.owner_id && this.owner_id === uid) return true;
    if (this.currentHostUid && this.currentHostUid === uid) return true;
    return false;
  };

  public isHostPresent = (): boolean => {
    if (this.currentHostClientId) {
      const rec = this.admittedParticipants.get(this.currentHostClientId);
      if (rec && rec.state === 'connected' && !rec.isKicked) {
        return true;
      }
    }
    if (this.owner_id) {
      for (const rec of this.admittedParticipants.values()) {
        if (rec.uid === this.owner_id && rec.state === 'connected' && !rec.isKicked) {
          return true;
        }
      }
    }
    return false;
  };

  public getConnectedParticipantUids = (): string[] => {
    const uids = new Set<string>();
    if (this.owner_id) uids.add(this.owner_id);
    for (const rec of this.admittedParticipants.values()) {
      if (rec.uid && rec.state === 'connected' && !rec.isKicked) {
        uids.add(rec.uid);
      }
    }
    return Array.from(uids);
  };

  public getEligibleParticipants = (excludeClientId?: string): { clientId: string; record: AdmittedParticipantRecord }[] => {
    const eligible: { clientId: string; record: AdmittedParticipantRecord }[] = [];
    for (const [cId, rec] of this.admittedParticipants.entries()) {
      if (excludeClientId && cId === excludeClientId) continue;
      if (this.isParticipantEligibleForHost(cId)) {
        eligible.push({ clientId: cId, record: rec });
      }
    }
    // Monotonically increasing admission sequence: lowest sequence ASC = highest failover priority
    eligible.sort((a, b) => a.record.admissionSequence - b.record.admissionSequence);
    return eligible;
  };

  public getHostMode = (): HostMode => {
    if (!this.currentHostUid && !this.currentHostClientId) {
      return "none";
    }
    const isOwner = Boolean(this.owner_id && this.currentHostUid && this.currentHostUid === this.owner_id);
    return isOwner ? "owner" : "temporary";
  };

  public withHostTransitionLease = async <T>(
    action: () => Promise<T>,
  ): Promise<T> => {
    const isMultiInstance = Boolean(
      config.REDIS_CORE_URL || (config.NODE_ENV !== "production" && config.REDIS_URL),
    );

    if (!isMultiInstance) {
      return action();
    }

    const availability = redisCore.getAvailability();

    if (!availability.available) {
      throw new HostTransitionUnavailableError(
        `Redis is unavailable: ${availability.reason}`,
      );
    }

    const leaseKey = `room:host:${this.roomId}`;
    const leaseVal =
      `${process.pid}:${Date.now()}:${randomUUID()}`;

    let acquired = false;

    try {
      acquired = await redisCore.setLease(
        leaseKey,
        leaseVal,
        5,
      );
    } catch (error: unknown) {
      console.warn(
        `[REDIS LEASE ERROR] Failed to acquire host lease in room ${this.roomId}`,
        error,
      );

      throw new HostTransitionUnavailableError();
    }

    if (!acquired) {
      throw new HostTransitionUnavailableError(
        "Unable to acquire the host transition lease.",
      );
    }

    try {
      return await action();
    } finally {
      try {
        const released = await redisCore.delLease(
          leaseKey,
          leaseVal,
        );

        if (!released) {
          console.warn(
            `[REDIS LEASE WARNING] Lease ownership changed before release for room ${this.roomId}`,
          );
        }
      } catch (error: unknown) {
        console.warn(
          `[REDIS LEASE RELEASE ERROR] Failed to release host lease in room ${this.roomId}`,
          error,
        );
      }
    }
  };

  public verifyAdmittedSession = (sessionHint?: string, uid?: string): boolean => {
    if (uid) {
      if (this.owner_id && uid === this.owner_id) return true;
      if (this.admittedMembers.has(uid)) return true;
      if (this.hasParticipantUid(uid)) return true;
    }
    if (!sessionHint) return false;
    const now = Date.now();
    for (const [cId, record] of this.admittedParticipants.entries()) {
      if (record.sessionId === sessionHint) {
        if (record.isKicked) return false;
        if (record.state === 'connected') return true;
        if (record.state === 'disconnected' && record.lastDisconnectedAt) {
          if (now - record.lastDisconnectedAt <= ADMISSION_DISCONNECT_GRACE_MS) {
            return true;
          } else {
            this.admittedParticipants.delete(cId);
            return false;
          }
        }
      }
    }
    return false;
  };

  public verifyAdmittedParticipant = (clientIdOrSessionHint: string, sessionId?: string): boolean => {
    if (sessionId) {
      return this.verifyAdmittedSession(sessionId);
    }
    return this.verifyAdmittedSession(clientIdOrSessionHint);
  };
  private preventTSUpdate = false;
  // Not really a queue since there's no ordering, we just retry as long as this is set
  // If we want a real queue then we need external processing of the jobs and a way to update the room from outside


  constructor(
    io: Server,
    roomId: string,
    roomData?: string | null | undefined,
  ) {
    this.roomId = sanitizeRoomId(roomId);
    this.io = io;
    this.localMediaSignaling = new LocalMediaSignaling(this.io.of(this.roomId) as any);
    this.localMediaAuthority = new LocalMediaAuthority(postgres, this.localMediaSignaling);

    if (roomData) {
      this.deserialize(roomData);
    }

    this.tsInterval = setInterval(async () => {
      // Scavenge stale disconnected participant admissions beyond grace period
      const now = Date.now();
      for (const [cId, rec] of this.admittedParticipants.entries()) {
        if (rec.state === 'disconnected' && rec.lastDisconnectedAt && (now - rec.lastDisconnectedAt > ADMISSION_DISCONNECT_GRACE_MS)) {
          this.admittedParticipants.delete(cId);
        }
      }
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
        io.of(roomId).emit("REC:playbackSync", this.timeline.generateSyncPayload());
      }
    }, 1000);

    io.of(roomId).use(async (socket, next) => {
      let isOwner = false;
      if (postgres) {
        const result = await postgres.query(
          `SELECT passcode, owner_id, "isSubRoom", status, "expiresAt", "isPermanent", "startedAt", participants_locked, max_participants FROM rooms where "roomId" = $1`,
          [this.roomId],
        );
        const roomRow = result.rows[0];
        if (roomRow?.participants_locked !== undefined) {
          this.participantsLocked = Boolean(roomRow.participants_locked);
        }
        if (roomRow?.max_participants !== undefined && typeof roomRow.max_participants === "number") {
          this.maxParticipants = roomRow.max_participants;
        }
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

        const token = socket.handshake.auth?.token;

        // Authenticate the user strictly from token, never from client-provided UID
        if (token) {
          try {
            const decoded = await validateToken(token);
            if (decoded && decoded !== "EMAIL_NOT_VERIFIED" && decoded.uid) {
              socket.uid = decoded.uid;
              isOwner = Boolean(owner_id && owner_id === decoded.uid);
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

        // Authoritative participant admission token verification
        // Strict boundary: Non-owners MUST possess a valid server-issued admissionToken
        // binding { roomId, userId, sessionId }
        if (!isOwner) {
          const admissionToken = socket.handshake.auth?.admissionToken;
          const handshakeSessionId = (socket.handshake.auth?.sessionId as string) || "";
          const tokenFp = fingerprintToken(admissionToken);

          const verification = verifyAdmissionToken(
            admissionToken,
            this.roomId,
            socket.uid,
            handshakeSessionId
          );

          console.log(
            `[ADMISSION_TRACE:F] Server verification: room=${this.roomId} uid=${socket.uid || "none"} session=${handshakeSessionId || "none"} tokenFp=${tokenFp} valid=${verification.valid} error=${verification.error || "none"}`
          );

          if (!verification.valid) {
            console.warn(
              `[Admission] Handshake rejected for room ${this.roomId}: ${verification.error}`
            );
            next(new Error("passcode"));
            return;
          }
        }

        // Host-initiated room access control:
        // When room is not active, non-owners are rejected to waiting poll.
        // Owner is admitted to the namespace WITHOUT activating the room.
        // Activation happens only via explicit CMD:startSession.
        if (currentDbStatus !== "active") {
          if (!isOwner) {
            next(new Error("ROOM_NOT_STARTED"));
            return;
          }
          // Owner enters namespace; room stays in its current state until CMD:startSession
          this.status = (currentDbStatus === "scheduled" || currentDbStatus === "inactive")
            ? currentDbStatus
            : "inactive";
        } else {
          this.status = "active";
        }
      }
      // clientId is meant for things that shouldn't require login
      // Anything sensitive (e.g. subscriber features, room lock) should be validated with uid and require login
      // identify chat messages, video chat/screenshare signaling
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

      // Server assigns unpredictable, ephemeral connection identity
      const clientId = randomUUID();
      socket.clientId = clientId;
      const sessionId = typeof socket.handshake.auth?.sessionId === "string" ? socket.handshake.auth.sessionId : undefined;

      // MODERATION-001 Invariant: Banned Participant Authority
      // Check PostgreSQL room_bans table and L1 cache
      const authUid = socket.uid || undefined;
      if (postgres) {
        try {
          const banRes = await postgres.query(
            `SELECT client_identity, user_id FROM room_bans WHERE room_id = $1 AND (user_id IS NOT NULL AND user_id = $2)`,
            [this.roomId, authUid || null]
          );
          if (banRes.rowCount && banRes.rowCount > 0) {
            if (authUid) this.bannedIdentities.add(authUid);
            const err = new Error("BANNED_FROM_ROOM");
            (err as any).data = {
              code: "BANNED_FROM_ROOM",
              message: "You have been removed from this room and cannot rejoin.",
            };
            next(err);
            return;
          }
        } catch (dbErr) {
          console.error("Failed to check room_bans in postgres:", dbErr);
          const err = new Error("SERVICE_UNAVAILABLE");
          (err as any).data = {
            code: "SERVICE_UNAVAILABLE",
            message: "Unable to verify authorization state. Please try again.",
          };
          next(err);
          return;
        }
      }

      if (this.isBanned(clientId, authUid)) {
        const err = new Error("BANNED_FROM_ROOM");
        (err as any).data = {
          code: "BANNED_FROM_ROOM",
          message: "You have been removed from this room and cannot rejoin.",
        };
        next(err);
        return;
      }

      // LOCK-001 Invariant: Evaluate participants_locked at final server-side admission boundary.
      // Flow: Creds -> Room/Passcode verify -> participants_locked?
      // - False: admit.
      // - True: admit ONLY IF owner OR authoritative server-side existing identity. Otherwise, reject PARTICIPANTS_LOCKED.
      if (this.participantsLocked && !isOwner) {
        const isAdmitted = this.verifyAdmittedSession(sessionId, authUid);
        if (!isAdmitted) {
          const err = new Error("PARTICIPANTS_LOCKED");
          (err as any).data = {
            code: "PARTICIPANTS_LOCKED",
            message: "This room is currently locked to existing participants.",
          };
          next(err);
          return;
        }
      }

      // MEMBER-001 Invariant: Capacity Authority
      // Flow: Creds -> Lock Policy -> Existing Session -> Capacity Check -> ADMIT or ROOM_FULL
      // - If room is full, reject with ROOM_FULL unless owner or existing admitted session reconnecting
      if (this.isRoomFull(isOwner, sessionId, authUid)) {
        const err = new Error("ROOM_FULL");
        (err as any).data = {
          code: "ROOM_FULL",
          message: "This room has reached its participant limit.",
        };
        next(err);
        return;
      }

      next();
    });
    const handleSocketConnection = async (socket: Socket): Promise<void> => {
      const clientId = socket.clientId || randomUUID();
      socket.clientId = clientId;
      socket.emit("REC:assignedClientId", clientId);
      const handshakeSessionId = (socket.handshake.auth?.sessionId as string) || "";
      this.recordAdmittedParticipant(clientId, handshakeSessionId, socket.uid);

      // -- Start socket state initialization --

      // Disconnect other sockets with this clientId
      if (this.socketIdMap[clientId]) {
        this.io.of(this.roomId).sockets.get(this.socketIdMap[clientId])?.disconnect(true);
      }
      // Keep track of the current socketID associated with this client (only used for signaling and kicking)
      this.socketIdMap[clientId] = socket.id;
      const effectiveUserId = socket.uid || clientId;
      this.localMediaAuthority.registerPeer(this.roomId, effectiveUserId, clientId, socket.id);
      const initialName = this.nameMap[clientId] || (socket.uid ? this.uidToNameMap[socket.uid] : undefined);
      const initialPicture = this.pictureMap[clientId] || (socket.uid ? this.uidToPictureMap[socket.uid] : undefined);
      const existingUser = this.roster.find(user => user.id === clientId);
      if (!existingUser) {
        this.roster.push({ id: clientId, name: initialName, picture: initialPicture });
      } else {
        if (initialName && !existingUser.name) existingUser.name = initialName;
        if (initialPicture && !existingUser.picture) existingUser.picture = initialPicture;
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
        await this.reclaimHostForOwner(socket);
      } else if (!this.currentHostUid && socket.uid) {
        // Initial room participant becomes host ONLY IF authenticated with verified UID
        this.currentHostUid = socket.uid;
        this.currentHostClientId = clientId;
      }

      // Authoritative Session Activation on Host Entry:
      // When the authenticated owner or authorized host enters Watch, transition an inactive
      // or scheduled room to active DB-first. Only mutate memory and broadcast upon confirmed DB transition.
      const isAuthorizedHostConnecting = Boolean(
        socket.uid &&
        (socket.uid === this.owner_id || (this.currentHostUid && socket.uid === this.currentHostUid))
      );

      if (isAuthorizedHostConnecting && (this.status === "inactive" || this.status === "scheduled") && postgres) {
        try {
          const activateResult = await postgres.query(
            "SELECT public.set_room_activity_authoritative($1, 'active', $2) AS result",
            [this.roomId, socket.uid]
          );
          const res = activateResult?.rows?.[0]?.result;
          if (res?.status === "active") {
            this.status = "active";
            this.expiresAt = res.expiresAt ? new Date(res.expiresAt) : undefined;
            this.lastUpdateTime = new Date();
            this.io.of(this.roomId).emit("REC:sessionStarted", {
              status: "active",
              startedBy: socket.uid,
            });
            this.scheduleInactivityTimeoutIfNeeded();
          } else if (res?.status === "expired") {
            this.status = "expired";
          }
        } catch (activationErr) {
          console.error(`[Lifecycle] Failed authoritative room activation on host entry for ${this.roomId}:`, activationErr);
        }
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
              `SELECT * FROM public.expire_rooms_authoritative()`
            ).catch(e => console.error("Failed to update status on authoritative real-time check:", e));
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

      socket.on("CMD:host", (data: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "room:set_media");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN" });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.startHosting(socket, String(data));
      });
      socket.on("CMD:play", (data?: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "room:play");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN", message: "Playback controls are locked to the host." });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.playVideo(socket, (data as any)?.operationId);
      });
      socket.on("CMD:pause", (data?: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "room:pause");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN", message: "Playback controls are locked to the host." });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.pauseVideo(socket, (data as any)?.operationId);
      });
      socket.on("CMD:seek", (data: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "room:seek");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN", message: "Playback controls are locked to the host." });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.seekVideo(socket, data as any);
      });
      socket.on("CMD:playbackRate", (data: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "room:change_rate");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN", message: "Playback controls are locked to the host." });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.setPlaybackRate(socket, data as any);
      });
      socket.on("CMD:loop", (data: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "room:play");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN", message: "Playback controls are locked to the host." });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.setLoop(Boolean(data));
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
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "room:set_media");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN" });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.joinScreenSharing(socket, data);
      });
      socket.on("CMD:userMute", (data: unknown) =>
        validateNotExpired() && this.setUserMute(socket, data),
      );
      socket.on("CMD:leaveScreenShare", () => validateNotExpired() && this.leaveScreenSharing(socket));

      socket.on("CMD:subtitle", (data: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "room:subtitle_change");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN" });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.addSubtitles(String(data));
      });
      socket.on("CMD:lock", async (data: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "room:lock");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN", message: "Only the room host or lock holder can change playback lock" });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        await this.lockRoom(socket, data);
      });
      socket.on("CMD:setParticipantsLock", async (data: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "room:lock_participants");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN", message: "Only the room owner or host can lock participants." });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        const locked = Boolean((data as any)?.locked);
        await this.setParticipantsLock(socket, locked);
      });
      socket.on("CMD:askHost", () => {
        validateNotExpired() && socket.emit("REC:host", this.getHostState());
      });
      socket.on("CMD:assignHost", (data: unknown) => {
        if (!validateNotExpired()) return;
        const req = data as { newHostClientId?: string; participantId?: string; targetClientId?: string };
        const targetId = req?.participantId || req?.targetClientId || req?.newHostClientId;
        if (targetId) {
          this.assignHost(socket, String(targetId));
        }
      });
      socket.on("CMD:transferHost", async (data: unknown, ack?: (res: { success: boolean; error?: string }) => void) => {
        if (!validateNotExpired()) return;
        const req = data as { participantId?: string; targetClientId?: string; newHostClientId?: string };
        const targetId = req?.participantId || req?.targetClientId || req?.newHostClientId;
        if (!targetId) {
          socket.emit("errorMessage", "Target participant ID is required.");
          if (typeof ack === "function") ack({ success: false, error: "TARGET_REQUIRED" });
          return;
        }
        try {
          const res = await this.transferHost(socket, String(targetId));
          if (!res.success) {
            socket.emit("errorMessage", res.error || "Failed to transfer host authority.");
            if (typeof ack === "function") ack({ success: false, error: res.error });
          } else {
            if (typeof ack === "function") ack({ success: true });
          }
        } catch (err: any) {
          socket.emit("errorMessage", err.message || "Failed to transfer host authority.");
          if (typeof ack === "function") ack({ success: false, error: err.message });
        }
      });
      socket.on("CMD:leaveRoom", (ack?: (res: { success: boolean; error?: string }) => void) => {
        if (this.isHost(socket) && this.getEligibleParticipants(socket.clientId).length > 0) {
          const msg = "Host must transfer host authority before leaving the room.";
          socket.emit("errorMessage", msg);
          if (typeof ack === "function") ack({ success: false, error: msg });
          return;
        }

        this.performParticipantDeparture(socket);

        if (typeof ack === "function") ack({ success: true });
      });
      socket.on("CMD:becomeHost", () => {
        socket.emit("errorMessage", "Direct host claims are not permitted.");
      });
      socket.on("CMD:claimHost", () => {
        socket.emit("errorMessage", "Direct host claims are not permitted.");
      });
      socket.on("CMD:startSession", async () => {
        await this.startSession(socket);
      });
      socket.on("CMD:getRoomState", () => validateNotExpired() && this.getRoomState(socket));
      socket.on("CMD:setRoomState", async (data: unknown) => {
        socket.emit("errorMessage", "Room settings cannot be changed while the room is active");
      });
      socket.on("CMD:setRoomOwner", async (data: unknown) => {
        socket.emit("errorMessage", "Room settings cannot be changed while the room is active");
      });
      socket.on("CMD:playlistNext", (data: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "playlist:next");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN" });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.playlistNext(data);
      });
      socket.on("CMD:playlistAdd", (data: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "playlist:add");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN" });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.playlistAdd(socket, String(data));
      });
      socket.on("CMD:playlistMove", (data: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "playlist:move");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN" });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.playlistMove(data);
      });
      socket.on("CMD:playlistDelete", (data: unknown) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "playlist:delete");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN" });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.playlistDelete(Number(data));
      });
      socket.on("CMD:kickUser", async (data: unknown) => {
        if (!validateNotExpired()) return;
        const payload = data as { userToBeKicked: string; reason?: string; operationId?: string };
        if (payload?.userToBeKicked) {
          await this.kickUser(socket, payload.userToBeKicked, payload.reason, payload.operationId);
        }
      });
      socket.on("CMD:banUser", async (data: unknown) => {
        if (!validateNotExpired()) return;
        const payload = data as { userToBeBanned: string; reason?: string; operationId?: string };
        if (payload?.userToBeBanned) {
          await this.banUser(socket, payload.userToBeBanned, payload.reason, payload.operationId);
        }
      });
      socket.on("CMD:deleteChatMessage", async (data: unknown) => {
        if (validateNotExpired()) {
          const payload = data as { messageIds: string[]; operationId?: string };
          if (payload?.messageIds) {
            await this.deleteChatMessages(socket, payload);
          }
        }
      });
      socket.on("CMD:deleteChatMessages", async (data: unknown) => {
        if (validateNotExpired()) {
          await this.deleteChatMessages(socket, data);
        }
      });

      socket.on("signal", (data: unknown) =>
        validateNotExpired() && this.sendSignal(socket, data, "signal"),
      );
      socket.on("signalSS", (data: unknown) =>
        validateNotExpired() && this.sendSignal(socket, data, "signalSS"),
      );

      // LOCAL-MEDIA-001: P2P Local Media distribution commands
      socket.on("CMD_LOCAL_MEDIA_ANNOUNCE", async (data: { roomId: string; manifest: ServerLocalMediaManifest }) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "room:set_media");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN" });
          return;
        }
        const userId = socket.uid || clientId;
        const session = await this.localMediaAuthority.announceSession(
          this.roomId,
          userId,
          auth.allowed,
          data?.manifest
        );
        if (session) {
          this.cmdHost(socket, "localmedia://" + data.manifest.mediaId);
        }
      });

      socket.on("CMD_LOCAL_MEDIA_SIGNAL", (data: any) => {
        if (!validateNotExpired()) return;
        if (!data || typeof data !== "object") return;

        // 1. Authoritative sender identity: sender's registered peerId (clientId) in this room
        const senderPeerId = clientId;
        const targetPeerId = data.toPeerId;
        if (!targetPeerId || typeof targetPeerId !== "string") return;

        // 2. Validate target socket belongs to this room
        const targetSocketId = this.socketIdMap[targetPeerId];
        if (!targetSocketId) return;

        // Ensure target is still connected in this room's namespace
        const targetSocket = this.io.of(this.roomId).sockets.get(targetSocketId);
        if (!targetSocket) return;

        // 3. Construct authoritative relay payload
        const relayPayload = {
          roomId: this.roomId,
          fromPeerId: senderPeerId, // Server enforced, ignoring data.fromPeerId
          toPeerId: targetPeerId,
          signal: data.signal,
          epoch: typeof data.epoch === "number" ? data.epoch : 1,
        };

        this.localMediaAuthority.handleSignalRelay(
          socket,
          targetSocketId,
          relayPayload,
          data.mediaId
        );
      });

      socket.on("CMD_LOCAL_MEDIA_AVAILABILITY", (data: any) => {
        if (!validateNotExpired()) return;
        if (!data || typeof data !== "object") return;
        const { mediaId, epoch, availableChunksCount, contiguousThrough } = data;
        if (!mediaId || typeof mediaId !== "string" || typeof epoch !== "number") return;

        this.localMediaAuthority.updatePeerAvailability(
          this.roomId,
          clientId,
          mediaId,
          epoch,
          availableChunksCount,
          contiguousThrough
        );
      });

      // Resolve profile for authenticated socket
      if (socket.uid) {
        this.clientToUidMap[clientId] = socket.uid;
        this.admittedMembers.add(socket.uid);
        if (this.uidToNameMap[socket.uid] && !this.nameMap[clientId]) {
          this.nameMap[clientId] = this.uidToNameMap[socket.uid];
        }
        if (this.uidToPictureMap[socket.uid] && !this.pictureMap[clientId]) {
          this.pictureMap[clientId] = this.uidToPictureMap[socket.uid];
        }
        if (this.owner_id && socket.uid === this.owner_id) {
          await this.reclaimHostForOwner(socket);
        }
        if (postgres) {
          try {
            const profileRes = await postgres.query(
              "SELECT display_name, username, avatar_url FROM profiles WHERE id = $1 LIMIT 1",
              [socket.uid]
            );
            if (profileRes.rows && profileRes.rows.length > 0) {
              const profile = profileRes.rows[0];
              const resolvedName = profile.display_name?.trim() || profile.username?.trim();
              if (resolvedName) {
                this.nameMap[clientId] = resolvedName;
                this.uidToNameMap[socket.uid] = resolvedName;
                const match = this.roster.find((user) => user.id === clientId);
                if (match) match.name = resolvedName;
              }
              if (profile.avatar_url) {
                this.pictureMap[clientId] = profile.avatar_url;
                this.uidToPictureMap[socket.uid] = profile.avatar_url;
                const match = this.roster.find((user) => user.id === clientId);
                if (match) match.picture = profile.avatar_url;
              }
            }
          } catch (e) {
            console.warn("Failed resolving profile on connection", e);
          }
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
      socket.emit("REC:hostAuthority", {
        hostId: this.currentHostUid || this.currentHostClientId,
        hostClientId: this.currentHostClientId,
        mode: this.getHostMode(),
        reason: "initial",
        hostName: this.getHostDisplayName(),
        isOwner: this.getHostMode() === "owner",
      });
      this.io.of(this.roomId).emit("REC:nameMap", this.nameMap);
      this.io.of(this.roomId).emit("REC:pictureMap", this.pictureMap);
      socket.emit("REC:tsMap", this.tsMap);
      socket.emit("REC:lock", this.lock);
      socket.emit("REC:participantsLock", this.participantsLocked);
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
      socket.emit("REC:playbackSync", this.timeline.generateSyncPayload());
      this.getRoomState(socket);
      io.of(roomId).emit("roster", this.getRosterForApp());
    };

    io.of(roomId).on("connection", (socket: Socket) => {
      void handleSocketConnection(socket).catch(
        (error: unknown) => {
          console.error(
            {
              socketId: socket.id,
              roomId: this.roomId,
              error,
            },
            "Unhandled socket connection lifecycle failure",
          );

          if (socket.connected) {
            socket.emit(
              "errorMessage",
              "Unable to initialize the connection.",
            );
            socket.disconnect();
          }
        },
      );
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
      lock: this.lock,
      creator: this.creator,
      playlist: this.playlist,
      loop: this.loop,
    });
  };

  private deserialize = (roomData: string) => {
    const roomObj = JSON.parse(roomData);
    this.video = roomObj.video;
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
    this.timeline = new TimelineAuthority({
      anchorTime: roomObj.videoTS || 0,
      anchorWallClock: Date.now(),
      paused: this.paused !== undefined ? this.paused : true,
      playbackRate: this.playbackRate || 1.0,
      mediaSource: this.video || "",
    });
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
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = undefined;
    }
    this.localMediaAuthority.terminateSession(this.roomId);
  };

  public getRosterForStats = () => {
    return this.roster.map((p) => ({
      id: p.id,
      name: this.nameMap[p.id] || p.name || "Guest",
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
        name: this.nameMap[p.id] || p.name || undefined,
        picture: this.pictureMap[p.id] || p.picture || undefined,
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
      loop: this.loop,
    };
  };

  public isHost = (socket: Socket | null | undefined): boolean => {
    if (!socket?.uid || !this.currentHostUid) return false;
    return socket.uid === this.currentHostUid;
  };

  public getHostDisplayName = (): string => {
    if (this.currentHostClientId && this.nameMap[this.currentHostClientId]) {
      return this.nameMap[this.currentHostClientId];
    }
    return "Host";
  };

  public broadcastHostChange = (reason: HostTransitionReason) => {
    const mode = this.getHostMode();
    this.hostMode = mode;
    const isOwner = mode === "owner";
    const hostId = this.currentHostUid || this.currentHostClientId;
    const hostPayload: HostAuthorityPayload = {
      hostId,
      hostClientId: this.currentHostClientId,
      mode,
      reason,
      hostName: this.getHostDisplayName(),
      isOwner,
    };
    this.io.of(this.roomId).emit("REC:hostAuthority", hostPayload);
    this.io.of(this.roomId).emit("REC:hostChange", hostPayload);

    if ((reason === "failover" || reason === "explicit_transfer") && this.currentHostUid) {
      const transferId = randomUUID();
      notificationService
        .notifyUser({
          userId: this.currentHostUid,
          type: "ROOM_HOST_TRANSFER",
          title: "Host role assigned",
          body: `You are now the host of room ${this.roomId}.`,
          metadata: {
            roomId: this.roomId,
            action: "open_room",
            targetUrl: `/room/${encodeURIComponent(this.roomId)}`,
            reason,
            hostEpoch: this.hostEpoch,
          },
          eventId: `ROOM_HOST_TRANSFER:${this.roomId}:${this.currentHostUid}`,
        })
        .catch((err) => console.error("[Notification] Failed to notify new host:", err));
    }
    this.io.of(this.roomId).emit("REC:getRoomState", {
      owner: this.owner_id,
      currentHostId: hostId,
      currentHostClientId: this.currentHostClientId,
      hostName: this.getHostDisplayName(),
      hostMode: mode,
      isHost: false, // Per-socket value evaluated in getRoomState()
      isChatDisabled: this.isChatDisabled,
      roomTitle: this.roomTitle,
      roomDescription: this.roomDescription,
      mediaPath: this.mediaPath,
      participantsLocked: this.participantsLocked,
      maxParticipants: this.maxParticipants,
    });
  };

  public reclaimHostForOwner = async (ownerSocket: Socket): Promise<boolean> => {
    if (!this.owner_id || ownerSocket.uid !== this.owner_id) return false;
    if (this.currentHostClientId === ownerSocket.clientId && this.hostMode === "owner") {
      return true;
    }

    try {
      return await this.withHostTransitionLease(async () => {
        const previousHostClientId = this.currentHostClientId;
        this.hostEpoch += 1;
        this.currentHostClientId = ownerSocket.clientId;
        this.currentHostUid = ownerSocket.uid;
        this.clientToUidMap[ownerSocket.clientId] = ownerSocket.uid;
        this.hostMode = "owner";

        this.broadcastHostChange("owner_regain");
        if (previousHostClientId && previousHostClientId !== ownerSocket.clientId) {
          const chatMsg = {
            id: ownerSocket.clientId,
            cmd: "system",
            msg: "The room creator has returned and resumed hosting.",
          };
          this.addChatMessage(ownerSocket, chatMsg);
        }
        return true;
      });
    } catch (err: any) {
      console.warn(`[RECLAIM HOST WARNING] Failed to reclaim host in room ${this.roomId}:`, err.message);
      return false;
    }
  };

  public transferHost = async (
    socket: Socket,
    targetClientId: string,
  ): Promise<{ success: boolean; error?: string }> => {
    const context = this.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "room:transfer_host");
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      return { success: false, error: "FORBIDDEN" };
    }
    if (!targetClientId) {
      return { success: false, error: "TARGET_REQUIRED" };
    }
    if (targetClientId === socket.clientId) {
      return { success: false, error: "CANNOT_TRANSFER_TO_SELF" };
    }
    if (!this.isParticipantEligibleForHost(targetClientId)) {
      return { success: false, error: "TARGET_NOT_ELIGIBLE" };
    }

    return await this.withHostTransitionLease(async () => {
      // Re-verify under distributed lease
      if (!this.isHost(socket)) {
        return { success: false, error: "NOT_HOST" };
      }
      if (!this.isParticipantEligibleForHost(targetClientId)) {
        return { success: false, error: "TARGET_NOT_ELIGIBLE" };
      }

      const previousHostName = this.getHostDisplayName();
      this.hostEpoch += 1;
      this.currentHostClientId = targetClientId;
      this.currentHostUid = this.clientToUidMap[targetClientId] || "";
      this.hostMode = this.getHostMode();
      const newHostName = this.getHostDisplayName();

      this.broadcastHostChange("explicit_transfer");
      const chatMsg = {
        id: socket.clientId,
        cmd: "system",
        msg: `${previousHostName} transferred host authority to ${newHostName}.`,
      };
      this.addChatMessage(socket, chatMsg);
      return { success: true };
    });
  };

  public assignHost = (socket: Socket, newHostClientId: string): boolean => {
    const auth = this.authorizeRoomAction({
      actorSocket: socket,
      action: "room:transfer_host",
    });
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      socket.emit("errorMessage", "FORBIDDEN");
      return false;
    }
    this.transferHost(socket, newHostClientId).catch((err) => {
      socket.emit("errorMessage", err.message || "Failed to assign host.");
    });
    return true;
  };



  private cmdHost = (socket: Socket | null, data: string) => {
    if (data && data.length > 50000) {
      return;
    }
    if (this.video?.startsWith("localmedia://") && !data?.startsWith("localmedia://")) {
      this.localMediaAuthority.terminateSession(this.roomId);
    }
    this.video = data;
    this.paused = false;
    this.subtitle = "";
    this.loop = false;
    this.playbackRate = 1;
    this.timeline.setMediaSource(data);
    this.tsMap = {};
    this.preventTSUpdate = true;
    setTimeout(() => (this.preventTSUpdate = false), 1000);
    this.io.of(this.roomId).emit("REC:tsMap", this.tsMap);
    this.io.of(this.roomId).emit("REC:host", this.getHostState());
    this.io.of(this.roomId).emit("REC:playbackSync", this.timeline.generateSyncPayload());
    if (socket && data) {
      const chatMsg = { id: socket.clientId, cmd: "host", msg: data };
      this.addChatMessage(socket, chatMsg);
    }
    if (data === "") {
      this.playlistNext(null);
    }

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

    // Broadcast immediately in realtime to all clients in the room (zero latency)
    this.io.of(this.roomId).emit("REC:chat", { ...chatWithTime, userId: socket.uid });
    this.io.of(this.roomId).emit("ROOM_MESSAGE", { ...chatWithTime, userId: socket.uid });

    // Persist asynchronously in the background so database latency never blocks the live realtime WebSocket loop
    const shouldPersist = !isCmd || (isCmd && ['room.inactive', 'room.reactivated', 'room.expired'].includes(chatMsg.cmd!));
    if (shouldPersist) {
      persistRoomMessage(
        this.roomId,
        socket.uid,
        chatMsg.msg || "",
        messageType,
        eventType,
        { clientId: socket?.clientId, videoTS: chatWithTime.videoTS, name: socket?.clientId ? this.nameMap[socket.clientId] : undefined, picture: socket?.clientId ? this.pictureMap[socket.clientId] : undefined },
        chatMsg.clientMessageId
      ).then((dbRow) => {
        if (dbRow?.id) {
          const persistedUpdate = {
            ...chatWithTime,
            dbId: dbRow.id,
            userId: socket?.uid,
          };
          this.io.of(this.roomId).emit("REC:messagePersisted", persistedUpdate);
          this.io.of(this.roomId).emit("ROOM_MESSAGE_EDITED", persistedUpdate);
        }
      }).catch((err) => {
        console.error("Background message persist error:", err);
      });
    }
  };

  private changeUserName = (socket: Socket, data: string) => {
    if (!data) {
      return;
    }
    if (data && data.length > 50) {
      return;
    }
    this.nameMap[socket.clientId] = data;
    if (socket.uid) {
      this.uidToNameMap[socket.uid] = data;
    }
    const match = this.roster.find((user) => user.id === socket.clientId);
    if (match) {
      match.name = data;
    }
    this.io.of(this.roomId).emit("REC:nameMap", this.nameMap);
    this.io.of(this.roomId).emit("roster", this.getRosterForApp());
    if (this.isHost(socket)) {
      this.io.of(this.roomId).emit("REC:hostChange", {
        hostId: this.currentHostUid,
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
    if (socket.uid) {
      this.uidToPictureMap[socket.uid] = data;
    }
    const match = this.roster.find((user) => user.id === socket.clientId);
    if (match) {
      match.picture = data;
    }
    this.io.of(this.roomId).emit("REC:pictureMap", this.pictureMap);
    this.io.of(this.roomId).emit("roster", this.getRosterForApp());
  };

  private startHosting = async (socket: Socket, data: string) => {

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

  public playVideo = (socket: Socket, operationId?: string) => {
    if (!this.canControlPlayback(socket)) {
      socket.emit("CMD:error", "Playback controls are locked to the host.");
      return;
    }
    if (this.hasProcessedOperation(socket.clientId, operationId)) {
      socket.emit("REC:playbackSync", this.timeline.generateSyncPayload());
      return;
    }
    this.recordProcessedOperation(socket.clientId, operationId);
    this.timeline.play();
    this.paused = false;
    socket.broadcast.emit("REC:play", this.video);
    this.io.of(this.roomId).emit("REC:playbackSync", this.timeline.generateSyncPayload(undefined, undefined, operationId));
    const chatMsg = {
      id: socket.clientId,
      cmd: "play",
      msg: this.tsMap[socket.clientId]?.toString(),
    };
    this.addChatMessage(socket, chatMsg);
  };

  public pauseVideo = (socket: Socket, operationId?: string) => {
    if (!this.canControlPlayback(socket)) {
      socket.emit("CMD:error", "Playback controls are locked to the host.");
      return;
    }
    if (this.hasProcessedOperation(socket.clientId, operationId)) {
      socket.emit("REC:playbackSync", this.timeline.generateSyncPayload());
      return;
    }
    this.recordProcessedOperation(socket.clientId, operationId);
    this.timeline.pause();
    this.paused = true;
    socket.broadcast.emit("REC:pause");
    this.io.of(this.roomId).emit("REC:playbackSync", this.timeline.generateSyncPayload(undefined, undefined, operationId));
    const chatMsg = {
      id: socket.clientId,
      cmd: "pause",
      msg: this.tsMap[socket.clientId]?.toString(),
    };
    this.addChatMessage(socket, chatMsg);
  };

  public startSession = async (socket: Socket): Promise<void> => {
    // 1. Server-authoritative ownership/host check (never trust client isHost)
    if (!socket.uid || (!this.isHostUid(socket.uid) && socket.uid !== this.owner_id)) {
      socket.emit("CMD:error", { code: "FORBIDDEN", message: "Only the room host or owner can start the session." });
      return;
    }

    // 2. Guard: only inactive/scheduled rooms can be started
    if (this.status !== "inactive" && this.status !== "scheduled") {
      socket.emit("CMD:error", { code: "INVALID_STATE", message: "Room is already active or has ended." });
      return;
    }

    // 3. Atomic DB-first transition (CAS: only transitions if current status allows)
    if (!postgres) {
      socket.emit("CMD:error", { code: "SERVICE_UNAVAILABLE", message: "Database unavailable." });
      return;
    }

    try {
      const activateResult = await postgres.query(
        "SELECT public.set_room_activity_authoritative($1, 'active', $2) AS result",
        [this.roomId, socket.uid]
      );

      const res = activateResult?.rows?.[0]?.result;
      if (!res || res.status === "expired") {
        this.status = "expired";
        socket.emit("CMD:error", { code: "ROOM_EXPIRED", message: "This room has expired." });
        return;
      }

      if (res.status !== "active") {
        socket.emit("CMD:error", { code: "TRANSITION_FAILED", message: "Failed to start the session." });
        return;
      }

      // 4. Only update memory AFTER DB confirms transition
      this.status = "active";
      this.expiresAt = res.expiresAt ? new Date(res.expiresAt) : undefined;
      this.lastUpdateTime = new Date();

      // 5. Broadcast to connected sockets (only owner is connected pre-start)
      this.io.of(this.roomId).emit("REC:sessionStarted", {
        status: "active",
        startedBy: socket.uid,
      });

      // 6. System chat message
      this.addChatMessage(null, {
        id: socket.clientId,
        cmd: "system",
        msg: "Host started the watch party.",
      });

      this.scheduleInactivityTimeoutIfNeeded();
    } catch (err) {
      console.error("CMD:startSession failed:", err);
      socket.emit("CMD:error", { code: "INTERNAL_ERROR", message: "Failed to start session." });
    }
  };

  public seekVideo = (socket: Socket, data: number | { time: number; operationId?: string }) => {
    if (!this.canControlPlayback(socket)) {
      socket.emit("CMD:error", "Playback controls are locked to the host.");
      return;
    }
    const rawTarget = typeof data === "object" ? Number(data?.time) : Number(data);
    const operationId = typeof data === "object" ? data?.operationId : undefined;
    if (String(rawTarget).length > 100 || !Number.isFinite(rawTarget)) {
      return;
    }
    if (this.hasProcessedOperation(socket.clientId, operationId)) {
      socket.emit("REC:playbackSync", this.timeline.generateSyncPayload());
      return;
    }
    this.recordProcessedOperation(socket.clientId, operationId);
    const targetTime = Math.max(0, rawTarget);
    this.timeline.seek(targetTime);
    socket.broadcast.emit("REC:seek", targetTime);
    this.io.of(this.roomId).emit("REC:playbackSync", this.timeline.generateSyncPayload(undefined, undefined, operationId));
    const chatMsg = { id: socket.clientId, cmd: "seek", msg: targetTime?.toString() };
    this.addChatMessage(socket, chatMsg);
  };

  public setPlaybackRate = (socket: Socket, data: number | { rate: number; operationId?: string }) => {
    if (!this.canControlPlayback(socket)) {
      socket.emit("CMD:error", "Playback controls are locked to the host.");
      return;
    }
    const rawRate = typeof data === "object" ? Number(data?.rate) : Number(data);
    const operationId = typeof data === "object" ? data?.operationId : undefined;
    if (String(rawRate).length > 100 || !Number.isFinite(rawRate) || rawRate <= 0 || rawRate > 16) {
      return;
    }
    if (this.hasProcessedOperation(socket.clientId, operationId)) {
      socket.emit("REC:playbackSync", this.timeline.generateSyncPayload());
      return;
    }
    this.recordProcessedOperation(socket.clientId, operationId);
    this.timeline.setPlaybackRate(rawRate);
    this.playbackRate = rawRate;
    this.io.of(this.roomId).emit("REC:playbackRate", rawRate);
    this.io.of(this.roomId).emit("REC:playbackSync", this.timeline.generateSyncPayload(undefined, undefined, operationId));
    const chatMsg = {
      id: socket.clientId,
      cmd: "playbackRate",
      msg: rawRate?.toString(),
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
    if (String(data).length > 100 || typeof data !== "number" || !Number.isFinite(data)) {
      return;
    }
    // Prevent lagging TS updates from the old video from messing up our timestamps
    if (this.preventTSUpdate) {
      return;
    }
    // AUD-006: CMD:ts is strictly non-authoritative client telemetry for presence / roster display.
    // It NEVER mutates this.videoTS or this.timeline.
    const sanitizedTs = Math.max(0, Math.round(data * 100) / 100);
    const timeSinceTsMap = Date.now() - this.lastTsMap;
    this.tsMap[socket.clientId] = sanitizedTs - timeSinceTsMap / 1000 + 1;
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

    // Step 1: Pure authorization for chat:send
    const context = this.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "chat:send");
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      socket.emit("errorMessage", "FORBIDDEN");
      return;
    }

    // Validate supported fields.
    const data = payload as Record<string, unknown>;

    // Step 2: Explicitly reject any client-supplied userId, uid, roomId, or author spoofing
    if (data.userId || data.uid || data.roomId || data.author) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      socket.emit("errorMessage", "FORBIDDEN");
      return;
    }

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

    emitChatMessage({
      ...baseMsg,
      replyToId,
      replyToTimestamp,
      replyToUserId: replyToId,
      replyToMsg: "",
    });
  };

  private editMessage = async (socket: Socket, raw: unknown) => {
    if (!socket.uid) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
    const data = raw as { messageId: string; newMessage: string };
    if (!data || typeof data.messageId !== 'string' || typeof data.newMessage !== 'string') return;
    const trimmedMsg = data.newMessage.trim();
    if (trimmedMsg.length === 0 || trimmedMsg.length > 50000) return;

    if (!postgres) return;

    const context = this.buildAuthorizationContext(socket);
    const hostEpochSnapshot = context.hostEpoch;

    try {
      // Step 1: Fetch target message to verify room and authorship
      const existing = await postgres.query(
        `SELECT id, room_id, user_id FROM room_messages WHERE id = $1`,
        [data.messageId]
      );
      if (existing.rowCount === 0) {
        socket.emit("CMD:error", { code: "FORBIDDEN" });
        return;
      }
      const targetRow = existing.rows[0];

      // Step 2: Host epoch revalidation after async retrieval
      if (this.hostEpoch !== hostEpochSnapshot) {
        socket.emit("CMD:error", { code: "FORBIDDEN" });
        return;
      }

      // Step 3: Pure authorization - Author ONLY. Neither Host nor Owner can edit other users' messages!
      const target: ActionTarget = {
        targetMessage: {
          id: targetRow.id,
          roomId: targetRow.room_id,
          authorUid: targetRow.user_id,
        },
      };
      const auth = pureAuthorizeRoomAction(context, "chat:edit", target);
      if (!auth.allowed) {
        socket.emit("CMD:error", { code: "FORBIDDEN" });
        return;
      }

      // Step 4: Mutate atomically
      const isHostOrOwner = context.isHost || context.isOwner;
      const query = isHostOrOwner
        ? `
          UPDATE room_messages
          SET message = $1, updated_at = NOW()
          WHERE id = $2 AND room_id = $3 AND message_type = 'user'
          RETURNING id, room_id as "roomId", user_id, message, message_type, event_type, metadata, created_at, updated_at
        `
        : `
          UPDATE room_messages
          SET message = $1, updated_at = NOW()
          WHERE id = $2 AND room_id = $3 AND user_id = $4 AND message_type = 'user'
          RETURNING id, room_id as "roomId", user_id, message, message_type, event_type, metadata, created_at, updated_at
        `;
      const queryParams = isHostOrOwner
        ? [trimmedMsg, data.messageId, this.roomId]
        : [trimmedMsg, data.messageId, this.roomId, socket.uid];
      const result = await postgres.query(query, queryParams);

      if (result.rowCount === 0) {
        socket.emit("CMD:error", { code: "FORBIDDEN" });
        return;
      }

      const row = result.rows[0];
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
      this.io.of(this.roomId).emit("ROOM_MESSAGE_EDITED", updatedMsg);
    } catch (e) {
      console.error("Failed to edit message in postgres:", e);
      socket.emit("CMD:error", { code: "FORBIDDEN" });
    }
  };

  private addReaction = (socket: Socket, raw: unknown) => {
    const context = this.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "chat:reaction");
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
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
    const context = this.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "chat:reaction");
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
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

  public setParticipantsLock = async (socket: Socket | null, locked: boolean) => {
    if (!postgres) return;
    try {
      await postgres.query(
        "SELECT public.set_room_participants_lock_authoritative($1, $2, $3) AS result",
        [this.owner_id, this.roomId, locked]
      );
      this.participantsLocked = locked;
      this.lastUpdateTime = new Date();
      this.io.of(this.roomId).emit("REC:participantsLock", locked);
      const chatMsg = {
        id: socket?.clientId || "system",
        cmd: "system",
        msg: locked
          ? "Room participants have been locked. New participants cannot join."
          : "Room participants have been unlocked. New participants may now join.",
      };
      this.addChatMessage(socket, chatMsg);
    } catch (err: any) {
      console.error("Failed to set participants lock:", err);
      if (socket) {
        socket.emit("errorMessage", "Failed to update participant lock.");
      }
    }
  };

  private setRoomOwner = async (socket: Socket, _raw: unknown) => {
    socket.emit("errorMessage", "Room settings cannot be changed via socket.");
  };

  private getRoomState = async (socket: Socket) => {
    let first: any = null;
    if (postgres) {
      try {
        const result = await postgres.query(
          `SELECT passcode, owner_passcode, owner_id, "isChatDisabled", "roomTitle", "roomDescription", "mediaPath", participants_locked, max_participants FROM rooms where "roomId" = $1`,
          [this.roomId]
        );
        first = result.rows[0];
        if (this.isChatDisabled === undefined) {
          this.isChatDisabled = Boolean(first?.isChatDisabled);
        }
        if (first?.roomTitle !== undefined) this.roomTitle = first.roomTitle;
        if (first?.roomDescription !== undefined) this.roomDescription = first.roomDescription;
        if (first?.mediaPath !== undefined) this.mediaPath = first.mediaPath;
        if (first?.owner_id) this.owner_id = first.owner_id;
        if (first?.participants_locked !== undefined) {
          this.participantsLocked = Boolean(first.participants_locked);
        }
        if (first?.max_participants !== undefined) {
          this.maxParticipants = first.max_participants;
        }
      } catch (err) {
        console.warn("Failed fetching room details from database in getRoomState:", err);
      }
    }

    let plainPasscode = undefined;
    const isOwnerSocket = Boolean(socket.uid && first?.owner_id && socket.uid === first.owner_id);
    const isHostSocket = this.isHost(socket);
    if (isOwnerSocket && first) {
      if (first.owner_passcode) {
        plainPasscode = decryptPasscodeForOwner(first.owner_passcode) || undefined;
      } else if (first.passcode && !isBcryptHash(first.passcode)) {
        plainPasscode = first.passcode;
      }
    }

    socket.emit("REC:getRoomState", {
      passcode: plainPasscode,
      owner: first?.owner_id || this.owner_id,
      currentHostId: this.currentHostUid || this.currentHostClientId,
      currentHostClientId: this.currentHostClientId,
      hostName: this.getHostDisplayName(),
      hostMode: this.getHostMode(),
      isHost: this.isHost(socket),
      isChatDisabled: first?.isChatDisabled ?? this.isChatDisabled,
      roomTitle: first?.roomTitle ?? this.roomTitle,
      roomDescription: first?.roomDescription ?? this.roomDescription,
      mediaPath: first?.mediaPath ?? this.mediaPath,
      participantsLocked: Boolean(first?.participants_locked ?? this.participantsLocked),
      maxParticipants: typeof first?.max_participants === "number" ? first.max_participants : this.maxParticipants,
      capabilities: {
        // Unidirectional UI Presentation Hints ONLY (server never relies on client capabilities)
        moderateChat: this.canModerate(socket),
        kickParticipants: this.canModerate(socket),
        banParticipants: this.canModerate(socket),
        transferHost: this.isHost(socket),
        lockRoom: this.canControlPlayback(socket),
        playback: {
          canControl: this.canControlPlayback(socket),
          canLock: this.canModerate(socket),
        },
        chat: {
          canSend: !this.isChatDisabled || this.canModerate(socket),
          canModerate: this.canModerate(socket),
          canClear: this.canModerate(socket),
        },
        playlist: {
          canAdd: this.canControlPlayback(socket),
          canMove: this.canControlPlayback(socket),
          canDelete: this.canControlPlayback(socket),
          canNext: this.canControlPlayback(socket),
        },
      },
    });
  };

  private setRoomState = async (socket: Socket, _raw: unknown) => {
    socket.emit("errorMessage", "Room settings cannot be changed via socket.");
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

  public scheduleInactivityTimeoutIfNeeded = (): void => {
    const actualUsers = this.roster.filter((p) => !p.isScreenShare);
    if (actualUsers.length === 0 && this.status === "active") {
      if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = setTimeout(async () => {
        const currentActualUsers = this.roster.filter((p) => !p.isScreenShare);
        if (currentActualUsers.length === 0 && this.status === "active") {
          this.status = "inactive";
          this.lastUpdateTime = new Date();
          this.io.of(this.roomId).emit("ROOM_SESSION_STOPPED");

          if (postgres) {
            await postgres.query(
              "SELECT public.set_room_activity_authoritative($1, 'inactive', NULL)",
              [this.roomId]
            );
          }
        }
      }, EMPTY_ROOM_INACTIVITY_TIMEOUT_MS);
    }
  };

  private performParticipantDeparture = (socket: Socket): void => {
    const { clientId } = socket;
    // Disconnecting/leaving socket is the current one
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
      this.localMediaAuthority.unregisterPeer(this.roomId, clientId, socket.id);

      // Transition admitted participant to disconnected state with timestamp for grace period
      const admittedRecord = this.admittedParticipants.get(clientId);
      if (admittedRecord) {
        admittedRecord.state = 'disconnected';
        admittedRecord.lastDisconnectedAt = Date.now();
      }

      // Auto-release lock when the departing socket is the current lock holder.
      // This prevents remaining participants from being frozen behind an orphaned lock.
      if (socket.uid && this.lock && socket.uid === this.lock) {
        this.lock = "";
        this.io.of(this.roomId).emit("REC:lock", this.lock);
        const unlockMsg = {
          id: clientId,
          cmd: "unlock",
          msg: "",
        };
        this.addChatMessage(null, unlockMsg);
      }

      if (wasHost) {
        this.withHostTransitionLease(async () => {
          const eligible = this.getEligibleParticipants(clientId);
          if (eligible.length > 0) {
            // Deterministic lowest admissionSequence ASC
            const nextHost = eligible[0];
            const oldHostName = this.getHostDisplayName();
            this.hostEpoch += 1;
            this.currentHostClientId = nextHost.clientId;
            this.currentHostUid = this.clientToUidMap[nextHost.clientId] || "";
            this.hostMode = this.getHostMode();
            const newHostName = this.getHostDisplayName();

            this.broadcastHostChange("failover");
            const chatMsg = {
              id: nextHost.clientId,
              cmd: "system",
              msg: `${oldHostName} disconnected. ${newHostName} is now the temporary room host.`,
            };
            this.addChatMessage(null, chatMsg);
          } else {
            // No eligible participants remaining
            this.hostEpoch += 1;
            this.currentHostClientId = "";
            this.currentHostUid = "";
            this.hostMode = "none";
            this.broadcastHostChange("room_empty");
          }
        }).catch((err) => {
          console.error("Failed during host failover transition:", err);
        });
      }
      this.scheduleInactivityTimeoutIfNeeded();
    }
    // Keep namemap/picturemap so old chat messages still render correctly after disconnect
    // When serializing we only write values with messages in chat
    // This will keep growing in memory until the room is unloaded
  };

  private onDisconnect = (socket: Socket) => {
    this.performParticipantDeparture(socket);
  };

  public kickUser = async (
    actorSocket: Socket,
    targetIdentity: string,
    reason?: string,
    operationId?: string
  ) => {
    const auth = this.authorizeRoomAction({
      actorSocket,
      action: "user:kick",
      targetUserId: targetIdentity,
    });
    if (!auth.allowed) {
      actorSocket.emit("errorMessage", "FORBIDDEN");
      actorSocket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
    if (!targetIdentity) return;

    if (this.hasProcessedOperation(actorSocket.clientId, operationId)) {
      return;
    }
    this.recordProcessedOperation(actorSocket.clientId, operationId);

    this.admittedParticipants.delete(targetIdentity);

    const targetSocketId = this.socketIdMap[targetIdentity];
    const targetSocket = targetSocketId
      ? this.io.of(this.roomId).sockets.get(targetSocketId)
      : undefined;

    if (targetSocket) {
      targetSocket.emit("kicked", {
        code: "KICKED_FROM_ROOM",
        message: "You were removed from the room by the host.",
      });
      targetSocket.disconnect(true);
    }

    this.sendRoster();
    this.io.of(this.roomId).emit("REC:participantKicked", {
      eventId: randomUUID(),
      roomId: this.roomId,
      targetUserId: targetIdentity,
      kickedBy: actorSocket.clientId,
      reason,
      timestamp: Date.now(),
    });

    const targetUid = this.clientToUidMap[targetIdentity] || targetSocket?.uid;
    if (targetUid) {
      this.admittedMembers.delete(targetUid);
      if (postgres) {
        postgres.query(
          `UPDATE public.room_admissions SET revoked_at = now(), revoked_reason = 'kicked' WHERE room_id = $1 AND user_id = $2::uuid`,
          [this.roomId, targetUid]
        ).catch((err) => console.warn("[Admission] Failed to revoke admission on kick in DB:", err));
      }
      const moderationEventId = operationId || randomUUID();
      notificationService
        .notifyUser({
          userId: targetUid,
          type: "MODERATION_ACTION",
          title: "Removed from room",
          body: reason
            ? `You were removed from room ${this.roomId}: ${reason}`
            : `You were removed from room ${this.roomId} by the host.`,
          metadata: {
            roomId: this.roomId,
            action: "go_home",
            targetUrl: "/home",
            moderationType: "kick",
            moderationEventId,
          },
          eventId: `MODERATION_ACTION:${moderationEventId}`,
        })
        .catch((err) => console.error("[Notification] Failed to notify kicked user:", err));
    }
  };

  public banUser = async (
    actorSocket: Socket,
    targetIdentity: string,
    reason?: string,
    operationId?: string
  ) => {
    const auth = this.authorizeRoomAction({
      actorSocket,
      action: "user:ban",
      targetUserId: targetIdentity,
    });
    if (!auth.allowed) {
      actorSocket.emit("errorMessage", "FORBIDDEN");
      actorSocket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
    if (!targetIdentity) return;

    if (this.hasProcessedOperation(actorSocket.clientId, operationId)) {
      return;
    }
    this.recordProcessedOperation(actorSocket.clientId, operationId);

    // Record in L1 cache
    this.bannedIdentities.add(targetIdentity);
    const targetUid = this.clientToUidMap[targetIdentity];
    if (targetUid) {
      this.bannedIdentities.add(targetUid);
    }

    // Remove from admitted participants
    this.admittedParticipants.delete(targetIdentity);

    if (targetUid) {
      this.admittedMembers.delete(targetUid);
      if (postgres) {
        postgres.query(
          `UPDATE public.room_admissions SET revoked_at = now(), revoked_reason = 'banned' WHERE room_id = $1 AND user_id = $2::uuid`,
          [this.roomId, targetUid]
        ).catch((err) => console.warn("[Admission] Failed to revoke admission on ban in DB:", err));
      }
      const moderationEventId = operationId || randomUUID();
      notificationService
        .notifyUser({
          userId: targetUid,
          type: "MODERATION_ACTION",
          title: "Banned from room",
          body: reason
            ? `You have been banned from room ${this.roomId}: ${reason}`
            : `You have been banned from room ${this.roomId} by the host.`,
          metadata: {
            roomId: this.roomId,
            action: "go_home",
            targetUrl: "/home",
            moderationType: "ban",
            moderationEventId,
          },
          eventId: `MODERATION_ACTION:${moderationEventId}`,
        })
        .catch((err) => console.error("[Notification] Failed to notify banned user:", err));
    }

    // Persist to PostgreSQL room_bans table
    if (postgres) {
      try {
        await postgres.query(
          `INSERT INTO room_bans (room_id, client_identity, user_id, banned_by, reason)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (room_id, client_identity) DO NOTHING`,
          [
            this.roomId,
            targetIdentity,
            targetUid || null,
            actorSocket.clientId || actorSocket.uid || "host",
            reason || null,
          ]
        );
      } catch (err) {
        console.error("Failed to persist room ban in database:", err);
      }
    }

    // Eject target socket if currently connected
    const targetSocketId = this.socketIdMap[targetIdentity];
    const targetSocket = targetSocketId
      ? this.io.of(this.roomId).sockets.get(targetSocketId)
      : undefined;

    if (targetSocket) {
      targetSocket.emit("banned", {
        code: "BANNED_FROM_ROOM",
        message: "You have been removed from this room and cannot rejoin.",
      });
      targetSocket.disconnect(true);
    }

    this.sendRoster();
    this.io.of(this.roomId).emit("REC:participantBanned", {
      eventId: randomUUID(),
      roomId: this.roomId,
      targetUserId: targetIdentity,
      bannedBy: actorSocket.clientId,
      reason,
      timestamp: Date.now(),
    });
  };

  public disconnectAllSockets = () => {
    this.io.of(this.roomId).disconnectSockets();
  };

  public deleteChatMessages = async (actorSocket: Socket, raw: unknown) => {
    const data = raw as {
      operationId?: string;
      messageIds?: string[];
      author?: string;
      timestamp?: string;
    };
    if (!data) return;

    if (this.hasProcessedOperation(actorSocket.clientId, data.operationId)) {
      return;
    }
    this.recordProcessedOperation(actorSocket.clientId, data.operationId);

    if (Array.isArray(data.messageIds) && data.messageIds.length > 0) {
      const context = this.buildAuthorizationContext(actorSocket);
      const hostEpochSnapshot = context.hostEpoch;
      const uniqueIds = [...new Set(data.messageIds)];

      if (postgres) {
        const client = await postgres.connect();
        try {
          await client.query("BEGIN");

          // Row lock target messages within the scope of this room
          const checkRes = await client.query(
            `SELECT id, room_id, user_id, metadata FROM room_messages 
             WHERE id = ANY($1::uuid[]) AND room_id = $2 
             FOR UPDATE`,
            [uniqueIds, this.roomId]
          );

          // All-or-nothing check: if row count does not match requested unique IDs, foreign or non-existent IDs are present
          if (checkRes.rows.length !== uniqueIds.length) {
            await client.query("ROLLBACK");
            actorSocket.emit("errorMessage", "FORBIDDEN");
            actorSocket.emit("CMD:error", { code: "FORBIDDEN" });
            return;
          }

          // Host epoch revalidation after async row acquisition
          if (this.hostEpoch !== hostEpochSnapshot) {
            await client.query("ROLLBACK");
            actorSocket.emit("errorMessage", "FORBIDDEN");
            actorSocket.emit("CMD:error", { code: "FORBIDDEN" });
            return;
          }

          // Authorize every message individually
          for (const row of checkRes.rows) {
            const isOwn = Boolean(actorSocket.uid && row.user_id && actorSocket.uid === row.user_id);
            const action: RoomAction = isOwn ? "chat:delete_own" : "chat:delete_other";
            const target: ActionTarget = {
              targetMessage: {
                id: row.id,
                roomId: row.room_id,
                authorUid: row.user_id,
              },
            };
            const auth = pureAuthorizeRoomAction(context, action, target);
            if (!auth.allowed) {
              await client.query("ROLLBACK");
              actorSocket.emit("errorMessage", "FORBIDDEN");
              actorSocket.emit("CMD:error", { code: "FORBIDDEN" });
              return; // All-or-nothing guarantee: zero rows modified on partial denial
            }
          }

          await client.query(
            `UPDATE room_messages 
             SET is_deleted = TRUE, deleted_at = NOW(), deleted_by = $2 
             WHERE room_id = $1 AND id = ANY($3::uuid[])`,
            [this.roomId, actorSocket.clientId || actorSocket.uid || "host", uniqueIds]
          );

          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => { });
          console.error("Failed transactional batch deleteChatMessages:", err);
          actorSocket.emit("errorMessage", "FORBIDDEN");
          actorSocket.emit("CMD:error", { code: "FORBIDDEN" });
          return;
        } finally {
          client.release();
        }
      } else {
        // Fallback in memory without postgres
        const isHost = this.canModerate(actorSocket);
        if (!isHost) {
          actorSocket.emit("errorMessage", "FORBIDDEN");
          actorSocket.emit("CMD:error", { code: "FORBIDDEN" });
          return;
        }
      }

      this.io.of(this.roomId).emit("REC:chatMessagesDeleted", {
        eventId: randomUUID(),
        roomId: this.roomId,
        messageIds: uniqueIds,
        deletedBy: actorSocket.clientId,
        timestamp: Date.now(),
      });
      return;
    }

    // Legacy author/timestamp handling
    if (!data.timestamp && !data.author) {
      // Clear all -> requires chat:clear
      const auth = this.authorizeRoomAction({ actorSocket, action: "chat:clear" });
      if (!auth.allowed) {
        actorSocket.emit("errorMessage", "FORBIDDEN");
        return; // Zero mutation on denial
      }
      if (postgres) {
        await postgres.query(`UPDATE room_messages SET is_deleted = TRUE, deleted_at = NOW() WHERE room_id = $1`, [this.roomId]);
      }
    } else if (data.timestamp && data.author) {
      // Delete specific message by author/timestamp
      const isOwn = (actorSocket.clientId && data.author === actorSocket.clientId) || (actorSocket.uid && data.author === actorSocket.uid);
      const action: RoomAction = isOwn ? "chat:delete_own" : "chat:delete_other";
      const auth = this.authorizeRoomAction({
        actorSocket,
        action,
        targetMessageAuthorId: data.author,
      });
      if (!auth.allowed) {
        actorSocket.emit("errorMessage", "FORBIDDEN");
        return; // Zero mutation on denial
      }
      if (postgres) {
        await postgres.query(
          `UPDATE room_messages SET is_deleted = TRUE, deleted_at = NOW() WHERE room_id = $1 AND (user_id = $2 OR metadata->>'clientId' = $2) AND created_at = $3`,
          [this.roomId, data.author, data.timestamp]
        );
      }
    } else if (data.author) {
      // Delete by author
      const isOwn = (actorSocket.clientId && data.author === actorSocket.clientId) || (actorSocket.uid && data.author === actorSocket.uid);
      const action: RoomAction = isOwn ? "chat:delete_own" : "chat:delete_other";
      const auth = this.authorizeRoomAction({
        actorSocket,
        action,
        targetMessageAuthorId: data.author,
      });
      if (!auth.allowed) {
        actorSocket.emit("errorMessage", "FORBIDDEN");
        return; // Zero mutation on denial
      }
      if (postgres) {
        await postgres.query(
          `UPDATE room_messages SET is_deleted = TRUE, deleted_at = NOW() WHERE room_id = $1 AND (user_id = $2 OR metadata->>'clientId' = $2)`,
          [this.roomId, data.author]
        );
      }
    }

    // Refresh for everyone (legacy UI sync)
    const recentMessages = await loadRoomMessages(this.roomId, 50);
    const formattedMessages = recentMessages.map((row: any) => ({
      id: row.metadata?.clientId || row.user_id,
      msg: row.is_deleted ? "This message was deleted." : row.message,
      cmd: row.event_type || undefined,
      timestamp: row.created_at.toISOString(),
      videoTS: row.metadata?.videoTS,
      dbId: row.id,
      isDeleted: Boolean(row.is_deleted),
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
