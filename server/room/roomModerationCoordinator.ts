import { randomUUID } from "crypto";
import type { Server, Socket } from "socket.io";
import { redisCount } from "../utils/redis.ts";
import { postgres as defaultPostgres } from "../utils/postgres.ts";
import { notificationService } from "../notifications/notificationService.ts";
import {
  authorizeRoomAction as pureAuthorizeRoomAction,
  type AuthorizationContext,
  type AuthorizationResult,
  type RoomAction,
  type ActionTarget,
} from "../roomAuthorization.ts";
import type { AdmittedParticipantRecord } from "../room.ts";

export interface RoomMessageRow {
  id: string;
  roomId: string;
  user_id: string;
  message: string;
  message_type: 'user' | 'system';
  event_type?: string | null;
  metadata?: any;
  created_at: Date;
  updated_at?: Date;
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
  metadata: Record<string, unknown> | null = null,
  clientMessageId: string | null = null,
  postgresInstance: any = defaultPostgres
): Promise<RoomMessageRow | null> {
  const db = postgresInstance ?? defaultPostgres;
  if (!db) return null;

  try {
    const result = await db.query(
      `INSERT INTO room_messages (room_id, user_id, message, message_type, event_type, metadata, client_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (room_id, user_id, client_message_id) DO NOTHING
       RETURNING id, room_id as "roomId", user_id, message, message_type, event_type, metadata, created_at, updated_at, is_deleted`,
      [roomId, userId, message, messageType, eventType, metadata, clientMessageId]
    );
    if (result.rowCount === 0 && clientMessageId) {
      // Duplicate client_message_id for this room/user, fetch the existing one
      const existingResult = await db.query(
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

export async function loadRoomMessages(
  roomId: string,
  limit: number = 50,
  beforeCursor?: string | { createdAt: string; id: string },
  postgresInstance: any = defaultPostgres
): Promise<RoomMessageRow[]> {
  const db = postgresInstance ?? defaultPostgres;
  if (!db) return [];

  try {
    let query = `
      SELECT rm.id, rm.room_id as "roomId", rm.user_id, rm.message, rm.message_type, rm.event_type, rm.metadata, rm.created_at, rm.updated_at, rm.is_deleted, p.display_name as profile_name, p.avatar_url as profile_picture
      FROM room_messages rm
      LEFT JOIN profiles p ON rm.user_id = p.id
      WHERE rm.room_id = $1
    `;
    const params: unknown[] = [roomId];

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

    const result = await db.query(query, params);
    return result.rows.reverse(); // Return in chronological order
  } catch (e) {
    console.error("Failed to load room messages:", e);
    return [];
  }
}

export interface RoomModerationOptions {
  roomId: string;
  io: Server;
  socketIdMap: StringDict;
  tsMap: Record<string, number>;
  nameMap: Record<string, string>;
  pictureMap: Record<string, string>;
  clientToUidMap: Record<string, string>;
  bannedIdentities: Set<string>;
  admittedParticipants: Map<string, AdmittedParticipantRecord>;
  admittedMembers: Set<string>;
  postgres?: any;
  getHostEpoch: () => number;
  getIsChatDisabled: () => boolean;
  canModerate: (socket: Socket) => boolean;
  sendRoster: () => void;
  hasProcessedOperation: (clientId: string, opId?: string) => boolean;
  recordProcessedOperation: (clientId: string, opId?: string) => void;
  buildAuthorizationContext: (socket: Socket) => AuthorizationContext;
  authorizeRoomAction: (params: {
    actorSocket: Socket;
    action: RoomAction;
    targetUserId?: string;
    targetMessageAuthorId?: string;
    targetMessageRoomId?: string;
    targetRoomPermanent?: boolean;
    targetRoomState?: string;
  }) => AuthorizationResult;
}

export class RoomModerationCoordinator {
  private readonly options: RoomModerationOptions;

  public constructor(options: RoomModerationOptions) {
    this.options = options;
  }

  public addChatMessage = async (
    socket: Socket | null,
    chatMsg: ChatMessageBase
  ): Promise<void> => {
    if (this.options.getIsChatDisabled() && !chatMsg.cmd) {
      return;
    }
    const chatWithTime: ChatMessage = {
      ...chatMsg,
      timestamp: new Date().toISOString(),
      videoTS: socket?.clientId ? this.options.tsMap[socket.clientId] : undefined,
      name: socket?.clientId ? this.options.nameMap[socket.clientId] : undefined,
      picture: socket?.clientId ? this.options.pictureMap[socket.clientId] : undefined,
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
      this.options.io.of(this.options.roomId).emit("REC:chat", chatWithTime);
      this.options.io.of(this.options.roomId).emit("ROOM_MESSAGE", chatWithTime);
      return;
    }

    // Broadcast immediately in realtime to all clients in the room (zero latency)
    this.options.io.of(this.options.roomId).emit("REC:chat", { ...chatWithTime, userId: socket.uid });
    this.options.io.of(this.options.roomId).emit("ROOM_MESSAGE", { ...chatWithTime, userId: socket.uid });

    // Persist asynchronously in the background so database latency never blocks the live realtime WebSocket loop
    const shouldPersist = !isCmd || (isCmd && ['room.inactive', 'room.reactivated', 'room.expired'].includes(chatMsg.cmd!));
    if (shouldPersist) {
      persistRoomMessage(
        this.options.roomId,
        socket.uid,
        chatMsg.msg || "",
        messageType,
        eventType,
        {
          clientId: socket?.clientId,
          videoTS: chatWithTime.videoTS,
          name: socket?.clientId ? this.options.nameMap[socket.clientId] : undefined,
          picture: socket?.clientId ? this.options.pictureMap[socket.clientId] : undefined,
        },
        chatMsg.clientMessageId,
        this.options.postgres ?? defaultPostgres
      ).then((dbRow) => {
        if (dbRow?.id) {
          const persistedUpdate = {
            ...chatWithTime,
            dbId: dbRow.id,
            userId: socket?.uid,
          };
          this.options.io.of(this.options.roomId).emit("REC:messagePersisted", persistedUpdate);
          this.options.io.of(this.options.roomId).emit("ROOM_MESSAGE_EDITED", persistedUpdate);
        }
      }).catch((err) => {
        console.error("Background message persist error:", err);
        const failurePayload = {
          clientMessageId: chatMsg.clientMessageId,
          roomId: this.options.roomId,
          userId: socket?.uid,
          error: "PERSISTENCE_FAILED",
          timestamp: chatWithTime.timestamp,
        };
        socket?.emit?.("REC:messagePersistFailed", failurePayload);
        socket?.emit?.("ROOM_MESSAGE_ERROR", failurePayload);
        this.options.io.of(this.options.roomId).emit("REC:messagePersistFailed", failurePayload);
      });
    }
  };

  public sendChatMessage = (socket: Socket, raw: unknown): void => {
    // Support legacy string and V2 object chat payloads.
    const payload = typeof raw === "string" ? { msg: raw } : raw;
    if (!payload || typeof payload !== "object") {
      return;
    }

    // Step 1: Pure authorization for chat:send
    const context = this.options.buildAuthorizationContext(socket);
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
    const replyToId = typeof data.replyToId === "string" ? data.replyToId : undefined;
    const replyToTimestamp = typeof data.replyToTimestamp === "string" ? data.replyToTimestamp : undefined;
    const clientMessageId = typeof data.clientMessageId === "string" ? data.clientMessageId : undefined;

    if (!msg || msg.length === 0 || msg.length > 10000) {
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

  public editMessage = async (
    socket: Socket,
    raw: unknown,
    context?: AuthorizationContext
  ): Promise<void> => {
    if (!socket.uid) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
    const data = raw as { messageId: string; newMessage: string };
    if (!data || typeof data.messageId !== 'string' || typeof data.newMessage !== 'string') return;
    const trimmedMsg = data.newMessage.trim();
    if (trimmedMsg.length === 0 || trimmedMsg.length > 50000) return;

    const db = this.options.postgres ?? defaultPostgres;
    if (!db) return;

    const ctx = context ?? this.options.buildAuthorizationContext(socket);
    const hostEpochSnapshot = ctx.hostEpoch;

    try {
      // Step 1: Fetch target message to verify room and authorship
      const existing = await db.query(
        `SELECT id, room_id, user_id FROM room_messages WHERE id = $1`,
        [data.messageId]
      );
      if (existing.rowCount === 0) {
        socket.emit("CMD:error", { code: "FORBIDDEN" });
        return;
      }
      const targetRow = existing.rows[0];

      // Step 2: Host epoch revalidation after async retrieval
      if (this.options.getHostEpoch() !== hostEpochSnapshot) {
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
      const auth = pureAuthorizeRoomAction(ctx, "chat:edit", target);
      if (!auth.allowed) {
        socket.emit("CMD:error", { code: "FORBIDDEN" });
        return;
      }

      // Step 4: Mutate atomically
      const isHostOrOwner = ctx.isHost || ctx.isOwner;
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
        ? [trimmedMsg, data.messageId, this.options.roomId]
        : [trimmedMsg, data.messageId, this.options.roomId, socket.uid];
      const result = await db.query(query, queryParams);

      if (result.rowCount === 0) {
        socket.emit("CMD:error", { code: "FORBIDDEN" });
        return;
      }

      const row = result.rows[0];
      let profile_name, profile_picture;
      const profileResult = await db.query('SELECT display_name, avatar_url FROM profiles WHERE id = $1', [row.user_id]);
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

      this.options.io.of(this.options.roomId).emit("REC:editMessage", updatedMsg);
      this.options.io.of(this.options.roomId).emit("ROOM_MESSAGE_EDITED", updatedMsg);
    } catch (e) {
      console.error("Failed to edit message in postgres:", e);
      socket.emit("CMD:error", { code: "FORBIDDEN" });
    }
  };

  public addReaction = (socket: Socket, raw: unknown): void => {
    const context = this.options.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "chat:reaction");
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
    const data = raw as { value: string; msgId: string; msgTimestamp: string };
    if (!data || !data.value || !data.msgId || !data.msgTimestamp) {
      return;
    }
    if (data.value.length > 8) {
      return;
    }
    const reaction: Reaction = { user: socket.clientId, ...data };
    redisCount("addReaction");
    this.options.io.of(this.options.roomId).emit("REC:addReaction", reaction);
  };

  public removeReaction = (socket: Socket, raw: unknown): void => {
    const context = this.options.buildAuthorizationContext(socket);
    const auth = pureAuthorizeRoomAction(context, "chat:reaction");
    if (!auth.allowed) {
      socket.emit("CMD:error", { code: "FORBIDDEN" });
      return;
    }
    const data = raw as { value: string; msgId: string; msgTimestamp: string };
    if (!data || !data.value || !data.msgId || !data.msgTimestamp) {
      return;
    }
    if (data.value.length > 8) {
      return;
    }
    const reaction: Reaction = { user: socket.clientId, ...data };
    this.options.io.of(this.options.roomId).emit("REC:removeReaction", reaction);
  };

  public deleteChatMessages = async (
    actorSocket: Socket,
    raw: unknown,
    context?: AuthorizationContext
  ): Promise<void> => {
    const data = raw as {
      operationId?: string;
      messageIds?: string[];
      author?: string;
      timestamp?: string;
    };
    if (!data) return;

    if (this.options.hasProcessedOperation(actorSocket.clientId, data.operationId)) {
      return;
    }
    this.options.recordProcessedOperation(actorSocket.clientId, data.operationId);

    const db = this.options.postgres ?? defaultPostgres;

    if (Array.isArray(data.messageIds) && data.messageIds.length > 0) {
      const ctx = context ?? this.options.buildAuthorizationContext(actorSocket);
      const hostEpochSnapshot = ctx.hostEpoch;
      const uniqueIds = [...new Set(data.messageIds)];

      if (db) {
        const client = await db.connect();
        try {
          await client.query("BEGIN");

          // Row lock target messages within the scope of this room
          const checkRes = await client.query(
            `SELECT id, room_id, user_id, metadata FROM room_messages 
             WHERE id = ANY($1::uuid[]) AND room_id = $2 
             FOR UPDATE`,
            [uniqueIds, this.options.roomId]
          );

          // All-or-nothing check: if row count does not match requested unique IDs, foreign or non-existent IDs are present
          if (checkRes.rows.length !== uniqueIds.length) {
            await client.query("ROLLBACK");
            actorSocket.emit("errorMessage", "FORBIDDEN");
            actorSocket.emit("CMD:error", { code: "FORBIDDEN" });
            return;
          }

          // Host epoch revalidation after async row acquisition
          if (this.options.getHostEpoch() !== hostEpochSnapshot) {
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
            const auth = pureAuthorizeRoomAction(ctx, action, target);
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
            [this.options.roomId, actorSocket.clientId || actorSocket.uid || "host", uniqueIds]
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
        const isHost = this.options.canModerate(actorSocket);
        if (!isHost) {
          actorSocket.emit("errorMessage", "FORBIDDEN");
          actorSocket.emit("CMD:error", { code: "FORBIDDEN" });
          return;
        }
      }

      this.options.io.of(this.options.roomId).emit("REC:chatMessagesDeleted", {
        eventId: randomUUID(),
        roomId: this.options.roomId,
        messageIds: uniqueIds,
        deletedBy: actorSocket.clientId,
        timestamp: Date.now(),
      });
      return;
    }

    // Legacy author/timestamp handling
    if (!data.timestamp && !data.author) {
      // Clear all -> requires chat:clear
      const auth = this.options.authorizeRoomAction({ actorSocket, action: "chat:clear" });
      if (!auth.allowed) {
        actorSocket.emit("errorMessage", "FORBIDDEN");
        return; // Zero mutation on denial
      }
      if (db) {
        await db.query(`UPDATE room_messages SET is_deleted = TRUE, deleted_at = NOW() WHERE room_id = $1`, [this.options.roomId]);
      }
    } else if (data.timestamp && data.author) {
      // Delete specific message by author/timestamp
      const isOwn = (actorSocket.clientId && data.author === actorSocket.clientId) || (actorSocket.uid && data.author === actorSocket.uid);
      const action: RoomAction = isOwn ? "chat:delete_own" : "chat:delete_other";
      const auth = this.options.authorizeRoomAction({
        actorSocket,
        action,
        targetMessageAuthorId: data.author,
      });
      if (!auth.allowed) {
        actorSocket.emit("errorMessage", "FORBIDDEN");
        return; // Zero mutation on denial
      }
      if (db) {
        await db.query(
          `UPDATE room_messages SET is_deleted = TRUE, deleted_at = NOW() WHERE room_id = $1 AND (user_id = $2 OR metadata->>'clientId' = $2) AND created_at = $3`,
          [this.options.roomId, data.author, data.timestamp]
        );
      }
    } else if (data.author) {
      // Delete by author
      const isOwn = (actorSocket.clientId && data.author === actorSocket.clientId) || (actorSocket.uid && data.author === actorSocket.uid);
      const action: RoomAction = isOwn ? "chat:delete_own" : "chat:delete_other";
      const auth = this.options.authorizeRoomAction({
        actorSocket,
        action,
        targetMessageAuthorId: data.author,
      });
      if (!auth.allowed) {
        actorSocket.emit("errorMessage", "FORBIDDEN");
        return; // Zero mutation on denial
      }
      if (db) {
        await db.query(
          `UPDATE room_messages SET is_deleted = TRUE, deleted_at = NOW() WHERE room_id = $1 AND (user_id = $2 OR metadata->>'clientId' = $2)`,
          [this.options.roomId, data.author]
        );
      }
    }

    // Refresh for everyone (legacy UI sync)
    const recentMessages = await loadRoomMessages(this.options.roomId, 50, undefined, db);
    const formattedMessages = recentMessages.map((row: any) => ({
      id: row.metadata?.clientId || row.user_id,
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
    this.options.io.of(this.options.roomId).emit("ROOM_MESSAGES", formattedMessages.reverse());
  };

  public kickUser = async (
    actorSocket: Socket,
    targetIdentity: string,
    reason?: string,
    operationId?: string
  ): Promise<void> => {
    const auth = this.options.authorizeRoomAction({
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

    if (this.options.hasProcessedOperation(actorSocket.clientId, operationId)) {
      return;
    }
    this.options.recordProcessedOperation(actorSocket.clientId, operationId);

    this.options.admittedParticipants.delete(targetIdentity);

    const targetSocketId = this.options.socketIdMap[targetIdentity];
    const targetSocket = targetSocketId
      ? this.options.io.of(this.options.roomId).sockets.get(targetSocketId)
      : undefined;

    if (targetSocket) {
      targetSocket.emit("kicked", {
        code: "KICKED_FROM_ROOM",
        message: "You were removed from the room by the host.",
      });
      targetSocket.disconnect(true);
    }

    this.options.sendRoster();
    this.options.io.of(this.options.roomId).emit("REC:participantKicked", {
      eventId: randomUUID(),
      roomId: this.options.roomId,
      targetUserId: targetIdentity,
      kickedBy: actorSocket.clientId,
      reason,
      timestamp: Date.now(),
    });

    const targetUid = this.options.clientToUidMap[targetIdentity] || targetSocket?.uid;
    if (targetUid) {
      this.options.admittedMembers.delete(targetUid);
      const db = this.options.postgres ?? defaultPostgres;
      if (db) {
        db.query(
          `UPDATE public.room_admissions SET revoked_at = now(), revoked_reason = 'kicked' WHERE room_id = $1 AND user_id = $2::uuid`,
          [this.options.roomId, targetUid]
        ).catch((err: any) => console.warn("[Admission] Failed to revoke admission on kick in DB:", err));
      }
      const moderationEventId = operationId || randomUUID();
      notificationService
        .notifyUser({
          userId: targetUid,
          type: "MODERATION_ACTION",
          title: "Removed from room",
          body: reason
            ? `You were removed from room ${this.options.roomId}: ${reason}`
            : `You were removed from room ${this.options.roomId} by the host.`,
          metadata: {
            roomId: this.options.roomId,
            action: "go_home",
            targetUrl: "/",
            moderationType: "kick",
            moderationEventId,
          },
          eventId: `MODERATION_ACTION:${moderationEventId}`,
        })
        .catch((err: any) => console.error("[Notification] Failed to notify kicked user:", err));
    }
  };

  public banUser = async (
    actorSocket: Socket,
    targetIdentity: string,
    reason?: string,
    operationId?: string
  ): Promise<void> => {
    const auth = this.options.authorizeRoomAction({
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

    if (this.options.hasProcessedOperation(actorSocket.clientId, operationId)) {
      return;
    }
    this.options.recordProcessedOperation(actorSocket.clientId, operationId);

    // Record in L1 cache
    this.options.bannedIdentities.add(targetIdentity);
    const targetUid = this.options.clientToUidMap[targetIdentity];
    if (targetUid) {
      this.options.bannedIdentities.add(targetUid);
    }

    // Remove from admitted participants
    this.options.admittedParticipants.delete(targetIdentity);

    if (targetUid) {
      this.options.admittedMembers.delete(targetUid);
      const db = this.options.postgres ?? defaultPostgres;
      if (db) {
        db.query(
          `UPDATE public.room_admissions SET revoked_at = now(), revoked_reason = 'banned' WHERE room_id = $1 AND user_id = $2::uuid`,
          [this.options.roomId, targetUid]
        ).catch((err: any) => console.warn("[Admission] Failed to revoke admission on ban in DB:", err));
      }
      const moderationEventId = operationId || randomUUID();
      notificationService
        .notifyUser({
          userId: targetUid,
          type: "MODERATION_ACTION",
          title: "Banned from room",
          body: reason
            ? `You have been banned from room ${this.options.roomId}: ${reason}`
            : `You have been banned from room ${this.options.roomId} by the host.`,
          metadata: {
            roomId: this.options.roomId,
            action: "go_home",
            targetUrl: "/",
            moderationType: "ban",
            moderationEventId,
          },
          eventId: `MODERATION_ACTION:${moderationEventId}`,
        })
        .catch((err: any) => console.error("[Notification] Failed to notify banned user:", err));
    }

    // Persist to PostgreSQL room_bans table
    const db = this.options.postgres ?? defaultPostgres;
    if (db) {
      try {
        await db.query(
          `INSERT INTO room_bans (room_id, client_identity, user_id, banned_by, reason)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (room_id, client_identity) DO NOTHING`,
          [
            this.options.roomId,
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
    const targetSocketId = this.options.socketIdMap[targetIdentity];
    const targetSocket = targetSocketId
      ? this.options.io.of(this.options.roomId).sockets.get(targetSocketId)
      : undefined;

    if (targetSocket) {
      targetSocket.emit("banned", {
        code: "BANNED_FROM_ROOM",
        message: "You have been removed from this room and cannot rejoin.",
      });
      targetSocket.disconnect(true);
    }

    this.options.sendRoster();
    this.options.io.of(this.options.roomId).emit("REC:participantBanned", {
      eventId: randomUUID(),
      roomId: this.options.roomId,
      targetUserId: targetIdentity,
      bannedBy: actorSocket.clientId,
      reason,
      timestamp: Date.now(),
    });
  };
}
