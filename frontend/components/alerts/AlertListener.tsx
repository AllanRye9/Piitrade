'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, API_URL } from '@/lib/api';
import { getAccessToken } from '@/lib/authStorage';
import { useAuth } from '@/context/AuthContext';
import { useTr } from '@/lib/i18n/useTr';
import { runAlertStream } from '@/lib/alertStream';
import { isSoundEnabled, playAlertSound, unlockAudio, audioIsReady } from '@/lib/alertSound';
import { ALERT_ARRIVED_EVENT, rememberId, safeAlertHref, type AlertEvent } from '@/lib/alerts';

/** Window event other parts of the site (header bell, alerts page) listen to. */
export const ALERT_EVENT = ALERT_ARRIVED_EVENT;

const POLL_CONNECTED_MS = 45_000; // safety net while the live stream is up
const POLL_OFFLINE_MS = 12_000;   // stream down: poll quickly instead
const TOAST_MS = 15_000;
const MAX_TOASTS = 3;

interface ToastItem extends AlertEvent { soundBlocked: boolean }

/**
 * Mounted once in the root layout. While a user is signed in it keeps a live connection to the alert
 * stream, so the moment a listing matching one of their alerts is posted it:
 *   1. shows a clickable toast,
 *   2. plays a chime (if the alert's sound is on and the browser tab allows audio),
 *   3. updates the notification bell immediately (via ALERT_EVENT) and flashes the tab title when
 *      the tab is in the background.
 * A short poll of /alerts/recent backs the stream up (proxies that buffer streams, flaky networks);
 * both paths share one de-duplication set, so an alert is only ever shown once.
 */
export default function AlertListener() {
  const { user } = useAuth();
  const tr = useTr();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seen = useRef(new Set<string>());
  const connected = useRef(false);
  const lastSeen = useRef(new Date().toISOString());
  const unseenWhileHidden = useRef(0);
  const baseTitle = useRef('');
  const titleTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const userId = user?.id;

  // Browsers allow audio only after a gesture: unlock on the first click / tap / key press.
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      if (audioIsReady()) {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('touchstart', unlock);
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  const stopTitleFlash = useCallback(() => {
    if (titleTimer.current) { clearInterval(titleTimer.current); titleTimer.current = null; }
    unseenWhileHidden.current = 0;
    if (baseTitle.current) document.title = baseTitle.current;
  }, []);

  useEffect(() => {
    const onVisible = () => { if (!document.hidden) stopTitleFlash(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); stopTitleFlash(); };
  }, [stopTitleFlash]);

  const flashTitle = useCallback(() => {
    if (!document.hidden) return;
    unseenWhileHidden.current += 1;
    if (titleTimer.current) return;
    baseTitle.current = document.title;
    let on = false;
    titleTimer.current = setInterval(() => {
      on = !on;
      document.title = on ? `🔔 (${unseenWhileHidden.current}) ${tr('New alert')}` : baseTitle.current;
    }, 1000);
  }, [tr]);

  const handle = useCallback(async (raw: AlertEvent) => {
    if (!rememberId(seen.current, raw.id)) return; // already shown (stream + poll can both deliver it)
    const event: AlertEvent = { ...raw, href: safeAlertHref(raw.href) };
    if (event.createdAt > lastSeen.current) lastSeen.current = event.createdAt;
    let soundBlocked = false;
    if (event.sound && isSoundEnabled()) soundBlocked = !(await playAlertSound());
    setToasts((t) => [{ ...event, soundBlocked }, ...t].slice(0, MAX_TOASTS));
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== event.id)), TOAST_MS);
    flashTitle();
    window.dispatchEvent(new CustomEvent(ALERT_EVENT, { detail: event }));
  }, [flashTitle]);

  // Live stream + poll fallback, only while signed in.
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    lastSeen.current = new Date().toISOString();
    connected.current = false;

    void runAlertStream({
      url: `${API_URL}/api/alerts/stream`,
      getToken: getAccessToken,
      onEvent: (e) => { void handle(e); },
      onStatus: (c) => { connected.current = c; },
      refreshAuth: async () => { await api.get('/alerts/recent').catch(() => undefined); }, // the axios 401 interceptor refreshes the token
      signal: controller.signal,
    });

    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const { data } = await api.get('/alerts/recent', { params: { since: lastSeen.current } });
        for (const e of (data.events ?? []) as AlertEvent[]) await handle(e);
        if (typeof data.now === 'string' && data.now > lastSeen.current) lastSeen.current = data.now;
      } catch { /* offline or signed out: try again next round */ }
      if (!controller.signal.aborted) pollTimer = setTimeout(poll, connected.current ? POLL_CONNECTED_MS : POLL_OFFLINE_MS);
    };
    pollTimer = setTimeout(poll, POLL_OFFLINE_MS);

    return () => { controller.abort(); if (pollTimer) clearTimeout(pollTimer); connected.current = false; };
  }, [userId, handle]);

  if (!userId || toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-20 z-[500] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2" role="region" aria-label={tr('New listing alerts')}>
      {toasts.map((t) => (
        <div key={t.id} role="alert" className="pointer-events-auto flex items-start gap-3 overflow-hidden rounded-xl border border-amber-200 bg-white p-3 shadow-xl animate-slide-down">
          <Link href={t.href} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="flex min-w-0 flex-1 items-start gap-3">
            {t.image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={t.image} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
              : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-2xl" aria-hidden="true">🎯</span>}
            <span className="min-w-0">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-amber-700">🔔 {tr('Alert')}{t.alertName ? ` · ${t.alertName}` : ''}</span>
              <span className="block truncate text-sm font-semibold text-gray-900">{t.title.replace(/^New match:\s*/, '')}</span>
              <span className="block text-xs text-gray-600 line-clamp-2">{t.message}</span>
              {t.soundBlocked && <span className="mt-1 block text-[11px] text-gray-400">🔇 {tr('Click anywhere once to enable alert sound')}</span>}
            </span>
          </Link>
          <button type="button" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label={tr('Dismiss')} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">✕</button>
        </div>
      ))}
    </div>
  );
}
