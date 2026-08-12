import { z } from 'zod';

const booleanFromString = z.preprocess(
  (value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value,
  z.boolean(),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1).default('postgresql://postgres:postgres@127.0.0.1:5432/buysell'),
  DIRECT_DATABASE_URL: z.string().min(1).optional(),
  FRONTEND_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(3).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
  ALLOW_DEV_AUTH: booleanFromString.default(false),
  DEV_AUTH_SUBJECT: z.string().uuid().default('00000000-0000-4000-8000-000000000001'),
  FLUTTERWAVE_PUBLIC_KEY: z.string().optional(),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_WEBHOOK_HASH: z.string().optional(),
  PAYMENT_REDIRECT_URL: z.string().url().optional(),
  PLATFORM_COMMISSION_BPS: z.coerce.number().int().min(0).max(10_000).default(300),
  PAYOUT_ENCRYPTION_KEY: z.string().min(32).optional(),
  CHECKOUT_QUOTE_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(20),
  INVENTORY_RESERVATION_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
  PUBLIC_MEDIA_PROVIDER: z.enum(['cloudinary', 's3']).default('cloudinary'),
  PRIVATE_MEDIA_PROVIDER: z.enum(['s3']).default('s3'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BUCKET: z.string().optional(),
  S3_PRIVATE_BUCKET: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),
  MEDIA_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  MEDIA_MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(10_000_000),
  MEDIA_MAX_VIDEO_BYTES: z.coerce.number().int().positive().default(60_000_000),
  MEDIA_MAX_DOCUMENT_BYTES: z.coerce.number().int().positive().default(15_000_000),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:support@buysell.ng'),
  PROCUREMENT_SOURCE_PROVIDER: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid backend environment: ${issues}`);
}

export const env = Object.freeze({
  ...parsed.data,
  origins: parsed.data.FRONTEND_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  isProduction: parsed.data.NODE_ENV === 'production',
});

if (env.isProduction && env.ALLOW_DEV_AUTH) {
  throw new Error('ALLOW_DEV_AUTH must be false in production.');
}

if (env.isProduction) {
  const errors = [];
  if (!process.env.DATABASE_URL) errors.push('DATABASE_URL must be explicitly configured');
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) errors.push('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required');
  if (!env.origins.length || env.origins.some((origin) => /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::|$)/i.test(origin))) errors.push('FRONTEND_ORIGINS must contain only deployed origins');
  if (env.FLUTTERWAVE_SECRET_KEY && !env.PAYMENT_REDIRECT_URL) errors.push('PAYMENT_REDIRECT_URL is required when Flutterwave is configured');
  if (env.PAYMENT_REDIRECT_URL && new URL(env.PAYMENT_REDIRECT_URL).protocol !== 'https:') errors.push('PAYMENT_REDIRECT_URL must use HTTPS');
  if (errors.length) throw new Error(`Invalid production backend environment: ${errors.join('; ')}`);
}
