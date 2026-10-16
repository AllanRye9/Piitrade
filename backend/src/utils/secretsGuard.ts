/**
 * secretsGuard.ts — refuse to run production with placeholder / weak secrets.
 *
 * .env.example and docker-compose.yml ship values such as
 * "your-super-secret-jwt-key-change-in-production". If those reach a real
 * deployment, anyone who has read the repository can forge a valid ADMIN access
 * token. This guard fails closed instead of silently accepting them.
 */

const PLACEHOLDER = /change[-_ ]?me|change[-_ ]?this|change[-_ ]?in[-_ ]?production|your[-_ ]|example|placeholder|test-jwt|marketplace_secret|^secret$|^password$/i;
const MIN_SECRET_LENGTH = 32;

export function describeWeakSecret(name: string, value: string | undefined): string | null {
  if (!value) return `${name} is not set`;
  if (value.length < MIN_SECRET_LENGTH) return `${name} is shorter than ${MIN_SECRET_LENGTH} characters`;
  if (PLACEHOLDER.test(value)) return `${name} still contains a placeholder/default value`;
  return null;
}

export function findInsecureSecrets(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  for (const name of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    const p = describeWeakSecret(name, env[name]);
    if (p) problems.push(p);
  }
  if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    problems.push('JWT_SECRET and JWT_REFRESH_SECRET must be different values');
  }
  // Optional secrets: only judged when they are actually configured.
  for (const name of ['ADMIN_SECRET']) {
    if (env[name]) {
      const p = describeWeakSecret(name, env[name]);
      if (p) problems.push(p);
    }
  }
  return problems;
}

/** Throws when running in production with weak secrets, unless ALLOW_INSECURE_DEFAULTS=true. */
export function assertSecureSecrets(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  if ((env.ALLOW_INSECURE_DEFAULTS || '').toLowerCase() === 'true') return;
  const problems = findInsecureSecrets(env);
  if (problems.length > 0) {
    throw new Error(
      'Refusing to start in production with insecure secrets:\n  - ' + problems.join('\n  - ') +
      '\nGenerate strong values (e.g. `openssl rand -hex 48`). For a throwaway local smoke test ONLY, ' +
      'set ALLOW_INSECURE_DEFAULTS=true.',
    );
  }
}
