import { Router, type Request, type Response } from "express";
import {
  supabaseAdmin as defaultSupabaseAdmin,
  deleteUser as defaultDeleteUser,
  getUserByEmail as defaultGetUserByEmail,
} from "../utils/supabase.js";
import {
  checkRateLimit as defaultCheckRateLimit,
  recordAttempt as defaultRecordAttempt,
} from "../utils/rateLimit.js";
import { sendDuplicateSignupSecurityAlert as defaultSendSecurityAlert } from "../notifications/securityAlerts.js";
import { isAllowedEmailDomain as defaultIsAllowedEmailDomain } from "../utils/emailDomain.js";

export interface AuthAccountRouterOptions {
  supabaseAdminClient?: typeof defaultSupabaseAdmin;
  deleteUserFn?: typeof defaultDeleteUser;
  getUserByEmailFn?: typeof defaultGetUserByEmail;
  checkRateLimitFn?: typeof defaultCheckRateLimit;
  recordAttemptFn?: typeof defaultRecordAttempt;
  sendSecurityAlertFn?: typeof defaultSendSecurityAlert;
  isAllowedEmailDomainFn?: typeof defaultIsAllowedEmailDomain;
}

export function createAuthAccountRouter(options: AuthAccountRouterOptions = {}): Router {
  const router = Router();
  const supabaseAdmin = options.supabaseAdminClient || defaultSupabaseAdmin;
  const deleteUser = options.deleteUserFn || defaultDeleteUser;
  const getUserByEmail = options.getUserByEmailFn || defaultGetUserByEmail;
  const checkRateLimit = options.checkRateLimitFn || defaultCheckRateLimit;
  const recordAttempt = options.recordAttemptFn || defaultRecordAttempt;
  const sendDuplicateSignupSecurityAlert = options.sendSecurityAlertFn || defaultSendSecurityAlert;
  const isAllowedEmailDomain = options.isAllowedEmailDomainFn || defaultIsAllowedEmailDomain;

  router.post("/api/auth/validate-email", async (req: Request, res: Response) => {
    const email = req.body?.email;
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "Email is required" });
      return;
    }
    const isAllowed = isAllowedEmailDomain(email);
    if (!isAllowed) {
      res.status(400).json({ error: "Email provider is not supported." });
      return;
    }
    res.json({ valid: true });
  });

  router.post("/api/auth/duplicate-signup-alert", async (req: Request, res: Response) => {
    try {
      const rawEmail = req.body?.email;
      if (!rawEmail || typeof rawEmail !== "string") {
        res.json({ success: true });
        return;
      }

      const email = rawEmail.trim().toLowerCase();
      if (!isAllowedEmailDomain(email)) {
        res.json({ success: true });
        return;
      }

      const clientIp = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      const userAgent = String(req.headers["user-agent"] || "");

      // Rate limit per email (max 3 in 15 min) and per IP (max 10 in 10 min) to prevent abuse
      const emailRateLimit = await checkRateLimit(`dup-signup:email:${email}`, 3, 15 * 60);
      const ipRateLimit = await checkRateLimit(`dup-signup:ip:${clientIp || "unknown"}`, 10, 10 * 60);

      if (!emailRateLimit.allowed || !ipRateLimit.allowed) {
        res.json({ success: true });
        return;
      }

      await recordAttempt(`dup-signup:email:${email}`, 15 * 60);
      await recordAttempt(`dup-signup:ip:${clientIp || "unknown"}`, 10 * 60);

      // Verify whether account exists before sending notification
      const existingUser = await getUserByEmail(email);
      if (!existingUser) {
        // Do not send alert if user does not exist (prevents unsolicited notifications)
        res.json({ success: true });
        return;
      }

      // Trigger security alert email asynchronously without blocking the client response
      sendDuplicateSignupSecurityAlert({
        email,
        ipAddress: clientIp || undefined,
        userAgent: userAgent || undefined,
        attemptedAt: new Date(),
      }).catch((err) => {
        console.error("[Auth] Duplicate signup alert dispatch error:", err);
      });

      res.json({ success: true });
    } catch (err) {
      console.error("[Auth] Duplicate signup alert handler exception:", err);
      res.json({ success: true });
    }
  });

  router.post("/api/account/delete", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or invalid Authorization header" });
        return;
      }
      const token = authHeader.split(" ")[1];

      // Authenticate and get uid
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !user) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }
      const uid = user.id;

      // Clean up Storage (avatars bucket)
      const { data: existingFiles, error: listError } = await supabaseAdmin.storage.from("avatars").list(uid);
      if (listError) {
        console.error("Storage list error during account deletion:", listError);
        res.status(500).json({ error: "Failed to list avatars" });
        return;
      }

      if (existingFiles && existingFiles.length > 0) {
        const filesToRemove = existingFiles.map((f: any) => `${uid}/${f.name}`);
        const { error: removeError } = await supabaseAdmin.storage.from("avatars").remove(filesToRemove);
        if (removeError) {
          console.error("Storage remove error during account deletion:", removeError);
          res.status(500).json({ error: "Failed to delete avatars" });
          return;
        }
      }

      // Delete Auth User (Postgres handles cascades automatically)
      const { error: deleteError } = await deleteUser(uid);
      if (deleteError) {
        console.error("Auth delete error during account deletion:", deleteError);
        res.status(500).json({ error: "Failed to delete auth user" });
        return;
      }

      res.status(204).send();
    } catch (e: any) {
      console.error("Error during account deletion:", e);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
