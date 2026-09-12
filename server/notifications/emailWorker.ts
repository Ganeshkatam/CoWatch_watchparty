/**
 * NOTIFY-001 Email Worker
 *
 * Polls the email_outbox table at a configurable interval, claims jobs atomically,
 * renders templates, and delegates delivery to the configured email provider.
 *
 * Design guarantees:
 *   - At-least-once delivery via retry/backoff (max attempts configurable)
 *   - Stalled PROCESSING rows are recovered via lease-timeout reclaim
 *   - Worker crashes do not orphan rows: reclaimStalledOutboxJobs() runs at start of each cycle
 *   - Provider idempotency key is passed to Resend to prevent duplicate delivery on retry
 */

import config from '../config.ts';
import {
  claimOutboxJobs,
  markOutboxSent,
  markOutboxRetryOrFailed,
  reclaimStalledOutboxJobs,
} from './emailOutbox.ts';
import { renderEmailTemplate } from './emailTemplates.ts';
import { NotificationDeliveryError } from './notificationErrors.ts';
import type { EmailProvider } from './emailProvider.ts';
import { ResendProvider } from './providers/resendProvider.ts';

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let workerTimer: ReturnType<typeof setInterval> | null = null;
let isCycleRunning = false;
let activeProvider: EmailProvider | null = null;

// ---------------------------------------------------------------------------
// Worker cycle
// ---------------------------------------------------------------------------

async function workerCycle(): Promise<void> {
  if (isCycleRunning) {
    // Previous cycle still running (slow DB or large batch); skip this tick
    return;
  }

  isCycleRunning = true;

  try {
    // 1. Recover stalled PROCESSING rows from crashed workers (lease: 10 min)
    const reclaimed = await reclaimStalledOutboxJobs(10);
    if (reclaimed > 0) {
      console.log(`[EmailWorker] Reclaimed ${reclaimed} stalled outbox jobs`);
    }

    const batchSize = Number(config.EMAIL_WORKER_BATCH_SIZE) || 10;
    const provider = getProvider();

    // 2. Claim batch atomically
    const jobs = await claimOutboxJobs(batchSize);
    if (jobs.length === 0) return;

    console.log(`[EmailWorker] Processing ${jobs.length} email(s)`);

    // 3. Process each job independently
    await Promise.allSettled(
      jobs.map(async (job) => {
        try {
          // Render template
          const rendered = renderEmailTemplate(job.template_key, job.payload as Record<string, unknown>);
          if (!rendered) {
            console.error(
              `[EmailWorker] No template registered for key "${job.template_key}" (job ${job.id})`,
            );
            await markOutboxRetryOrFailed(job.id, job.attempt_count, 'TEMPLATE_NOT_FOUND');
            return;
          }

          // Send via provider
          const fromEmail = config.RESEND_FROM_EMAIL || 'CoWatch <noreply@cowatch.tv>';
          const result = await provider.send({
            to: job.recipient_email,
            from: fromEmail,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            idempotencyKey: job.provider_idempotency_key ?? `fallback:${job.id}`,
          });

          await markOutboxSent(job.id, result.messageId);
          console.log(`[EmailWorker] Sent job ${job.id} via ${provider.name}: ${result.messageId}`);
        } catch (err) {
          const isRetryable =
            err instanceof NotificationDeliveryError ? err.isRetryable : true;
          const errorCode =
            err instanceof NotificationDeliveryError
              ? err.code
              : 'PROVIDER_ERROR';

          console.error(
            `[EmailWorker] Job ${job.id} failed (attempt ${job.attempt_count}, retryable=${isRetryable}):`,
            err,
          );

          if (isRetryable) {
            await markOutboxRetryOrFailed(job.id, job.attempt_count, errorCode);
          } else {
            // Non-retryable errors immediately exhaust all attempts
            const maxAttempts = Number(config.EMAIL_MAX_ATTEMPTS) || 5;
            await markOutboxRetryOrFailed(job.id, maxAttempts, errorCode);
          }
        }
      }),
    );
  } catch (err) {
    console.error('[EmailWorker] Unhandled error in worker cycle:', err);
  } finally {
    isCycleRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Provider resolution (lazy)
// ---------------------------------------------------------------------------

function getProvider(): EmailProvider {
  if (!activeProvider) {
    activeProvider = new ResendProvider();
  }
  return activeProvider;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the email worker.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startEmailWorker(): void {
  if (workerTimer !== null) return;

  const intervalMs = Number(config.EMAIL_WORKER_INTERVAL_MS) || 30_000;

  console.log(`[EmailWorker] Starting with interval=${intervalMs}ms, provider=${getProvider().name}`);

  // Run one cycle immediately, then on interval
  workerCycle().catch((err) => console.error('[EmailWorker] Initial cycle error:', err));
  workerTimer = setInterval(() => {
    workerCycle().catch((err) => console.error('[EmailWorker] Cycle error:', err));
  }, intervalMs);
}

/**
 * Stop the email worker (used in tests).
 */
export function stopEmailWorker(): void {
  if (workerTimer !== null) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

/**
 * Replace the active provider (used in tests).
 */
export function setEmailProvider(provider: EmailProvider): void {
  activeProvider = provider;
}
