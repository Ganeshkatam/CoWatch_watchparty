import config from "./config.ts";
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
import { sanitizeRoomId } from "./strip_slashes.ts";
import { TimelineAuthority } from "./timelineAuthority.ts";
import { notificationService } from "./notifications/notificationService.ts";
import { RoomPlaybackCoordinator } from "./room/roomPlaybackCoordinator.ts";
import { LocalMediaAuthority } from "./media/local/LocalMediaAuthority.ts";
import { RoomSignalingCoordinator } from "./room/roomSignalingCoordinator.ts";
import {
  RoomModerationCoordinator,
  persistRoomMessage,
  loadRoomMessages,
  type RoomMessageRow,
} from "./room/roomModerationCoordinator.ts";
import {
  RoomAdmissionCoordinator,
  type AdmittedParticipantRecord,
  ADMISSION_DISCONNECT_GRACE_MS,
} from "./room/roomAdmissionCoordinator.ts";
import {
  RoomHostCoordinator,
  type HostMode,
  type HostTransitionReason,
  HostTransitionUnavailableError,
  type HostAuthorityPayload,
} from "./room/roomHostCoordinator.ts";
import {
  RoomLifecycleCoordinator,
  EMPTY_ROOM_INACTIVITY_TIMEOUT_MS,
} from "./room/roomLifecycleCoordinator.ts";
import type { ServerLocalMediaManifest } from "./media/local/LocalMediaSession.ts";
export function makeHandshakeError(code: string, message: string): Error & { data: { code: string; message: string } } {
  return Object.assign(new Error(code), {
    data: { code, message },
  });
}

export type { RoomMessageRow, AdmittedParticipantRecord, HostMode, HostTransitionReason, HostAuthorityPayload };
export {
  persistRoomMessage,
  loadRoomMessages,
  ADMISSION_DISCONNECT_GRACE_MS,
  RoomAdmissionCoordinator,
  HostTransitionUnavailableError,
  RoomHostCoordinator,
  EMPTY_ROOM_INACTIVITY_TIMEOUT_MS,
  RoomLifecycleCoordinator,
};


// Extend the interface
declare module "socket.io" {
  interface Socket {
    clientId: string;
    uid: string;
  }
}


export type { RoomAction, AuthorizationContext, ActionTarget, AuthorizationResult };

export interface AuthorizeActionParams {
  actorSocket: Socket | null | undefined;
  action: RoomAction;
  targetUserId?: string;
  targetMessageAuthorId?: string;
  targetMessageRoomId?: string;
}

export class Room {
  public sendRoster = () => {
    this.io.of(this.roomId).emit("roster", this.getRosterForApp());
  };
  // Serialized state
  public get video(): string | null {
    return this.playbackCoordinator.video;
  }
  public set video(val: string | null) {
    this.playbackCoordinator.video = val || "";
  }
  public get videoTS(): number {
    return this.playbackCoordinator.videoTS;
  }
  public subtitle = "";
  public get playbackRate(): number {
    return this.playbackCoordinator.playbackRate;
  }
  public set playbackRate(val: number) {
    this.playbackCoordinator.playbackRate = val;
  }
  public get paused(): boolean {
    return this.playbackCoordinator.paused;
  }
  public set paused(val: boolean) {
    this.playbackCoordinator.paused = val;
  }
  public get loop(): boolean {
    return this.playbackCoordinator.loop;
  }
  public set loop(val: boolean) {
    this.playbackCoordinator.loop = val;
  }
  private chat: ChatMessage[] = [];
  public nameMap: StringDict = {};
  public pictureMap: StringDict = {};
  private uidToNameMap: StringDict = {};
  private uidToPictureMap: StringDict = {};

  public creator: string | undefined = undefined; // email of the user who created the room (just used for stats)
  public lock: string | undefined = undefined; // uid of the user who locked the room
  public get playlist(): PlaylistVideo[] {
    return this.playbackCoordinator.playlist;
  }
  public set playlist(val: PlaylistVideo[]) {
    this.playbackCoordinator.playlist = val;
  }

  // Non-serialized state
  public roomId: string;
  public roster: User[] = [];
  public get lastTsMap(): number {
    return this.playbackCoordinator.lastTsMap;
  }
  public set lastTsMap(val: number) {
    this.playbackCoordinator.lastTsMap = val;
  }
  public tsMap: NumberDict = {};
  private io: Server;
  private socketIdMap: StringDict = {};
  public isChatDisabled: boolean | undefined = undefined;
  public status: 'scheduled' | 'active' | 'inactive' | 'ended' | 'expired' = 'inactive';
  public expiresAt: Date | undefined = undefined;
  public startedAt: Date | undefined = undefined;
  public owner_id: string = '';
  public get currentHostClientId(): string {
    return this.hostCoordinator.currentHostClientId;
  }
  public set currentHostClientId(val: string) {
    this.hostCoordinator.currentHostClientId = val;
  }
  public get currentHostUid(): string {
    return this.hostCoordinator.currentHostUid;
  }
  public set currentHostUid(val: string) {
    this.hostCoordinator.currentHostUid = val;
  }
  public get hostMode(): HostMode {
    return this.hostCoordinator.hostMode;
  }
  public set hostMode(val: HostMode) {
    this.hostCoordinator.hostMode = val;
  }
  public get hostEpoch(): number {
    return this.hostCoordinator.hostEpoch;
  }
  public set hostEpoch(val: number) {
    this.hostCoordinator.hostEpoch = val;
  }
  public get admittedMembers(): Set<string> {
    return this.admissionCoordinator.admittedMembers;
  }
  private clientToUidMap: StringDict = {};
  public roomTitle: string | undefined = undefined;
  public roomDescription: string | undefined = undefined;
  public mediaPath: string | undefined = undefined;
  public isPermanent: boolean = false;
  public lastUpdateTime: Date = new Date();
  public get participantsLocked(): boolean {
    return this.admissionCoordinator.participantsLocked;
  }
  public set participantsLocked(val: boolean) {
    this.admissionCoordinator.participantsLocked = val;
  }
  public get maxParticipants(): number {
    return this.admissionCoordinator.maxParticipants;
  }
  public set maxParticipants(val: number) {
    this.admissionCoordinator.maxParticipants = val;
  }
  public get admittedParticipants(): Map<string, AdmittedParticipantRecord> {
    return this.admissionCoordinator.admittedParticipants;
  }
  private bannedIdentities: Set<string> = new Set();
  private processedOperations: Map<string, { operationId: string; timestamp: number }[]> = new Map();
  public get timeline(): TimelineAuthority {
    return this.playbackCoordinator.timeline;
  }
  public set timeline(val: TimelineAuthority) {
    this.playbackCoordinator.timeline = val;
  }
  public get preventTSUpdate(): boolean {
    return this.playbackCoordinator.preventTSUpdate;
  }
  public set preventTSUpdate(val: boolean) {
    this.playbackCoordinator.preventTSUpdate = val;
  }
  public signalingCoordinator: RoomSignalingCoordinator;
  public moderationCoordinator: RoomModerationCoordinator;
  public playbackCoordinator: RoomPlaybackCoordinator;
  public admissionCoordinator: RoomAdmissionCoordinator;
  public hostCoordinator: RoomHostCoordinator;
  public lifecycleCoordinator: RoomLifecycleCoordinator;
  public get localMediaAuthority(): LocalMediaAuthority {
    return this.signalingCoordinator.localMediaAuthority;
  }

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

  public addBannedIdentity = (identity: string): void => {
    if (identity) this.bannedIdentities.add(identity);
  };

  public hasParticipantUid = (uid: string): boolean => {
    return this.admissionCoordinator.hasParticipantUid(uid);
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
    return this.admissionCoordinator.isRoomFull(isOwner, sessionHint, uid);
  };

  public recordAdmittedParticipant = (clientId: string, sessionId?: string, uid?: string): void => {
    this.admissionCoordinator.recordAdmittedParticipant(clientId, sessionId, uid);
  };

  public isParticipantEligibleForHost = (clientId: string): boolean => {
    return this.admissionCoordinator.isParticipantEligibleForHost(clientId);
  };

  public isHostUid = (uid: string): boolean => {
    return this.hostCoordinator.isHostUid(uid);
  };

  public isHostPresent = (): boolean => {
    return this.admissionCoordinator.isHostPresent();
  };

  public getConnectedParticipantUids = (): string[] => {
    return this.admissionCoordinator.getConnectedParticipantUids();
  };

  public getEligibleParticipants = (excludeClientId?: string): { clientId: string; record: AdmittedParticipantRecord }[] => {
    return this.admissionCoordinator.getEligibleParticipants(excludeClientId);
  };

  public removeParticipant = (clientId: string, uid?: string): void => {
    this.admissionCoordinator.removeParticipant(clientId, uid);
  };

  public getHostMode = (): HostMode => {
    return this.hostCoordinator.getHostMode();
  };

  public withHostTransitionLease = async <T>(
    action: () => Promise<T>,
  ): Promise<T> => {
    return this.hostCoordinator.withHostTransitionLease(action);
  };

  public verifyAdmittedSession = (sessionHint?: string, uid?: string): boolean => {
    return this.admissionCoordinator.verifyAdmittedSession(sessionHint, uid);
  };

  public verifyAdmittedParticipant = (clientIdOrSessionHint: string, sessionId?: string): boolean => {
    return this.admissionCoordinator.verifyAdmittedParticipant(clientIdOrSessionHint, sessionId);
  };
  // Not really a queue since there's no ordering, we just retry as long as this is set
  // If we want a real queue then we need external processing of the jobs and a way to update the room from outside


  constructor(
    io: Server,
    roomId: string,
    roomData?: string | null | undefined,
  ) {
    this.roomId = sanitizeRoomId(roomId);
    this.io = io;
    this.admissionCoordinator = new RoomAdmissionCoordinator({
      roomId: this.roomId,
      getOwnerId: () => this.owner_id,
      getCurrentHostClientId: () => this.currentHostClientId,
      getClientToUidMap: () => this.clientToUidMap,
      getNameMap: () => this.nameMap,
      getPictureMap: () => this.pictureMap,
      getUidToNameMap: () => this.uidToNameMap,
      getUidToPictureMap: () => this.uidToPictureMap,
      getRoster: () => this.roster,
    });

    this.hostCoordinator = new RoomHostCoordinator({
      roomId: this.roomId,
      io: this.io,
      getOwnerId: () => this.owner_id,
      getClientToUidMap: () => this.clientToUidMap,
      getNameMap: () => this.nameMap,
      isParticipantEligibleForHost: (clientId) => this.admissionCoordinator.isParticipantEligibleForHost(clientId),
      getEligibleParticipants: (excludeClientId) => this.admissionCoordinator.getEligibleParticipants(excludeClientId),
      buildAuthorizationContext: (socket) => this.buildAuthorizationContext(socket),
      authorizeRoomAction: (params) => this.authorizeRoomAction(params),
      addChatMessage: (socket, chatMsg) => this.addChatMessage(socket, chatMsg),
      getRoomStateBroadcastDetails: () => ({
        isChatDisabled: this.isChatDisabled,
        roomTitle: this.roomTitle,
        roomDescription: this.roomDescription,
        mediaPath: this.mediaPath,
        participantsLocked: this.participantsLocked,
        maxParticipants: this.maxParticipants,
      }),
    });

    this.signalingCoordinator = new RoomSignalingCoordinator({
      roomId: this.roomId,
      io: this.io,
      socketIdMap: this.socketIdMap,
      roster: this.roster,
      postgres,
      getRosterForApp: () => this.getRosterForApp(),
      setMediaSource: (socket, mediaUrl) => this.cmdHost(socket, mediaUrl),
      buildAuthorizationContext: (socket) => this.buildAuthorizationContext(socket),
    });

    this.moderationCoordinator = new RoomModerationCoordinator({
      roomId: this.roomId,
      io: this.io,
      socketIdMap: this.socketIdMap,
      tsMap: this.tsMap,
      nameMap: this.nameMap,
      pictureMap: this.pictureMap,
      clientToUidMap: this.clientToUidMap,
      bannedIdentities: this.bannedIdentities,
      admittedParticipants: this.admissionCoordinator.admittedParticipants,
      admittedMembers: this.admissionCoordinator.admittedMembers,
      postgres,
      getHostEpoch: () => this.hostEpoch,
      getIsChatDisabled: () => Boolean(this.isChatDisabled),
      canModerate: (socket) => this.canModerate(socket),
      sendRoster: () => this.sendRoster(),
      hasProcessedOperation: (clientId, opId) => this.hasProcessedOperation(clientId, opId),
      recordProcessedOperation: (clientId, opId) => this.recordProcessedOperation(clientId, opId),
      buildAuthorizationContext: (socket) => this.buildAuthorizationContext(socket),
      authorizeRoomAction: (params) => this.authorizeRoomAction(params),
    });

    this.playbackCoordinator = new RoomPlaybackCoordinator({
      roomId: this.roomId,
      io: this.io,
      tsMap: this.tsMap,
      canControlPlayback: (socket) => this.canControlPlayback(socket),
      hasProcessedOperation: (clientId, opId) => this.hasProcessedOperation(clientId, opId),
      recordProcessedOperation: (clientId, opId) => this.recordProcessedOperation(clientId, opId),
      addChatMessage: (socket, chatMsg) => this.addChatMessage(socket, chatMsg),
      terminateSignalingSession: () => this.signalingCoordinator.terminateSession(),
      sendRoster: () => this.sendRoster(),
      getHostState: () => this.getHostState(),
      resetSubtitle: () => {
        this.subtitle = "";
      },
    });

    this.lifecycleCoordinator = new RoomLifecycleCoordinator({
      roomId: this.roomId,
      io: this.io,
      getPostgres: () => postgres,
      getStatus: () => this.status,
      setStatus: (status) => {
        this.status = status;
      },
      getExpiresAt: () => this.expiresAt,
      setExpiresAt: (expiresAt) => {
        this.expiresAt = expiresAt;
      },
      getLastUpdateTime: () => this.lastUpdateTime,
      setLastUpdateTime: (time) => {
        this.lastUpdateTime = time;
      },
      getOwnerId: () => this.owner_id,
      getCurrentHostUid: () => this.currentHostUid,
      isHostUid: (uid) => this.isHostUid(uid),
      getRoster: () => this.roster,
      getTsMap: () => this.tsMap,
      getVideo: () => this.video,
      setVideo: (video) => {
        this.video = video;
      },
      getVideoTS: () => this.videoTS,
      getSubtitle: () => this.subtitle,
      setSubtitle: (subtitle) => {
        this.subtitle = subtitle;
      },
      getPlaybackRate: () => this.playbackRate,
      setPlaybackRate: (rate) => {
        this.playbackRate = rate;
      },
      getPaused: () => this.paused,
      setPaused: (paused) => {
        this.paused = paused;
      },
      getLoop: () => this.loop,
      setLoop: (loop) => {
        this.loop = loop;
      },
      getNameMap: () => this.nameMap,
      setNameMap: (nameMap) => {
        this.nameMap = nameMap;
      },
      getPictureMap: () => this.pictureMap,
      setPictureMap: (pictureMap) => {
        this.pictureMap = pictureMap;
      },
      getLock: () => this.lock,
      setLock: (lock) => {
        this.lock = lock;
      },
      getCreator: () => this.creator,
      setCreator: (creator) => {
        this.creator = creator;
      },
      getPlaylist: () => this.playlist,
      setPlaylist: (playlist) => {
        this.playlist = playlist;
      },
      getTimeline: () => this.timeline,
      setTimeline: (timeline) => {
        this.timeline = timeline;
      },
      setLastTsMap: (ts) => {
        this.lastTsMap = ts;
      },
      scavengeDisconnectedParticipants: (now) => this.admissionCoordinator.scavengeDisconnectedParticipants(now),
      terminateSignalingSession: () => this.signalingCoordinator.terminateSession(),
      addChatMessage: (socket, chatMsg) => this.addChatMessage(socket, chatMsg),
      getConnectedParticipantUids: () => this.getConnectedParticipantUids(),
    });

    if (roomData) {
      this.deserialize(roomData);
    }

    this.lifecycleCoordinator.startPeriodicTicker();

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
            next(makeHandshakeError("BANNED_FROM_ROOM", "You have been removed from this room and cannot rejoin."));
            return;
          }
        } catch (dbErr) {
          console.error("Failed to check room_bans in postgres:", dbErr);
          next(makeHandshakeError("SERVICE_UNAVAILABLE", "Unable to verify authorization state. Please try again."));
          return;
        }
      }

      if (this.isBanned(clientId, authUid)) {
        next(makeHandshakeError("BANNED_FROM_ROOM", "You have been removed from this room and cannot rejoin."));
        return;
      }

      // LOCK-001 Invariant: Evaluate participants_locked at final server-side admission boundary.
      // Flow: Creds -> Room/Passcode verify -> participants_locked?
      // - False: admit.
      // - True: admit ONLY IF owner OR authoritative server-side existing identity. Otherwise, reject PARTICIPANTS_LOCKED.
      if (this.participantsLocked && !isOwner) {
        const isAdmitted = this.verifyAdmittedSession(sessionId, authUid);
        if (!isAdmitted) {
          next(makeHandshakeError("PARTICIPANTS_LOCKED", "This room is currently locked to existing participants."));
          return;
        }
      }

      // MEMBER-001 Invariant: Capacity Authority
      // Flow: Creds -> Lock Policy -> Existing Session -> Capacity Check -> ADMIT or ROOM_FULL
      // - If room is full, reject with ROOM_FULL unless owner or existing admitted session reconnecting
      if (this.isRoomFull(isOwner, sessionId, authUid)) {
        next(makeHandshakeError("ROOM_FULL", "This room has reached its participant limit."));
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
      this.signalingCoordinator.registerPeer(clientId, effectiveUserId, socket.id);
      const initialName = this.nameMap[clientId] || (socket.uid ? this.uidToNameMap[socket.uid] : undefined);
      const initialPicture = this.pictureMap[clientId] || (socket.uid ? this.uidToPictureMap[socket.uid] : undefined);
      const existingUser = this.roster.find(user => user.id === clientId);
      if (!existingUser) {
        this.roster.push({ id: clientId, name: initialName, picture: initialPicture });
      } else {
        if (initialName && !existingUser.name) existingUser.name = initialName;
        if (initialPicture && !existingUser.picture) existingUser.picture = initialPicture;
      }

      this.lifecycleCoordinator.clearInactivityTimeout();

      socket.on("disconnect", () => this.onDisconnect(socket));
      // -- End socket state initialization --

      // Preserve uid if already set by the middleware (owner auth bypass)
      if (!socket.uid) {
        socket.uid = "";
      } else {
        this.clientToUidMap[clientId] = socket.uid;
      }

      // Initial host or owner reclaim handling
      await this.hostCoordinator.handleInitialHost(socket, clientId);

      // Authoritative Session Activation on Host Entry:
      await this.lifecycleCoordinator.handleHostEntryActivation(socket);

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
        const opId = (typeof data === "object" && data !== null && "operationId" in data)
          ? String((data as { operationId?: unknown }).operationId)
          : undefined;
        this.playVideo(socket, opId);
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
        const opId = (typeof data === "object" && data !== null && "operationId" in data)
          ? String((data as { operationId?: unknown }).operationId)
          : undefined;
        this.pauseVideo(socket, opId);
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
        let seekPayload: number | { time: number; operationId?: string };
        if (typeof data === "number") {
          seekPayload = data;
        } else if (typeof data === "object" && data !== null && "time" in data) {
          const d = data as { time: unknown; operationId?: unknown };
          seekPayload = {
            time: Number(d.time) || 0,
            operationId: d.operationId ? String(d.operationId) : undefined,
          };
        } else {
          seekPayload = Number(data) || 0;
        }
        this.seekVideo(socket, seekPayload);
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
        let ratePayload: number | { rate: number; operationId?: string };
        if (typeof data === "number") {
          ratePayload = data;
        } else if (typeof data === "object" && data !== null && "rate" in data) {
          const d = data as { rate: unknown; operationId?: unknown };
          ratePayload = {
            rate: Number(d.rate) || 1,
            operationId: d.operationId ? String(d.operationId) : undefined,
          };
        } else {
          ratePayload = Number(data) || 1;
        }
        this.setPlaybackRate(socket, ratePayload);
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
      socket.on("CMD:joinVideo", () => validateNotExpired() && this.signalingCoordinator.joinVideo(socket));
      socket.on("CMD:leaveVideo", () => validateNotExpired() && this.signalingCoordinator.leaveVideo(socket));
      socket.on("CMD:joinScreenShare", (data) => {
        if (!validateNotExpired()) return;
        const context = this.buildAuthorizationContext(socket);
        const auth = pureAuthorizeRoomAction(context, "room:set_media");
        if (!auth.allowed) {
          socket.emit("CMD:error", { code: "FORBIDDEN" });
          socket.emit("errorMessage", "FORBIDDEN");
          return;
        }
        this.signalingCoordinator.joinScreenSharing(socket, data);
      });
      socket.on("CMD:userMute", (data: unknown) =>
        validateNotExpired() && this.signalingCoordinator.setUserMute(socket, data),
      );
      socket.on("CMD:leaveScreenShare", () => validateNotExpired() && this.signalingCoordinator.leaveScreenSharing(socket));

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
        const locked = Boolean((data as { locked?: unknown })?.locked);
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
        validateNotExpired() && this.signalingCoordinator.sendSignal(socket, data, "signal"),
      );
      socket.on("signalSS", (data: unknown) =>
        validateNotExpired() && this.signalingCoordinator.sendSignal(socket, data, "signalSS"),
      );

      // LOCAL-MEDIA-001: P2P Local Media distribution commands
      socket.on("CMD_LOCAL_MEDIA_ANNOUNCE", async (data: { roomId: string; manifest: ServerLocalMediaManifest }) => {
        if (!validateNotExpired()) return;
        await this.signalingCoordinator.handleLocalMediaAnnounce(socket, data);
      });

      socket.on("CMD_LOCAL_MEDIA_SIGNAL", (data: any) => {
        if (!validateNotExpired()) return;
        this.signalingCoordinator.handleLocalMediaSignal(socket, data);
      });

      socket.on("CMD_LOCAL_MEDIA_AVAILABILITY", (data: any) => {
        if (!validateNotExpired()) return;
        this.signalingCoordinator.handleLocalMediaAvailability(socket, data);
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

  public serialize = (): string => {
    return this.lifecycleCoordinator.serialize();
  };

  private deserialize = (roomData: string): void => {
    this.lifecycleCoordinator.deserialize(roomData);
  };

  public saveRoom = async (): Promise<void> => {
    return this.lifecycleCoordinator.saveRoom();
  };

  public destroy = (): void => {
    this.lifecycleCoordinator.destroy();
    this.admissionCoordinator.admittedParticipants.clear();
    this.admissionCoordinator.admittedMembers.clear();
    this.roster = [];
    this.socketIdMap = {};
    this.tsMap = {};
    this.clientToUidMap = {};
    this.nameMap = {};
    this.pictureMap = {};
    this.uidToNameMap = {};
    this.uidToPictureMap = {};
    this.playlist = [];
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
    return this.hostCoordinator.isHost(socket);
  };

  public getHostDisplayName = (): string => {
    return this.hostCoordinator.getHostDisplayName();
  };

  public getHostAuthorityPayload = (reason: HostTransitionReason = "initial"): HostAuthorityPayload => {
    return this.hostCoordinator.getHostAuthorityPayload(reason);
  };

  public broadcastHostChange = (reason: HostTransitionReason): void => {
    this.hostCoordinator.broadcastHostChange(reason);
  };

  public reclaimHostForOwner = async (ownerSocket: Socket): Promise<boolean> => {
    return this.hostCoordinator.reclaimHostForOwner(ownerSocket);
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
    return this.hostCoordinator.transferHost(socket, targetClientId);
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
    return this.hostCoordinator.assignHost(socket, newHostClientId);
  };

  public handleHostDisconnect = async (departingClientId: string): Promise<void> => {
    return this.hostCoordinator.handleHostDisconnect(departingClientId);
  };

  public handleInitialHost = async (socket: Socket, clientId: string): Promise<void> => {
    return this.hostCoordinator.handleInitialHost(socket, clientId);
  };



  public cmdHost = (socket: Socket | null, data: string) => {
    this.playbackCoordinator.cmdHost(socket, data);
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
    return this.moderationCoordinator.addChatMessage(socket, chatMsg);
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
      this.io.of(this.roomId).emit("REC:hostAuthority", {
        hostId: this.currentHostUid || this.currentHostClientId,
        hostClientId: this.currentHostClientId,
        mode: this.getHostMode(),
        reason: "name_update",
        hostName: data,
        isOwner: this.getHostMode() === "owner",
      });
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
    await this.playbackCoordinator.startHosting(socket, data);
  };

  private playlistNext = (raw: unknown) => {
    this.playbackCoordinator.playlistNext(raw);
  };

  public playlistAdd = async (socket: Socket | null, data: string) => {
    await this.playbackCoordinator.playlistAdd(socket, data);
  };

  private playlistDelete = (index: number) => {
    this.playbackCoordinator.playlistDelete(index);
  };

  private playlistMove = (raw: unknown) => {
    this.playbackCoordinator.playlistMove(raw);
  };

  public playVideo = (socket: Socket, operationId?: string) => {
    if (!this.canControlPlayback(socket)) {
      socket.emit("CMD:error", "Playback controls are locked to the host.");
      return;
    }
    this.playbackCoordinator.playVideo(socket, operationId);
  };

  public pauseVideo = (socket: Socket, operationId?: string) => {
    if (!this.canControlPlayback(socket)) {
      socket.emit("CMD:error", "Playback controls are locked to the host.");
      return;
    }
    this.playbackCoordinator.pauseVideo(socket, operationId);
  };

  public startSession = async (socket: Socket): Promise<void> => {
    return this.lifecycleCoordinator.startSession(socket);
  };

  public dispatchRoomStartedNotification = (actorUid: string, lifecycleEventId?: string | null): Promise<void> => {
    return this.lifecycleCoordinator.dispatchRoomStartedNotification(actorUid, lifecycleEventId);
  };

  public seekVideo = (socket: Socket, data: number | { time: number; operationId?: string }) => {
    if (!this.canControlPlayback(socket)) {
      socket.emit("CMD:error", "Playback controls are locked to the host.");
      return;
    }
    this.playbackCoordinator.seekVideo(socket, data);
  };

  public setPlaybackRate = (socket: Socket, data: number | { rate: number; operationId?: string }) => {
    if (!this.canControlPlayback(socket)) {
      socket.emit("CMD:error", "Playback controls are locked to the host.");
      return;
    }
    this.playbackCoordinator.setPlaybackRate(socket, data);
  };

  private setLoop = (data: boolean) => {
    this.playbackCoordinator.setLoop(data);
  };

  private setTimestamp = (socket: Socket, data: number) => {
    this.playbackCoordinator.setTimestamp(socket, data);
  };

  private isValidChatMessage = (msg: string | undefined) => {
    return Boolean(msg && msg.length <= 10000);
  };

  private sendChatMessage = (socket: Socket, raw: unknown) => {
    const context = this.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "chat:send");
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      socket.emit("errorMessage", "FORBIDDEN");
      return;
    }
    this.moderationCoordinator.sendChatMessage(socket, raw);
  };

  private editMessage = async (socket: Socket, raw: unknown) => {
    const context = this.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "chat:edit");
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
    await this.moderationCoordinator.editMessage(socket, raw, context);
  };

  private addReaction = (socket: Socket, raw: unknown) => {
    const context = this.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "chat:reaction");
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
    this.moderationCoordinator.addReaction(socket, raw);
  };

  private removeReaction = (socket: Socket, raw: unknown) => {
    const context = this.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "chat:reaction");
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
    this.moderationCoordinator.removeReaction(socket, raw);
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



  public scheduleInactivityTimeoutIfNeeded = (): void => {
    this.lifecycleCoordinator.scheduleInactivityTimeoutIfNeeded();
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
      this.signalingCoordinator.unregisterPeer(clientId, socket.id);

      // Transition admitted participant to disconnected state with timestamp for grace period
      this.admissionCoordinator.handleParticipantDisconnect(clientId);

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
        this.hostCoordinator.handleHostDisconnect(clientId);
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
    await this.moderationCoordinator.kickUser(actorSocket, targetIdentity, reason, operationId);
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
    await this.moderationCoordinator.banUser(actorSocket, targetIdentity, reason, operationId);
  };

  public disconnectAllSockets = () => {
    this.lifecycleCoordinator.disconnectAllSockets();
  };

  public deleteChatMessages = async (actorSocket: Socket, raw: unknown) => {
    const context = this.buildAuthorizationContext(actorSocket);
    const auth = pureAuthorizeRoomAction(context, "chat:delete_own");
    if (!auth.allowed && !context.isHost && !context.isOwner) {
      actorSocket.emit("errorMessage", "FORBIDDEN");
      actorSocket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
    await this.moderationCoordinator.deleteChatMessages(actorSocket, raw, context);
  };
}

function isValidUUID(id: string) {
  return /^[0-9A-F]{8}-[0-9A-F]{4}-[4][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i.test(
    id,
  );
}
