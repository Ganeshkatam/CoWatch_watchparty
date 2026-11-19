import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { EmailServiceConfig } from './config.ts';
import { createEmailServiceServer } from './server.ts';

const config: EmailServiceConfig = {
  nodeEnv: 'test', host: '127.0.0.1', port: 0, appUrl: 'https://cowatch.example',
  cowatchApiUrl: 'https://api.cowatch.example', cowatchApiSecret: 'x'.repeat(32),
  serviceApiSecret: 'y'.repeat(32), workerIntervalMs: 15000, workerBatchSize: 10,
  workerConcurrency: 5, defaultProvider: 'smtp',
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

test('service API rejects unauthenticated and malformed security alert requests', async () => {
  let sent = 0;
  const provider = {
    name: 'brevo:security',
    providerId: 'brevo' as const,
    verifyConfiguration: async () => {},
    send: async () => {
      sent += 1;
      return { accepted: true, provider: 'brevo', providerMessageId: 'msg-security-1' };
    },
    classifyError: (error: unknown) => error,
  };
  const registry = {
    getProviderForProfile: () => provider,
  };
  const server = createEmailServiceServer(config, registry as never);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = 'http://127.0.0.1:' + address.port;

  try {
    const unauthorized = await fetch(baseUrl + '/internal/send/duplicate-signup-alert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'person@example.com',
        attemptedAt: '2026-09-15T12:00:00.000Z',
      }),
    });
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(baseUrl + '/internal/send/duplicate-signup-alert', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + config.serviceApiSecret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'person@example.com',
        attemptedAt: '2026-09-15T12:00:00.000Z',
        html: '<script>alert(1)</script>',
      }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(sent, 0);

    const accepted = await fetch(baseUrl + '/internal/send/duplicate-signup-alert', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + config.serviceApiSecret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'person@example.com',
        ipAddress: '192.0.2.1',
        attemptedAt: '2026-09-15T12:00:00.000Z',
      }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), {
      accepted: true,
      provider: 'brevo',
      providerMessageId: 'msg-security-1',
    });
    assert.equal(sent, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
