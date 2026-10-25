'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { resolveImageUrl, timeAgo } from '@/lib/utils';
import PresenceDot from '@/components/ui/PresenceDot';
import TypingIndicator from '@/components/ui/TypingIndicator';
import { useIntlayer } from 'next-intlayer';
import { useTr } from '@/lib/i18n/useTr';
import { OfferCard } from '@/components/offers/OfferCard';
import type { PriceOffer } from '@/lib/types';

interface ConversationSummary {
  counterpart: { id: string; name: string; avatar: string | null; online: boolean; lastActiveAt: string | null };
  lastMessage: string;
  lastMessageAt: string;
  listing: { id: string; title: string; images: string[] } | null;
  unreadCount: number;
  lastMessageFromMe?: boolean;
}

interface ThreadMessage {
  id: string;
  content: string;
  read: boolean;
  createdAt: string;
  senderId: string;
  receiverId: string;
  listing: { id: string; title: string; images: string[] } | null;
  /** Present when this message carries a price offer; rendered as an offer card with live status. */
  offer?: PriceOffer | null;
}

interface CounterpartStatus {
  online: boolean;
  lastActiveAt: string | null;
  typing: boolean;
}

// No websocket infra: the inbox refreshes itself by polling. Presence/typing
// poll faster against the small /status endpoint.
const POLL_MS = 6000;
const STATUS_POLL_MS = 2500;
const TYPING_IDLE_MS = 4000;
const PAGE = 30;
const THREAD_PAGE = 50;
const GROUP_GAP_MS = 5 * 60 * 1000;

const convKey = (c: ConversationSummary) => `${c.counterpart.id}|${c.listing?.id ?? ''}`;

function dayLabel(iso: string, tr: (s: string) => string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return tr('Today');
  if (d.toDateString() === yest.toDateString()) return tr('Yesterday');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function Avatar({ name, src, size }: { name: string; src: string | null | undefined; size: number }) {
  return (
    <div className="relative overflow-hidden rounded-full bg-gray-100" style={{ width: size, height: size }}>
      {src ? (
        <Image src={resolveImageUrl(src)} alt={name} fill className="object-cover" sizes={`${size}px`} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm font-bold text-gray-400">{name.charAt(0).toUpperCase()}</div>
      )}
    </div>
  );
}

function MessagesPageInner() {
  const { user, loading: authLoading } = useAuth();
  const t = useIntlayer('messages-page');
  const tr = useTr();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeCounterpartId = searchParams.get('with');
  // ?listing=<id> opens the thread about that ONE item; ?listing=none the
  // general (no-item) thread; absent = legacy "everything with this person".
  const listingParam = searchParams.get('listing');
  const contextListingId = listingParam && listingParam !== 'none' ? listingParam : null;

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [convCursor, setConvCursor] = useState<string | null>(null);
  const [convHasMore, setConvHasMore] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [loadingMoreConvs, setLoadingMoreConvs] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'all' | 'unread'>('all');

  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [counterpartStatus, setCounterpartStatus] = useState<CounterpartStatus | null>(null);
  const [newBelow, setNewBelow] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottomRef = useRef(true);
  const forceBottomRef = useRef(true);
  const prependRef = useRef<{ h: number } | null>(null);
  const prevLenRef = useRef(0);
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);
  const convCursorLoaded = useRef(false);

  useEffect(() => {
    if (!authLoading && !user) router.push('/auth/login?next=/messages');
  }, [authLoading, user, router]);

  // ── Fit the inbox to the visible screen so neither pane needs the page to scroll ──
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const main = el.closest('main');
      const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const h = window.innerHeight - top - pad - (window.innerWidth >= 640 ? 12 : 0);
      el.style.height = `${Math.max(380, Math.floor(h))}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    const id = window.setTimeout(fit, 300); // after banners / fonts settle
    return () => { window.removeEventListener('resize', fit); window.removeEventListener('orientationchange', fit); window.clearTimeout(id); };
  }, [authLoading, conversationsLoading]);

  // ── Conversations (page 1 polls; further pages load on demand) ──
  const fetchConversations = useCallback(() => {
    if (!user) return;
    api.get('/messages/conversations', { params: { limit: PAGE } })
      .then(({ data }) => {
        const first: ConversationSummary[] = data.conversations || [];
        setConversations((prev) => {
          const seen = new Set(first.map(convKey));
          const cutoff = first.length ? first[first.length - 1].lastMessageAt : null;
          // keep already-loaded older pages, but never a stale copy of something page 1 now owns
          const older = prev.filter((c) => !seen.has(convKey(c)) && cutoff && new Date(c.lastMessageAt) <= new Date(cutoff));
          return [...first, ...older];
        });
        if (typeof data.unreadTotal === 'number') setUnreadTotal(data.unreadTotal);
        // once older pages were loaded, the cursor belongs to them — don't reset it on each poll
        if (!convCursorLoaded.current) {
          setConvHasMore(!!data.hasMore);
          setConvCursor(data.hasMore ? data.nextCursor ?? null : null);
        }
      })
      .catch(() => {})
      .finally(() => setConversationsLoading(false));
  }, [user]);

  const loadMoreConversations = async () => {
    if (!convCursor || loadingMoreConvs) return;
    setLoadingMoreConvs(true);
    try {
      const { data } = await api.get('/messages/conversations', { params: { limit: PAGE, cursor: convCursor } });
      convCursorLoaded.current = true;
      setConversations((prev) => {
        const seen = new Set(prev.map(convKey));
        return [...prev, ...(data.conversations || []).filter((c: ConversationSummary) => !seen.has(convKey(c)))];
      });
      setConvHasMore(!!data.hasMore);
      setConvCursor(data.hasMore ? data.nextCursor ?? null : null);
    } catch { /* leave the button for a retry */ }
    finally { setLoadingMoreConvs(false); }
  };

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(() => { if (document.visibilityState === 'visible') fetchConversations(); }, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  // ── Thread ──
  const mergeThread = (prev: ThreadMessage[], incoming: ThreadMessage[]) => {
    const map = new Map(prev.map((m) => [m.id, m]));
    for (const m of incoming) map.set(m.id, m);
    return [...map.values()].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  };

  const fetchThread = useCallback((counterpartId: string, silent = false) => {
    if (!silent) setThreadLoading(true);
    api.get(`/messages/thread/${counterpartId}`, { params: { ...(listingParam ? { listing: listingParam } : {}), limit: THREAD_PAGE } })
      .then(({ data }) => {
        const incoming: ThreadMessage[] = data.messages || [];
        setThread((prev) => (silent ? mergeThread(prev, incoming) : incoming));
        if (!silent) {
          setHasOlder(!!data.hasMore);
          setOlderCursor(data.nextBefore ?? null);
          // opening a thread marks its incoming mail read — clear the badge now
          fetchConversations();
        }
      })
      .catch(() => { if (!silent) setError(String(t.loadFailed)); })
      .finally(() => { if (!silent) setThreadLoading(false); });
  }, [fetchConversations, listingParam, t.loadFailed]);

  const loadOlder = async () => {
    if (!activeCounterpartId || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    const box = scrollRef.current;
    try {
      const { data } = await api.get(`/messages/thread/${activeCounterpartId}`, {
        params: { ...(listingParam ? { listing: listingParam } : {}), limit: THREAD_PAGE, before: olderCursor },
      });
      if (box) prependRef.current = { h: box.scrollHeight };
      setThread((prev) => mergeThread(prev, data.messages || []));
      setHasOlder(!!data.hasMore);
      setOlderCursor(data.nextBefore ?? null);
    } catch { /* retry via the button */ }
    finally { setLoadingOlder(false); }
  };

  useEffect(() => {
    setThread([]); setHasOlder(false); setOlderCursor(null); setNewBelow(0);
    forceBottomRef.current = true; prevLenRef.current = 0;
    if (!activeCounterpartId) return;
    setError('');
    fetchThread(activeCounterpartId);
    const interval = setInterval(() => { if (document.visibilityState === 'visible') fetchThread(activeCounterpartId, true); }, POLL_MS);
    return () => clearInterval(interval);
  }, [activeCounterpartId, fetchThread]);

  useEffect(() => {
    if (!activeCounterpartId) { setCounterpartStatus(null); return; }
    setCounterpartStatus(null);
    let cancelled = false;
    const poll = () => {
      if (document.visibilityState !== 'visible') return;
      api.get(`/messages/thread/${activeCounterpartId}/status`)
        .then(({ data }) => { if (!cancelled) setCounterpartStatus({ online: data.online, lastActiveAt: data.lastActiveAt, typing: data.typing }); })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeCounterpartId]);

  // Smart scrolling: stick to the bottom only if the reader is already there; otherwise
  // leave their place alone and offer a "new messages" pill. Prepending older mail keeps position.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    if (prependRef.current) {
      box.scrollTop += box.scrollHeight - prependRef.current.h;
      prependRef.current = null;
      prevLenRef.current = thread.length;
      return;
    }
    const grew = thread.length > prevLenRef.current;
    const last = thread[thread.length - 1];
    if (forceBottomRef.current && thread.length) {
      box.scrollTop = box.scrollHeight;
      forceBottomRef.current = false;
      setNewBelow(0);
    } else if (grew && prevLenRef.current > 0) {
      if (atBottomRef.current || last?.senderId === user?.id) {
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
        setNewBelow(0);
      } else {
        setNewBelow((n) => n + (thread.length - prevLenRef.current));
      }
    }
    prevLenRef.current = thread.length;
  }, [thread, user?.id]);

  useEffect(() => {
    if (counterpartStatus?.typing && atBottomRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [counterpartStatus?.typing]);

  const onScroll = () => {
    const box = scrollRef.current;
    if (!box) return;
    atBottomRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (atBottomRef.current && newBelow) setNewBelow(0);
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    const el = inputRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 112)}px`; }
    if (!activeCounterpartId) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current > 2000) {
      lastTypingSentRef.current = now;
      api.post('/messages/typing', { receiverId: activeCounterpartId }).catch(() => {});
    }
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    if (value.trim()) {
      typingIdleTimerRef.current = setTimeout(() => { lastTypingSentRef.current = 0; }, TYPING_IDLE_MS);
    }
  };

  const activeConversation = conversations.find((c) =>
    c.counterpart.id === activeCounterpartId &&
    (listingParam == null ? true : listingParam === 'none' ? !c.listing : c.listing?.id === listingParam));

  // A fresh chat (arriving from "Message Seller") has no conversation row yet; the listing page
  // leaves a one-time name hint in sessionStorage.
  const [pendingCounterpartName, setPendingCounterpartName] = useState<string | null>(null);
  useEffect(() => {
    if (!activeCounterpartId) { setPendingCounterpartName(null); return; }
    if (activeConversation) { setPendingCounterpartName(null); return; }
    try { setPendingCounterpartName(sessionStorage.getItem(`chat-start:${activeCounterpartId}`)); } catch { /* private mode */ }
  }, [activeCounterpartId, activeConversation]);

  const sendText = async (raw: string) => {
    const content = raw.trim();
    if (!content || !activeCounterpartId || sending) return;
    setSending(true);
    setError('');
    lastTypingSentRef.current = 0;
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    try {
      await api.post('/messages', {
        receiverId: activeCounterpartId,
        content,
        listingId: listingParam === 'none' ? undefined : (contextListingId || activeConversation?.listing?.id || undefined),
      });
      forceBottomRef.current = true;
      fetchThread(activeCounterpartId, true);
      fetchConversations();
      return true;
    } catch {
      setError(String(t.sendFailed));
      return false;
    } finally {
      setSending(false);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = draft;
    if (!content.trim()) return;
    setDraft('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    const ok = await sendText(content);
    if (ok === false) setDraft(content);
  };

  // ── Derived: filtered list, unread counts, thread rows ──
  const unreadCount = unreadTotal ?? conversations.reduce((s, c) => s + (c.unreadCount > 0 ? 1 : 0), 0);
  const unreadConvs = conversations.filter((c) => c.unreadCount > 0).length;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((c) => {
      if (tab === 'unread' && c.unreadCount === 0) return false;
      if (!q) return true;
      return c.counterpart.name.toLowerCase().includes(q) || (c.listing?.title ?? '').toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q);
    });
  }, [conversations, query, tab]);

  const rows = useMemo(() => thread.map((m, i) => {
    const prev = thread[i - 1];
    const next = thread[i + 1];
    const gap = (a?: ThreadMessage, b?: ThreadMessage) => !a || !b || a.senderId !== b.senderId || Math.abs(+new Date(b.createdAt) - +new Date(a.createdAt)) > GROUP_GAP_MS;
    return {
      m,
      showDay: !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString(),
      groupStart: gap(prev, m),
      groupEnd: gap(m, next) || new Date(next!.createdAt).toDateString() !== new Date(m.createdAt).toDateString(),
    };
  }), [thread]);

  if (authLoading || (conversationsLoading && !activeCounterpartId)) {
    return <div className="mx-auto max-w-5xl px-4 py-5 text-center text-sm text-gray-500">{t.loading}</div>;
  }
  if (!user) return null;

  const showListPane = !activeCounterpartId; // mobile: list OR thread, never both
  const displayName = activeConversation?.counterpart.name || pendingCounterpartName || String(t.newConversation);
  const displayAvatar = activeConversation?.counterpart.avatar;
  const ctxListing = activeConversation?.listing ?? thread.find((m) => m.listing)?.listing ?? null;
  const ctxListingId = contextListingId || ctxListing?.id || null;
  const quick = [tr('Is this still available?'), tr('What is your best price?'), tr('Where can we meet?')];

  return (
    <div className="mx-auto w-full max-w-[1500px] sm:px-3 sm:pt-2">
      <div ref={rootRef} className="flex overflow-hidden bg-white sm:rounded-2xl sm:border sm:border-gray-100 sm:shadow-sm" style={{ height: 'calc(100dvh - 11rem)' }}>
        {/* ── Conversation list ── */}
        <aside className={`min-h-0 w-full flex-col sm:flex sm:w-[22rem] sm:shrink-0 sm:border-r sm:border-gray-100 lg:w-[26rem] ${showListPane ? 'flex' : 'hidden'}`}>
          <div className="shrink-0 space-y-2 border-b border-gray-100 px-3 pb-2 pt-3">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-extrabold text-gray-900">{t.title}</h1>
              {unreadCount > 0 && <span key={unreadCount} className="animate-pop rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">{unreadCount} {tr('new')}</span>}
            </div>
            <div className="relative">
              <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" /></svg>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Search people, items or messages')} aria-label={tr('Search conversations')}
                className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-8 text-sm focus:border-red-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-100" />
              {query && <button type="button" onClick={() => setQuery('')} aria-label={tr('Clear')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">✕</button>}
            </div>
            <div className="flex gap-1" role="tablist" aria-label={tr('Filter conversations')}>
              {([['all', tr('All'), conversations.length], ['unread', tr('Unread'), unreadConvs]] as const).map(([k, label, n]) => (
                <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${tab === k ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {label} <span className={tab === k ? 'opacity-80' : 'text-gray-400'}>{n}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {conversations.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <div className="mb-2 text-4xl" aria-hidden="true">💬</div>
                <p className="text-sm font-semibold text-gray-600">{t.noConversationsTitle}</p>
                <p className="mt-1 text-xs text-gray-400">{t.noConversationsSubtitle}</p>
              </div>
            ) : visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-gray-400">
                {tab === 'unread' && !query ? tr('You are all caught up 🎉') : tr('No conversations match')}
                {(query || tab === 'unread') && <> · <button type="button" className="font-semibold text-red-600 underline" onClick={() => { setQuery(''); setTab('all'); }}>{tr('Show all')}</button></>}
              </p>
            ) : (
              <>
                {visible.map((c) => {
                  const active = c.counterpart.id === activeCounterpartId && (listingParam == null || (listingParam === 'none' ? !c.listing : c.listing?.id === listingParam));
                  const unread = c.unreadCount > 0;
                  return (
                    <Link
                      key={convKey(c)}
                      href={`/messages?with=${c.counterpart.id}&listing=${c.listing?.id ?? 'none'}`}
                      aria-current={active ? 'true' : undefined}
                      className={`relative flex items-center gap-3 border-b border-gray-50 px-3 py-2.5 transition-colors hover:bg-gray-50 ${active ? 'bg-[var(--theme-bg-light)]' : unread ? 'bg-red-50/40' : ''}`}
                    >
                      {active && <span className="absolute inset-y-0 left-0 w-1 bg-[var(--theme-primary)]" aria-hidden />}
                      <div className="relative h-11 w-11 shrink-0">
                        <Avatar name={c.counterpart.name} src={c.counterpart.avatar} size={44} />
                        <PresenceDot online={c.counterpart.online} size="sm" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={`truncate text-sm ${unread ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>{c.counterpart.name}</p>
                          <span className={`shrink-0 text-[10px] ${unread ? 'font-semibold text-red-600' : 'text-gray-400'}`}>{timeAgo(c.lastMessageAt)}</span>
                        </div>
                        {c.listing && <p className="truncate text-[11px] font-medium text-[var(--theme-primary)]">{c.listing.title}</p>}
                        <p className={`truncate text-xs ${unread ? 'font-medium text-gray-800' : 'text-gray-400'}`}>{c.lastMessageFromMe ? `${tr('You')}: ` : ''}{c.lastMessage}</p>
                      </div>
                      {c.listing?.images?.[0] && (
                        <div className="relative hidden h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100 sm:block">
                          <Image src={resolveImageUrl(c.listing.images[0])} alt="" fill className="object-cover" sizes="40px" unoptimized />
                        </div>
                      )}
                      {unread && (
                        <span className="flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                          {c.unreadCount > 9 ? '9+' : c.unreadCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
                {convHasMore && convCursor && !query && tab === 'all' && (
                  <button type="button" onClick={loadMoreConversations} disabled={loadingMoreConvs}
                    className="w-full py-3 text-xs font-semibold text-red-600 hover:bg-gray-50 disabled:opacity-50">
                    {loadingMoreConvs ? tr('Loading…') : tr('Load older conversations')}
                  </button>
                )}
              </>
            )}
          </div>
        </aside>

        {/* ── Thread ── */}
        <section className={`min-h-0 min-w-0 flex-1 flex-col sm:flex ${showListPane ? 'hidden' : 'flex'}`}>
          {!activeCounterpartId ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <div>
                <div className="mb-2 text-4xl" aria-hidden="true">👋</div>
                <p className="text-sm text-gray-400">{t.selectConversation}</p>
              </div>
            </div>
          ) : (
            <>
              <header className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-3 py-2">
                <Link href="/messages" className="-ml-1 p-1.5 text-gray-500 sm:hidden" aria-label={String(t.backToConversations)}>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </Link>
                <div className="relative h-9 w-9 shrink-0">
                  <Avatar name={displayName} src={displayAvatar} size={36} />
                  {counterpartStatus && <PresenceDot online={counterpartStatus.online} size="md" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gray-900">{displayName}</p>
                  {counterpartStatus?.typing ? (
                    <p className="text-[11px] font-medium italic text-emerald-600">{t.typing}</p>
                  ) : counterpartStatus?.online ? (
                    <p className="text-[11px] font-medium text-emerald-600">{t.online}</p>
                  ) : counterpartStatus?.lastActiveAt ? (
                    <p className="text-[11px] text-gray-400">{t.lastSeen} {timeAgo(counterpartStatus.lastActiveAt)}</p>
                  ) : null}
                </div>
                {ctxListingId && (
                  <Link href={`/listings/${ctxListingId}`} className="flex min-w-0 max-w-[45%] items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1 pr-2.5 hover:border-red-300 hover:bg-white">
                    {ctxListing?.images?.[0] && (
                      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md bg-gray-100">
                        <Image src={resolveImageUrl(ctxListing.images[0])} alt="" fill className="object-cover" sizes="32px" unoptimized />
                      </span>
                    )}
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-[11px] font-semibold text-gray-800">{ctxListing?.title ?? tr('View listing')}</span>
                      <span className="block text-[10px] font-semibold text-[var(--theme-primary)]">{tr('View ad')} →</span>
                    </span>
                  </Link>
                )}
              </header>

              <div className="relative min-h-0 flex-1">
                <div ref={scrollRef} onScroll={onScroll} className="h-full space-y-0.5 overflow-y-auto overscroll-contain bg-gray-50/60 px-3 py-3">
                  {hasOlder && (
                    <div className="pb-2 text-center">
                      <button type="button" onClick={loadOlder} disabled={loadingOlder} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        {loadingOlder ? tr('Loading…') : tr('Load earlier messages')}
                      </button>
                    </div>
                  )}
                  {threadLoading ? (
                    <p className="py-8 text-center text-sm text-gray-400">{t.loading}</p>
                  ) : thread.length === 0 && !counterpartStatus?.typing ? (
                    <div className="py-8 text-center">
                      <p className="text-sm text-gray-400">{t.sayHello}</p>
                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        {quick.map((q) => (
                          <button key={q} type="button" disabled={sending} onClick={() => sendText(q)}
                            className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">{q}</button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      {rows.map(({ m, showDay, groupStart, groupEnd }) => {
                        const isMine = m.senderId === user.id;
                        return (
                          <div key={m.id}>
                            {showDay && (
                              <div className="sticky top-0 z-10 my-2 flex justify-center">
                                <span className="rounded-full bg-white/90 px-3 py-0.5 text-[10px] font-semibold text-gray-500 shadow-sm ring-1 ring-gray-100">{dayLabel(m.createdAt, tr)}</span>
                              </div>
                            )}
                            <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} ${groupStart ? 'mt-2' : ''}`}>
                              {m.offer ? (
                                <div className="w-[85%] sm:w-[70%]">
                                  <OfferCard
                                    offer={m.offer}
                                    meId={user.id}
                                    onChanged={() => { if (activeCounterpartId) fetchThread(activeCounterpartId, true); fetchConversations(); }}
                                  />
                                  <p className={`mt-0.5 text-[10px] text-gray-400 ${isMine ? 'text-right' : ''}`}>{clock(m.createdAt)}</p>
                                </div>
                              ) : (
                              <div
                                className={`max-w-[85%] px-3.5 py-1.5 text-sm sm:max-w-[70%] ${
                                  isMine ? 'bg-[var(--theme-primary)] text-white' : 'border border-gray-100 bg-white text-gray-800'
                                } ${groupEnd ? (isMine ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-bl-md') : 'rounded-2xl'}`}
                              >
                                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                                {groupEnd && (
                                  <div className={`mt-0.5 flex items-center gap-1 ${isMine ? 'justify-end' : ''}`}>
                                    <p className={`text-[10px] ${isMine ? 'text-white/70' : 'text-gray-400'}`}>{clock(m.createdAt)}</p>
                                    {/* One check = sent, two = read (no separate "delivered" state exists). Own messages only. */}
                                    {isMine && (m.read ? (
                                      <svg className="h-3.5 w-3.5 text-sky-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="Read"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M1 13l4 4L15 7M9 13l4 4L23 7" /></svg>
                                    ) : (
                                      <svg className="h-3.5 w-3.5 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="Sent"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                                    ))}
                                  </div>
                                )}
                              </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {counterpartStatus?.typing && <TypingIndicator />}
                    </>
                  )}
                </div>
                {newBelow > 0 && (
                  <button type="button" onClick={() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); setNewBelow(0); }}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 animate-pop rounded-full bg-gray-900 px-3 py-1.5 text-xs font-bold text-white shadow-lg">
                    ↓ {newBelow} {tr('new messages')}
                  </button>
                )}
              </div>

              {error && <p className="shrink-0 px-4 pb-1 text-xs text-red-600">{error}</p>}

              <form onSubmit={handleSend} className="flex shrink-0 items-end gap-2 border-t border-gray-100 bg-white px-3 py-2">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={String(t.typePlaceholder)}
                  rows={1}
                  className="max-h-28 flex-1 resize-none rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]/40"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || sending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--theme-primary)] text-white transition-all hover:brightness-110 disabled:opacity-40"
                  aria-label={String(t.sendMessage)}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const t = useIntlayer('messages-page');
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl px-4 py-5 text-center text-sm text-gray-500">{t.loading}</div>}>
      <MessagesPageInner />
    </Suspense>
  );
}
