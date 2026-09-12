/**
 * NOTIFY-001A Email Outbox — Atomic Job Claiming, Lifecycle Transitions, and Suppression
 *
 * Enforces:
 *   - Atomic CTE + FOR UPDATE SKIP LOCKED claim pattern.
 *   - Horizontal worker lease lock (locked_at, locked_by).
 *   - SHA-256 hash-based email suppression checks.
 *   - Resend delivery matching strictly by provider_message_id.
 *   - Webhook idempotency via public.webhook_events.
 *   - Authoritative retention cleanup routines.
 */

import { postgres } from '../utils/postgres.ts';
import type { EmailOutboxRow, ProviderDeliveryStatus } from './notificationTypes.ts';
import config from '../config.ts';

// ---------------------------------------------------------------------------
// Retry schedule
// ---------------------------------------------------------------------------

function getRetryDelay(attemptCount: number): number {
  const raw = String(config.EMAIL_RETRY_DELAYS_MS || '60000,300000,1800000,3600000');
  const delays = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
  const idx = Math.min(attemptCount, delays.length - 1);
  return delays[idx] ?? 3_600_000;
}

// ---------------------------------------------------------------------------
// Atomic job claim
// ---------------------------------------------------------------------------

export async function claimOutboxJobs(
  batchSize: number,
  workerId = 'worker-1',
): Promise<EmailOutboxRow[]> {
  if (!postgres) return [];

  const { rows } = await postgres.query<EmailOutboxRow>(
    `WITH claimed AS (
       SELECT id FROM public.email_outbox
       WHERE status IN ('PENDING', 'RETRY')
         AND available_at <= now()
       ORDER BY available_at, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE public.email_outbox e
     SET
       status          = 'PROCESSING',
       last_attempt_at = clock_timestamp(),
       attempt_count   = attempt_count + 1,
       locked_at       = clock_timestamp(),
       locked_by       = $2,
       updated_at      = clock_timestamp()
     FROM claimed
     WHERE e.id = claimed.id
     RETURNING e.*`,
    [batchSize, workerId],
  );

  return rows;
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

export async function markOutboxSent(
  id: string,
  providerMessageId: string,
  provider = 'smtp',
): Promise<void> {
  if (!postgres) return;

  await postgres.query(
    `UPDATE public.email_outbox
     SET status = 'SENT',
         provider = $3,
         provider_delivery_status = 'SENT',
         sent_at = clock_timestamp(),
         provider_message_id = $2,
         locked_at = NULL,
         locked_by = NULL,
         updated_at = clock_timestamp()
     WHERE id = $1`,
    [id, providerMessageId, provider],
  );
}

export async function markOutboxRetryOrFailed(
  id: string,
  attemptCount: number,
  errorCode: string,
): Promise<void> {
  if (!postgres) return;

  const maxAttempts = Number(config.EMAIL_MAX_ATTEMPTS) || 5;

  if (attemptCount >= maxAttempts) {
    await postgres.query(
      `UPDATE public.email_outbox
       SET status = 'FAILED',
           last_error_code = $2,
           dispatch_started_at = NULL,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = clock_timestamp()
       WHERE id = $1`,
      [id, errorCode],
    );
  } else {
    const delayMs = getRetryDelay(attemptCount);
    await postgres.query(
      `UPDATE public.email_outbox
       SET status = 'RETRY',
           last_error_code = $2,
           dispatch_started_at = NULL,
           available_at = now() + ($3 || ' milliseconds')::interval,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = clock_timestamp()
       WHERE id = $1`,
      [id, errorCode, delayMs],
    );
  }
}

/**
 * Handle deliverability suppression:
 * Sets outbox row status = FAILED and last_error_code = RECIPIENT_SUPPRESSED.
 * Does NOT consume retry attempts or retry the job.
 */
export async function markOutboxSuppressed(id: string): Promise<void> {
  if (!postgres) return;

  await postgres.query(
    `UPDATE public.email_outbox
     SET status = 'FAILED',
         last_error_code = 'RECIPIENT_SUPPRESSED',
         dispatch_started_at = NULL,
         locked_at = NULL,
         locked_by = NULL,
         updated_at = clock_timestamp()
     WHERE id = $1`,
    [id],
  );
}

/**
 * NOTIFY-004: Record dispatch started immediately before calling external provider.
 * Protects against ambiguous crashes mid-dispatch.
 */
export async function recordDispatchStarted(id: string): Promise<void> {
  if (!postgres || !id) return;

  await postgres.query(
    `UPDATE public.email_outbox
     SET dispatch_started_at = clock_timestamp(),
         updated_at = clock_timestamp()
     WHERE id = $1`,
    [id],
  );
}

// ---------------------------------------------------------------------------
// Worker Lease & Crash Recovery
// ---------------------------------------------------------------------------

export async function reclaimStalledOutboxJobs(
  stallThresholdSeconds = 600,
): Promise<number> {
  if (!postgres) return 0;

  // Stalled jobs where dispatch_started_at is NOT NULL indicate an in-flight crash
  // We record 'AMBIGUOUS_CRASH_RECOVERY' if an in-flight job is reclaimed
  const { rowCount } = await postgres.query(
    `UPDATE public.email_outbox
     SET status = 'RETRY',
         available_at = now(),
         locked_at = NULL,
         locked_by = NULL,
         last_error_code = CASE
           WHEN dispatch_started_at IS NOT NULL THEN 'AMBIGUOUS_CRASH_RECOVERY'
           ELSE last_error_code
         END,
         dispatch_started_at = NULL,
         updated_at = clock_timestamp()
     WHERE status = 'PROCESSING'
       AND (locked_at IS NULL OR locked_at < now() - ($1 || ' seconds')::interval)`,
    [stallThresholdSeconds],
  );

  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Deliverability Suppression Queries (Zero Plaintext Email)
// ---------------------------------------------------------------------------

export async function checkEmailSuppression(emailHash: string): Promise<boolean> {
  if (!postgres || !emailHash) return false;

  const result = await postgres.query(
    `SELECT 1 FROM public.email_delivery_suppressions WHERE email_hash = $1 LIMIT 1`,
    [emailHash],
  );

  return Boolean(result.rowCount && result.rowCount > 0);
}

export async function recordEmailSuppression(
  emailHash: string,
  reason: 'bounced' | 'complained' | 'manual',
  source = 'resend_webhook',
): Promise<void> {
  if (!postgres || !emailHash) return;

  await postgres.query(
    `INSERT INTO public.email_delivery_suppressions (email_hash, reason, source)
     VALUES ($1, $2, $3)
     ON CONFLICT (email_hash) DO NOTHING`,
    [emailHash, reason, source],
  );
}

// ---------------------------------------------------------------------------
// Resend Webhook Delivery Matching & State Updates
// ---------------------------------------------------------------------------

/**
 * Route Resend webhook strictly via provider_message_id, never by email alone.
 */
export async function updateDeliveryStatusByProviderMessageId(
  providerMessageId: string,
  status: ProviderDeliveryStatus,
  timestamp: Date = new Date(),
  provider?: string,
): Promise<boolean> {
  if (!postgres || !providerMessageId) return false;

  let extraColumnClause = '';
  if (status === 'DELIVERED') {
    extraColumnClause = ', delivered_at = $3';
  } else if (status === 'BOUNCED') {
    extraColumnClause = ', bounced_at = $3';
  } else if (status === 'COMPLAINED') {
    extraColumnClause = ', complained_at = $3';
  }

  let whereClause = 'WHERE provider_message_id = $1';
  const params: any[] = extraColumnClause
    ? [providerMessageId, status, timestamp]
    : [providerMessageId, status];

  if (provider) {
    const providerParamIdx = params.length + 1;
    whereClause += ` AND provider = $${providerParamIdx}`;
    params.push(provider);
  }

  const query = `UPDATE public.email_outbox
     SET provider_delivery_status = $2,
         updated_at = clock_timestamp()
         ${extraColumnClause}
     ${whereClause}`;

  const { rowCount } = await postgres.query(query, params);
  return Boolean(rowCount && rowCount > 0);
}

/**
 * Record webhook event for deduplication.
 * Returns true if the event is new, false if duplicate.
 */
export async function recordWebhookEventIdempotent(
  provider: string,
  eventId: string,
  eventType: string,
): Promise<boolean> {
  if (!postgres || !provider || !eventId) return false;

  const { rowCount } = await postgres.query(
    `INSERT INTO public.webhook_events (provider, event_id, event_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, event_id) DO NOTHING`,
    [provider, eventId, eventType],
  );

  return Boolean(rowCount && rowCount > 0);
}

// ---------------------------------------------------------------------------
// Authoritative Retention Routines
// ---------------------------------------------------------------------------

export async function purgeReadNotificationsExpired(): Promise<number> {
  if (!postgres) return 0;
  const result = await postgres.query<{ purge_read_notifications_expired: number }>(
    `SELECT public.purge_read_notifications_expired()`,
  );
  return result.rows[0]?.purge_read_notifications_expired ?? 0;
}

export async function purgeSentOutboxRows(retentionDays: number): Promise<number> {
  if (!postgres) return 0;
  const result = await postgres.query<{ purge_sent_email_outbox: number }>(
    `SELECT public.purge_sent_email_outbox($1)`,
    [retentionDays],
  );
  return result.rows[0]?.purge_sent_email_outbox ?? 0;
}

export async function purgeFailedOutboxRows(retentionDays: number): Promise<number> {
  if (!postgres) return 0;
  const result = await postgres.query<{ purge_failed_email_outbox: number }>(
    `SELECT public.purge_failed_email_outbox($1)`,
    [retentionDays],
  );
  return result.rows[0]?.purge_failed_email_outbox ?? 0;
}
