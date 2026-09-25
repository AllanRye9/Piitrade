'use client';

import { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { resolveImageUrl, timeAgo } from '@/lib/utils';
import PresenceDot from '@/components/ui/PresenceDot';
import TypingIndicator from '@/components/ui/TypingIndicator';
import { useIntlayer } from 'next-intlayer';

interface ConversationSummary {
  counterpart: { id: string; name: string; avatar: string | null; online: boolean; lastActiveAt: string | null };
  lastMessage: string;
  lastMessageAt: string;
  listing: { id: string; title: string; images: string[] } | null;
  unreadCount: number;
}

interface ThreadMessage {
  id: string;
  content: string;
  read: boolean;
  createdAt: string;
  senderId: string;
  receiverId: string;
  listing: { id: string; title: string; images: string[] } | null;
}

interface CounterpartStatus {
  online: boolean;
  lastActiveAt: string | null;
  typing: boolean;
}

// Polling interval for the active thread and the conversation list. This
// backend doesn't have websocket infra, so "no need to chat outside the
// platform" is delivered via a REST inbox that refreshes itself rather
// than true push — close enough to feel live at this scale without taking
// on a new realtime transport/deployment dependency.
const POLL_MS = 6000;
// Presence/typing needs to feel snappier than the full thread refresh —
// polled against the small, cheap GET /thread/:userId/status endpoint
// rather than the full message list.
const STATUS_POLL_MS = 2500;
// How long after the buyer/seller stops typing before we stop telling the
// backend they're typing — matches the backend's own TYPING_TTL_MS so the
// indicator doesn't flicker off a beat before the other side's poll would
// have caught it anyway.
const TYPING_IDLE_MS = 4000;

function MessagesPageInner() {
  const { user, loading: authLoading } = useAuth();
  const t = useIntlayer('messages-page');
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeCounterpartId = searchParams.get('with');
  const contextListingId = searchParams.get('listing');

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [counterpartStatus, setCounterpartStatus] = useState<CounterpartStatus | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);

  useEffect(() => {
    if (!authLoading && !user) router.push('/auth/login?next=/messages');
  }, [authLoading, user, router]);

  const fetchConversations = useCallback(() => {
    if (!user) return;
    api.get('/messages/conversations')
      .then(({ data }) => setConversations(data.conversations || []))
      .catch(() => {})
      .finally(() => setConversationsLoading(false));
  }, [user]);

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  const fetchThread = useCallback((counterpartId: string, silent = false) => {
    if (!silent) setThreadLoading(true);
    api.get(`/messages/thread/${counterpartId}`)
      .then(({ data }) => {
        setThread(data.messages || []);
        // Opening/polling a thread marks its incoming messages read
        // server-side (see GET /messages/thread/:userId) — refresh the
        // conversation list right away so its unread badge clears
        // immediately instead of waiting up to POLL_MS for the next
        // scheduled conversations refresh.
        if (!silent) fetchConversations();
      })
      .catch(() => { if (!silent) setError(String(t.loadFailed)); })
      .finally(() => { if (!silent) setThreadLoading(false); });
  }, [fetchConversations]);

  useEffect(() => {
    if (!activeCounterpartId) { setThread([]); return; }
    setError('');
    fetchThread(activeCounterpartId);
    const interval = setInterval(() => fetchThread(activeCounterpartId, true), POLL_MS);
    return () => clearInterval(interval);
  }, [activeCounterpartId, fetchThread]);

  // Presence (online/offline) and typing indicator — polled separately
  // from, and faster than, the full thread refresh above (see
  // STATUS_POLL_MS) since both need to feel responsive but the endpoint
  // behind them is small and doesn't carry the thread poll's read-receipt
  // side effect.
  useEffect(() => {
    if (!activeCounterpartId) { setCounterpartStatus(null); return; }
    setCounterpartStatus(null); // avoid a flash of the previous conversation's status while the new one loads
    let cancelled = false;
    const poll = () => {
      api.get(`/messages/thread/${activeCounterpartId}/status`)
        .then(({ data }) => { if (!cancelled) setCounterpartStatus({ online: data.online, lastActiveAt: data.lastActiveAt, typing: data.typing }); })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeCounterpartId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [thread, counterpartStatus?.typing]);

  // Tell the backend I'm typing (throttled — no need to re-POST on every
  // keystroke, just often enough that TYPING_TTL_MS on the backend never
  // lapses while I'm still actively typing) and clear it after a pause.
  const handleDraftChange = (value: string) => {
    setDraft(value);
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

  const activeConversation = conversations.find((c) => c.counterpart.id === activeCounterpartId);
  // The counterpart may not have an existing conversation yet (e.g. arriving
  // fresh from a listing's "Message Seller" button) — the thread endpoint
  // still works with zero prior messages, but the name/avatar for the header
  // has to come from somewhere until the first message creates a
  // conversation row. sessionStorage carries that one-time hint across the
  // navigation from the listing page (see ListingDetailClient).
  const [pendingCounterpartName, setPendingCounterpartName] = useState<string | null>(null);
  useEffect(() => {
    if (!activeCounterpartId) { setPendingCounterpartName(null); return; }
    if (activeConversation) { setPendingCounterpartName(null); return; }
    try {
      const hint = sessionStorage.getItem(`chat-start:${activeCounterpartId}`);
      setPendingCounterpartName(hint);
    } catch { /* sessionStorage unavailable (e.g. private mode) — fine, just no name hint */ }
  }, [activeCounterpartId, activeConversation]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || !activeCounterpartId || sending) return;
    setSending(true);
    setError('');
    const content = draft.trim();
    setDraft('');
    lastTypingSentRef.current = 0;
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    try {
      await api.post('/messages', {
        receiverId: activeCounterpartId,
        content,
        listingId: contextListingId || activeConversation?.listing?.id || undefined,
      });
      fetchThread(activeCounterpartId, true);
      fetchConversations();
    } catch {
      setError(String(t.sendFailed));
      setDraft(content);
    } finally {
      setSending(false);
    }
  };

  if (authLoading || (conversationsLoading && !activeCounterpartId)) {
    return <div className="max-w-5xl mx-auto px-4 py-10 text-center text-sm text-gray-500">{t.loading}</div>;
  }
  if (!user) return null;

  const showListPane = !activeCounterpartId; // mobile: list OR thread, never both
  const displayName = activeConversation?.counterpart.name || pendingCounterpartName || String(t.newConversation);
  const displayAvatar = activeConversation?.counterpart.avatar;

  return (
    <div className="max-w-5xl mx-auto sm:px-4 sm:py-6">
      <h1 className="hidden sm:block text-xl font-extrabold text-gray-900 mb-4 px-1">{t.title}</h1>

      <div className="sm:flex sm:h-[calc(100vh-180px)] sm:min-h-[500px] sm:rounded-2xl sm:border sm:border-gray-100 sm:shadow-sm sm:overflow-hidden bg-white">
        {/* Conversation list */}
        <div className={`sm:w-80 sm:shrink-0 sm:border-r sm:border-gray-100 sm:flex sm:flex-col ${showListPane ? 'block' : 'hidden sm:flex'}`}>
          <div className="hidden sm:block px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-bold text-gray-700">{t.conversations}</p>
          </div>
          <div className="overflow-y-auto sm:flex-1">
            {conversations.length === 0 ? (
              <div className="text-center py-12 px-4">
                <div className="text-4xl mb-2" aria-hidden="true">💬</div>
                <p className="text-sm font-semibold text-gray-600">{t.noConversationsTitle}</p>
                <p className="text-xs text-gray-400 mt-1">{t.noConversationsSubtitle}</p>
              </div>
            ) : (
              conversations.map((c) => (
                <Link
                  key={c.counterpart.id}
                  href={`/messages?with=${c.counterpart.id}`}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                    c.counterpart.id === activeCounterpartId ? 'bg-[var(--theme-bg-light)]' : ''
                  }`}
                >
                  <div className="relative w-11 h-11 shrink-0">
                    <div className="relative w-full h-full rounded-full overflow-hidden bg-gray-100">
                      {c.counterpart.avatar ? (
                        <Image src={resolveImageUrl(c.counterpart.avatar)} alt={c.counterpart.name} fill className="object-cover" sizes="44px" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-sm font-bold text-gray-400">
                          {c.counterpart.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <PresenceDot online={c.counterpart.online} size="sm" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm truncate ${c.unreadCount > 0 ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>{c.counterpart.name}</p>
                      <span className="text-[10px] text-gray-400 shrink-0">{timeAgo(c.lastMessageAt)}</span>
                    </div>
                    {c.listing && <p className="text-[11px] text-gray-400 truncate">{t.reListing} {c.listing.title}</p>}
                    <p className={`text-xs truncate ${c.unreadCount > 0 ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>{c.lastMessage}</p>
                  </div>
                  {c.unreadCount > 0 && (
                    <span className="shrink-0 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {c.unreadCount > 9 ? '9+' : c.unreadCount}
                    </span>
                  )}
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Thread */}
        <div className={`sm:flex-1 sm:flex sm:flex-col ${showListPane ? 'hidden sm:flex' : 'flex flex-col'}`} style={{ minHeight: showListPane ? undefined : 'calc(100vh - 180px)' }}>
          {!activeCounterpartId ? (
            <div className="hidden sm:flex flex-1 items-center justify-center text-center px-6">
              <div>
                <div className="text-4xl mb-2" aria-hidden="true">👋</div>
                <p className="text-sm text-gray-400">{t.selectConversation}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
                <Link href="/messages" className="sm:hidden p-1 -ml-1 text-gray-500" aria-label={String(t.backToConversations)}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </Link>
                <div className="relative w-9 h-9 shrink-0">
                  <div className="relative w-full h-full rounded-full overflow-hidden bg-gray-100">
                    {displayAvatar ? (
                      <Image src={resolveImageUrl(displayAvatar)} alt={displayName} fill className="object-cover" sizes="36px" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs font-bold text-gray-400">
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  {counterpartStatus && <PresenceDot online={counterpartStatus.online} size="md" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-900 truncate">{displayName}</p>
                  {counterpartStatus?.typing ? (
                    <p className="text-[11px] text-emerald-600 font-medium italic">{t.typing}</p>
                  ) : counterpartStatus?.online ? (
                    <p className="text-[11px] text-emerald-600 font-medium">{t.online}</p>
                  ) : counterpartStatus?.lastActiveAt ? (
                    <p className="text-[11px] text-gray-400">{t.lastSeen} {timeAgo(counterpartStatus.lastActiveAt)}</p>
                  ) : null}
                  {(contextListingId || activeConversation?.listing) && (
                    <Link
                      href={`/listings/${contextListingId || activeConversation?.listing?.id}`}
                      className="text-[11px] text-[var(--theme-primary)] hover:underline truncate block"
                    >
                      {t.reListing} {activeConversation?.listing?.title || 'this listing'}
                    </Link>
                  )}
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50/50">
                {threadLoading ? (
                  <p className="text-center text-sm text-gray-400 py-8">{t.loading}</p>
                ) : thread.length === 0 && !counterpartStatus?.typing ? (
                  <p className="text-center text-sm text-gray-400 py-8">{t.sayHello}</p>
                ) : (
                  <>
                    {thread.map((m) => {
                      const isMine = m.senderId === user.id;
                      return (
                        <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                              isMine
                                ? 'bg-[var(--theme-primary)] text-white rounded-br-md'
                                : 'bg-white border border-gray-100 text-gray-800 rounded-bl-md'
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words">{m.content}</p>
                            <div className={`flex items-center gap-1 mt-1 ${isMine ? 'justify-end' : ''}`}>
                              <p className={`text-[10px] ${isMine ? 'text-white/70' : 'text-gray-400'}`}>{timeAgo(m.createdAt)}</p>
                              {/* Read receipt ticks, WhatsApp-style: one check
                                  = sent, two checks = read. There's no
                                  separate "delivered" state tracked here (see
                                  the Message model), so this collapses
                                  WhatsApp's three states to two — sent vs
                                  read — which is the distinction that
                                  actually matters to the sender. Only shown
                                  on my own messages; the other side's
                                  messages never show ticks, same convention
                                  as every chat app. */}
                              {isMine && (
                                m.read ? (
                                  <svg className="w-3.5 h-3.5 text-sky-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="Read">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M1 13l4 4L15 7M9 13l4 4L23 7" />
                                  </svg>
                                ) : (
                                  <svg className="w-3.5 h-3.5 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="Sent">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                  </svg>
                                )
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {counterpartStatus?.typing && <TypingIndicator />}
                  </>
                )}
              </div>

              {error && <p className="text-xs text-red-600 px-4 pb-1">{error}</p>}

              <form onSubmit={handleSend} className="flex items-end gap-2 px-3 py-3 border-t border-gray-100 shrink-0">
                <textarea
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
                  placeholder={String(t.typePlaceholder)}
                  rows={1}
                  className="flex-1 resize-none rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]/40 max-h-28"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || sending}
                  className="shrink-0 w-10 h-10 rounded-xl bg-[var(--theme-primary)] hover:brightness-110 disabled:opacity-40 text-white flex items-center justify-center transition-all"
                  aria-label={String(t.sendMessage)}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const t = useIntlayer('messages-page');
  return (
    <Suspense fallback={<div className="max-w-5xl mx-auto px-4 py-10 text-center text-sm text-gray-500">{t.loading}</div>}>
      <MessagesPageInner />
    </Suspense>
  );
}
