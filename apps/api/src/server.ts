import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

if (typeof process.loadEnvFile === 'function' && process.env.NODE_ENV !== 'production') {
  try {
    process.loadEnvFile();
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code !== 'ENOENT') throw error;
  }
}

const env = loadEnv();
const { app, container } = await buildApp({ env });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutdown_started');
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  container.outboxWorker.start();
  app.log.info({ host: env.HOST, port: env.PORT, environment: env.NODE_ENV }, 'server_started');
} catch (error) {
  app.log.fatal({ err: error }, 'server_start_failed');
  await app.close();
  process.exit(1);
}
