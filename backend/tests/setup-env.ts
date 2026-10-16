// Deterministic env for tests (runs before any module reads config)
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.AUTH_MODE = 'local';
process.env.AI_PROVIDER = 'mock';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123456';
process.env.DATABASE_URL ??= 'postgresql://shipops:shipops@localhost:5432/shipops_test?schema=public';
process.env.CORS_ORIGINS = 'http://localhost:5173';
