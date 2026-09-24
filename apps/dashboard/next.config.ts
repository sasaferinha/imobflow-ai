import type { NextConfig } from 'next';
import { execSync } from 'node:child_process';

// CLI deployments can contain different uncommitted changes with the same SHA.
// A deployment identifier is stable across build workers, but unique per release.
let release = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL;
if (!release) {
  release = process.env.VERCEL_GIT_COMMIT_SHA || 'development';
  try { release = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Local checkout is optional. */ }
}
const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_RELEASE: release },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    ] }, { source: '/demonstracao', headers: [
      { key: 'Content-Security-Policy', value: "connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ] }];
  },
};

export default nextConfig;
