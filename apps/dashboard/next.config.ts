import type { NextConfig } from 'next';
import { execSync } from 'node:child_process';

let release = process.env.VERCEL_GIT_COMMIT_SHA || 'development';
try { release = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { /* Vercel also provides the source revision. */ }
const nextConfig: NextConfig = { env: { NEXT_PUBLIC_APP_RELEASE: release } };

export default nextConfig;
