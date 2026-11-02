import { randomUUID } from "node:crypto";
import { Server, Socket } from "socket.io";
import { TimelineAuthority } from "../timelineAuthority.ts";
import { postgres as defaultPostgres } from "../utils/postgres.ts";
import { notificationService } from "../notifications/notificationService.ts";
import { NotificationType } from "../notifications/notificationTypes.ts";
import config from "../config.ts";

export const EMPTY_ROOM_INACTIVITY_TIMEOUT_MS = 30 * 1000; // 30 seconds

export interface RoomLifecycleDependencies {
  roomId: string;
  io: Server;
  getPostgres?: () => any;
  getStatus: () => 'scheduled' | 'active' | 'inactive' | 'ended' | 'expired';
  setStatus: (status: 'scheduled' | 'active' | 'inactive' | 'ended' | 'expired') => void;
  getExpiresAt: () => Date | undefined;
  setExpiresAt: (expiresAt: Date | undefined) => void;
  getLastUpdateTime: () => Date;
  setLastUpdateTime: (time: Date) => void;
  getOwnerId: () => string;
  getCurrentHostUid: () => string;
  isHostUid: (uid: string) => boolean;
  getRoster: () => User[];
  getTsMap: () => NumberDict;
  getVideo: () => string | null;
  setVideo: (video: string | null) => void;
  getVideoTS: () => number;
  getSubtitle: () => string;
  setSubtitle: (subtitle: string) => void;
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  getPaused: () => boolean;
  setPaused: (paused: boolean) => void;
  getLoop: () => boolean;
  setLoop: (loop: boolean) => void;
  getNameMap: () => StringDict;
  setNameMap: (nameMap: StringDict) => void;
  getPictureMap: () => StringDict;
  setPictureMap: (pictureMap: StringDict) => void;
  getLock: () => string | undefined;
  setLock: (lock: string | undefined) => void;
  getCreator: () => string | undefined;
  setCreator: (creator: string | undefined) => void;
  getPlaylist: () => PlaylistVideo[];
  setPlaylist: (playlist: PlaylistVideo[]) => void;
  getTimeline: () => TimelineAuthority;
  setTimeline: (timeline: TimelineAuthority) => void;
  setLastTsMap: (ts: number) => void;
  scavengeDisconnectedParticipants: (now: number) => void;
  terminateSignalingSession: () => void;
  addChatMessage: (socket: Socket | null, chatMsg: ChatMessageBase) => Promise<any>;
  getConnectedParticipantUids?: () => string[];
}

export class RoomLifecycleCoordinator {
  private deps: RoomLifecycleDependencies;
  private tsInterval: NodeJS.Timeout | undefined = undefined;
  private inactivityTimeout: NodeJS.Timeout | undefined = undefined;

  public constructor(deps: RoomLifecycleDependencies) {
    this.deps = deps;
  }

  private get postgres(): any {
    return this.deps.getPostgres ? this.deps.getPostgres() : defaultPostgres;
  }

  public startPeriodicTicker = (): void => {
    if (this.tsInterval) {
      clearInterval(this.tsInterval);
    }
    this.tsInterval = setInterval(async () => {
      // Scavenge stale disconnected participant admissions beyond grace period
      this.deps.scavengeDisconnectedParticipants(Date.now());

      // Clean up the data of users who aren't in the room anymore
      const memberIds = this.deps.getRoster().map((p) => p.id);
      const tsMap = this.deps.getTsMap();
      Object.keys(tsMap).forEach((key) => {
        if (!memberIds.includes(key)) {
          delete tsMap[key];
        }
      });
      if (this.deps.getVideo()) {
        this.deps.setLastTsMap(Date.now());
        this.deps.io.of(this.deps.roomId).emit("REC:tsMap", tsMap);
        this.deps.io.of(this.deps.roomId).emit("REC:playbackSync", this.deps.getTimeline().generateSyncPayload());
      }
    }, 1000);
  };

  public scheduleInactivityTimeoutIfNeeded = (): void => {
    const actualUsers = this.deps.getRoster().filter((p) => !p.isScreenShare);
    if (actualUsers.length === 0 && this.deps.getStatus() === "active") {
      if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = setTimeout(async () => {
        const currentActualUsers = this.deps.getRoster().filter((p) => !p.isScreenShare);
        if (currentActualUsers.length === 0 && this.deps.getStatus() === "active") {
          this.deps.setStatus("inactive");
          this.deps.setLastUpdateTime(new Date());
          this.deps.io.of(this.deps.roomId).emit("SIGNAL:terminateAndExit", {
            roomId: this.deps.roomId,
            reason: "host_stopped_permanent",
            isPermanent: true,
          });
          this.deps.io.of(this.deps.roomId).emit("ROOM_SESSION_STOPPED", {
            isPermanent: true,
            status: "inactive",
            roomId: this.deps.roomId,
          });

          if (this.postgres) {
            await this.postgres.query(
              "SELECT public.set_room_activity_authoritative($1, 'inactive', NULL)",
              [this.deps.roomId]
            );
          }
        }
      }, EMPTY_ROOM_INACTIVITY_TIMEOUT_MS);
    }
  };

  public clearInactivityTimeout = (): void => {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = undefined;
    }
  };

  public handleHostEntryActivation = async (socket: Socket): Promise<void> => {
    const isAuthorizedHostConnecting = Boolean(
      socket.uid &&
      (socket.uid === this.deps.getOwnerId() || (this.deps.getCurrentHostUid() && socket.uid === this.deps.getCurrentHostUid()))
    );

    const currentStatus = this.deps.getStatus();
    if (isAuthorizedHostConnecting && (currentStatus === "inactive" || currentStatus === "scheduled") && this.postgres) {
      try {
        const activateResult = await this.postgres.query(
          "SELECT public.set_room_activity_authoritative($1, 'active', $2) AS result",
          [this.deps.roomId, socket.uid]
        );
        const res = activateResult?.rows?.[0]?.result;
        if (res?.status === "active") {
          this.deps.setStatus("active");
          this.deps.setExpiresAt(res.expiresAt ? new Date(res.expiresAt) : undefined);
          this.deps.setLastUpdateTime(new Date());
          this.deps.io.of(this.deps.roomId).emit("REC:sessionStarted", {
            status: "active",
            startedBy: socket.uid,
          });
          this.scheduleInactivityTimeoutIfNeeded();

          if (res.transitioned !== false) {
            this.dispatchRoomStartedNotification(socket.uid, res.lifecycleEventId).catch((err) =>
              console.error(`[Lifecycle] Background notification error for ${this.deps.roomId}:`, err)
            );
          }
        } else if (res?.status === "expired") {
          this.deps.setStatus("expired");
        }
      } catch (activationErr) {
        console.error(`[Lifecycle] Failed authoritative room activation on host entry for ${this.deps.roomId}:`, activationErr);
      }
    }
  };

  public startSession = async (socket: Socket): Promise<void> => {
    // 1. Server-authoritative ownership/host check (never trust client isHost)
    if (!socket.uid || (!this.deps.isHostUid(socket.uid) && socket.uid !== this.deps.getOwnerId())) {
      socket.emit("CMD:error", { code: "FORBIDDEN", message: "Only the room host or owner can start the session." });
      return;
    }

    // 2. Guard: only inactive/scheduled rooms can be started
    const status = this.deps.getStatus();
    if (status !== "inactive" && status !== "scheduled") {
      socket.emit("CMD:error", { code: "INVALID_STATE", message: "Room is already active or has ended." });
      return;
    }

    // 3. Atomic DB-first transition (CAS: only transitions if current status allows)
    if (!this.postgres) {
      socket.emit("CMD:error", { code: "SERVICE_UNAVAILABLE", message: "Database unavailable." });
      return;
    }

    try {
      const activateResult = await this.postgres.query(
        "SELECT public.set_room_activity_authoritative($1, 'active', $2) AS result",
        [this.deps.roomId, socket.uid]
      );

      const res = activateResult?.rows?.[0]?.result;
      if (!res || res.status === "expired") {
        this.deps.setStatus("expired");
        socket.emit("CMD:error", { code: "ROOM_EXPIRED", message: "This room has expired." });
        return;
      }

      if (res.status !== "active") {
        socket.emit("CMD:error", { code: "TRANSITION_FAILED", message: "Failed to start the session." });
        return;
      }

      // 4. Only update memory AFTER DB confirms transition
      this.deps.setStatus("active");
      this.deps.setExpiresAt(res.expiresAt ? new Date(res.expiresAt) : undefined);
      this.deps.setLastUpdateTime(new Date());

      // 5. Broadcast to connected sockets (only owner is connected pre-start)
      this.deps.io.of(this.deps.roomId).emit("REC:sessionStarted", {
        status: "active",
        startedBy: socket.uid,
      });

      // 6. System chat message
      this.deps.addChatMessage(null, {
        id: socket.clientId,
        cmd: "system",
        msg: "Host started the watch party.",
      });

      this.scheduleInactivityTimeoutIfNeeded();

      if (res.transitioned !== false) {
        this.dispatchRoomStartedNotification(socket.uid, res.lifecycleEventId).catch((err) =>
          console.error(`[Lifecycle] Background notification error for ${this.deps.roomId}:`, err)
        );
      }
    } catch (err) {
      console.error("CMD:startSession failed:", err);
      socket.emit("CMD:error", { code: "INTERNAL_ERROR", message: "Failed to start session." });
    }
  };

  public dispatchRoomStartedNotification = async (
    actorUid: string,
    lifecycleEventId?: string | null
  ): Promise<void> => {
    if (!this.postgres) return;

    // Explicitly non-transitioning CAS invocations must never trigger notification
    if (lifecycleEventId === null) return;

    try {
      let sessionId = lifecycleEventId;
      if (!sessionId) {
        const eventRes = await this.postgres.query(
          `SELECT id FROM public.room_lifecycle_events
           WHERE "roomId" = $1 AND event = 'room.status_changed' AND "newStatus" = 'active'
           ORDER BY timestamp DESC LIMIT 1`,
          [this.deps.roomId]
        );
        sessionId = eventRes?.rows?.[0]?.id;
      }

      if (!sessionId) {
        // Fallback for mocks and unit tests
        sessionId = randomUUID();
      }

      const roomRes = await this.postgres.query(
        `SELECT "roomTitle" FROM public.rooms WHERE "roomId" = $1 LIMIT 1`,
        [this.deps.roomId]
      );
      const roomTitle = roomRes?.rows?.[0]?.roomTitle || this.deps.roomId;

      const [invitesRes, admissionsRes] = await Promise.all([
        this.postgres.query(
          `SELECT target_user_id AS user_id
           FROM public.room_invitations
           WHERE room_id = $1
             AND target_user_id IS NOT NULL
             AND revoked_at IS NULL
             AND (expires_at IS NULL OR expires_at > now())`,
          [this.deps.roomId]
        ),
        this.postgres.query(
          `SELECT user_id
           FROM public.room_admissions
           WHERE room_id = $1
             AND revoked_at IS NULL`,
          [this.deps.roomId]
        ),
      ]);

      const candidateUserIds = new Set<string>();
      for (const row of invitesRes?.rows || []) {
        if (row.user_id) candidateUserIds.add(String(row.user_id));
      }
      for (const row of admissionsRes?.rows || []) {
        if (row.user_id) candidateUserIds.add(String(row.user_id));
      }

      if (actorUid) {
        candidateUserIds.delete(actorUid);
      }

      if (this.deps.getConnectedParticipantUids) {
        for (const uid of this.deps.getConnectedParticipantUids()) {
          candidateUserIds.delete(uid);
        }
      }

      if (candidateUserIds.size === 0) {
        return;
      }

      const participantUserIds = Array.from(candidateUserIds);
      const appUrl = config.APP_URL || "https://cowatch.tomesphere.in";
      const roomUrl = appUrl
        ? `${appUrl}/watch/${encodeURIComponent(this.deps.roomId)}`
        : `/watch/${encodeURIComponent(this.deps.roomId)}`;

      await notificationService.notifyRoomParticipants({
        roomId: this.deps.roomId,
        ownerUserId: this.deps.getOwnerId(),
        participantUserIds,
        type: NotificationType.ROOM_STARTED,
        title: "Room Started",
        body: `The room "${roomTitle}" has started. Join now to watch together!`,
        metadata: {
          roomId: this.deps.roomId,
          action: "open_room",
          sessionId,
          targetUrl: `/watch/${encodeURIComponent(this.deps.roomId)}`,
        },
        eventIdPrefix: `ROOM_STARTED:${this.deps.roomId}:${sessionId}`,
        emailTemplateKey: "ROOM_STARTED",
        emailPayload: {
          roomTitle,
          roomUrl,
        },
      });
    } catch (err) {
      console.error(
        `[Lifecycle] Failed to dispatch ROOM_STARTED notification for ${this.deps.roomId}:`,
        err
      );
    }
  };

  public serialize = (): string => {
    // We no longer serialize chat messages to memory state
    const chatIDs = new Set<string>();
    const nameMap = this.deps.getNameMap();
    const abbrNameMap: StringDict = {};
    Object.keys(nameMap).forEach((id) => {
      if (chatIDs.has(id)) {
        abbrNameMap[id] = nameMap[id];
      }
    });
    const pictureMap = this.deps.getPictureMap();
    const abbrPictureMap: StringDict = {};
    Object.keys(pictureMap).forEach((id) => {
      if (chatIDs.has(id)) {
        abbrPictureMap[id] = pictureMap[id];
      }
    });
    return JSON.stringify({
      video: this.deps.getVideo(),
      videoTS: this.deps.getVideoTS(),
      subtitle: this.deps.getSubtitle(),
      playbackRate: this.deps.getPlaybackRate(),
      paused: this.deps.getPaused(),
      nameMap: abbrNameMap,
      pictureMap: abbrPictureMap,
      lock: this.deps.getLock(),
      creator: this.deps.getCreator(),
      playlist: this.deps.getPlaylist(),
      loop: this.deps.getLoop(),
    });
  };

  public deserialize = (roomData: string): void => {
    const roomObj = JSON.parse(roomData);
    this.deps.setVideo(roomObj.video);
    if (roomObj.subtitle) {
      this.deps.setSubtitle(roomObj.subtitle);
    }
    if (roomObj.paused !== undefined) {
      this.deps.setPaused(roomObj.paused);
    }
    if (roomObj.nameMap) {
      this.deps.setNameMap(roomObj.nameMap);
    }
    if (roomObj.pictureMap) {
      this.deps.setPictureMap(roomObj.pictureMap);
    }

    if (roomObj.lock) {
      this.deps.setLock(roomObj.lock);
    }
    if (roomObj.creator) {
      this.deps.setCreator(roomObj.creator);
    }
    if (roomObj.playlist) {
      this.deps.setPlaylist(roomObj.playlist);
    }
    if (roomObj.playbackRate) {
      this.deps.setPlaybackRate(roomObj.playbackRate);
    }
    if (roomObj.loop) {
      this.deps.setLoop(roomObj.loop);
    }
    this.deps.setTimeline(new TimelineAuthority({
      anchorTime: roomObj.videoTS || 0,
      anchorWallClock: Date.now(),
      paused: roomObj.paused !== undefined ? roomObj.paused : true,
      playbackRate: roomObj.playbackRate || 1.0,
      mediaSource: roomObj.video || "",
    }));
  };

  public saveRoom = async (): Promise<void> => {
    if (this.postgres) {
      try {
        const roomString = this.serialize();
        await this.postgres.query(
          `UPDATE rooms SET
          "lastUpdateTime" = $1, data = $2
          WHERE "roomId" = $3`,
          [this.deps.getLastUpdateTime() ?? new Date(), roomString, this.deps.roomId],
        );
      } catch (e) {
        console.warn(e);
      }
    }
  };

  public destroy = (): void => {
    if (this.tsInterval) {
      clearInterval(this.tsInterval);
      this.tsInterval = undefined;
    }
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = undefined;
    }
    this.deps.terminateSignalingSession();
  };

  public disconnectAllSockets = (): void => {
    this.deps.io.of(this.deps.roomId).disconnectSockets();
  };
}
