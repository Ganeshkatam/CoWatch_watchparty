import assert from 'node:assert/strict';
import {
  parseBoolean,
  parseBoundedInteger,
  parseOptionalInteger,
  createConfig,
  defaults,
} from './config.ts';

assert.equal(parseBoolean(' true ', false), true);
assert.equal(parseBoolean('0', true), false);
assert.equal(parseBoolean('', true), true);
assert.throws(() => parseBoolean('yes', false), /Invalid boolean/);

assert.equal(parseBoundedInteger(' 9000 ', 8080, { min: 1, max: 65535 }), 9000);
assert.equal(parseBoundedInteger('', 8080), 8080);
assert.throws(() => parseBoundedInteger('1.5', 0), /Invalid integer/);
assert.throws(() => parseBoundedInteger('65536', 8080, { min: 1, max: 65535 }), /exceeds maximum/);

assert.equal(parseOptionalInteger('', undefined, { min: 0 }), undefined);
assert.equal(parseOptionalInteger('4', undefined, { min: 0 }), 4);

const empty = createConfig({});
assert.equal(empty.PORT, defaults.PORT);
assert.equal(empty.HOST, defaults.HOST);
assert.equal(empty.EMAIL_WORKER_LEASE_SECONDS, defaults.EMAIL_WORKER_LEASE_SECONDS);
assert.equal(empty.EMAIL_MAX_ATTEMPTS, defaults.EMAIL_MAX_ATTEMPTS);

const configured = createConfig({
  PORT: '9000',
  HOST: ' 127.0.0.1 ',
  ROOM_CAPACITY: '25',
  EMAIL_WORKER_LEASE_SECONDS: '120',
  EMAIL_MAX_ATTEMPTS: '4',
  EMAIL_SERVICE_API_SECRET: 'service-secret',
  BREVO_API_KEY: 'must-not-enter-cowatch-config',
  EMAIL_SMTP_PASSWORD: 'must-not-enter-cowatch-config',
});
assert.equal(configured.PORT, 9000);
assert.equal(configured.HOST, '127.0.0.1');
assert.equal(configured.ROOM_CAPACITY, 25);
assert.equal(configured.EMAIL_WORKER_LEASE_SECONDS, 120);
assert.equal(configured.EMAIL_MAX_ATTEMPTS, 4);
assert.equal(configured.EMAIL_SERVICE_API_SECRET, 'service-secret');
assert.equal('BREVO_API_KEY' in configured, false);
assert.equal('EMAIL_SMTP_PASSWORD' in configured, false);

assert.throws(() => createConfig({ PORT: 'invalid-port' }), /Invalid integer configuration value for PORT/);
assert.throws(() => createConfig({ EMAIL_WORKER_LEASE_SECONDS: '0' }), /below minimum/);
assert.throws(() => createConfig({ EMAIL_MAX_ATTEMPTS: '21' }), /exceeds maximum/);

console.log('CoWatch configuration and remote email boundary tests passed.');
