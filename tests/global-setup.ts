import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Brings the test database up to the current schema before any test runs.
 *
 * DATABASE_URL is read from .env.test explicitly: the Prisma CLI would otherwise pick up
 * .env and migrate the development database instead.
 */
export default function setup() {
  const path = fileURLToPath(new URL('../.env.test', import.meta.url));
  if (!existsSync(path)) {
    throw new Error('.env.test is missing — copy .env.example and point it at a test database.');
  }

  const env: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
  }

  const url = env.DATABASE_URL;
  if (!url) throw new Error('.env.test does not define DATABASE_URL');
  if (!/test/i.test(url)) {
    throw new Error(`Refusing to run tests against "${url}" — the database name must contain "test".`);
  }

  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}
