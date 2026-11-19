import type { Pool } from 'pg';
import config from '../config.ts';
import { computeEmailHash } from './suppression.ts';
import { postgres as defaultPostgres } from '../utils/postgres.ts';

export interface EmailServiceJob {
  id: string;
  recipientEmail: string;
  templateKey: string;
  payload: Record<string, unknown>;
  deliveryProfile: string;
  attemptCount: number;
  idempotencyKey: string;
  leaseToken: string;
}

interface OutboxRow {
  id: string;
  recipient_email: string;
  template_key: string;
  payload: Record<string, unknown>;
  delivery_profile: string;
  attempt_count: number;
  provider_idempotency_key: string | null;
  locked_by: string;
}

export class EmailServiceGateway {
  private readonly db: Pool;

  constructor(database: Pool | undefined = defaultPostgres) {
    if (!database) throw new Error('DATABASE_UNAVAILABLE');
    this.db = database;
  }

  async claimJobs(batchSize: number, workerId: string): Promise<EmailServiceJob[]> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
      throw new Error('INVALID_BATCH_SIZE');
    }
    if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(workerId)) throw new Error('INVALID_WORKER_ID');

    const leaseSeconds = Number(config.EMAIL_WORKER_LEASE_SECONDS) || 600;
    await this.db.query(
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
      [leaseSeconds],
    );

    const { rows } = await this.db.query<OutboxRow>(
      `WITH claimed AS (
         SELECT id FROM public.email_outbox
         WHERE status IN ('PENDING', 'RETRY') AND available_at <= now()
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE public.email_outbox e
       SET status = 'PROCESSING',
           last_attempt_at = clock_timestamp(),
           attempt_count = attempt_count + 1,
           locked_at = clock_timestamp(),
           locked_by = $2 || ':' || gen_random_uuid()::text,
           updated_at = clock_timestamp()
       FROM claimed
       WHERE e.id = claimed.id
       RETURNING e.id, e.recipient_email, e.template_key, e.payload,
                 e.delivery_profile, e.attempt_count, e.provider_idempotency_key, e.locked_by`,
      [batchSize, workerId],
    );

    const jobs: EmailServiceJob[] = [];
    for (const row of rows) {
      const hash = computeEmailHash(row.recipient_email);
      const suppression = await this.db.query(
        'SELECT 1 FROM public.email_delivery_suppressions WHERE email_hash = $1 LIMIT 1',
        [hash],
      );
      if (suppression.rowCount) {
        await this.db.query(
          `UPDATE public.email_outbox
           SET status = 'FAILED', last_error_code = 'RECIPIENT_SUPPRESSED',
               dispatch_started_at = NULL, locked_at = NULL, locked_by = NULL,
               updated_at = clock_timestamp()
           WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
          [row.id, row.locked_by],
        );
        continue;
      }
      jobs.push({
        id: row.id,
        recipientEmail: row.recipient_email,
        templateKey: row.template_key,
        payload: row.payload,
        deliveryProfile: row.delivery_profile || 'transactional_default',
        attemptCount: row.attempt_count,
        idempotencyKey: row.provider_idempotency_key || 'notify-email:' + row.id,
        leaseToken: row.locked_by,
      });
    }
    return jobs;
  }

  async markDispatchStarted(id: string, leaseToken: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE public.email_outbox
       SET dispatch_started_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
      [id, leaseToken],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async markSent(id: string, leaseToken: string, provider: string, messageId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE public.email_outbox
       SET status = 'SENT', provider = $3, provider_delivery_status = 'SENT',
           sent_at = clock_timestamp(), provider_message_id = $4,
           dispatch_started_at = NULL, locked_at = NULL, locked_by = NULL,
           updated_at = clock_timestamp()
       WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
      [id, leaseToken, provider, messageId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async markFailed(id: string, leaseToken: string, errorCode: string, retryable: boolean): Promise<boolean> {
    const { rows } = await this.db.query<{ attempt_count: number }>(
      `SELECT attempt_count FROM public.email_outbox
       WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
      [id, leaseToken],
    );
    const attemptCount = rows[0]?.attempt_count;
    if (attemptCount === undefined) return false;

    const maxAttempts = Number(config.EMAIL_MAX_ATTEMPTS) || 5;
    const delays = String(config.EMAIL_RETRY_DELAYS_MS || '60000,300000,1800000,3600000')
      .split(',').map((value) => Number.parseInt(value.trim(), 10)).filter(Number.isFinite);
    const delayMs = delays[Math.min(attemptCount, delays.length - 1)] ?? 3_600_000;
    const failed = !retryable || attemptCount >= maxAttempts;

    const result = await this.db.query(
      `UPDATE public.email_outbox
       SET status = $3,
           last_error_code = $4,
           dispatch_started_at = NULL,
           available_at = CASE WHEN $3 = 'RETRY'
             THEN now() + ($5 || ' milliseconds')::interval ELSE available_at END,
           locked_at = NULL, locked_by = NULL, updated_at = clock_timestamp()
       WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
      [id, leaseToken, failed ? 'FAILED' : 'RETRY', errorCode, delayMs],
    );
    return (result.rowCount ?? 0) === 1;
  }
}
