import axios, { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

/**
 * Public, non-personal GETs that several components request on the same page (the category tree is fetched by the
 * header, the category bar, the home grid and the ad form; popular searches and site stats twice each). They share
 * one in-flight request and reuse the answer briefly. Anything not listed, any non-GET, and any failure behaves
 * exactly as before.
 */
const SHARED: { test: RegExp; ttlMs: number }[] = [
  { test: /^\/categories$/, ttlMs: 60_000 },
  { test: /^\/categories\/(rollup-counts|counts|active-counts)$/, ttlMs: 10_000 },
  { test: /^\/listings\/popular-searches$/, ttlMs: 60_000 },
  { test: /^\/listings\/locations$/, ttlMs: 60_000 },
  { test: /^\/stats\/public$/, ttlMs: 30_000 },
  { test: /^\/site-media$/, ttlMs: 60_000 },
  { test: /^\/public\/site-config$/, ttlMs: 30_000 },
];

interface Entry { at: number; ttl: number; promise: Promise<AxiosResponse> }
const entries = new Map<string, Entry>();

const pathOf = (config: InternalAxiosRequestConfig): string => (config.url ?? '').split('?')[0].replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '');

export function withSharedGets(base: AxiosAdapter): AxiosAdapter {
  return (config) => {
    if ((config.method ?? 'get').toLowerCase() !== 'get' || typeof window === 'undefined') return base(config);
    const path = pathOf(config);
    const rule = SHARED.find((r) => r.test.test(path));
    if (!rule) return base(config);
    // The time-stamp the site-config call appends (_t) is a cache-buster; sharing is the point here, so ignore it.
    const { _t: _ignored, ...params } = (config.params ?? {}) as Record<string, unknown>;
    const key = `${config.baseURL ?? ''}${path}?${JSON.stringify(params)}|${config.headers?.Authorization ? 'a' : 'x'}`;
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.promise.then((r) => ({ ...r, data: typeof structuredClone === 'function' ? structuredClone(r.data) : r.data, config }));
    const promise = base(config);
    entries.set(key, { at: Date.now(), ttl: rule.ttlMs, promise });
    promise.catch(() => { if (entries.get(key)?.promise === promise) entries.delete(key); });
    return promise;
  };
}

export const resolveAdapter = (adapter: unknown): AxiosAdapter => axios.getAdapter(adapter as never);
