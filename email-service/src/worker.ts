import { CoWatchApiClient, type EmailJob } from './apiClient.ts';
import type { EmailServiceConfig, DeliveryProfileId } from './config.ts';
import { EmailProviderError, EmailProviderRegistry, getDeliveryProfile } from './providers.ts';
import { renderEmailTemplate } from './templates.ts';

const PROFILE_IDS = new Set<string>([
  'transactional_default',
  'transactional_security',
  'transactional_invitation',
  'transactional_system',
]);

export interface EmailWorkerDependencies {
  api: Pick<CoWatchApiClient, 'claimJobs' | 'markDispatchStarted' | 'markSent' | 'markFailed' | 'heartbeat'>;
  providers: Pick<EmailProviderRegistry, 'getProviderForProfile'>;
  config: EmailServiceConfig;
  workerId: string;
}

async function processJob(job: EmailJob, dependencies: EmailWorkerDependencies): Promise<void> {
  let provider: ReturnType<EmailProviderRegistry['getProviderForProfile']> | undefined;
  let providerAccepted = false;

  if (!PROFILE_IDS.has(job.deliveryProfile)) {
    await dependencies.api.markFailed(job, 'INVALID_DELIVERY_PROFILE', false);
    return;
  }

  const profileId = job.deliveryProfile as DeliveryProfileId;
  try {
    provider = dependencies.providers.getProviderForProfile(profileId);
    const rendered = renderEmailTemplate(job.templateKey, job.payload);
    if (!rendered) {
      await dependencies.api.markFailed(job, 'TEMPLATE_NOT_FOUND', false);
      return;
    }

    const profile = getDeliveryProfile(profileId, dependencies.config);
    await dependencies.api.markDispatchStarted(job);
    const result = await provider.send({
      to: job.recipientEmail,
      from: '"' + profile.fromName + '" <' + profile.fromAddress + '>',
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: job.idempotencyKey,
    });
    if (!result.accepted || !result.providerMessageId) {
      throw new EmailProviderError('Provider did not confirm message acceptance', 'PROVIDER_NOT_ACCEPTED', true);
    }
    providerAccepted = true;
    try {
      await dependencies.api.markSent(job, result.provider, result.providerMessageId);
      console.log('[EmailWorker] Delivered job ' + job.id + ' via ' + result.provider);
    } catch (error) {
      console.error('[EmailWorker] Delivery acknowledgement uncertain for job ' + job.id + ':',
        error instanceof Error ? error.message : 'UNKNOWN_ERROR');
    }
  } catch (error) {
    if (providerAccepted) return;
    const classified = provider
      ? provider.classifyError(error)
      : new EmailProviderError('Email job configuration is invalid', 'EMAIL_JOB_CONFIGURATION', false);
    console.error('[EmailWorker] Job ' + job.id + ' failed (' + classified.code + ', retryable=' + classified.retryable + ')');
    try {
      await dependencies.api.markFailed(job, classified.code, classified.retryable);
    } catch (ackError) {
      console.error('[EmailWorker] Failure acknowledgement uncertain for job ' + job.id + ':',
        ackError instanceof Error ? ackError.message : 'UNKNOWN_ERROR');
    }
  }
}

export async function runWorkerCycle(dependencies: EmailWorkerDependencies): Promise<void> {
  const startedAt = Date.now();
  try {
    const jobs = await dependencies.api.claimJobs(
      dependencies.workerId,
      dependencies.config.workerBatchSize,
    );
    let nextIndex = 0;
    const workerCount = Math.min(dependencies.config.workerConcurrency, jobs.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < jobs.length) {
        const job = jobs[nextIndex++];
        await processJob(job, dependencies);
      }
    }));
  } catch (error) {
    console.error('[EmailWorker] Cycle failed:', error instanceof Error ? error.message : 'UNKNOWN_ERROR');
  } finally {
    try {
      await dependencies.api.heartbeat(Date.now() - startedAt);
    } catch {
      // Health reporting must not affect queued delivery.
    }
  }
}

export function startEmailWorker(dependencies: EmailWorkerDependencies): () => Promise<void> {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = runWorkerCycle(dependencies).finally(() => {
        running = undefined;
        schedule();
      });
    }, dependencies.config.workerIntervalMs);
  };

  running = runWorkerCycle(dependencies).finally(() => {
    running = undefined;
    schedule();
  });

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await running;
  };
}
