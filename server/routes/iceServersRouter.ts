import express, { type Request, type Response, Router } from "express";
import type { Pool } from "pg";
import type { Room } from "../room.ts";
import { validateUserToken as defaultValidateUserToken } from "../utils/supabase.ts";
import { verifyAdmissionToken as defaultVerifyAdmissionToken } from "../utils/admissionToken.ts";
import { checkRateLimit as defaultCheckRateLimit } from "../utils/rateLimit.ts";
import { CoturnHmacProvider, type TurnProvider } from "../services/turnProvider.ts";
import { sanitizeRoomId as defaultSanitizeRoomId } from "../strip_slashes.ts";

export function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    return token || undefined;
  }
  return undefined;
}

export interface IceServersRouterOptions {
  rooms?: Map<string, Room>;
  postgres?: Pool | null;
  turnProvider?: TurnProvider;
  validateUserTokenFn?: typeof defaultValidateUserToken;
  verifyAdmissionTokenFn?: typeof defaultVerifyAdmissionToken;
  checkRateLimitFn?: typeof defaultCheckRateLimit;
  sanitizeRoomIdFn?: (rawRoomId: string) => string;
}

export function createIceServersRouter(options?: IceServersRouterOptions): Router {
  const router = express.Router();
  const rooms = options?.rooms;
  const postgres = options?.postgres ?? null;
  const turnProvider = options?.turnProvider ?? new CoturnHmacProvider();
  const validateUserToken = options?.validateUserTokenFn ?? defaultValidateUserToken;
  const verifyAdmissionToken = options?.verifyAdmissionTokenFn ?? defaultVerifyAdmissionToken;
  const checkRateLimit = options?.checkRateLimitFn ?? defaultCheckRateLimit;
  const sanitizeRoomId = options?.sanitizeRoomIdFn ?? defaultSanitizeRoomId;

  router.get(["/api/media/ice-servers", "/media/ice-servers"], async (req: Request, res: Response) => {
    // 1. Abuse Protection & Rate Limiting
    const rawForwarded = req.headers["x-forwarded-for"];
    const forwardedIp = Array.isArray(rawForwarded) ? rawForwarded[0] : (rawForwarded ? String(rawForwarded).split(",")[0].trim() : "");
    const ip = forwardedIp || req.ip || req.socket?.remoteAddress || "unknown_ip";
    const rateLimit = await checkRateLimit(`ice_servers:${ip}`, 10, 60);
    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many ICE server requests. Please try again later.",
        },
      });
      return;
    }

    // 2. Dual Authorization & Identity Derivation
    const bearerToken = extractBearerToken(req);
    const admissionTokenHeader = req.headers["x-admission-token"] as string | undefined;
    const rawRoomId = (req.headers["x-room-id"] as string | undefined)?.trim();
    const cleanRoomId = rawRoomId ? sanitizeRoomId(rawRoomId) : "";
    const callerUidHeader = (req.headers["x-caller-uid"] as string | undefined)?.trim();
    const sessionIdHeader = (req.headers["x-session-id"] as string | undefined)?.trim();

    let derivedUserId = "";
    let isGuestAuth = false;

    if (bearerToken) {
      const decoded = await validateUserToken("", bearerToken);
      if (!decoded || decoded === "EMAIL_NOT_VERIFIED" || typeof decoded !== "object" || !decoded.uid) {
        res.status(401).json({
          error: {
            code: "AUTHENTICATION_FAILED",
            message: "Invalid or unverified user token.",
          },
        });
        return;
      }
      derivedUserId = decoded.uid;
    } else if (admissionTokenHeader) {
      if (!cleanRoomId) {
        res.status(400).json({
          error: {
            code: "ROOM_ID_REQUIRED",
            message: "X-Room-Id header is required when authenticating with admission token.",
          },
        });
        return;
      }

      if (!callerUidHeader || !sessionIdHeader) {
        res.status(400).json({
          error: {
            code: "IDENTITY_HEADERS_REQUIRED",
            message: "X-Caller-Uid and X-Session-Id headers are required when authenticating with admission token.",
          },
        });
        return;
      }

      const verification = verifyAdmissionToken(
        admissionTokenHeader,
        cleanRoomId,
        callerUidHeader,
        sessionIdHeader
      );

      if (!verification.valid || !verification.payload) {
        const isIdentityMismatch =
          verification.error === "ADMISSION_TOKEN_USER_MISMATCH" ||
          verification.error === "ADMISSION_TOKEN_SESSION_MISMATCH";
        res.status(isIdentityMismatch ? 403 : 401).json({
          error: {
            code: verification.error || "ADMISSION_TOKEN_INVALID",
            message: isIdentityMismatch
              ? "Caller identity does not match admission token payload."
              : "Invalid or expired room admission token.",
          },
        });
        return;
      }

      derivedUserId = verification.payload.userId;
      isGuestAuth = true;
    } else {
      res.status(401).json({
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication required via Bearer token or X-Admission-Token header.",
        },
      });
      return;
    }

    // 3. Room Expiration & Revocation Validation
    let ttlSeconds = 10800; // Default 3 hours

    if (cleanRoomId) {
      let roomRow: any = null;

      // Check database if postgres available
      if (postgres) {
        try {
          const roomRes = await postgres.query(
            `SELECT status, "isPermanent", "expiresAt", owner_id FROM rooms WHERE "roomId" = $1 LIMIT 1`,
            [cleanRoomId]
          );
          if (roomRes.rows.length > 0) {
            roomRow = roomRes.rows[0];
          }
        } catch (dbErr) {
          console.error("[ICE_SERVERS] Database room lookup error:", dbErr);
        }
      }

      const memoryRoom = rooms?.get(cleanRoomId);

      // Room existence check
      if (!roomRow && !memoryRoom) {
        res.status(404).json({
          error: {
            code: "ROOM_NOT_FOUND",
            message: "The requested room does not exist.",
          },
        });
        return;
      }

      const status = roomRow?.status || (memoryRoom as any)?.status || "active";
      if (status === "ended" || status === "expired") {
        res.status(403).json({
          error: {
            code: "ROOM_EXPIRED",
            message: "This room has ended or expired.",
          },
        });
        return;
      }

      // Ban checks
      if (memoryRoom && typeof (memoryRoom as any).isBanned === "function" && (memoryRoom as any).isBanned(undefined, derivedUserId)) {
        res.status(403).json({
          error: {
            code: "BANNED",
            message: "You have been removed from this room.",
          },
        });
        return;
      }

      if (postgres) {
        try {
          const banRes = await postgres.query(
            `SELECT id FROM room_bans WHERE room_id = $1 AND user_id = $2::uuid LIMIT 1`,
            [cleanRoomId, derivedUserId]
          );
          if (banRes.rows.length > 0) {
            res.status(403).json({
              error: {
                code: "BANNED",
                message: "You have been banned from this room.",
              },
            });
            return;
          }

          // Guest revocation check
          if (isGuestAuth) {
            const admRes = await postgres.query(
              `SELECT revoked_at FROM room_admissions WHERE room_id = $1 AND user_id = $2::uuid ORDER BY admitted_at DESC LIMIT 1`,
              [cleanRoomId, derivedUserId]
            );
            if (admRes.rows.length === 0 || admRes.rows[0].revoked_at) {
              res.status(401).json({
                error: {
                  code: "ADMISSION_REVOKED",
                  message: "Your room admission has been revoked.",
                },
              });
              return;
            }
          }
        } catch (authDbErr) {
          console.error("[ICE_SERVERS] Database ban/admission check error:", authDbErr);
        }
      }

      // TTL Calculation & Clamping
      const isPermanent = Boolean(roomRow?.isPermanent ?? (memoryRoom as any)?.isPermanent);
      const expiresAtRaw = roomRow?.expiresAt ?? (memoryRoom as any)?.expiresAt;

      if (!isPermanent) {
        if (!expiresAtRaw) {
          res.status(500).json({
            error: {
              code: "CORRUPTED_ROOM_EXPIRY",
              message: "Temporary room has no valid expiration timestamp.",
            },
          });
          return;
        }

        const expiresAtTime = new Date(expiresAtRaw).getTime();
        if (Number.isNaN(expiresAtTime)) {
          res.status(500).json({
            error: {
              code: "CORRUPTED_ROOM_EXPIRY",
              message: "Temporary room has an invalid expiration timestamp.",
            },
          });
          return;
        }

        const remainingSeconds = Math.floor((expiresAtTime - Date.now()) / 1000);
        // Safe rejection threshold: reject if room is within 60s of termination
        if (remainingSeconds < 60) {
          res.status(403).json({
            error: {
              code: "ROOM_EXPIRING_IMMINENT",
              message: "Room is ending or has expired.",
            },
          });
          return;
        }

        ttlSeconds = Math.min(10800, remainingSeconds);
      }
    }

    // 4. Generate & Return Ephemeral Credentials
    try {
      const credentials = await turnProvider.generateCredentials({
        userId: derivedUserId,
        roomId: cleanRoomId || "global",
        ttlSeconds,
      });

      res.json(credentials);
    } catch (turnErr) {
      console.error("[ICE_SERVERS] Error generating TURN credentials:", turnErr);
      res.status(500).json({
        error: {
          code: "TURN_GENERATION_FAILED",
          message: "Failed to generate relay credentials.",
        },
      });
    }
  });

  return router;
}
