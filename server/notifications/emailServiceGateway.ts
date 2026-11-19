import type { Pool } from 'pg';
import config from '../config.ts';
import { postgres as defaultPostgres } from '../utils/postgres.ts';
import {
  claimOutboxJobs,
  checkEmailSuppression,
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

export class EmailServiceGateway {
  constructor(private readonly db: Pool | undefined = defaultPostgres) {
    if (!db) throw new Error('DATABASE_UNAVAILABLE');
  }

  async claimJobs(batchSize: number, workerId: string): Promise<EmailServiceJob[]> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new Error('INVALID_BATCH_SIZE');
    if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(workerId)) throw new Error('INVALID_WORKER_ID');

    await reclaimStalledOutboxJobs(Number(config.EMAIL_WORKER_LEASE_SECONDS) || 600);
    const rows = await claimOutboxJobs(batchSize, workerId);
    const jobs: EmailServiceJob[] = [];

    for (const row of rows) {
      const leaseToken = row.locked_by;
      if (!leaseToken) throw new Error('MISSING_OUTBOX_LEASE');
      if (await checkEmailSuppression(computeEmailHash(row.recipient_email))) {
        await markOutboxSuppressed(row.id, leaseToken);
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
    return jobs;
  }

  markDispatchStarted(id: string, leaseToken: string): Promise<boolean> {
    return recordDispatchStarted(id, leaseToken);
  }

  markSent(id: string, leaseToken: string, provider: string, messageId: string): Promise<boolean> {
    return markOutboxSent(id, messageId, provider, leaseToken);
  }

  async markFailed(id: string, leaseToken: string, errorCode: string, retryable: boolean): Promise<boolean> {
    const { rows } = await this.db!.query<{ attempt_count: number }>(
      `SELECT attempt_count FROM public.email_outbox
       WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
      [id, leaseToken],
    );
    const attemptCount = rows[0]?.attempt_count;
    if (attemptCount === undefined) return false;
    const count = retryable ? attemptCount : Number(config.EMAIL_MAX_ATTEMPTS) || 5;
    return markOutboxRetryOrFailed(id, count, errorCode, leaseToken);
  }
}
