/**
 * NOTIFY-001 Email Templates
 *
 * Provides HTML and plain-text content for all email-eligible notification types.
 *
 * This registry MUST be kept in sync with email_eligible types in:
 *   - notificationTypes.ts (EMAIL_ELIGIBLE_TYPES set)
 *   - notification_type_registry DB table (email_eligible = true)
 *
 * CI test: notificationConsistency.test.ts enforces this invariant.
 */

import type { EmailEligibleType } from './notificationTypes.ts';

export interface EmailTemplate {
  subject(payload: Record<string, unknown>): string;
  html(payload: Record<string, unknown>): string;
  text(payload: Record<string, unknown>): string;
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function base(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0f0f1a; color:#e8e8f0; margin:0; padding:0; }
  .wrapper { max-width:560px; margin:40px auto; background:#1a1a2e; border-radius:12px; overflow:hidden; border:1px solid #2d2d4e; }
  .header { background:linear-gradient(135deg,#6c63ff 0%,#3a86ff 100%); padding:32px 40px; }
  .header h1 { margin:0; font-size:20px; font-weight:700; color:#fff; }
  .body { padding:32px 40px; }
  .body p { margin:0 0 16px; line-height:1.6; color:#c8c8dc; }
  .cta { display:inline-block; margin-top:8px; padding:12px 24px; background:#6c63ff; color:#fff; text-decoration:none; border-radius:8px; font-weight:600; }
  .footer { padding:20px 40px; border-top:1px solid #2d2d4e; color:#666; font-size:12px; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header"><h1>CoWatch</h1></div>
  <div class="body">${bodyHtml}</div>
  <div class="footer">
    <p>You're receiving this because you have notifications enabled. 
    <a href="{{preferencesUrl}}" style="color:#6c63ff">Manage preferences</a>.</p>
  </div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

export const EMAIL_TEMPLATES: Record<EmailEligibleType, EmailTemplate> = {
  ROOM_INVITATION: {
    subject: (p) => `You've been invited to join "${esc(p.roomTitle)}"`,
    html: (p) =>
      base(
        'Room Invitation',
        `<p>Hi${p.userName ? ` ${esc(p.userName)}` : ''},</p>
         <p><strong>${esc(p.inviterName)}</strong> has invited you to watch together in the room
         <strong>"${esc(p.roomTitle)}"</strong>.</p>
         <a href="${esc(p.roomUrl)}" class="cta">Join Room</a>`,
      ),
    text: (p) =>
      `${p.inviterName} has invited you to join "${p.roomTitle}".\nJoin here: ${p.roomUrl}`,
  },

  ROOM_STARTED: {
    subject: (p) => `"${esc(p.roomTitle)}" is now live`,
    html: (p) =>
      base(
        'Room Started',
        `<p>The room <strong>"${esc(p.roomTitle)}"</strong> you belong to has started.
         Join now to watch together!</p>
         <a href="${esc(p.roomUrl)}" class="cta">Join Room</a>`,
      ),
    text: (p) =>
      `The room "${p.roomTitle}" has started.\nJoin here: ${p.roomUrl}`,
  },

  SYSTEM_ANNOUNCEMENT: {
    subject: (p) => `${esc(p.subject ?? 'An announcement from CoWatch')}`,
    html: (p) =>
      base(
        String(p.subject ?? 'CoWatch Announcement'),
        `<p>${esc(p.body)}</p>
         ${p.ctaUrl ? `<a href="${esc(p.ctaUrl)}" class="cta">${esc(p.ctaLabel ?? 'Learn more')}</a>` : ''}`,
      ),
    text: (p) =>
      `${p.body}${p.ctaUrl ? `\n\n${p.ctaLabel ?? 'Learn more'}: ${p.ctaUrl}` : ''}`,
  },
};

/**
 * Render a template for a given type and payload.
 * Returns null if no template is registered for the given key.
 */
export function renderEmailTemplate(
  templateKey: string,
  payload: Record<string, unknown>,
): { subject: string; html: string; text: string } | null {
  const normalizedKey = templateKey.toUpperCase().replace(/-/g, '_') as EmailEligibleType;
  const template =
    EMAIL_TEMPLATES[templateKey as EmailEligibleType] ||
    EMAIL_TEMPLATES[normalizedKey];
  if (!template) return null;

  return {
    subject: template.subject(payload),
    html: template.html(payload),
    text: template.text(payload),
  };
}

/**
 * The set of template keys registered in this module.
 * Used by the CI consistency test to verify registry completeness.
 */
export const REGISTERED_TEMPLATE_KEYS = new Set(Object.keys(EMAIL_TEMPLATES));
