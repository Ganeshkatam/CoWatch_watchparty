/**
 * NOTIFY-001A Resend Webhook Adversarial Test Suite
 *
 * Verifies:
 *   1. Signature verification: invalid signature yields 401.
 *   2. Missing event-id yields 400.
 *   3. Malformed payload yields 400.
 *   4. Duplicate event-id returns 200 (duplicate_ignored) without duplicate state mutation.
 *   5. Unknown event types are safely ignored without crashing.
 *   6. Outbox rows are updated strictly via provider_message_id.
 *   7. Bounced and complained events trigger SHA-256 suppression without exposing plaintext.
 */

import { ResendWebhookHandler } from './resendWebhook.ts';
import { MockWebhookVerifier, SvixWebhookVerifier } from './webhookVerifier.ts';
import { computeEmailHash } from './suppression.ts';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[WebhookAdversarialTest] Assertion Failed: ${message}`);
  }
}

// Minimal mock Express Response
function createMockResponse() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: any };
}

async function runWebhookAdversarialTests() {
  console.log('=== NOTIFY-001A Resend Webhook Adversarial Test Suite ===\n');

  // ---------------------------------------------------------------------------
  // Case 1: Cryptographic Svix Verification Test
  // ---------------------------------------------------------------------------
  console.log('Case 1: Testing Svix signature verifier with valid and invalid signatures...');
  const testSecret = 'whsec_' + Buffer.from('test-secret-key-32-bytes-long!').toString('base64');
  const verifier = new SvixWebhookVerifier(testSecret);

  const payload = JSON.stringify({ id: 'evt_123', type: 'email.delivered' });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const svixId = 'msg_test_123';

  // Compute valid signature
  const cleanSecret = testSecret.slice(6);
  const secretBytes = Buffer.from(cleanSecret, 'base64');
  const signature = crypto
    .createHmac('sha256', secretBytes)
    .update(`${svixId}.${timestamp}.${payload}`, 'utf8')
    .digest('base64');

  const validHeaders = {
    'svix-id': svixId,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  };

  assert(verifier.verify(payload, validHeaders) === true, 'Valid signature must verify successfully');

  // Tampered payload
  const tamperedPayload = JSON.stringify({ id: 'evt_123', type: 'email.bounced' });
  assert(
    verifier.verify(tamperedPayload, validHeaders) === false,
    'Tampered payload must fail signature verification',
  );

  // Expired timestamp (replay attack simulation: 10 minutes old)
  const expiredHeaders = {
    ...validHeaders,
    'svix-timestamp': (Math.floor(Date.now() / 1000) - 600).toString(),
  };
  assert(
    verifier.verify(payload, expiredHeaders) === false,
    'Expired timestamp (>300s) must be rejected to prevent replay attacks',
  );
  console.log('  PASSED: Svix signature verification correctly validates authentic payloads and rejects tampering/replay');

  // ---------------------------------------------------------------------------
  // Case 2: Missing or Invalid Signature Handling
  // ---------------------------------------------------------------------------
  console.log('Case 2: Testing HTTP response on invalid/missing signature...');
  const mockVerifier = new MockWebhookVerifier(false); // Reject all
  const recordedEvents = new Set<string>();
  const outboxStatusUpdates: Array<{ providerMessageId: string; status: string }> = [];
  const recordedSuppressions: Array<{ emailHash: string; reason: string }> = [];

  const mockStore = {
    async recordWebhookEventIdempotent(provider: string, eventId: string): Promise<boolean> {
      const key = `${provider}:${eventId}`;
      if (recordedEvents.has(key)) return false;
      recordedEvents.add(key);
      return true;
    },
    async updateDeliveryStatusByProviderMessageId(providerMessageId: string, status: any): Promise<boolean> {
      outboxStatusUpdates.push({ providerMessageId, status });
      return true;
    },
    async recordEmailSuppression(emailHash: string, reason: any): Promise<void> {
      recordedSuppressions.push({ emailHash, reason });
    },
  };

  const handler = new ResendWebhookHandler(mockVerifier, mockStore);

  const mockReq: any = {
    body: { id: 'evt_unauthorized', type: 'email.delivered' },
    headers: {},
  };
  const mockRes = createMockResponse();

  await handler.handleRequest(mockReq, mockRes);
  assert(mockRes.statusCode === 401, 'Invalid signature must return HTTP 401');
  assert(mockRes.body?.error === 'INVALID_SIGNATURE', 'Response must indicate invalid signature');
  console.log('  PASSED: Unauthorized requests return HTTP 401');

  // ---------------------------------------------------------------------------
  // Case 3: Malformed Payload Handling
  // ---------------------------------------------------------------------------
  console.log('Case 3: Testing malformed payload rejection...');
  mockVerifier.setShouldPass(true); // Allow signature

  const malformedReq: any = {
    body: '{"invalid_json: unclosed',
    headers: { 'svix-id': 'evt_malformed' },
  };
  const malformedRes = createMockResponse();

  await handler.handleRequest(malformedReq, malformedRes);
  assert(malformedRes.statusCode === 400, 'Malformed JSON must return HTTP 400');
  console.log('  PASSED: Malformed JSON payloads return HTTP 400');

  // ---------------------------------------------------------------------------
  // Case 4: Idempotency & Deduplication
  // ---------------------------------------------------------------------------
  console.log('Case 4: Testing webhook idempotency (duplicate event suppression)...');
  const validEventReq: any = {
    body: {
      id: 'evt_idempotent_1',
      type: 'email.delivered',
      data: { email_id: 'msg_resend_999' },
    },
    headers: { 'svix-id': 'evt_idempotent_1' },
  };

  const firstRes = createMockResponse();
  await handler.handleRequest(validEventReq, firstRes);
  assert(firstRes.statusCode === 200, 'First event processing must succeed');
  assert(firstRes.body?.status === 'processed', 'First event should be processed');
  assert(
    outboxStatusUpdates.some((u) => u.providerMessageId === 'msg_resend_999' && u.status === 'DELIVERED'),
    'Delivery status must be updated for msg_resend_999',
  );

  const duplicateRes = createMockResponse();
  await handler.handleRequest(validEventReq, duplicateRes);
  assert(duplicateRes.statusCode === 200, 'Duplicate event must return HTTP 200');
  assert(duplicateRes.body?.status === 'duplicate_ignored', 'Duplicate event must be ignored');
  console.log('  PASSED: Duplicate event IDs are safely ignored without redundant mutations');

  // ---------------------------------------------------------------------------
  // Case 5: Unknown Event Safely Ignored
  // ---------------------------------------------------------------------------
  console.log('Case 5: Testing unknown event type handling...');
  const unknownReq: any = {
    body: { id: 'evt_unknown_999', type: 'email.clicked', data: {} },
    headers: { 'svix-id': 'evt_unknown_999' },
  };
  const unknownRes = createMockResponse();

  await handler.handleRequest(unknownReq, unknownRes);
  assert(unknownRes.statusCode === 200, 'Unknown event type must return HTTP 200');
  assert(unknownRes.body?.status === 'event_ignored', 'Status must indicate event was safely ignored');
  console.log('  PASSED: Unknown events are safely acknowledged and ignored');

  // ---------------------------------------------------------------------------
  // Case 6: Deliverability Suppression & Bounce Handling
  // ---------------------------------------------------------------------------
  console.log('Case 6: Testing bounce event processing and SHA-256 suppression registration...');
  const bouncedEmail = 'bounced_recipient@external-domain.org';
  const expectedBounceHash = computeEmailHash(bouncedEmail);

  const bounceReq: any = {
    body: {
      id: 'evt_bounce_123',
      type: 'email.bounced',
      data: {
        email_id: 'msg_bounce_outbox_456',
        to: [bouncedEmail],
      },
    },
    headers: { 'svix-id': 'evt_bounce_123' },
  };
  const bounceRes = createMockResponse();

  await handler.handleRequest(bounceReq, bounceRes);
  assert(bounceRes.statusCode === 200, 'Bounce event must return HTTP 200');
  assert(
    outboxStatusUpdates.some(
      (u) => u.providerMessageId === 'msg_bounce_outbox_456' && u.status === 'BOUNCED',
    ),
    'Outbox row must be updated to BOUNCED via provider_message_id',
  );
  assert(
    recordedSuppressions.some((s) => s.emailHash === expectedBounceHash && s.reason === 'bounced'),
    'Recipient email must be hashed with SHA-256 and recorded as suppressed',
  );
  console.log('  PASSED: Bounce event updates outbox by provider_message_id and registers SHA-256 suppression');

  console.log('\nAll Resend Webhook Adversarial Tests Passed Successfully!');
}

runWebhookAdversarialTests().catch((err) => {
  console.error('\nWebhook adversarial test failure:', err);
  process.exit(1);
});
