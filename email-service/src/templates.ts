import type { EmailServiceConfig } from './config.ts';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

type Payload = Record<string, unknown>;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function requiredText(payload: Payload, key: string, maxLength = 4000): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error('INVALID_TEMPLATE_FIELD:' + key);
  }
  return value;
}

function optionalText(payload: Payload, key: string, fallback = ''): string {
  const value = payload[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > 1000) throw new Error('INVALID_TEMPLATE_FIELD:' + key);
  return value;
}

function safeUrl(value: string, nodeEnv = 'development'): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('INVALID_TEMPLATE_URL');
  }
  if (parsed.protocol !== 'https:' && !(nodeEnv !== 'production' && parsed.protocol === 'http:')) {
    throw new Error('INVALID_TEMPLATE_URL');
  }
  if (parsed.username || parsed.password) throw new Error('INVALID_TEMPLATE_URL');
  return parsed.toString();
}

function base(title: string, bodyHtml: string): string {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
    '<title>' + escapeHtml(title) + '</title><style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0f1a;color:#e8e8f0;margin:0;padding:0}' +
    '.wrapper{max-width:560px;margin:40px auto;background:#1a1a2e;border-radius:12px;overflow:hidden;border:1px solid #2d2d4e}' +
    '.header{background:linear-gradient(135deg,#6c63ff 0%,#3a86ff 100%);padding:32px 40px}' +
    '.header h1{margin:0;font-size:20px;font-weight:700;color:#fff}.body{padding:32px 40px}' +
    '.body p{margin:0 0 16px;line-height:1.6;color:#c8c8dc}' +
    '.cta{display:inline-block;margin-top:8px;padding:12px 24px;background:#6c63ff;color:#fff;text-decoration:none;border-radius:8px;font-weight:600}' +
    '.footer{padding:20px 40px;border-top:1px solid #2d2d4e;color:#666;font-size:12px}</style></head><body>' +
    '<div class="wrapper"><div class="header"><h1>CoWatch</h1></div>' +
    '<div class="body">' + bodyHtml + '</div>' +
    '<div class="footer"><p>You\'re receiving this because you have notifications enabled. ' +
    '<a href="{{preferencesUrl}}" style="color:#6c63ff">Manage preferences</a>.</p></div></div></body></html>';
}

export function renderEmailTemplate(key: string, payload: Payload, nodeEnv = 'development'): RenderedEmail | null {
  const normalized = key.toUpperCase().replace(/-/g, '_');
  switch (normalized) {
    case 'ROOM_INVITATION': {
      const roomTitle = requiredText(payload, 'roomTitle', 200);
      const inviterName = requiredText(payload, 'inviterName', 100);
      const roomUrl = safeUrl(requiredText(payload, 'roomUrl', 2048), nodeEnv);
      const userName = optionalText(payload, 'userName', '');
      return {
        subject: 'You\'ve been invited to join "' + escapeHtml(roomTitle) + '"',
        html: base('Room Invitation',
          '<p>Hi' + (userName ? ' ' + escapeHtml(userName) : '') + ',</p>' +
          '<p><strong>' + escapeHtml(inviterName) + '</strong> has invited you to watch together in the room ' +
          '<strong>"' + escapeHtml(roomTitle) + '"</strong>.</p>' +
          '<a href="' + escapeHtml(roomUrl) + '" class="cta">Join Room</a>'),
        text: inviterName + ' has invited you to join "' + roomTitle + '".\nJoin here: ' + roomUrl,
      };
    }
    case 'ROOM_STARTED': {
      const roomTitle = requiredText(payload, 'roomTitle', 200);
      const roomUrl = safeUrl(requiredText(payload, 'roomUrl', 2048), nodeEnv);
      return {
        subject: '"' + escapeHtml(roomTitle) + '" is now live',
        html: base('Room Started',
          '<p>The room <strong>"' + escapeHtml(roomTitle) + '"</strong> you belong to has started. Join now to watch together!</p>' +
          '<a href="' + escapeHtml(roomUrl) + '" class="cta">Join Room</a>'),
        text: 'The room "' + roomTitle + '" has started.\nJoin here: ' + roomUrl,
      };
    }
    case 'SYSTEM_ANNOUNCEMENT': {
      const subject = optionalText(payload, 'subject', 'An announcement from CoWatch');
      const title = optionalText(payload, 'subject', 'CoWatch Announcement');
      const body = requiredText(payload, 'body');
      const ctaUrl = optionalText(payload, 'ctaUrl');
      const ctaLabel = optionalText(payload, 'ctaLabel', 'Learn more');
      const safeCta = ctaUrl ? safeUrl(ctaUrl, nodeEnv) : '';
      return {
        subject,
        html: base(title, '<p>' + escapeHtml(body) + '</p>' +
          (safeCta ? '<a href="' + escapeHtml(safeCta) + '" class="cta">' + escapeHtml(ctaLabel) + '</a>' : '')),
        text: body + (safeCta ? '\n\n' + ctaLabel + ': ' + safeCta : ''),
      };
    }
    default:
      return null;
  }
}

export function renderDuplicateSignupSecurityAlert(
  email: string,
  ipAddress: string,
  attemptedAt: Date,
  config: EmailServiceConfig,
): RenderedEmail {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('INVALID_SECURITY_ALERT_EMAIL');
  }
  const appUrl = safeUrl(config.appUrl, config.nodeEnv).replace(/\/+$/, '');
  const loginUrl = appUrl + '/login';
  const resetUrl = appUrl + '/reset-password';
  const subject = 'Security Notice: Attempted sign up with your email address';
  const timestamp = attemptedAt.toUTCString();
  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>' + escapeHtml(subject) + '</title>' +
    '<style>body{font-family:Arial,sans-serif;background:#0f0f1a;color:#e8e8f0;margin:0;padding:0}' +
    '.wrapper{max-width:580px;margin:40px auto;background:#1a1a2e;border:1px solid #2d2d4e;border-radius:14px;overflow:hidden}' +
    '.header{background:linear-gradient(135deg,#e63946,#6c63ff);padding:28px 36px}.content{padding:32px 36px}' +
    '.content p{line-height:1.6;color:#c8c8dc}.card{background:#141424;border:1px solid #2d2d4e;border-radius:8px;padding:16px 20px}' +
    'a{display:inline-block;margin:8px 10px 8px 0;padding:11px 22px;background:#6c63ff;color:#fff;text-decoration:none;border-radius:8px}' +
    '.footer{padding:20px 36px;border-top:1px solid #2d2d4e;color:#aaa;font-size:12px}</style></head><body>' +
    '<div class="wrapper"><div class="header"><h1>CoWatch Security</h1><p>Sign-up attempt detected for an existing account</p></div>' +
    '<div class="content"><p>Hello,</p><p>We received an attempt to create a new CoWatch account using your email address (<strong>' +
    escapeHtml(email) + '</strong>).</p><div class="card"><p>Date &amp; Time: ' + escapeHtml(timestamp) +
    '</p><p>IP Address: ' + escapeHtml(ipAddress || 'Unavailable') +
    '</p><p>Status: Registration blocked (Account already exists)</p></div>' +
    '<h3>Was this you?</h3><p>If you were trying to register, you already have an account. You can sign in or reset your password.</p>' +
    '<a href="' + escapeHtml(loginUrl) + '">Sign In to CoWatch</a><a href="' + escapeHtml(resetUrl) + '">Reset Password</a>' +
    '<h3>Was not you?</h3><p>If you did not make this request, you can safely disregard this notice. No new account was created.</p>' +
    '</div><div class="footer">Automated security notice from CoWatch.</div></div></body></html>';
  const text = 'CoWatch Security Alert\n\nWe received an attempt to create a new CoWatch account using your email address (' +
    email + ').\n\nAttempt Details:\n- Date & Time: ' + timestamp + '\n- IP Address: ' +
    (ipAddress || 'Unavailable') + '\n- Status: Blocked (Account already exists)\n\nSign in: ' + loginUrl +
    '\nReset password: ' + resetUrl + '\n\nIf you did not make this request, you can safely ignore this email.';
  return { subject, html, text };
}

export const REGISTERED_TEMPLATE_KEYS = new Set([
  'ROOM_INVITATION',
  'ROOM_STARTED',
  'SYSTEM_ANNOUNCEMENT',
]);
