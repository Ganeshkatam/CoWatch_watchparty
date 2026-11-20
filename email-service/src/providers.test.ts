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
  HOST_API_URL: 'https://api.cowatch.example',
  HOST_API_SECRET: 'c'.repeat(40),
  EMAIL_SERVICE_API_SECRET: 'e'.repeat(40),
  EMAIL_FROM_ADDRESS: 'accounts@cowatch.example',
  EMAIL_PROFILE_INVITATION_SENDER: 'invitations@cowatch.example',
  EMAIL_PROFILE_SECURITY_SENDER: 'security@cowatch.example',
  EMAIL_PROFILE_SYSTEM_SENDER: 'notifications@cowatch.example',
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

  const brevoTimeout = brevo.classifyError({ status: 408 });
  assert.equal(brevoTimeout.code, 'BREVO_TRANSIENT_408');
  assert.equal(brevoTimeout.retryable, true);

  const brevoThrottle = brevo.classifyError({ status: 429 });
  assert.equal(brevoThrottle.code, 'BREVO_TRANSIENT_429');
  assert.equal(brevoThrottle.retryable, true);

  const brevoAuth = brevo.classifyError({ status: 403 });
  assert.equal(brevoAuth.code, 'BREVO_AUTH_403');
  assert.equal(brevoAuth.retryable, false);

  const brevoServer = brevo.classifyError({ status: 500 });
  assert.equal(brevoServer.code, 'BREVO_TRANSIENT_FAILURE');
  assert.equal(brevoServer.retryable, true);
});

test('delivery profiles resolve distinct providers and sender identities', async () => {
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
  const defaultProvider = registry.getProviderForProfile('transactional_default');
  assert.equal(securityProvider.providerId, 'brevo');
  assert.equal(securityProvider.name, 'brevo:security');
  assert.equal(invitationProvider.providerId, 'smtp');
  assert.equal(invitationProvider, defaultProvider, 'SMTP profiles must share one pooled transport');
  assert.equal(getDeliveryProfile('transactional_security', config).fromAddress, 'security@cowatch.example');
  await registry.close();
});

test('provider failures retain typed retry semantics', () => {
  const error = new EmailProviderError('Temporary', 'TEMPORARY', true);
  assert.equal(error.code, 'TEMPORARY');
  assert.equal(error.retryable, true);
});

test('custom profile bindings resolve matching provider and credentials', () => {
  const config = loadConfig({
    ...baseEnv,
    EMAIL_PROFILE_SECURITY_BINDING: 'alerts',
    EMAIL_BINDING_ALERTS_PROVIDER: 'brevo',
    BREVO_API_KEY_ALERTS: 'alerts-api-key',
  });
  const provider = new EmailProviderRegistry(config).getProviderForProfile('transactional_security');
  assert.equal(provider.providerId, 'brevo');
  assert.equal(provider.name, 'brevo:alerts');
});

test('each Brevo delivery profile uses only its own account credentials', () => {
  const config = loadConfig({
    ...baseEnv,
    EMAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: 'default-account-key',
    BREVO_API_KEY_INVITATIONS: 'invitation-account-key',
    BREVO_API_KEY_SECURITY: 'security-account-key',
    BREVO_API_KEY_SYSTEM: 'system-account-key',
  });
  const registry = new EmailProviderRegistry(config);
  const profiles = [
    'transactional_default',
    'transactional_invitation',
    'transactional_security',
    'transactional_system',
  ] as const;
  const providers = profiles.map((profile) => registry.getProviderForProfile(profile));
  assert.deepEqual(providers.map((provider) => provider.name), [
    'brevo:default',
    'brevo:invitation',
    'brevo:security',
    'brevo:system',
  ]);
  assert.equal(new Set(providers).size, 4);
});
