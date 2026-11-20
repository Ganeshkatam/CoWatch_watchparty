import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

export type DeliveryProfileId =
  | 'transactional_default'
  | 'transactional_security'
  | 'transactional_invitation'
  | 'transactional_system';

export interface EmailServiceConfig {
  nodeEnv: string;
  host: string;
  port: number;
  appUrl: string;
  hostApiUrl: string;
  hostApiSecret: string;
  serviceApiSecret: string;
  workerIntervalMs: number;
  workerBatchSize: number;
  workerConcurrency: number;
  defaultProvider: 'smtp' | 'brevo';
  fromAddress: string;
  fromName: string;
  profileSenders: Record<DeliveryProfileId, string>;
  profileBindings: Record<DeliveryProfileId, string>;
  bindingProviders: Record<string, string>;
  brevoKeys: Record<string, string>;
  smtp: {
    host: string;
    port: number;
    username: string;
    password: string;
    secure: boolean;
  };
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number, key: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error('INVALID_CONFIGURATION:' + key);
  }
  return parsed;
}

function booleanValue(value: string | undefined, fallback: boolean, key: string): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error('INVALID_CONFIGURATION:' + key);
}

function requiredSecret(value: string | undefined, key: string): string {
  if (!value || value.trim().length < 32) throw new Error('INVALID_CONFIGURATION:' + key);
  return value.trim();
}

function serviceUrl(value: string | undefined, nodeEnv: string): string {
  if (!value) throw new Error('INVALID_CONFIGURATION:HOST_API_URL');
  const parsed = new URL(value);
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
    throw new Error('INVALID_CONFIGURATION:HOST_API_URL_REQUIRES_HTTPS');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('INVALID_CONFIGURATION:HOST_API_URL_ORIGIN_ONLY');
  }
  return parsed.toString().replace(/\/$/, '');
}

function appBaseUrl(value: string | undefined, nodeEnv: string): string {
  if (!value) throw new Error('INVALID_CONFIGURATION:APP_URL');
  const parsed = new URL(value);
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
    throw new Error('INVALID_CONFIGURATION:APP_URL_REQUIRES_HTTPS');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('INVALID_CONFIGURATION:APP_URL_ORIGIN_ONLY');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EmailServiceConfig {
  const nodeEnv = env.NODE_ENV || 'development';
  const provider = (env.EMAIL_PROVIDER || 'smtp').toLowerCase();
  if (provider !== 'smtp' && provider !== 'brevo') {
    throw new Error('INVALID_CONFIGURATION:EMAIL_PROVIDER');
  }

  const profileIds: DeliveryProfileId[] = [
    'transactional_default',
    'transactional_security',
    'transactional_invitation',
    'transactional_system',
  ];
  const profileBindings: Record<DeliveryProfileId, string> = {
    transactional_default: env.EMAIL_PROFILE_DEFAULT_BINDING || 'default',
    transactional_security: env.EMAIL_PROFILE_SECURITY_BINDING || 'security',
    transactional_invitation: env.EMAIL_PROFILE_INVITATION_BINDING || 'invitation',
    transactional_system: env.EMAIL_PROFILE_SYSTEM_BINDING || 'system',
  };
  const profileSenders: Record<DeliveryProfileId, string> = {
    transactional_default: env.EMAIL_FROM_ADDRESS || '',
    transactional_security: env.EMAIL_PROFILE_SECURITY_SENDER || '',
    transactional_invitation: env.EMAIL_PROFILE_INVITATION_SENDER || '',
    transactional_system: env.EMAIL_PROFILE_SYSTEM_SENDER || '',
  };
  const bindings = Object.values(profileBindings);
  if (new Set(bindings).size !== profileIds.length) {
    throw new Error('INVALID_CONFIGURATION:EMAIL_PROFILE_BINDINGS_MUST_BE_UNIQUE');
  }
  const bindingProviders: Record<string, string> = {};
  const brevoKeys: Record<string, string> = {};
  const keyEnvByProfile: Record<DeliveryProfileId, string> = {
    transactional_default: 'BREVO_API_KEY',
    transactional_security: 'BREVO_API_KEY_SECURITY',
    transactional_invitation: 'BREVO_API_KEY_INVITATIONS',
    transactional_system: 'BREVO_API_KEY_SYSTEM',
  };
  for (const id of profileIds) {
    const binding = profileBindings[id];
    const suffix = binding.toUpperCase();
    const providerName = (env['EMAIL_BINDING_' + suffix + '_PROVIDER'] || provider).toLowerCase();
    if (providerName !== 'smtp' && providerName !== 'brevo') {
      throw new Error('INVALID_CONFIGURATION:EMAIL_BINDING_PROVIDER');
    }
    bindingProviders[binding] = providerName;
    brevoKeys[binding] = env[keyEnvByProfile[id]]?.trim() || '';
    if (providerName === 'brevo' && !brevoKeys[binding]) {
      throw new Error('INVALID_CONFIGURATION:' + keyEnvByProfile[id]);
    }
  }

  for (const id of profileIds) {
    if (!/^[^\\s<>@]+@[^\\s<>@]+\\.[^\\s<>@]+$/.test(profileSenders[id])) {
      throw new Error('INVALID_CONFIGURATION:EMAIL_SENDER_' + id.toUpperCase());
    }
  }
  if (new Set(profileIds.map((id) => profileSenders[id].toLowerCase())).size !== profileIds.length) {
    throw new Error('INVALID_CONFIGURATION:EMAIL_PROFILE_SENDERS_MUST_BE_UNIQUE');
  }
  const brevoAccountKeys = profileIds
    .filter((id) => bindingProviders[profileBindings[id]] === 'brevo')
    .map((id) => brevoKeys[profileBindings[id]]);
  if (new Set(brevoAccountKeys).size !== brevoAccountKeys.length) {
    throw new Error('INVALID_CONFIGURATION:BREVO_API_KEYS_MUST_BE_UNIQUE');
  }

  for (const binding of bindings) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(binding)) throw new Error('INVALID_CONFIGURATION:EMAIL_PROFILE_BINDING');
  }
  const smtpPort = boundedInteger(env.EMAIL_SMTP_PORT, 587, 1, 65535, 'EMAIL_SMTP_PORT');
  const fromName = env.EMAIL_FROM_NAME || 'CoWatch';
  if (fromName.includes('\r') || fromName.includes('\n') || fromName.length > 80) throw new Error('INVALID_CONFIGURATION:EMAIL_FROM_NAME');
  if (Boolean(env.EMAIL_SMTP_USERNAME) !== Boolean(env.EMAIL_SMTP_PASSWORD)) {
    throw new Error('INVALID_CONFIGURATION:EMAIL_SMTP_CREDENTIAL_PAIR');
  }
  return {
    nodeEnv,
    host: env.HOST || '0.0.0.0',
    port: boundedInteger(env.PORT, 8090, 1, 65535, 'PORT'),
    appUrl: appBaseUrl(env.APP_URL, nodeEnv),
    hostApiUrl: serviceUrl(env.HOST_API_URL, nodeEnv),
    hostApiSecret: requiredSecret(env.HOST_API_SECRET, 'HOST_API_SECRET'),
    serviceApiSecret: requiredSecret(env.EMAIL_SERVICE_API_SECRET, 'EMAIL_SERVICE_API_SECRET'),
    workerIntervalMs: boundedInteger(env.EMAIL_WORKER_INTERVAL_MS, 15000, 1000, 300000, 'EMAIL_WORKER_INTERVAL_MS'),
    workerBatchSize: boundedInteger(env.EMAIL_WORKER_BATCH_SIZE, 10, 1, 50, 'EMAIL_WORKER_BATCH_SIZE'),
    workerConcurrency: boundedInteger(env.EMAIL_WORKER_CONCURRENCY, 5, 1, 20, 'EMAIL_WORKER_CONCURRENCY'),
    defaultProvider: provider,
    fromAddress: env.EMAIL_FROM_ADDRESS || '',
    fromName,
    profileSenders,
    profileBindings,
    bindingProviders,
    brevoKeys,
    smtp: {
      host: env.EMAIL_SMTP_HOST || '',
      port: smtpPort,
      username: env.EMAIL_SMTP_USERNAME || '',
      password: env.EMAIL_SMTP_PASSWORD || '',
      secure: smtpPort === 465 || booleanValue(env.EMAIL_SMTP_SECURE, false, 'EMAIL_SMTP_SECURE'),
    },
  };
}

export function loadLocalEnv(): void {
  if (existsSync('.env')) loadEnvFile('.env');
}
