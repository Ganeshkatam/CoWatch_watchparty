/**
 * NOTIFY-001 Email Outbox — Atomic Job Claiming & State Transitions
 *
 * Implements the mandatory atomic CTE claim pattern to prevent concurrent
 * worker races. No two workers can claim the same row simultaneously due to
 * FOR UPDATE SKIP LOCKED.
 */

import { postgres } from '../utils/postgres.ts';
import type { EmailOutboxRow } from './notificationTypes.ts';
import config from '../config.ts';

// ---------------------------------------------------------------------------
// Retry schedule
// ---------------------------------------------------------------------------

/**
 * Compute the next available_at timestamp for a retry attempt.
 * Delays are loaded from config: EMAIL_RETRY_DELAYS_MS (comma-separated ms per attempt).
 */
function getRetryDelay(attemptCount: number): number {
  const raw = String(config.EMAIL_RETRY_DELAYS_MS || '60000,300000,1800000,3600000');
  const delays = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  // Clamp to last defined delay if attempt exceeds delay list length
  const idx = Math.min(attemptCount, delays.length - 1);
  return delays[idx] ?? 3_600_000;
}

// ---------------------------------------------------------------------------
// Atomic job claim (mandatory CTE pattern from NOTIFY-001 spec)
// ---------------------------------------------------------------------------

/**
 * Atomically claim up to `batchSize` PENDING/RETRY outbox rows for processing.
 *
 * Uses the exact CTE + FOR UPDATE SKIP LOCKED pattern specified in NOTIFY-001:
 *   WITH claimed AS (SELECT id FROM email_outbox WHERE status IN ('PENDING','RETRY')
 *     AND available_at <= now() ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT $1)
 *   UPDATE email_outbox e SET status='PROCESSING', last_attempt_at=clock_timestamp(),
 *     attempt_count=attempt_count+1, updated_at=clock_timestamp()
 *   FROM claimed WHERE e.id = claimed.id RETURNING e.*;
 */
export async function claimOutboxJobs(batchSize: number): Promise<EmailOutboxRow[]> {
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
       updated_at      = clock_timestamp()
     FROM claimed
     WHERE e.id = claimed.id
     RETURNING e.*`,
    [batchSize],
  );

  return rows;
}

// ---------------------------------------------------------------------------
// State transitions (called after provider send attempt)
// ---------------------------------------------------------------------------

/**
 * Mark an outbox row as successfully sent.
 */
export async function markOutboxSent(
  id: string,
  providerMessageId: string,
): Promise<void> {
  if (!postgres) return;

  await postgres.query(
    `UPDATE public.email_outbox
     SET status = 'SENT', sent_at = clock_timestamp(), provider_message_id = $2, updated_at = clock_timestamp()
     WHERE id = $1`,
    [id, providerMessageId],
  );
}

/**
 * Mark an outbox row for retry (or FAILED if max attempts exceeded).
 */
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
       SET status = 'FAILED', last_error_code = $2, updated_at = clock_timestamp()
       WHERE id = $1`,
      [id, errorCode],
    );
  } else {
    const delayMs = getRetryDelay(attemptCount);
    await postgres.query(
      `UPDATE public.email_outbox
       SET status = 'RETRY',
           last_error_code = $2,
           available_at = now() + ($3 || ' milliseconds')::interval,
           updated_at = clock_timestamp()
       WHERE id = $1`,
      [id, errorCode, delayMs],
    );
  }
}

/**
 * Reclaim stalled PROCESSING rows back to RETRY.
 * Used for recovery from worker crashes (lease timeout: 10 minutes).
 */
export async function reclaimStalledOutboxJobs(
  stallThresholdMinutes = 10,
): Promise<number> {
  if (!postgres) return 0;

  const { rowCount } = await postgres.query(
    `UPDATE public.email_outbox
     SET status = 'RETRY', available_at = now(), updated_at = clock_timestamp()
     WHERE status = 'PROCESSING'
       AND last_attempt_at < now() - ($1 || ' minutes')::interval`,
    [stallThresholdMinutes],
  );

  return rowCount ?? 0;
}
