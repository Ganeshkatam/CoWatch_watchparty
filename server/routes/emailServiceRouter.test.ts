import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import config from '../config.ts';
import { createEmailServiceRouter, type EmailServiceGatewayContract } from './emailServiceRouter.ts';

test('remote worker API authenticates requests and fences stale leases', async () => {
  const originalSecret = config.EMAIL_SERVICE_WORKER_SECRET;
  config.EMAIL_SERVICE_WORKER_SECRET = 's'.repeat(40);
  const calls: string[] = [];
  const gateway: EmailServiceGatewayContract = {
    claimJobs: async (batchSize, workerId) => {
      calls.push('claim:' + batchSize + ':' + workerId);
      return [{ id: '00000000-0000-4000-8000-000000000001' }];
    },
    markDispatchStarted: async (_id, token) => token === 'valid-lease',
    markSent: async (_id, token) => token === 'valid-lease',
    markFailed: async (_id, token) => token === 'valid-lease',
  };

  const app = express();
  app.use(express.json());
  app.use('/internal/email', createEmailServiceRouter(gateway));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = 'http://127.0.0.1:' + address.port;

  try {
    const unauthorized = await fetch(baseUrl + '/internal/email/jobs/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workerId: 'worker-a', batchSize: 2 }),
    });
    assert.equal(unauthorized.status, 401);

    const claimed = await fetch(baseUrl + '/internal/email/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + config.EMAIL_SERVICE_WORKER_SECRET,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ workerId: 'worker-a', batchSize: 2 }),
    });
    assert.equal(claimed.status, 200);
    assert.deepEqual(await claimed.json(), { jobs: [{ id: '00000000-0000-4000-8000-000000000001' }] });
    assert.deepEqual(calls, ['claim:2:worker-a']);

    const stale = await fetch(baseUrl + '/internal/email/jobs/00000000-0000-4000-8000-000000000001/sent', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + config.EMAIL_SERVICE_WORKER_SECRET,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        leaseToken: 'stale-lease', provider: 'brevo', messageId: 'msg-1',
      }),
    });
    assert.equal(stale.status, 409);

    const valid = await fetch(baseUrl + '/internal/email/jobs/00000000-0000-4000-8000-000000000001/sent', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + config.EMAIL_SERVICE_WORKER_SECRET,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        leaseToken: 'valid-lease', provider: 'brevo', messageId: 'msg-1',
      }),
    });
    assert.equal(valid.status, 204);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    config.EMAIL_SERVICE_WORKER_SECRET = originalSecret;
  }
});
