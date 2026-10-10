import 'dotenv/config';

const isTest = process.env.NODE_ENV === 'test';

export const config = {
  port: Number(process.env.PORT) || 5000,
  dbFile: process.env.DB_FILE || 'data/events.db',
  jwtSecret: process.env.JWT_SECRET || (isTest ? 'test-secret' : 'dev-only-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  adminEmail: process.env.ADMIN_EMAIL || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminName: process.env.ADMIN_NAME || 'Admin',
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 200,
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
};

if (!isTest && process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-only-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
