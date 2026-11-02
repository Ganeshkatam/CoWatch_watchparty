import config from '../config.ts';
import { getDeliveryProfile } from './deliveryProfiles.ts';
import { EmailProviderRegistry } from './emailProviderRegistry.ts';
import type { EmailMessage, EmailSendResult } from './emailProvider.ts';

export interface DuplicateSignupAlertOptions {
  email: string;
  ipAddress?: string;
  userAgent?: string;
  attemptedAt?: Date;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderDuplicateSignupAlertEmail(options: DuplicateSignupAlertOptions): {
  subject: string;
  html: string;
  text: string;
} {
  const appBaseUrl = (config.APP_URL || '').replace(/\/+$/, '');
  const loginUrl = `${appBaseUrl}/login`;
  const resetPasswordUrl = `${appBaseUrl}/reset-password`;
  const timestampStr = (options.attemptedAt || new Date()).toUTCString();
  const safeEmail = escapeHtml(options.email);
  const safeIp = escapeHtml(options.ipAddress || 'Unavailable');

  const subject = 'Security Notice: Attempted sign up with your email address';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(subject)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background:#0f0f1a; color:#e8e8f0; margin:0; padding:0; }
  .wrapper { max-width:580px; margin:40px auto; background:#1a1a2e; border-radius:14px; overflow:hidden; border:1px solid #2d2d4e; box-shadow:0 8px 30px rgba(0,0,0,0.5); }
  .header { background:linear-gradient(135deg, #e63946 0%, #6c63ff 100%); padding:28px 36px; }
  .header h1 { margin:0; font-size:22px; font-weight:700; color:#ffffff; letter-spacing:-0.5px; }
  .header p { margin:6px 0 0 0; font-size:13px; color:rgba(255,255,255,0.85); }
  .content { padding:32px 36px; }
  .content p { margin:0 0 16px; line-height:1.6; color:#c8c8dc; font-size:14px; }
  .card-box { background:#141424; border:1px solid #2d2d4e; border-radius:8px; padding:16px 20px; margin:20px 0; }
  .card-box table { width:100%; border-collapse:collapse; font-size:13px; color:#a0a0c0; }
  .card-box td { padding:6px 0; }
  .card-box td.label { font-weight:600; color:#8b5cf6; width:130px; }
  .card-box td.val { color:#ffffff; font-family:monospace; }
  .section-heading { color:#ffffff; font-size:15px; font-weight:600; margin:24px 0 10px; }
  .btn-group { margin:24px 0 16px; }
  .btn-primary { display:inline-block; margin-right:12px; margin-bottom:8px; padding:11px 22px; background:#6c63ff; color:#ffffff !important; text-decoration:none; border-radius:8px; font-weight:600; font-size:13px; }
  .btn-secondary { display:inline-block; margin-bottom:8px; padding:11px 22px; background:#2d2d4e; color:#ffffff !important; text-decoration:none; border-radius:8px; font-weight:600; font-size:13px; }
  .footer { padding:20px 36px; border-top:1px solid #2d2d4e; color:#707090; font-size:12px; line-height:1.5; background:#121220; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>CoWatch Security</h1>
    <p>Sign-up attempt detected for an existing account</p>
  </div>
  <div class="content">
    <p>Hello,</p>
    <p>We received an attempt to create a new CoWatch account using your email address (<strong>${safeEmail}</strong>).</p>
    
    <div class="card-box">
      <table>
        <tr>
          <td class="label">Date &amp; Time:</td>
          <td class="val">${escapeHtml(timestampStr)}</td>
        </tr>
        <tr>
          <td class="label">IP Address:</td>
          <td class="val">${safeIp}</td>
        </tr>
        <tr>
          <td class="label">Status:</td>
          <td class="val">Registration blocked (Account already exists)</td>
        </tr>
      </table>
    </div>

    <div class="section-heading">Was this you?</div>
    <p>If you were trying to register, please remember that you already have an account with us. You do not need to register again. You can sign in directly or reset your password if you forgot it.</p>
    
    <div class="btn-group">
      <a href="${escapeHtml(loginUrl)}" class="btn-primary">Sign In to CoWatch</a>
      <a href="${escapeHtml(resetPasswordUrl)}" class="btn-secondary">Reset Password</a>
    </div>

    <div class="section-heading">Wasn't you?</div>
    <p>If you did not make this request, you can safely disregard this notice. Your existing account, credentials, and profile remain completely secure. No new account was created and no one gained access to your account.</p>
    <p>If you suspect someone is attempting to compromise your accounts, we recommend resetting your password as a precaution.</p>
  </div>
  <div class="footer">
    <p>This is an automated security notice from CoWatch. For security reasons, confirmation or activation links are never sent for existing accounts.</p>
  </div>
</div>
</body>
</html>`;

  const text = `CoWatch Security Alert

We received an attempt to create a new CoWatch account using your email address (${options.email}).

Attempt Details:
- Date & Time: ${timestampStr}
- IP Address: ${options.ipAddress || 'Unavailable'}
- Status: Blocked (Account already exists)

WAS THIS YOU?
If you were trying to sign up, you already have an account! You do not need to register again.
- Sign in: ${loginUrl}
- Reset your password: ${resetPasswordUrl}

WASN'T YOU?
If you did not make this request, you can safely ignore this email. Your existing account and password remain completely secure. No new account was created.

--
CoWatch Security Team
Automated security notice.
`;

  return { subject, html, text };
}

export async function sendDuplicateSignupSecurityAlert(
  options: DuplicateSignupAlertOptions,
): Promise<EmailSendResult | null> {
  try {
    const profile = getDeliveryProfile('transactional_security');
    const provider = EmailProviderRegistry.getProviderForProfile(profile.id);

    const fromEmail = profile.fromName
      ? `"${profile.fromName}" <${profile.fromAddress}>`
      : profile.fromAddress;

    const rendered = renderDuplicateSignupAlertEmail(options);
    const idempotencyKey = `security-dup-signup:${Buffer.from(options.email).toString('hex')}:${Math.floor(Date.now() / (10 * 60 * 1000))}`;

    const message: EmailMessage = {
      to: options.email,
      from: fromEmail,
      replyTo: profile.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey,
    };

    const result = await provider.send(message);
    console.log(
      `[SecurityAlert] Dispatched duplicate signup security notice to ${options.email.replace(/(?<=.).(?=.*@)/g, '*')} via ${provider.name}`,
    );
    return result;
  } catch (err) {
    console.error('[SecurityAlert] Failed to send duplicate signup security alert:', err);
    return null;
  }
}
