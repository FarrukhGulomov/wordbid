import crypto from 'node:crypto';
import { cookies } from 'next/headers';

export const ADMIN_COOKIE = 'oti_admin';

function adminToken(): string {
  const token = process.env.ADMIN_TOKEN;
  if (!token || token.length < 8) {
    throw new Error('ADMIN_TOKEN is not set (or is too short) — /admin is unavailable.');
  }
  return token;
}

/** Constant-time comparison so the token cannot be discovered by timing. */
export function isValidAdminToken(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const expected = Buffer.from(adminToken());
  const given = Buffer.from(candidate);
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return isValidAdminToken(store.get(ADMIN_COOKIE)?.value);
}
