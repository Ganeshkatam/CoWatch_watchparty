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

export class HostApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HostApiError';
  }
}

export class HostApiClient {
  constructor(
    private readonly config: Pick<EmailServiceConfig, 'hostApiUrl' | 'hostApiSecret'>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetcher(new URL(path, this.config.hostApiUrl), {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + this.config.hostApiSecret,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok && response.status !== 204) {
      throw new HostApiError(response.status, 'HOST_API_REQUEST_FAILED');
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async claimJobs(workerId: string, batchSize: number): Promise<EmailJob[]> {
    const result = await this.post('/internal/email/jobs/claim', { workerId, batchSize });
    if (typeof result !== 'object' || result === null || !Array.isArray((result as Record<string, unknown>).jobs)) {
      throw new HostApiError(502, 'INVALID_CLAIM_RESPONSE');
    }
    const jobs: EmailJob[] = [];
    for (const item of (result as { jobs: unknown[] }).jobs) {
      if (typeof item !== 'object' || item === null) throw new HostApiError(502, 'INVALID_JOB');
      const job = item as Record<string, unknown>;
      if (typeof job.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(job.id) ||
          typeof job.recipientEmail !== 'string' || job.recipientEmail.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.recipientEmail) ||
          typeof job.templateKey !== 'string' || job.templateKey.length > 100 ||
          typeof job.deliveryProfile !== 'string' ||
          typeof job.attemptCount !== 'number' || !Number.isInteger(job.attemptCount) || job.attemptCount < 1 ||
          typeof job.idempotencyKey !== 'string' || !/^[a-zA-Z0-9._:-]{1,256}$/.test(job.idempotencyKey) ||
          typeof job.leaseToken !== 'string' || !job.leaseToken || job.leaseToken.length > 160 ||
          typeof job.payload !== 'object' || job.payload === null || Array.isArray(job.payload)) {
        throw new HostApiError(502, 'INVALID_JOB');
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
