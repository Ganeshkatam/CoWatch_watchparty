/**
 * NOTIFY-002 Universal EmailProvider Contract Test Suite
 *
 * All provider adapters (Brevo, Resend, SMTP) must independently satisfy
 * this identical contract test suite to guarantee complete provider interchangeability.
 */

import type { EmailProvider, EmailMessage } from './emailProvider.ts';
import { EmailProviderError } from './emailErrors.ts';
import { BrevoEmailProvider } from './providers/brevoEmailProvider.ts';
import { ResendEmailProvider } from './providers/resendEmailProvider.ts';
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
    `${provider.name}: RATE_LIMITED errors must be retryable`,
  );
  console.log(`  PASS: Rate limiting correctly classified as retryable RATE_LIMITED`);

  // 3. Error classification: Authentication failure
  const authErr = {
    isAxiosError: true,
    response: { status: 401, data: { message: 'Bad API key' } },
    responseCode: 535,
  };
  const classifiedAuth = provider.classifyError(authErr);
  assert(
    classifiedAuth.category === 'AUTHENTICATION',
    `${provider.name}: 401/535 must be classified as AUTHENTICATION`,
  );
  assert(
    classifiedAuth.isRetryable === false,
    `${provider.name}: AUTHENTICATION errors must be non-retryable`,
  );
  console.log(`  PASS: Credential failure correctly classified as non-retryable AUTHENTICATION`);

  // 4. Error classification: Invalid recipient
  const recipientErr = {
    isAxiosError: true,
    response: { status: 400, data: { message: 'Invalid email address' } },
    responseCode: 550,
  };
  const classifiedRecipient = provider.classifyError(recipientErr);
  assert(
    classifiedRecipient.category === 'INVALID_RECIPIENT',
    `${provider.name}: 400/550 must be classified as INVALID_RECIPIENT`,
  );
  assert(
    classifiedRecipient.isRetryable === false,
    `${provider.name}: INVALID_RECIPIENT errors must be non-retryable`,
  );
  console.log(`  PASS: Malformed/invalid recipient correctly classified as INVALID_RECIPIENT`);

  // 5. Error classification: Transient / Network timeout
  const timeoutErr = {
    isAxiosError: true,
    code: 'ETIMEDOUT',
    responseCode: 451,
  };
  const classifiedTimeout = provider.classifyError(timeoutErr);
  assert(
    classifiedTimeout.category === 'TRANSIENT',
    `${provider.name}: ETIMEDOUT/451 must be classified as TRANSIENT`,
  );
  assert(
    classifiedTimeout.isRetryable === true,
    `${provider.name}: TRANSIENT errors must be retryable`,
  );
  console.log(`  PASS: Timeout failure correctly classified as retryable TRANSIENT`);

  // 6. Capability contract consistency
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
    new ResendEmailProvider(),
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
