import type { EmailServiceConfig } from './config.ts';

export interface EmailJob {
  id: string;
  recipientEmail: string;
  templateKey: string;
  payload: Record<string, unknown>;
  deliveryProfile: string;
  attemptCount: number;
  idempotencyKey: string;
  leaseToken: string;
}

export class CoWatchApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'CoWatchApiError';
  }
}

export class CoWatchApiClient {
  constructor(
    private readonly config: Pick<EmailServiceConfig, 'cowatchApiUrl' | 'cowatchApiSecret'>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetcher(new URL(path, this.config.cowatchApiUrl), {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + this.config.cowatchApiSecret,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok && response.status !== 204) {
      throw new CoWatchApiError(response.status, 'COWATCH_API_REQUEST_FAILED');
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async claimJobs(workerId: string, batchSize: number): Promise<EmailJob[]> {
    const result = await this.post('/internal/email/jobs/claim', { workerId, batchSize });
    if (typeof result !== 'object' || result === null || !Array.isArray((result as Record<string, unknown>).jobs)) {
      throw new CoWatchApiError(502, 'INVALID_CLAIM_RESPONSE');
    }
    const jobs: EmailJob[] = [];
    for (const item of (result as { jobs: unknown[] }).jobs) {
      if (typeof item !== 'object' || item === null) throw new CoWatchApiError(502, 'INVALID_JOB');
      const job = item as Record<string, unknown>;
      if (typeof job.id !== 'string' || typeof job.recipientEmail !== 'string' ||
          typeof job.templateKey !== 'string' || typeof job.deliveryProfile !== 'string' ||
          typeof job.attemptCount !== 'number' || typeof job.idempotencyKey !== 'string' ||
          typeof job.leaseToken !== 'string' || typeof job.payload !== 'object' ||
          job.payload === null || Array.isArray(job.payload)) {
        throw new CoWatchApiError(502, 'INVALID_JOB');
      }
      jobs.push(job as unknown as EmailJob);
    }
    return jobs;
  }

  async markDispatchStarted(job: EmailJob): Promise<void> {
    await this.post('/internal/email/jobs/' + encodeURIComponent(job.id) + '/dispatch', {
      leaseToken: job.leaseToken,
    });
  }

  async markSent(job: EmailJob, provider: string, messageId: string): Promise<void> {
    await this.post('/internal/email/jobs/' + encodeURIComponent(job.id) + '/sent', {
      leaseToken: job.leaseToken,
      provider,
      messageId,
    });
  }

  async markFailed(job: EmailJob, errorCode: string, retryable: boolean): Promise<void> {
    await this.post('/internal/email/jobs/' + encodeURIComponent(job.id) + '/fail', {
      leaseToken: job.leaseToken,
      errorCode,
      retryable,
    });
  }

  async heartbeat(durationMs: number): Promise<void> {
    await this.post('/internal/email/worker/heartbeat', { durationMs });
  }
}
