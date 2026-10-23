/** Safe page/limit parsing: never NaN, never < 1, limit capped. (parseInt of junk gave NaN and a failing query.) */
export function parsePaging(query: Record<string, unknown>, defaultLimit = 20, maxLimit = 100): { page: number; limit: number } {
  const num = (v: unknown, fallback: number) => {
    const n = Number.parseInt(typeof v === 'string' ? v : '', 10);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    page: Math.max(1, num(query.page, 1)),
    limit: Math.min(maxLimit, Math.max(1, num(query.limit, defaultLimit))),
  };
}
