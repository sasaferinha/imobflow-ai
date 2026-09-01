import { z } from 'zod';

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().min(1),
    INTERNAL_API_KEY: z.string().min(16),
    DEFAULT_TENANT_ID: z.string().min(1).default('tenant_demo'),
    LLM_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
    OPENAI_API_KEY: optionalString,
    OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
    OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
    WHATSAPP_PROVIDER: z.enum(['mock', 'meta']).default('mock'),
    WHATSAPP_ACCESS_TOKEN: optionalString,
    WHATSAPP_PHONE_NUMBER_ID: optionalString,
    WHATSAPP_VERIFY_TOKEN: optionalString,
    WHATSAPP_APP_SECRET: optionalString,
    WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
    N8N_EVENTS_WEBHOOK_URL: optionalString.pipe(z.string().url().optional()),
    N8N_SHARED_SECRET: optionalString,
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
    LLM_INPUT_USD_PER_MILLION: z.coerce.number().min(0).default(0),
    LLM_OUTPUT_USD_PER_MILLION: z.coerce.number().min(0).default(0),
  })
  .superRefine((env, context) => {
    if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
      context.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'Obrigatória para LLM_PROVIDER=openai' });
    }
    if (env.WHATSAPP_PROVIDER === 'meta') {
      for (const key of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET'] as const) {
        if (!env[key]) context.addIssue({ code: 'custom', path: [key], message: `Obrigatória para WHATSAPP_PROVIDER=meta` });
      }
    }
    if (env.NODE_ENV === 'production' && env.INTERNAL_API_KEY.includes('change-me')) {
      context.addIssue({ code: 'custom', path: ['INTERNAL_API_KEY'], message: 'Use uma chave forte em produção' });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Configuração de ambiente inválida: ${details}`);
  }
  return result.data;
}
