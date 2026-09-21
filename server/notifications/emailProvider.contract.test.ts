/**
 * NOTIFY-002 Universal EmailProvider Contract Test Suite
 *
 * All provider adapters (Brevo, Resend, SMTP) must independently satisfy
 * this identical contract test suite to guarantee complete provider interchangeability.
 */

import type { EmailProvider, EmailMessage } from './emailProvider.ts';
import { EmailProviderError } from './emailErrors.ts';
import { BrevoEmailProvider } from './providers/brevoEmailProvider.ts';
import { SMTPEmailProvider } from './providers/smtpEmailProvider.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[ContractAssertionError] ${message}`);
  }
}

async function runContractSuite(provider: EmailProvider): Promise<void> {
  console.log(`\n--- Running Universal Contract Suite for: ${provider.name.toUpperCase()} ---`);

  // 1. Valid message dispatch (dry-run / contract mode)
  const validMessage: EmailMessage = {
    to: 'test-user@cowatch.tv',
    from: 'CoWatch <noreply@cowatch.tv>',
    subject: 'Room Invitation',
    html: '<p>You are invited!</p>',
    text: 'You are invited!',
    idempotencyKey: `contract-test-${Date.now()}-${provider.name}`,
  };

  const result = await provider.send(validMessage);
  assert(result.accepted === true, `${provider.name}: Send result must indicate accepted`);
  assert(
    typeof result.providerMessageId === 'string' && result.providerMessageId.length > 0,
    `${provider.name}: Send result must include a valid non-empty providerMessageId`,
  );
  assert(
    result.provider.toLowerCase() === provider.name.toLowerCase(),
    `${provider.name}: Send result must report matching provider name`,
  );
  console.log(`  PASS: Valid message accepted with providerMessageId "${result.providerMessageId}"`);

  // 2. Error classification: Rate limit handling
  const rateLimitErr = {
    isAxiosError: true,
    response: { status: 429, data: { message: 'Too many requests' } },
    responseCode: 421,
  };
  const classifiedRateLimit = provider.classifyError(rateLimitErr);
  assert(
    classifiedRateLimit instanceof EmailProviderError,
    `${provider.name}: Must return EmailProviderError instance`,
  );
  assert(
    classifiedRateLimit.category === 'RATE_LIMITED',
    `${provider.name}: 429/421 must be classified as RATE_LIMITED`,
  );
  assert(
    classifiedRateLimit.isRetryable === true,
    `${provider.name}: RATE_LIMITED error must be marked retryable`,
  );
  console.log(`  PASS: Rate limit error correctly classified as RATE_LIMITED (retryable)`);

  // 3. Error classification: Authentication failure (Permanent)
  const authErr = {
    isAxiosError: true,
    response: { status: 401, data: { message: 'Invalid API Key' } },
    responseCode: 535,
  };
  const classifiedAuth = provider.classifyError(authErr);
  assert(
    classifiedAuth instanceof EmailProviderError,
    `${provider.name}: Must return EmailProviderError instance`,
  );
  assert(
    classifiedAuth.category === 'AUTHENTICATION',
    `${provider.name}: 401/535 must be classified as AUTHENTICATION`,
  );
  assert(
    classifiedAuth.isRetryable === false,
    `${provider.name}: AUTHENTICATION error must NOT be retryable`,
  );
  console.log(`  PASS: Authentication error correctly classified as AUTHENTICATION (permanent)`);

  // 4. Error classification: Invalid recipient / Payload error (Permanent)
  const payloadErr = {
    isAxiosError: true,
    response: { status: 400, data: { message: 'Invalid email address format' } },
    responseCode: 501,
  };
  const classifiedPayload = provider.classifyError(payloadErr);
  assert(
    classifiedPayload instanceof EmailProviderError,
    `${provider.name}: Must return EmailProviderError instance`,
  );
  assert(
    classifiedPayload.category === 'INVALID_RECIPIENT',
    `${provider.name}: 400/501 must be classified as INVALID_RECIPIENT`,
  );
  assert(
    classifiedPayload.isRetryable === false,
    `${provider.name}: INVALID_RECIPIENT error must NOT be retryable`,
  );
  console.log(`  PASS: Invalid payload error correctly classified as INVALID_RECIPIENT (permanent)`);

  // 5. Error classification: Transient network / upstream server error
  const transientErr = {
    isAxiosError: true,
    response: { status: 500, data: { message: 'Internal Server Error' } },
    code: 'ECONNRESET',
  };
  const classifiedTransient = provider.classifyError(transientErr);
  assert(
    classifiedTransient instanceof EmailProviderError,
    `${provider.name}: Must return EmailProviderError instance`,
  );
  assert(
    classifiedTransient.category === 'TRANSIENT',
    `${provider.name}: 500/ECONNRESET must be classified as TRANSIENT`,
  );
  assert(
    classifiedTransient.isRetryable === true,
    `${provider.name}: TRANSIENT error must be marked retryable`,
  );
  console.log(`  PASS: Upstream 500/ECONNRESET correctly classified as TRANSIENT (retryable)`);

  // 6. Capability inspection
  assert(provider.capabilities !== undefined, `${provider.name}: Must declare capabilities`);
  assert(
    typeof provider.capabilities.nativeIdempotency === 'boolean',
    `${provider.name}: capabilities.nativeIdempotency must be boolean`,
  );
  assert(
    typeof provider.capabilities.transactionalSending === 'boolean',
    `${provider.name}: capabilities.transactionalSending must be boolean`,
  );
  assert(
    typeof provider.capabilities.deliveryWebhooks === 'boolean',
    `${provider.name}: capabilities.deliveryWebhooks must be boolean`,
  );
  assert(
    typeof provider.capabilities.bounceEvents === 'boolean',
    `${provider.name}: capabilities.bounceEvents must be boolean`,
  );
  console.log(`  PASS: Provider capabilities structure is valid`);
}

async function runAllContractTests(): Promise<void> {
  console.log('=== NOTIFY-002 Universal EmailProvider Contract Tests ===');

  const adapters: EmailProvider[] = [
    new BrevoEmailProvider(),
    new SMTPEmailProvider(),
  ];

  for (const adapter of adapters) {
    await runContractSuite(adapter);
  }

  console.log('\nAll EmailProvider Adapters passed the universal contract suite successfully!\n');
}

runAllContractTests().catch((err) => {
  console.error('EmailProvider contract test failure:', err);
  process.exit(1);
});
