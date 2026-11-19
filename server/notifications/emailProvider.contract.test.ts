import assert from 'node:assert/strict';
import { loadConfig } from '../../email-service/src/config.ts';
import {
  type EmailProvider,
  type EmailMessage,
  EmailProviderError,
  BrevoEmailProvider,
  SMTPEmailProvider,
} from '../../email-service/src/providers.ts';

const config = loadConfig({
  NODE_ENV: 'test',
  APP_URL: 'https://cowatch.example',
  COWATCH_API_URL: 'https://api.cowatch.example',
  COWATCH_API_SECRET: 'c'.repeat(40),
  EMAIL_SERVICE_API_SECRET: 'e'.repeat(40),
  EMAIL_FROM_ADDRESS: 'noreply@cowatch.example',
});

const message: EmailMessage = {
  to: 'person@example.com',
  from: 'CoWatch <noreply@cowatch.example>',
  subject: 'Room Invitation',
  html: '<p>You are invited</p>',
  text: 'You are invited',
  idempotencyKey: 'provider-contract-1',
};

async function verifyProvider(provider: EmailProvider): Promise<void> {
  await provider.verifyConfiguration();
  const result = await provider.send(message);
  assert.equal(result.accepted, true);
  assert.equal(result.provider, provider.providerId);
  assert.ok(result.providerMessageId.length > 0);

  const throttled = provider.classifyError({ status: 429, responseCode: 421 });
  assert.ok(throttled instanceof EmailProviderError);
  assert.equal(throttled.retryable, true);

  const permanent = provider.classifyError({ status: 403, responseCode: 535, code: 'EAUTH' });
  assert.equal(permanent.retryable, false);

  const transient = provider.classifyError({ status: 500, code: 'ECONNRESET' });
  assert.equal(transient.retryable, true);
}

async function main(): Promise<void> {
  await verifyProvider(new SMTPEmailProvider(config));
  await verifyProvider(new BrevoEmailProvider(config, 'brevo:default', ''));
  console.log('Standalone SMTP and Brevo provider contract tests passed.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
