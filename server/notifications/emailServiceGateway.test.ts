import assert from 'node:assert/strict';
import { EmailServiceGateway } from './emailServiceGateway.ts';
import { computeEmailHash } from './suppression.ts';
import type { Pool } from 'pg';

async function run(): Promise<void> {
  const blockedEmail = 'blocked@example.com';
  const allowedEmail = 'allowed@example.com';
  const rows = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      recipient_email: blockedEmail,
      template_key: 'ROOM_STARTED',
      payload: { roomTitle: 'Blocked', roomUrl: 'https://cowatch.example/room/1' },
      delivery_profile: 'transactional_invitation',
      attempt_count: 1,
      provider_idempotency_key: 'blocked-key',
      locked_by: 'worker-a:lease-1',
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      recipient_email: allowedEmail,
      template_key: 'ROOM_STARTED',
      payload: { roomTitle: 'Allowed', roomUrl: 'https://cowatch.example/room/2' },
      delivery_profile: 'transactional_invitation',
      attempt_count: 1,
      provider_idempotency_key: 'allowed-key',
      locked_by: 'worker-a:lease-2',
    },
  ];
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const pool = {
    query: async <T = unknown>(sql: string, values: unknown[] = []) => {
      queries.push({ sql, values });
      if (sql.includes('WITH claimed AS')) return { rows: rows as T[], rowCount: 2 };
      if (sql.includes('SELECT email_hash')) {
        return { rows: [{ email_hash: computeEmailHash(blockedEmail) }] as T[], rowCount: 1 };
      }
      if (sql.includes('SELECT attempt_count')) return { rows: [{ attempt_count: 1 }] as T[], rowCount: 1 };
      if (sql.includes('locked_by =')) {
        return { rows: [], rowCount: values.includes('stale-lease') ? 0 : 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;

  const gateway = new EmailServiceGateway(pool);
  const jobs = await gateway.claimJobs(2, 'worker-a');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].recipientEmail, allowedEmail);
  assert.equal(jobs[0].leaseToken, 'worker-a:lease-2');
  assert.ok(queries.some((query) => query.sql.includes('FOR UPDATE SKIP LOCKED')));
  assert.ok(queries.some((query) => query.sql.includes('email_delivery_suppressions')));

  assert.equal(await gateway.markDispatchStarted(jobs[0].id, jobs[0].leaseToken), true);
  assert.equal(await gateway.markSent(jobs[0].id, jobs[0].leaseToken, 'brevo', 'provider-message-1'), true);
  assert.equal(await gateway.markFailed(jobs[0].id, jobs[0].leaseToken, 'TEMPORARY_FAILURE', true), true);
  assert.equal(await gateway.markSent(jobs[0].id, 'stale-lease', 'brevo', 'provider-message-2'), false);

  const stateTransitions = queries.filter((query) =>
    query.sql.includes('UPDATE public.email_outbox') && query.sql.includes('WHERE id = $1'),
  );
  assert.ok(stateTransitions.length >= 4, 'Expected suppression, dispatch, sent, and retry transitions');
  assert.ok(
    stateTransitions.every((query) => query.sql.includes('locked_by = $')),
    'Every job state transition must be fenced by its lease token',
  );
  console.log('Remote email gateway claim, suppression, lease fencing, and transitions passed.');
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
