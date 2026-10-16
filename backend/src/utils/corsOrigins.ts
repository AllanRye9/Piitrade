/**
 * Single source of truth for which browser origins may call this API with
 * credentials. Used by the CORS layer (app.ts) and by the CSRF-style Origin
 * check on cookie-authenticated endpoints (middleware/originCheck.ts).
 */
export function getAllowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.CORS_ORIGIN || 'http://localhost:3000';
  const fromEnv = raw.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  // A literal "*" can never be combined with credentials:true without becoming
  // "any website may act as the logged-in user", so it is dropped, not honoured.
  const explicit = fromEnv.filter((o) => o !== '*');
  return Array.from(new Set([...explicit, 'https://piitrade.com', 'https://www.piitrade.com']));
}

export function isAllowedOrigin(origin: string | undefined, allowed: string[] = getAllowedOrigins()): boolean {
  if (!origin) return false;
  return allowed.includes(origin.replace(/\/+$/, ''));
}
