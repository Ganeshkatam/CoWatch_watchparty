import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import config from '../config.ts';
import { EmailServiceGateway } from '../notifications/emailServiceGateway.ts';
import { recordWorkerCycleComplete } from '../notifications/notificationTelemetry.ts';

export interface EmailServiceGatewayContract {
  claimJobs(batchSize: number, workerId: string): Promise<unknown[]>;
  markDispatchStarted(id: string, leaseToken: string): Promise<boolean>;
  markSent(id: string, leaseToken: string, provider: string, messageId: string): Promise<boolean>;
  markFailed(id: string, leaseToken: string, errorCode: string, retryable: boolean): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function requireEmailServiceAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = config.EMAIL_SERVICE_WORKER_SECRET;
  const supplied = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : '';
  if (!expected || expected.length < 32) {
    res.status(503).json({ error: 'EMAIL_SERVICE_AUTH_NOT_CONFIGURED' });
    return;
  }
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !crypto.timingSafeEqual(expectedBytes, suppliedBytes)) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }
  next();
}

export function createEmailServiceRouter(
  gateway: EmailServiceGatewayContract = new EmailServiceGateway(),
): Router {
  const router = Router();
  router.use(requireEmailServiceAuth);

  router.post('/jobs/claim', async (req: Request, res: Response) => {
    const body: unknown = req.body;
    if (!isRecord(body) || typeof body.workerId !== 'string' ||
        !Number.isInteger(body.batchSize) || (body.batchSize as number) < 1 || (body.batchSize as number) > 50) {
      res.status(400).json({ error: 'INVALID_CLAIM_REQUEST' });
      return;
    }
    try {
      const jobs = await gateway.claimJobs(body.batchSize as number, body.workerId);
      res.status(200).json({ jobs });
    } catch (error) {
      console.error('[EmailServiceAPI] Claim failed:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
      res.status(503).json({ error: 'EMAIL_QUEUE_UNAVAILABLE' });
    }
  });

  router.post('/jobs/:id/dispatch', async (req: Request, res: Response) => {
    const id = req.params.id;
    const leaseToken = isRecord(req.body) ? req.body.leaseToken : undefined;
    if (!validId(id) || typeof leaseToken !== 'string' || leaseToken.length > 160) {
      res.status(400).json({ error: 'INVALID_DISPATCH_REQUEST' });
      return;
    }
    try {
      const accepted = await gateway.markDispatchStarted(id, leaseToken);
      res.status(accepted ? 204 : 409).end();
    } catch (error) {
      console.error('[EmailServiceAPI] Dispatch transition failed:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
      res.status(503).json({ error: 'EMAIL_QUEUE_UNAVAILABLE' });
    }
  });

  router.post('/jobs/:id/sent', async (req: Request, res: Response) => {
    const id = req.params.id;
    const body: unknown = req.body;
    if (!validId(id) || !isRecord(body) ||
        typeof body.leaseToken !== 'string' || body.leaseToken.length > 160 ||
        typeof body.provider !== 'string' || !/^[a-zA-Z0-9:_-]{1,80}$/.test(body.provider) ||
        typeof body.messageId !== 'string' || !body.messageId.trim() || body.messageId.length > 500) {
      res.status(400).json({ error: 'INVALID_SENT_REQUEST' });
      return;
    }
    try {
      const accepted = await gateway.markSent(id, body.leaseToken, body.provider, body.messageId);
      res.status(accepted ? 204 : 409).end();
    } catch (error) {
      console.error('[EmailServiceAPI] Sent transition failed:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
      res.status(503).json({ error: 'EMAIL_QUEUE_UNAVAILABLE' });
    }
  });

  router.post('/jobs/:id/fail', async (req: Request, res: Response) => {
    const id = req.params.id;
    const body: unknown = req.body;
    if (!validId(id) || !isRecord(body) ||
        typeof body.leaseToken !== 'string' || body.leaseToken.length > 160 ||
        typeof body.errorCode !== 'string' || !/^[A-Z0-9_:-]{1,100}$/.test(body.errorCode) ||
        typeof body.retryable !== 'boolean') {
      res.status(400).json({ error: 'INVALID_FAILURE_REQUEST' });
      return;
    }
    try {
      const accepted = await gateway.markFailed(id, body.leaseToken, body.errorCode, body.retryable);
      res.status(accepted ? 204 : 409).end();
    } catch (error) {
      console.error('[EmailServiceAPI] Failure transition failed:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
      res.status(503).json({ error: 'EMAIL_QUEUE_UNAVAILABLE' });
    }
  });

  router.post('/worker/heartbeat', (req: Request, res: Response) => {
    const durationMs = isRecord(req.body) ? req.body.durationMs : undefined;
    if (!Number.isInteger(durationMs) || (durationMs as number) < 0 || (durationMs as number) > 120_000) {
      res.status(400).json({ error: 'INVALID_HEARTBEAT' });
      return;
    }
    recordWorkerCycleComplete(durationMs as number);
    res.status(204).end();
  });

  return router;
}
