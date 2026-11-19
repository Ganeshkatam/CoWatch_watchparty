import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEmailTemplate, renderDuplicateSignupSecurityAlert } from './templates.ts';
import type { EmailServiceConfig } from './config.ts';

const config: EmailServiceConfig = {
  nodeEnv: 'test', host: '127.0.0.1', port: 8090, appUrl: 'https://cowatch.example',
  hostApiUrl: 'https://api.cowatch.example', hostApiSecret: 'x'.repeat(32),
  serviceApiSecret: 'y'.repeat(32), workerIntervalMs: 15000, workerBatchSize: 10,
  workerConcurrency: 5, defaultProvider: 'smtp',
  fromAddress: 'noreply@cowatch.example', fromName: 'CoWatch',
  profileSenders: {
    transactional_default: 'noreply@cowatch.example',
    transactional_security: 'security@cowatch.example',
    transactional_invitation: 'invites@cowatch.example',
    transactional_system: 'updates@cowatch.example',
  },
  profileBindings: {
    transactional_default: 'default', transactional_security: 'security',
    transactional_invitation: 'invitation', transactional_system: 'system',
  },
  bindingProviders: {}, brevoKeys: {},
  smtp: { host: '', port: 587, username: '', password: '', secure: false },
};

test('room invitation escapes user content and rejects unsafe URLs', () => {
  const rendered = renderEmailTemplate('room-invitation', {
    roomTitle: '<script>alert(1)</script>',
    inviterName: 'Alice & Bob',
    roomUrl: 'https://cowatch.example/join/room-1',
  });
  assert.ok(rendered);
  assert.ok(!rendered.html.includes('<script>'));
  assert.ok(rendered.html.includes('&lt;script&gt;'));
  assert.throws(() => renderEmailTemplate('ROOM_INVITATION', {
    roomTitle: 'Room', inviterName: 'Alice', roomUrl: 'javascript:alert(1)',
  }), /INVALID_TEMPLATE_URL/);
});

test('unknown template is rejected without rendering arbitrary markup', () => {
  assert.equal(renderEmailTemplate('CUSTOM_HTML', { html: '<script>' }), null);
});

test('duplicate signup alert contains safe links and no account confirmation link', () => {
  const rendered = renderDuplicateSignupSecurityAlert(
    'person@example.com',
    '<script>',
    new Date('2026-09-15T12:00:00Z'),
    config,
  );
  assert.ok(rendered.html.includes('&lt;script&gt;'));
  assert.ok(rendered.html.includes('https://cowatch.example/login'));
  assert.ok(rendered.html.includes('https://cowatch.example/reset-password'));
  assert.ok(!rendered.html.toLowerCase().includes('confirm your account'));
  assert.ok(rendered.text.includes('person@example.com'));
});
