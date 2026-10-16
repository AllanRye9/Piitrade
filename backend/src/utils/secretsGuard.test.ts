import { describe, it, expect } from 'vitest';
import { assertSecureSecrets, findInsecureSecrets } from './secretsGuard';

const strong = 'f3a9c1d27b8e4a60915cde72b4f08a13d6e95b7c0a2148fe';
const strong2 = '0b7d51e9a4c63f82d1e07a5b9c348f16e2d7a05c8b19f4e3';

describe('secretsGuard', () => {
  it('accepts long random secrets', () => {
    expect(findInsecureSecrets({ JWT_SECRET: strong, JWT_REFRESH_SECRET: strong2 })).toEqual([]);
  });

  it('flags the exact placeholders shipped in .env.example and docker-compose.yml', () => {
    const problems = findInsecureSecrets({
      JWT_SECRET: 'your-super-secret-jwt-key-change-in-production',
      JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-change-me',
      ADMIN_SECRET: 'change-this-to-a-strong-admin-registration-secret',
    });
    expect(problems.length).toBe(3);
  });

  it('flags short, missing and identical secrets', () => {
    expect(findInsecureSecrets({ JWT_SECRET: 'abc', JWT_REFRESH_SECRET: strong })).toHaveLength(1);
    expect(findInsecureSecrets({})).toHaveLength(2);
    expect(findInsecureSecrets({ JWT_SECRET: strong, JWT_REFRESH_SECRET: strong })).toHaveLength(1);
  });

  it('only enforces in production, with an explicit escape hatch', () => {
    const weak = { JWT_SECRET: 'x', JWT_REFRESH_SECRET: 'y' };
    expect(() => assertSecureSecrets({ ...weak, NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertSecureSecrets({ ...weak, NODE_ENV: 'production' })).toThrow(/insecure secrets/);
    expect(() => assertSecureSecrets({ ...weak, NODE_ENV: 'production', ALLOW_INSECURE_DEFAULTS: 'true' })).not.toThrow();
  });
});
