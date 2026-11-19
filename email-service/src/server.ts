import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import type { EmailServiceConfig } from './config.ts';
import { EmailProviderRegistry, getDeliveryProfile } from './providers.ts';
import { renderDuplicateSignupSecurityAlert } from './templates.ts';

const MAX_BODY_BYTES = 16 * 1024;

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  if (!/^application\\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('INVALID_JSON');
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function authorized(req: IncomingMessage, secret: string): boolean {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expected = Buffer.from(secret);
  const supplied = Buffer.from(token);
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

export function createEmailServiceServer(
  config: EmailServiceConfig,
  providers: EmailProviderRegistry,
): Server {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (req.method === 'GET' && pathname === '/healthz') {
      json(res, 200, { status: 'healthy' });
      return;
    }
    if (req.method !== 'POST' || pathname !== '/internal/send/duplicate-signup-alert') {
      json(res, 404, { error: 'NOT_FOUND' });
      return;
    }
    if (!authorized(req, config.serviceApiSecret)) {
      json(res, 401, { error: 'UNAUTHORIZED' });
      return;
    }

    try {
      const body = await readJson(req);
      const email = body?.email;
      const ipAddress = body?.ipAddress;
      const attemptedAt = body?.attemptedAt;
      const allowedKeys = new Set(['email', 'ipAddress', 'attemptedAt']);
      if (body && Object.keys(body).some((key) => !allowedKeys.has(key)) ||
          typeof email !== 'string' || email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          (ipAddress !== undefined && (typeof ipAddress !== 'string' || ipAddress.length > 64)) ||
          typeof attemptedAt !== 'string' || !Number.isFinite(Date.parse(attemptedAt))) {
        json(res, 400, { error: 'INVALID_SECURITY_ALERT_REQUEST' });
        return;
      }

      const profile = getDeliveryProfile('transactional_security', config);
      const provider = providers.getProviderForProfile('transactional_security');
      const rendered = renderDuplicateSignupSecurityAlert(email, String(ipAddress || ''), new Date(attemptedAt), config);
      const emailHash = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
      const timeBucket = Math.floor(Date.parse(attemptedAt) / 600000);
      const result = await provider.send({
        to: email,
        from: '"' + profile.fromName + '" <' + profile.fromAddress + '>',
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: 'security-dup-signup:' + emailHash + ':' + timeBucket,
      });
      json(res, 200, {
        accepted: result.accepted,
        provider: result.provider,
        providerMessageId: result.providerMessageId,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'SECURITY_ALERT_DELIVERY_FAILED';
      const status = code === 'BODY_TOO_LARGE' ? 413
        : code === 'INVALID_JSON' ? 400
        : 502;
      json(res, status, { error: status === 502 ? 'SECURITY_ALERT_DELIVERY_FAILED' : code });
    }
  });

  server.headersTimeout = 5000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  return server;
}
