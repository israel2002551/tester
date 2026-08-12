import 'dotenv/config';

const requiredInProd = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
if (process.env.NODE_ENV === 'production') {
  const missing = requiredInProd.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing production environment variables: ${missing.join(', ')}`);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/buysell',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 30),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174').split(',').map((v) => v.trim()).filter(Boolean),
  flutterwaveSecretKey: process.env.FLUTTERWAVE_SECRET_KEY || '',
  flutterwaveWebhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET || '',
  adPriceKobo: Number(process.env.AD_PRICE_KOBO || 500000),
  publicMarketplaceUrl: process.env.PUBLIC_MARKETPLACE_URL || 'http://localhost:5173',
  storageDriver: process.env.STORAGE_DRIVER || 'local',
  storageLocalDir: process.env.STORAGE_LOCAL_DIR || './storage/uploads',
  publicUploadBaseUrl: process.env.PUBLIC_UPLOAD_BASE_URL || 'http://localhost:4000/uploads',
  s3Endpoint: process.env.S3_ENDPOINT || '',
  s3Region: process.env.S3_REGION || 'auto',
  s3Bucket: process.env.S3_BUCKET || '',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL || ''
};
