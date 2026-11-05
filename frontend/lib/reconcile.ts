/**
 * Structural sharing for background refreshes.
 *
 * `reconcile(prev, next)` returns `prev` itself when `next` is deeply equal, and otherwise a copy of
 * `next` in which every unchanged object / array is the *previous* instance. Used as
 * `setState((p) => reconcile(p, data))`: React bails out when the reference is unchanged, and
 * memoised children whose item did not change are not re-rendered. A refresh that found nothing new
 * therefore costs no render at all, and one that found a single edit re-renders only that item.
 */
export function reconcile<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length;
    const out = next.map((n, i) => {
      const r = i < prev.length ? reconcile(prev[i], n) : n;
      if (same && r !== prev[i]) same = false;
      return r;
    });
    return (same ? prev : out) as unknown as T;
  }
  if (isPlain(prev) && isPlain(next)) {
    const pk = Object.keys(prev);
    const nk = Object.keys(next);
    let same = pk.length === nk.length;
    const out: Record<string, unknown> = {};
    for (const k of nk) {
      const r = k in prev ? reconcile(prev[k], next[k]) : next[k];
      out[k] = r;
      if (same && (!(k in prev) || r !== prev[k])) same = false;
    }
    return (same ? prev : out) as T;
  }
  return next;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
