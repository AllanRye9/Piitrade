/**
 * liveData.ts — instant, invisible page refreshes.
 *
 * How it works
 *   1. Postgres triggers announce every change to listings / photos / clicks (backend migration
 *      20261105000000_live_change_feed) and the server pushes a tiny Server-Sent Event: "topic X changed".
 *      The event carries no data, so there is nothing to leak.
 *   2. This module keeps ONE shared stream per tab (reference counted) and calls the page's refetch.
 *   3. The refetch is silent: no spinner, single-flight (never two at once, a change that arrives
 *      mid-fetch triggers exactly one more), skipped while the tab is hidden (done on return), and the
 *      page applies the result with reconcile() so unchanged data causes no render at all.
 *
 * Fallbacks: if the stream is down or refused, the page polls every 20 s (and on focus / reconnect);
 * while it is up a slow 90 s check is a safety net. The stream is closed after 60 s in a hidden tab.
 *
 * End to end a change shows up in roughly 100–300 ms: trigger → NOTIFY (ms) → push (ms) →
 * 60 ms merge window → one small request.
 */
import { useEffect, useRef, useState } from 'react';
import { api, API_URL } from '@/lib/api';
import { getAccessToken } from '@/lib/authStorage';
import { parseSseBuffer } from '@/lib/alertStream';
import { clearSharedGets } from '@/lib/sharedGet';

export type LiveChannelName = 'public' | 'admin';
export type LiveTopic = 'listings' | 'clicks';

type LiveEvent =
  | { kind: 'change'; topics: string[] }
  | { kind: 'open'; reconnect: boolean }
  | { kind: 'down' };
type Listener = (e: LiveEvent) => void;

const MIN_BACKOFF = 1_000;
const MAX_BACKOFF = 30_000;
const HIDDEN_CLOSE_MS = 60_000;

class Channel {
  private listeners = new Set<Listener>();
  private abort: AbortController | null = null;
  private opened = false;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private onVis = () => {
    if (document.visibilityState === 'hidden') {
      this.hiddenTimer = setTimeout(() => this.stopConnection(), HIDDEN_CLOSE_MS);
    } else {
      if (this.hiddenTimer) { clearTimeout(this.hiddenTimer); this.hiddenTimer = null; }
      if (!this.abort && this.listeners.size > 0) this.startConnection();
    }
  };

  constructor(private name: LiveChannelName) {}

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    if (this.listeners.size === 1) {
      document.addEventListener('visibilitychange', this.onVis);
      this.startConnection();
    }
    return () => {
      this.listeners.delete(l);
      if (this.listeners.size === 0) {
        document.removeEventListener('visibilitychange', this.onVis);
        if (this.hiddenTimer) { clearTimeout(this.hiddenTimer); this.hiddenTimer = null; }
        this.stopConnection();
        this.opened = false;
      }
    };
  }

  private emit(e: LiveEvent) { for (const l of [...this.listeners]) l(e); }

  private stopConnection() {
    this.abort?.abort();
    this.abort = null;
    this.emit({ kind: 'down' });
  }

  private startConnection() {
    if (this.abort) return;
    const controller = new AbortController();
    this.abort = controller;
    void this.run(controller);
  }

  private async run(controller: AbortController) {
    const { signal } = controller;
    let backoff = MIN_BACKOFF;
    while (!signal.aborted) {
      let lived = 0;
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        if (this.name === 'admin') {
          const token = getAccessToken();
          if (!token) throw new Error('no token');
          headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(`${API_URL}/api/live/${this.name}`, { headers, signal, cache: 'no-store', credentials: 'omit' });
        if (res.status === 401 && this.name === 'admin') {
          await api.get('/users/me').catch(() => undefined); // the axios 401 interceptor refreshes the token
          throw new Error('unauthorized');
        }
        if (res.status === 429) { backoff = MAX_BACKOFF; throw new Error('busy'); }
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        lived = Date.now();
        this.emit({ kind: 'open', reconnect: this.opened });
        this.opened = true;
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
            if (m.event !== 'change') continue;
            try {
              const d = JSON.parse(m.data) as { topics?: string[] };
              const topics = Array.isArray(d.topics) ? d.topics : [];
              if (topics.includes('listings')) clearSharedGets();
              this.emit({ kind: 'change', topics });
            } catch { /* ignore a malformed frame */ }
          }
        }
      } catch {
        /* fall through to the reconnect below (aborts exit the loop) */
      }
      if (signal.aborted) return;
      this.emit({ kind: 'down' });
      if (lived && Date.now() - lived > 10_000) backoff = MIN_BACKOFF;
      await new Promise<void>((r) => setTimeout(r, backoff + Math.random() * 500));
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    }
  }
}

const channels: Partial<Record<LiveChannelName, Channel>> = {};
function channel(name: LiveChannelName): Channel {
  return (channels[name] ??= new Channel(name));
}

const MERGE_MS = 60;
const POLL_DOWN_MS = 20_000;
const POLL_UP_MS = 90_000;

/**
 * Calls `refetch` right after the server reports a change to `topic` (and as a fallback when the stream
 * is down). `refetch` must be silent: no loading state, no error flash; use reconcile() when storing.
 */
export function useLiveRefresh(
  refetch: () => Promise<unknown> | void,
  opts: { channel: LiveChannelName; topic: LiveTopic; enabled?: boolean },
): { live: boolean } {
  const { channel: name, topic, enabled = true } = opts;
  const fnRef = useRef(refetch);
  useEffect(() => { fnRef.current = refetch; });
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let cancelled = false;
    let running = false;
    let dirty = false;
    let connected = false;
    let mergeTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const isHidden = () => document.visibilityState === 'hidden';
    const run = async () => {
      if (cancelled) return;
      if (isHidden()) { dirty = true; return; }
      if (running) { dirty = true; return; }
      running = true;
      try {
        do {
          dirty = false;
          try { await fnRef.current(); } catch { /* silent */ }
        } while (dirty && !cancelled && !isHidden());
      } finally {
        running = false;
      }
    };
    const schedule = () => {
      if (mergeTimer) clearTimeout(mergeTimer);
      mergeTimer = setTimeout(() => { mergeTimer = null; void run(); }, MERGE_MS);
    };
    const poll = () => {
      pollTimer = setTimeout(() => { void run(); poll(); }, connected ? POLL_UP_MS : POLL_DOWN_MS);
    };

    const unsub = channel(name).subscribe((e) => {
      if (e.kind === 'change') { if (e.topics.includes(topic)) schedule(); return; }
      if (e.kind === 'open') { connected = true; setLive(true); if (e.reconnect) schedule(); return; }
      connected = false; setLive(false);
    });
    const onVisible = () => { if (document.visibilityState === 'visible' && dirty) schedule(); };
    const onFocus = () => { if (!connected) schedule(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    poll();

    return () => {
      cancelled = true;
      unsub();
      if (mergeTimer) clearTimeout(mergeTimer);
      if (pollTimer) clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [name, topic, enabled]);

  return { live };
}
