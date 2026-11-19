import type { Pool } from 'pg';
import config from '../config.ts';
import { postgres as defaultPostgres } from '../utils/postgres.ts';
import {
  claimOutboxJobs,
  markOutboxRetryOrFailed,
  markOutboxSent,
  markOutboxSuppressed,
  recordDispatchStarted,
  reclaimStalledOutboxJobs,
} from './emailOutbox.ts';
import { computeEmailHash } from './suppression.ts';

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

function isPayloadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class EmailServiceGateway {
  private readonly db: Pool;

  constructor(database: Pool | undefined = defaultPostgres) {
    if (!database) throw new Error('DATABASE_UNAVAILABLE');
    this.db = database;
  }

  async claimJobs(batchSize: number, workerId: string): Promise<EmailServiceJob[]> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new Error('INVALID_BATCH_SIZE');
    if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(workerId)) throw new Error('INVALID_WORKER_ID');

    await reclaimStalledOutboxJobs(Number(config.EMAIL_WORKER_LEASE_SECONDS) || 600, this.db);
    const rows = await claimOutboxJobs(batchSize, workerId, this.db);
    const hashes = rows.map((row) => computeEmailHash(row.recipient_email));
    const { rows: suppressedRows } = hashes.length
      ? await this.db.query<{ email_hash: string }>(
          'SELECT email_hash FROM public.email_delivery_suppressions WHERE email_hash = ANY($1::text[])',
          [hashes],
        )
      : { rows: [] as { email_hash: string }[] };
    const suppressedHashes = new Set(suppressedRows.map((row) => row.email_hash));

    const jobs: EmailServiceJob[] = [];
    const suppressedUpdates: Promise<boolean>[] = [];
    for (const row of rows) {
      const leaseToken = row.locked_by;
      if (!leaseToken) throw new Error('MISSING_OUTBOX_LEASE');
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(row.recipient_email) ||
          row.recipient_email.length > 254 || !row.template_key || row.template_key.length > 100 ||
          !isPayloadRecord(row.payload) || (row.provider_idempotency_key?.length ?? 0) > 256) {
        await markOutboxRetryOrFailed(
          row.id,
          Number(config.EMAIL_MAX_ATTEMPTS) || 5,
          'INVALID_OUTBOX_PAYLOAD',
          leaseToken,
          this.db,
        );
        continue;
      }
      if (suppressedHashes.has(computeEmailHash(row.recipient_email))) {
        suppressedUpdates.push(markOutboxSuppressed(row.id, leaseToken, this.db));
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
        leaseToken,
      });
    }
    await Promise.all(suppressedUpdates);
    return jobs;
  }

  markDispatchStarted(id: string, leaseToken: string): Promise<boolean> {
    return recordDispatchStarted(id, leaseToken, this.db);
  }

  markSent(id: string, leaseToken: string, provider: string, messageId: string): Promise<boolean> {
    return markOutboxSent(id, messageId, provider, leaseToken, this.db);
  }

  async markFailed(id: string, leaseToken: string, errorCode: string, retryable: boolean): Promise<boolean> {
    const { rows } = await this.db.query<{ attempt_count: number }>(
      `SELECT attempt_count FROM public.email_outbox
       WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
      [id, leaseToken],
    );
    const attemptCount = rows[0]?.attempt_count;
    if (attemptCount === undefined) return false;
    const count = retryable ? attemptCount : Number(config.EMAIL_MAX_ATTEMPTS) || 5;
    return markOutboxRetryOrFailed(id, count, errorCode, leaseToken, this.db);
  }
}
