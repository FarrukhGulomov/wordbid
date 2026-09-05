import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

/** Minimal .env.test loader — tests must never touch the development database. */
function loadTestEnv(): Record<string, string> {
  const path = fileURLToPath(new URL('./.env.test', import.meta.url));
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    out[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: loadTestEnv(),
    globalSetup: ['./tests/global-setup.ts'],
    // The integration tests share one Postgres database, so files must not run in parallel.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
