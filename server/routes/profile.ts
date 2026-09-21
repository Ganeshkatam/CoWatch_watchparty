import express from "express";
import { validateUserToken } from "../utils/supabase.ts";
import { consumeRateLimitToken } from "../utils/durableRateLimit.ts";
import {
  validateProfilePatch,
  isValidUuid,
} from "../validation/profileSchemas.ts";
import {
  profileService,
  ProfileDomainError,
} from "../services/profileService.ts";

export function extractBearerToken(req: express.Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== "string") return undefined;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : undefined;
}

export const profileRouter = express.Router();

/**
 * GET /api/profile
 * Retrieves canonical profile for authenticated caller; atomically self-heals if missing.
 */
profileRouter.get("/profile", async (req: express.Request, res: express.Response): Promise<void> => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authorization Bearer token is required",
      },
    });
    return;
  }

  let decoded: any;
  try {
    decoded = await validateUserToken("", token, false);
    if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
      res.status(401).json({
        error: {
          code: "INVALID_TOKEN",
          message: "Session token is invalid or expired",
        },
      });
      return;
    }
  } catch {
    res.status(401).json({
      error: {
        code: "INVALID_TOKEN",
        message: "Failed to validate session token",
      },
    });
    return;
  }

  // Rate limit: 60 req/min
  const rateLimit = await consumeRateLimitToken(`profile:get:${decoded.uid}`, 60, 60);
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many profile requests. Please slow down.",
        retryAfter: rateLimit.retryAfterSeconds,
      },
    });
    return;
  }

  try {
    const profile = await profileService.getOrSelfHealProfile(
      decoded.uid,
      decoded.user_metadata,
      decoded.email
    );
    res.status(200).json({ profile });
  } catch (err: any) {
    console.error("GET /api/profile error:", err);
    res.status(err.statusCode || 500).json({
      error: {
        code: err.code || "INTERNAL_SERVER_ERROR",
        message: err.message || "An unexpected error occurred loading profile",
      },
    });
  }
});

/**
 * PATCH /api/profile
 * Concurrency-safe column-level update of authenticated caller's profile.
 * Rejects unknown and protected fields.
 */
profileRouter.patch("/profile", async (req: express.Request, res: express.Response): Promise<void> => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authorization Bearer token is required",
      },
    });
    return;
  }

  let decoded: any;
  try {
    decoded = await validateUserToken("", token, false);
    if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
      res.status(401).json({
        error: {
          code: "INVALID_TOKEN",
          message: "Session token is invalid or expired",
        },
      });
      return;
    }
  } catch {
    res.status(401).json({
      error: {
        code: "INVALID_TOKEN",
        message: "Failed to validate session token",
      },
    });
    return;
  }

  // Rate limit: 30 req/min
  const rateLimit = await consumeRateLimitToken(`profile:patch:${decoded.uid}`, 30, 60);
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many profile updates. Please slow down.",
        retryAfter: rateLimit.retryAfterSeconds,
      },
    });
    return;
  }

  // Strict payload validation
  const validation = validateProfilePatch(req.body);
  if (!validation.success || !validation.data) {
    res.status(400).json({ error: validation.error });
    return;
  }

  try {
    const updated = await profileService.updateProfile(decoded.uid, validation.data);
    res.status(200).json({ profile: updated });
  } catch (err: any) {
    if (err instanceof ProfileDomainError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
        },
      });
      return;
    }
    console.error("PATCH /api/profile error:", err);
    res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to update profile",
      },
    });
  }
});

/**
 * GET /api/users/:userId/public-profile
 * Authenticated endpoint resolving non-sensitive public profile projection.
 */
profileRouter.get("/users/:userId/public-profile", async (req: express.Request, res: express.Response): Promise<void> => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authorization Bearer token is required",
      },
    });
    return;
  }

  let decoded: any;
  try {
    decoded = await validateUserToken("", token, false);
    if (!decoded || decoded === "EMAIL_NOT_VERIFIED") {
      res.status(401).json({
        error: {
          code: "INVALID_TOKEN",
          message: "Session token is invalid or expired",
        },
      });
      return;
    }
  } catch {
    res.status(401).json({
      error: {
        code: "INVALID_TOKEN",
        message: "Failed to validate session token",
      },
    });
    return;
  }

  const { userId } = req.params;
  if (!isValidUuid(userId)) {
    res.status(400).json({
      error: {
        code: "INVALID_USER_ID",
        message: "User ID must be a valid UUID format",
      },
    });
    return;
  }

  // Anti-enumeration rate limit: 60 req/min per caller
  const rateLimit = await consumeRateLimitToken(`public_profile:get:${decoded.uid}`, 60, 60);
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many lookup requests. Please slow down.",
        retryAfter: rateLimit.retryAfterSeconds,
      },
    });
    return;
  }

  try {
    const publicProfile = await profileService.getPublicProfile(userId);
    res.status(200).json({ profile: publicProfile });
  } catch (err: any) {
    if (err instanceof ProfileDomainError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
        },
      });
      return;
    }
    console.error("GET /api/users/:userId/public-profile error:", err);
    res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to retrieve public profile",
      },
    });
  }
});
