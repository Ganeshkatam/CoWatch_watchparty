import { Router, type Request, type Response, type NextFunction } from "express";
import config from "../config.js";
import { providerWebhookRouter as defaultProviderWebhookRouter } from "../notifications/webhooks/providerWebhookRouter.js";
import { getNotificationHealthReport as defaultGetNotificationHealthReport } from "../notifications/notificationTelemetry.js";

export function defaultRequireInternalAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = config.INTERNAL_API_SECRET;
  if (!secret) {
    const socketAddress = String(req.socket?.remoteAddress || "");
    const isLoopback = socketAddress.includes("127.0.0.1") || socketAddress === "::1" || socketAddress === "::ffff:127.0.0.1";
    if (!isLoopback && process.env.NODE_ENV === "production") {
      res.status(403).json({ error: "FORBIDDEN: Internal endpoint accessible only via loopback or INTERNAL_API_SECRET" });
      return;
    }
    return next();
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : req.headers["x-internal-secret"];
  if (token !== secret) {
    res.status(401).json({ error: "UNAUTHORIZED: Valid INTERNAL_API_SECRET required" });
    return;
  }
  next();
}

export interface InternalOperationsRouterOptions {
  providerWebhookRouterInstance?: { handleWebhook: (req: Request, res: Response) => Promise<void> };
  getNotificationHealthReportFn?: () => Promise<any>;
  requireInternalAuthMiddleware?: (req: Request, res: Response, next: NextFunction) => void;
}

export function createInternalOperationsRouter(options: InternalOperationsRouterOptions = {}): Router {
  const router = Router();
  const providerWebhookRouter = options.providerWebhookRouterInstance || defaultProviderWebhookRouter;
  const getNotificationHealthReport = options.getNotificationHealthReportFn || defaultGetNotificationHealthReport;
  const requireInternalAuth = options.requireInternalAuthMiddleware || defaultRequireInternalAuth;

  // Root health probe preserved at exact /ping path
  router.get("/ping", (_req: Request, res: Response) => {
    res.json("pong");
  });

  // NOTIFY-002: Universal Provider Delivery Webhook Ingress
  router.post("/internal/webhooks/email/:provider", async (req: Request, res: Response) => {
    await providerWebhookRouter.handleWebhook(req, res);
  });

  // NOTIFY-001A & NOTIFY-004: Database-derived Notification Health Probe
  router.get("/internal/health/notifications", requireInternalAuth, async (_req: Request, res: Response) => {
    try {
      const report = await getNotificationHealthReport();
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: "HEALTH_CHECK_FAILED", details: err?.message });
    }
  });

  // TURN Relay Infrastructure Health Probe
  router.get("/internal/health/relay", requireInternalAuth, (_req: Request, res: Response) => {
    const isConfigured = Boolean(config.TURN_SHARED_SECRET && config.TURN_HOST);
    const isMisconfigured = Boolean(
      (config.TURN_SHARED_SECRET && !config.TURN_HOST) ||
      (!config.TURN_SHARED_SECRET && config.TURN_HOST)
    );
    const status = isMisconfigured ? "misconfigured" : (isConfigured ? "healthy" : "stun_only");
    res.json({
      status,
      relayConfigured: isConfigured,
      turnHost: config.TURN_HOST || null,
      udpPort: Number(config.TURN_PORT_UDP || 3478),
      tlsPort: Number(config.TURN_PORT_TLS || 443),
      warning: !isConfigured ? "WebRTC operating in STUN-only fallback without TURN relay" : null,
    });
  });

  return router;
}
