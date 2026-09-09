import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

const COOKIE_NAME = 'imobflow_admin';

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isValidAdminPassword(password: string) {
  const secret = process.env.ADMIN_PANEL_SECRET;
  return Boolean(secret && password && safeEqual(password, secret));
}

export function adminSessionToken() {
  const secret = process.env.ADMIN_PANEL_SECRET;
  if (!secret) return '';
  const issuedAt = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret).update(`imobflow-admin:${issuedAt}`).digest('hex');
  return `${issuedAt}.${signature}`;
}

export function isAdminCookie(value?: string) {
  const secret = process.env.ADMIN_PANEL_SECRET;
  if (!secret || !value) return false;
  const [issuedAt, signature, extra] = value.split('.');
  const timestamp = Number(issuedAt);
  if (extra || !issuedAt || !signature || !Number.isInteger(timestamp)) return false;
  const age = Math.floor(Date.now() / 1000) - timestamp;
  if (age < -60 || age > 60 * 60 * 12) return false;
  const expected = createHmac('sha256', secret).update(`imobflow-admin:${issuedAt}`).digest('hex');
  return safeEqual(signature, expected);
}

export function isAdminRequest(request: NextRequest) {
  // Every protected route is wrapped by protectedRoute, which validates this
  // opaque session against the database. This cheap guard prevents handler
  // work if a wrapper is accidentally removed in a future route change.
  return Boolean(request.cookies.get('imobflow_session')?.value);
}

export { COOKIE_NAME };
