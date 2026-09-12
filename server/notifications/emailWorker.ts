/**
 * NOTIFY-001A Email Worker
 *
 * Polls the email_outbox table, claims jobs atomically (FOR UPDATE SKIP LOCKED),
 * checks deliverability suppression, renders templates, and dispatches to Resend.
 *
 * Guarantees:
 *   - Deliverability suppression check via SHA-256 email_hash prior to dispatch.
 *   - If recipient is suppressed: immediately marks row FAILED (RECIPIENT_SUPPRESSED), zero retries.
 *   - Stalled jobs recovered automatically via horizontal lease timeout (locked_at).
 *   - Ephemeral process metrics recorded for observability.
 */

import config from '../config.ts';
import {
  claimOutboxJobs,
  markOutboxSent,
  markOutboxRetryOrFailed,
  markOutboxSuppressed,
  reclaimStalledOutboxJobs,
  checkEmailSuppression,
  recordDispatchStarted,
} from './emailOutbox.ts';
import { getDeliveryProfile } from './deliveryProfiles.ts';
import { computeEmailHash } from './suppression.ts';
import { renderEmailTemplate } from './emailTemplates.ts';
import { NotificationDeliveryError } from './notificationErrors.ts';
import type { EmailProvider } from './emailProvider.ts';
import { EmailProviderError } from './emailErrors.ts';
import { EmailProviderRegistry } from './emailProviderRegistry.ts';
import {
  recordWorkerCycleStart,
  recordWorkerCycleComplete,
} from './notificationTelemetry.ts';

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let workerTimer: ReturnType<typeof setInterval> | null = null;
let isCycleRunning = false;
let activeProvider: EmailProvider | null = null;
const workerId = `worker-${process.pid || 1}`;

// ---------------------------------------------------------------------------
// Worker cycle
// ---------------------------------------------------------------------------

export async function runWorkerCycle(): Promise<void> {
  if (isCycleRunning) {
    return;
  }

  isCycleRunning = true;
  const cycleStart = Date.now();
  recordWorkerCycleStart();

  try {
    // 1. Recover stalled PROCESSING rows from crashed workers based on configured lease duration
    const leaseSeconds = Number(config.EMAIL_WORKER_LEASE_SECONDS) || 600;
    const reclaimed = await reclaimStalledOutboxJobs(leaseSeconds);
    if (reclaimed > 0) {
      console.log(`[EmailWorker] Reclaimed ${reclaimed} stalled outbox jobs`);
    }

    const batchSize = Number(config.EMAIL_WORKER_BATCH_SIZE) || 10;
    const provider = getProvider();

    // 2. Claim batch atomically with lease lock
    const jobs = await claimOutboxJobs(batchSize, workerId);
    if (jobs.length === 0) return;

    console.log(`[EmailWorker] Processing ${jobs.length} email(s)`);

    // 3. Process each job independently
    await Promise.allSettled(
      jobs.map(async (job) => {
        try {
          // Deliverability Suppression Check (Zero plaintext email)
          const emailHash = computeEmailHash(job.recipient_email);
          const isSuppressed = await checkEmailSuppression(emailHash);
          if (isSuppressed) {
            console.warn(
              `[EmailWorker] Recipient ${emailHash.slice(0, 8)}... is suppressed (job ${job.id}); marking FAILED`,
            );
            await markOutboxSuppressed(job.id);
            return;
          }

          // Render template
          const rendered = renderEmailTemplate(
            job.template_key,
            job.payload as Record<string, unknown>,
          );
          if (!rendered) {
            console.error(
              `[EmailWorker] No template registered for key "${job.template_key}" (job ${job.id})`,
            );
            await markOutboxRetryOrFailed(job.id, job.attempt_count, 'TEMPLATE_NOT_FOUND');
            return;
          }

          // Resolve delivery profile and bound provider
          const profile = getDeliveryProfile(job.delivery_profile || 'transactional_default');
          const jobProvider = activeProvider || EmailProviderRegistry.getProviderForProfile(profile.id);

          const fromEmail = profile.fromName
            ? `"${profile.fromName}" <${profile.fromAddress}>`
            : profile.fromAddress;

          // Record dispatch started before calling provider (idempotency guard)
          await recordDispatchStarted(job.id);

          const result = await jobProvider.send({
            to: job.recipient_email,
            from: fromEmail,
            replyTo: profile.replyTo,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            idempotencyKey: job.provider_idempotency_key ?? `notify-email:${job.id}`,
          });

          const messageId = result.providerMessageId || (result as any).messageId || `sent:${job.id}`;
          await markOutboxSent(job.id, messageId, jobProvider.name);
          console.log(`[EmailWorker] Sent job ${job.id} via ${jobProvider.name} (profile ${profile.id}): ${messageId}`);
        } catch (err) {
          let isRetryable = true;
          let errorCode = 'PROVIDER_ERROR';

          if (err instanceof EmailProviderError) {
            isRetryable = err.isRetryable;
            errorCode = err.code;
          } else if (err instanceof NotificationDeliveryError) {
            isRetryable = err.isRetryable;
            errorCode = err.code;
          } else if (typeof provider.classifyError === 'function') {
            const classified = provider.classifyError(err);
            isRetryable = classified.isRetryable;
            errorCode = classified.code;
          }

          console.error(
            `[EmailWorker] Job ${job.id} failed via ${provider.name} (attempt ${job.attempt_count}, retryable=${isRetryable}, code=${errorCode}):`,
            err,
          );

          if (isRetryable) {
            await markOutboxRetryOrFailed(job.id, job.attempt_count, errorCode);
          } else {
            // Non-retryable errors immediately exhaust attempts and transition to FAILED
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
    recordWorkerCycleComplete(Date.now() - cycleStart);
  }
}

// ---------------------------------------------------------------------------
// Provider resolution (lazy)
// ---------------------------------------------------------------------------

function getProvider(): EmailProvider {
  if (!activeProvider) {
    activeProvider = EmailProviderRegistry.getProvider();
  }
  return activeProvider;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startEmailWorker(): void {
  if (workerTimer !== null) return;

  const intervalMs = Number(config.EMAIL_WORKER_INTERVAL_MS) || 30_000;
  console.log(`[EmailWorker] Starting with interval=${intervalMs}ms, provider=${getProvider().name}`);

  runWorkerCycle().catch((err) => console.error('[EmailWorker] Initial cycle error:', err));
  workerTimer = setInterval(() => {
    runWorkerCycle().catch((err) => console.error('[EmailWorker] Cycle error:', err));
  }, intervalMs);
}

export function stopEmailWorker(): void {
  if (workerTimer !== null) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

export function setEmailProvider(provider: EmailProvider): void {
  activeProvider = provider;
}
