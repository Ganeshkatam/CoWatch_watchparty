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
  cowatchApiUrl: string;
  cowatchApiSecret: string;
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
  if (!value) throw new Error('INVALID_CONFIGURATION:COWATCH_API_URL');
  const parsed = new URL(value);
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
    throw new Error('INVALID_CONFIGURATION:COWATCH_API_URL_REQUIRES_HTTPS');
  }
  return parsed.toString().replace(/\/$/, '');
}

function appBaseUrl(value: string | undefined, nodeEnv: string): string {
  if (!value) throw new Error('INVALID_CONFIGURATION:APP_URL');
  const parsed = new URL(value);
  if (nodeEnv === 'production' && parsed.protocol !== 'https:') {
    throw new Error('INVALID_CONFIGURATION:APP_URL_REQUIRES_HTTPS');
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
    transactional_security: env.EMAIL_PROFILE_SECURITY_SENDER || env.EMAIL_FROM_ADDRESS || '',
    transactional_invitation: env.EMAIL_PROFILE_INVITATION_SENDER || env.EMAIL_FROM_ADDRESS || '',
    transactional_system: env.EMAIL_PROFILE_SYSTEM_SENDER || env.EMAIL_FROM_ADDRESS || '',
  };
  const bindingProviders: Record<string, string> = {
    default: env.EMAIL_BINDING_DEFAULT_PROVIDER || '',
    invitation: env.EMAIL_BINDING_INVITATION_PROVIDER || '',
    security: env.EMAIL_BINDING_SECURITY_PROVIDER || '',
    system: env.EMAIL_BINDING_SYSTEM_PROVIDER || '',
  };
  const brevoKeys: Record<string, string> = {
    default: env.BREVO_API_KEY || '',
    invitation: env.BREVO_API_KEY_INVITATIONS || env.BREVO_API_KEY || '',
    security: env.BREVO_API_KEY_SECURITY || env.BREVO_API_KEY || '',
    system: env.BREVO_API_KEY_SYSTEM || env.BREVO_API_KEY || '',
  };

  for (const id of profileIds) {
    if (!/^[^\\s<>@]+@[^\\s<>@]+\\.[^\\s<>@]+$/.test(profileSenders[id])) {
      throw new Error('INVALID_CONFIGURATION:EMAIL_SENDER_' + id.toUpperCase());
    }
  }

  const smtpPort = boundedInteger(env.EMAIL_SMTP_PORT, 587, 1, 65535, 'EMAIL_SMTP_PORT');
  const fromName = env.EMAIL_FROM_NAME || 'CoWatch';
  if (/[\\r\\n]/.test(fromName) || fromName.length > 80) throw new Error('INVALID_CONFIGURATION:EMAIL_FROM_NAME');
  if (Boolean(env.EMAIL_SMTP_USERNAME) !== Boolean(env.EMAIL_SMTP_PASSWORD)) {
    throw new Error('INVALID_CONFIGURATION:EMAIL_SMTP_CREDENTIAL_PAIR');
  }
  return {
    nodeEnv,
    host: env.HOST || '0.0.0.0',
    port: boundedInteger(env.PORT, 8090, 1, 65535, 'PORT'),
    appUrl: (env.APP_URL || '').replace(/\/+$/, ''),
    cowatchApiUrl: serviceUrl(env.COWATCH_API_URL, nodeEnv),
    cowatchApiSecret: requiredSecret(env.COWATCH_API_SECRET, 'COWATCH_API_SECRET'),
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
