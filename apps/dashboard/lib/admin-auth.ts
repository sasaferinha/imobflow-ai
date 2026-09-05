import { createHash, timingSafeEqual } from 'node:crypto';
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
  return secret ? createHash('sha256').update(`imobflow-admin:${secret}`).digest('hex') : '';
}

export function isAdminCookie(value?: string) {
  const token = adminSessionToken();
  return Boolean(token && value && safeEqual(value, token));
}

export function isAdminRequest(request: NextRequest) {
  return isAdminCookie(request.cookies.get(COOKIE_NAME)?.value);
}

export { COOKIE_NAME };
