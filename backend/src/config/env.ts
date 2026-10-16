import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment-based configuration.
 * Every variable is validated at boot; the process refuses to start with an
 * invalid configuration instead of failing later at request time.
 * In Azure these values come from App Service settings, with secrets resolved
 * through Key Vault references (@Microsoft.KeyVault(SecretUri=...)).
 */
const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().url(),

    // Comma-separated list of allowed browser origins
    CORS_ORIGINS: z.string().default('http://localhost:5173'),

    // ---- Authentication ----
    // local = mock login issuing HS256 JWTs; entra = validate Microsoft Entra ID access tokens
    AUTH_MODE: z.enum(['local', 'entra']).default('local'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
    JWT_EXPIRES_IN: z.string().default('8h'),
    JWT_ISSUER: z.string().default('shipops-api'),
    JWT_AUDIENCE: z.string().default('shipops-web'),
    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_API_AUDIENCE: z.string().optional(), // e.g. api://<app-id>

    // ---- AI assistant ----
    // openai | azure | mock (mock = deterministic offline responses, used in dev/test)
    AI_PROVIDER: z.enum(['openai', 'azure', 'mock']).default('mock'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),
    AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
    AZURE_OPENAI_API_KEY: z.string().optional(),
    AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
    AZURE_OPENAI_API_VERSION: z.string().default('2024-10-21'),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    AI_MAX_HISTORY_MESSAGES: z.coerce.number().int().positive().default(20),

    // ---- Analytics microservice ----
    ANALYTICS_SERVICE_URL: z.string().url().default('http://localhost:5001'),
    ANALYTICS_API_KEY: z.string().optional(),

    // ---- Real-time ----
    WS_HEARTBEAT_MS: z.coerce.number().int().positive().default(30000),

    // ---- SharePoint (Bonus 3) ----
    ANNOUNCEMENTS_SOURCE: z.enum(['mock', 'sharepoint']).default('mock'),
    SHAREPOINT_SITE_ID: z.string().optional(),
    SHAREPOINT_LIST_ID: z.string().optional(),
    GRAPH_CLIENT_ID: z.string().optional(),
    GRAPH_CLIENT_SECRET: z.string().optional(),

    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
    SWAGGER_ENABLED: bool.default('true'),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'local' && !env.JWT_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET is required when AUTH_MODE=local' });
    }
    if (env.AUTH_MODE === 'entra' && (!env.ENTRA_TENANT_ID || !env.ENTRA_API_AUDIENCE)) {
      ctx.addIssue({ code: 'custom', path: ['ENTRA_TENANT_ID'], message: 'ENTRA_TENANT_ID and ENTRA_API_AUDIENCE are required when AUTH_MODE=entra' });
    }
    if (env.AI_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'OPENAI_API_KEY is required when AI_PROVIDER=openai' });
    }
    if (env.AI_PROVIDER === 'azure' && (!env.AZURE_OPENAI_ENDPOINT || !env.AZURE_OPENAI_DEPLOYMENT)) {
      ctx.addIssue({ code: 'custom', path: ['AZURE_OPENAI_ENDPOINT'], message: 'AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT are required when AI_PROVIDER=azure' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${details}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProd = env.NODE_ENV === 'production';
export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
