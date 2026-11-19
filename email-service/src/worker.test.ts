import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkerCycle, type EmailWorkerDependencies } from './worker.ts';
import { EmailProviderError } from './providers.ts';
import type { EmailServiceConfig } from './config.ts';
import type { EmailJob } from './apiClient.ts';

const config: EmailServiceConfig = {
  nodeEnv: 'test', host: '127.0.0.1', port: 8090, appUrl: 'https://cowatch.example',
  cowatchApiUrl: 'https://api.cowatch.example', cowatchApiSecret: 'x'.repeat(32),
  serviceApiSecret: 'y'.repeat(32), workerIntervalMs: 15000, workerBatchSize: 10,
  workerConcurrency: 2, defaultProvider: 'smtp',
  fromAddress: 'noreply@cowatch.example', fromName: 'CoWatch',
  profileSenders: {
    transactional_default: 'noreply@cowatch.example',
    transactional_security: 'security@cowatch.example',
    transactional_invitation: 'invites@cowatch.example',
    transactional_system: 'updates@cowatch.example',
  },
  profileBindings: {
    transactional_default: 'default', transactional_security: 'security',
    transactional_invitation: 'invitation', transactional_system: 'system',
  },
  bindingProviders: {}, brevoKeys: {},
  smtp: { host: '', port: 587, username: '', password: '', secure: false },
};

function job(id: string, deliveryProfile: string, templateKey = 'ROOM_STARTED'): EmailJob {
  return {
    id, recipientEmail: 'person@example.com', templateKey,
    payload: { roomTitle: 'Movie Night', roomUrl: 'https://cowatch.example/join/room-1' },
    deliveryProfile, attemptCount: 1, idempotencyKey: 'notify:' + id, leaseToken: 'lease:' + id,
  };
}

function dependencies(
  jobs: EmailJob[],
  overrides: Partial<EmailWorkerDependencies['api']> = {},
): { deps: EmailWorkerDependencies; sends: string[]; failures: Array<{ id: string; code: string; retryable: boolean }> } {
  const sends: string[] = [];
  const failures: Array<{ id: string; code: string; retryable: boolean }> = [];
  const api: EmailWorkerDependencies['api'] = {
    claimJobs: async () => jobs,
    markDispatchStarted: async () => {},
    markSent: async () => {},
    markFailed: async (item, code, retryable) => { failures.push({ id: item.id, code, retryable }); },
    heartbeat: async () => {},
    ...overrides,
  };
  const deps: EmailWorkerDependencies = {
    api,
    providers: {
      getProviderForProfile: (profile) => ({
        name: 'provider-' + profile,
        providerId: 'brevo' as const,
        verifyConfiguration: async () => {},
        send: async (message) => {
          sends.push(profile + ':' + message.to);
          return { accepted: true, provider: 'provider-' + profile, providerMessageId: 'msg-' + profile };
        },
        classifyError: (error) => error instanceof EmailProviderError
          ? error
          : new EmailProviderError('Unknown', 'UNKNOWN', true),
      }),
    },
    config,
    workerId: 'test-worker',
  };
  return { deps, sends, failures };
}

test('worker routes each job using its own delivery profile', async () => {
  const state = dependencies([
    job('1', 'transactional_invitation'),
    job('2', 'transactional_security'),
  ]);
  await runWorkerCycle(state.deps);
  assert.deepEqual(state.sends, [
    'transactional_invitation:person@example.com',
    'transactional_security:person@example.com',
  ]);
  assert.equal(state.failures.length, 0);
});

test('unknown templates fail permanently and are never sent', async () => {
  const state = dependencies([job('3', 'transactional_default', 'UNKNOWN_TEMPLATE')]);
  await runWorkerCycle(state.deps);
  assert.equal(state.sends.length, 0);
  assert.deepEqual(state.failures, [{ id: '3', code: 'TEMPLATE_NOT_FOUND', retryable: false }]);
});

test('provider failure is classified and reported for retry', async () => {
  const state = dependencies([job('4', 'transactional_default')]);
  state.deps.providers.getProviderForProfile = () => ({
    name: 'mock',
    providerId: 'smtp' as const,
    verifyConfiguration: async () => {},
    send: async () => { throw new EmailProviderError('temporary', 'TEMPORARY', true); },
    classifyError: (error) => error instanceof EmailProviderError
      ? error
      : new EmailProviderError('unknown', 'UNKNOWN', true),
  });
  await runWorkerCycle(state.deps);
  assert.deepEqual(state.failures, [{ id: '4', code: 'TEMPORARY', retryable: true }]);
});

test('lost success acknowledgement does not incorrectly mark an accepted email failed', async () => {
  const state = dependencies([job('5', 'transactional_default')], {
    markSent: async () => { throw new Error('ack timeout'); },
  });
  await runWorkerCycle(state.deps);
  assert.equal(state.sends.length, 1);
  assert.equal(state.failures.length, 0);
});
