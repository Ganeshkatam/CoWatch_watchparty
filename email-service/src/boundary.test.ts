import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sourceFiles = [
  'apiClient.ts',
  'config.ts',
  'index.ts',
  'providers.ts',
  'server.ts',
  'templates.ts',
  'worker.ts',
];

test('email service has no runtime dependency on CoWatch server or database packages', () => {
  for (const file of sourceFiles) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"](?:\.\.\/)+server\//, file + ' imports CoWatch server code');
    assert.doesNotMatch(source, /from\s+['"](?:pg|ioredis|bullmq|@supabase\/)/, file + ' imports host database infrastructure');
  }

  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  for (const dependency of ['pg', 'ioredis', 'bullmq', '@supabase/supabase-js']) {
    assert.equal(packageJson.dependencies?.[dependency], undefined, dependency + ' must not be a service dependency');
  }
});
