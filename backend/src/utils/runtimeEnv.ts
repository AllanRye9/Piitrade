/**
 * Whether this process is a production deployment. NODE_ENV alone is not trustworthy on PaaS hosts
 * (it is easy to leave unset or "development" — .env.example even ships it that way, see
 * authCookies.ts), so a Railway deployment counts as production regardless of NODE_ENV.
 */
export function isProductionRuntime(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID);
}
