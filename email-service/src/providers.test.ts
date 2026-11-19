import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.ts';
import {
  BrevoEmailProvider,
  EmailProviderRegistry,
  EmailProviderError,
  SMTPEmailProvider,
  getDeliveryProfile,
} from './providers.ts';

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  APP_URL: 'https://cowatch.example',
  COWATCH_API_URL: 'https://api.cowatch.example',
  COWATCH_API_SECRET: 'c'.repeat(40),
  EMAIL_SERVICE_API_SECRET: 'e'.repeat(40),
  EMAIL_FROM_ADDRESS: 'noreply@cowatch.example',
  EMAIL_FROM_NAME: 'CoWatch',
};

const message = {
  to: 'person@example.com',
  from: 'CoWatch <noreply@cowatch.example>',
  subject: 'Contract test',
  html: '<p>Test</p>',
  text: 'Test',
  idempotencyKey: 'contract-test-1',
};

test('SMTP and Brevo satisfy the provider send contract in dry-run mode', async () => {
  const config = loadConfig(baseEnv);
  const smtp = new SMTPEmailProvider(config);
  const brevo = new BrevoEmailProvider(config, 'brevo:default', '');
  const smtpResult = await smtp.send(message);
  const brevoResult = await brevo.send(message);
  assert.equal(smtpResult.accepted, true);
  assert.equal(smtpResult.provider, 'smtp');
  assert.ok(smtpResult.providerMessageId);
  assert.equal(brevoResult.accepted, true);
  assert.equal(brevoResult.provider, 'brevo');
  assert.ok(brevoResult.providerMessageId);
});

test('provider error classification distinguishes retryable and permanent failures', () => {
  const config = loadConfig(baseEnv);
  const smtp = new SMTPEmailProvider(config);
  const brevo = new BrevoEmailProvider(config, 'brevo:default', '');

  const smtpThrottle = smtp.classifyError({ responseCode: 421 });
  assert.equal(smtpThrottle.code, 'SMTP_THROTTLED_421');
  assert.equal(smtpThrottle.retryable, true);

  const smtpAuth = smtp.classifyError({ responseCode: 535, code: 'EAUTH' });
  assert.equal(smtpAuth.code, 'SMTP_AUTH_FAILURE');
  assert.equal(smtpAuth.retryable, false);

  const brevoThrottle = brevo.classifyError({ status: 429 });
  assert.equal(brevoThrottle.code, 'BREVO_RATE_LIMITED');
  assert.equal(brevoThrottle.retryable, true);

  const brevoAuth = brevo.classifyError({ status: 403 });
  assert.equal(brevoAuth.code, 'BREVO_AUTH_403');
  assert.equal(brevoAuth.retryable, false);

  const brevoServer = brevo.classifyError({ status: 500 });
  assert.equal(brevoServer.code, 'BREVO_TRANSIENT_FAILURE');
  assert.equal(brevoServer.retryable, true);
});

test('delivery profiles resolve distinct providers and sender identities', () => {
  const config = loadConfig({
    ...baseEnv,
    EMAIL_PROFILE_SECURITY_BINDING: 'security',
    EMAIL_BINDING_SECURITY_PROVIDER: 'brevo',
    BREVO_API_KEY_SECURITY: 'security-api-key',
    EMAIL_PROFILE_SECURITY_SENDER: 'security@cowatch.example',
  });
  const registry = new EmailProviderRegistry(config);
  const securityProvider = registry.getProviderForProfile('transactional_security');
  const invitationProvider = registry.getProviderForProfile('transactional_invitation');
  assert.equal(securityProvider.providerId, 'brevo');
  assert.equal(securityProvider.name, 'brevo:security');
  assert.equal(invitationProvider.providerId, 'smtp');
  assert.equal(getDeliveryProfile('transactional_security', config).fromAddress, 'security@cowatch.example');
});

test('provider failures retain typed retry semantics', () => {
  const error = new EmailProviderError('Temporary', 'TEMPORARY', true);
  assert.equal(error.code, 'TEMPORARY');
  assert.equal(error.retryable, true);
});
