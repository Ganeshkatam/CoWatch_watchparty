import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.ts';

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:5173',
  HOST_API_URL: 'http://127.0.0.1:8080',
  HOST_API_SECRET: 'c'.repeat(40),
  EMAIL_SERVICE_API_SECRET: 'e'.repeat(40),
  EMAIL_FROM_ADDRESS: 'accounts@example.com',
  EMAIL_PROFILE_INVITATION_SENDER: 'invitations@example.com',
  EMAIL_PROFILE_SECURITY_SENDER: 'security@example.com',
  EMAIL_PROFILE_SYSTEM_SENDER: 'notifications@example.com',
};

test('configuration validates service secrets, URLs, and bounded worker settings', () => {
  const config = loadConfig({
    ...baseEnv,
    EMAIL_WORKER_BATCH_SIZE: '12',
    EMAIL_WORKER_CONCURRENCY: '4',
    EMAIL_SMTP_PORT: '465',
    EMAIL_SMTP_SECURE: 'false',
  });
  assert.equal(config.workerBatchSize, 12);
  assert.equal(config.workerConcurrency, 4);
  assert.equal(config.smtp.secure, true);
  assert.equal(config.profileSenders.transactional_security, 'security@example.com');
});

test('production rejects insecure upstream URLs and short credentials', () => {
  assert.throws(() => loadConfig({ ...baseEnv, NODE_ENV: 'production', APP_URL: 'https://cowatch.example' }), /HOST_API_URL_REQUIRES_HTTPS/);
  assert.throws(() => loadConfig({ ...baseEnv, HOST_API_SECRET: 'short' }), /HOST_API_SECRET/);
  assert.throws(() => loadConfig({ ...baseEnv, EMAIL_SERVICE_API_SECRET: 'short' }), /EMAIL_SERVICE_API_SECRET/);
});

test('configuration rejects unsafe sender identities and out-of-range concurrency', () => {
  assert.throws(() => loadConfig({ ...baseEnv, EMAIL_FROM_ADDRESS: 'bad sender' }), /EMAIL_SENDER/);
  assert.throws(() => loadConfig({ ...baseEnv, EMAIL_WORKER_CONCURRENCY: '100' }), /EMAIL_WORKER_CONCURRENCY/);
});

test('Brevo profiles require independent credentials and unique sender identities', () => {
  const brevoEnv = {
    ...baseEnv,
    EMAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: 'default-account-key',
    BREVO_API_KEY_INVITATIONS: 'invitation-account-key',
    BREVO_API_KEY_SECURITY: 'security-account-key',
    BREVO_API_KEY_SYSTEM: 'system-account-key',
  };
  assert.equal(loadConfig(brevoEnv).brevoKeys.security, 'security-account-key');
  assert.throws(() => loadConfig({ ...brevoEnv, BREVO_API_KEY_SECURITY: '' }), /BREVO_API_KEY_SECURITY/);
  assert.throws(() => loadConfig({ ...brevoEnv, BREVO_API_KEY_SECURITY: 'default-account-key' }), /BREVO_API_KEYS_MUST_BE_UNIQUE/);
  assert.throws(() => loadConfig({ ...brevoEnv, EMAIL_PROFILE_SECURITY_SENDER: 'accounts@example.com' }), /EMAIL_PROFILE_SENDERS_MUST_BE_UNIQUE/);
});
