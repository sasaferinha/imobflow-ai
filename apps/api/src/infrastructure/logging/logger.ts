import type { FastifyServerOptions } from 'fastify';
import type { AppEnv } from '../../config/env.js';

export function loggerOptions(env: AppEnv): Exclude<FastifyServerOptions['logger'], boolean | undefined> {
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.x-api-key',
        'headers.authorization',
        'headers.x-api-key',
        '*.accessToken',
        '*.apiKey',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } }
      : {}),
  };
}
