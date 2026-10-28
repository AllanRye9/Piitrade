/**
 * alertStream.ts — client for the instant-alert Server-Sent Events stream (GET /api/alerts/stream).
 *
 * The browser's EventSource cannot send an Authorization header, and this API authenticates with a
 * Bearer token, so the stream is read with fetch() and parsed here. Reconnects with exponential
 * backoff; the caller also polls /alerts/recent as a safety net, and de-duplicates on event id.
 */
import { safeAlertHref, type AlertEvent } from '@/lib/alerts';

export interface SseMessage { event: string; data: string; id?: string }

/** Split a text buffer into complete SSE messages; returns the unfinished remainder. Pure. */
export function parseSseBuffer(buffer: string): { messages: SseMessage[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  const messages: SseMessage[] = [];
  for (const block of parts) {
    let event = 'message';
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue; // comment / heartbeat
      const i = line.indexOf(':');
      const field = i === -1 ? line : line.slice(0, i);
      const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
      else if (field === 'id') id = value;
    }
    if (data.length > 0) messages.push({ event, data: data.join('\n'), id });
  }
  return { messages, rest };
}

export function parseAlertEvent(msg: SseMessage): AlertEvent | null {
  if (msg.event !== 'alert') return null;
  try {
    const e = JSON.parse(msg.data) as Partial<AlertEvent>;
    if (!e || typeof e.id !== 'string' || typeof e.title !== 'string') return null;
    return {
      id: e.id, listingId: e.listingId ?? '', alertName: e.alertName ?? '', title: e.title, message: e.message ?? '',
      href: safeAlertHref(e.href),
      image: typeof e.image === 'string' ? e.image : null, sound: e.sound !== false, createdAt: e.createdAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export interface StreamOptions {
  url: string;
  getToken: () => string | null;
  onEvent: (e: AlertEvent) => void;
  onStatus?: (connected: boolean) => void;
  /** Called when the server answers 401, so the caller can refresh the access token before the retry. */
  refreshAuth?: () => Promise<void>;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Test hook: replaces the backoff sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const MIN_BACKOFF = 1_000;
const MAX_BACKOFF = 30_000;

export async function runAlertStream(opts: StreamOptions): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let backoff = MIN_BACKOFF;

  while (!opts.signal.aborted) {
    let connectedAt = 0;
    try {
      const token = opts.getToken();
      if (!token) { await sleep(MAX_BACKOFF); continue; }
      const res = await doFetch(opts.url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: opts.signal,
        cache: 'no-store',
      });
      if (res.status === 401) { await opts.refreshAuth?.(); throw new Error('unauthorized'); }
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

      connectedAt = Date.now();
      opts.onStatus?.(true);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { messages, rest } = parseSseBuffer(buffer);
        buffer = rest;
        for (const m of messages) {
          const ev = parseAlertEvent(m);
          if (ev) opts.onEvent(ev);
        }
      }
    } catch {
      /* fall through to the backoff below (aborts exit the loop) */
    }
    opts.onStatus?.(false);
    if (opts.signal.aborted) return;
    // A connection that lived a while was healthy: start the backoff over.
    if (connectedAt && Date.now() - connectedAt > 10_000) backoff = MIN_BACKOFF;
    await sleep(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  }
}
