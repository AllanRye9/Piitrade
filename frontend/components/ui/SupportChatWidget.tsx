'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** True when the bot gave up — shows the "Connect me to a human" action. */
  handoff?: boolean;
}

const GREETING: ChatMessage = {
  role: 'assistant',
  text: "Hi! I'm the Piitrade support assistant. Ask me anything about posting ads, staying safe, or how the platform works.",
};

// ── On-device persistence (logged-in users only) ─────────────────────────────
// The conversation is saved in this browser's localStorage under a per-user key
// (and synced to the server, see below), so it survives reloads / page changes / returning later on this device, never
// leaks to another account that signs in here, and is never stored for guests.
// Capped and expiring so it can't grow without bound.
const STORE_PREFIX = 'piitrade.supportChat.v1.';
const STORE_MAX_MESSAGES = 50;
const STORE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredChat { savedAt: number; messages: ChatMessage[]; handoffDone?: boolean }

function loadChat(userId: string): StoredChat | null {
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredChat;
    if (!parsed || !Array.isArray(parsed.messages) || Date.now() - parsed.savedAt > STORE_TTL_MS) {
      window.localStorage.removeItem(STORE_PREFIX + userId);
      return null;
    }
    const messages = parsed.messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .slice(-STORE_MAX_MESSAGES);
    return messages.length ? { ...parsed, messages } : null;
  } catch {
    return null;
  }
}

function saveChat(userId: string, messages: ChatMessage[], handoffDone: boolean) {
  try {
    // Nothing worth keeping until the user has actually said something.
    if (!messages.some((m) => m.role === 'user')) {
      window.localStorage.removeItem(STORE_PREFIX + userId);
      return;
    }
    const data: StoredChat = { savedAt: Date.now(), messages: messages.slice(-STORE_MAX_MESSAGES), handoffDone };
    window.localStorage.setItem(STORE_PREFIX + userId, JSON.stringify(data));
  } catch { /* storage unavailable or full — chat still works, just isn't saved */ }
}

/**
 * Floating support-chat widget (Module 2) — available on every screen size,
 * unlike the mobile-only Special Offers popup, since customer support is a
 * universal need regardless of device. Talks to POST /support/chat, which
 * is restricted server-side to only answer from the admin's FAQ context
 * (Admin → Settings → "AI Customer Support") and falls back to a
 * human-transfer message for anything outside it — this component doesn't
 * duplicate any of that logic, it just renders whatever comes back.
 */
export default function SupportChatWidget() {
  // On a listing page phones get a sticky Message/Call/WhatsApp bar above the bottom nav; keep the bubble clear of it.
  const pathname = usePathname();
  const onListingDetail = !!pathname && /^\/listings\/(?!create)[^/]+$/.test(pathname);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const [handoffState, setHandoffState] = useState<'idle' | 'form' | 'sending' | 'done'>('idle');
  const [contact, setContact] = useState('');
  const [handoffError, setHandoffError] = useState('');

  // Restore this user's saved conversation: instantly from this device, then
  // reconcile with the server copy (newest wins) so it follows them across
  // devices. Resets to the greeting on logout / account switch so one account's
  // chat is never shown to another. `restoredFor` gates saving so the initial
  // greeting never overwrites stored history before it has been loaded.
  const userId = user?.id ?? null;
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) {
      setMessages([GREETING]);
      setHandoffState('idle');
      setRestoredFor(null);
      return;
    }
    let cancelled = false;
    const saved = loadChat(userId);
    setMessages(saved ? saved.messages : [GREETING]);
    setHandoffState(saved?.handoffDone ? 'done' : 'idle');
    api.get('/support/chat/history')
      .then(({ data }) => {
        if (cancelled) return;
        const remote: ChatMessage[] = Array.isArray(data?.messages) ? data.messages : [];
        const remoteAt = data?.updatedAt ? new Date(data.updatedAt).getTime() : 0;
        if (remote.length && remoteAt > (saved?.savedAt ?? 0)) {
          setMessages(remote);
          setHandoffState(data.handoffDone ? 'done' : 'idle');
        }
      })
      .catch(() => { /* offline / server unavailable — keep the on-device copy */ })
      .finally(() => { if (!cancelled) setRestoredFor(userId); });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId || restoredFor !== userId) return;
    const handoffDone = handoffState === 'done';
    saveChat(userId, messages, handoffDone);
    // Debounced server sync so a burst of messages is one request.
    const t = setTimeout(() => {
      api.put('/support/chat/history', {
        messages: messages.map(({ role, text, handoff }) => ({ role, text, ...(handoff ? { handoff } : {}) })),
        handoffDone,
      }).catch(() => { /* best-effort; the on-device copy still holds it */ });
    }, 1500);
    return () => clearTimeout(t);
  }, [messages, handoffState, userId, restoredFor]);

  const clearChat = () => {
    if (userId) {
      try { window.localStorage.removeItem(STORE_PREFIX + userId); } catch { /* ignore */ }
      api.delete('/support/chat/history').catch(() => {});
    }
    setMessages([GREETING]);
    setHandoffState('idle');
    setContact('');
    setHandoffError('');
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    setSending(true);

    try {
      const { data } = await api.post('/support/chat', { message: text });
      setMessages((prev) => [...prev, { role: 'assistant', text: data.reply, handoff: Boolean(data.handoff) }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: "I'm sorry, I cannot find that information. Let me transfer you to a human agent.", handoff: true },
      ]);
    } finally {
      setSending(false);
    }
  };

  // Hand the conversation to the admin team. Logged-in users are identified by
  // their account; guests must leave an email or phone number.
  const connectToHuman = async (leaveContact: boolean) => {
    const lastQuestion = [...messages].reverse().find((m) => m.role === 'user')?.text ?? '';
    if (!lastQuestion) return;
    if (!user && !leaveContact) { setHandoffState('form'); return; }
    const isEmail = contact.includes('@');
    setHandoffState('sending');
    setHandoffError('');
    try {
      await api.post('/support/handoff', {
        question: lastQuestion,
        transcript: messages.map(({ role, text }) => ({ role, text })),
        ...(!user && contact.trim() ? (isEmail ? { contactEmail: contact.trim() } : { contactPhone: contact.trim() }) : {}),
      });
      setHandoffState('done');
      setMessages((prev) => [...prev, {
        role: 'assistant',
        text: user
          ? "Thanks — I've passed this to our team. A person will reply to you in your notifications."
          : "Thanks — I've passed this to our team. We'll get back to you using the contact details you left.",
      }]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setHandoffError(msg || 'Could not reach our team just now. Please try again.');
      setHandoffState(user ? 'idle' : 'form');
    }
  };

  const lastIsHandoff = messages[messages.length - 1]?.handoff === true;

  return (
    // bottom-20 on phones: the fixed bottom navigation bar (~64px) is visible below md and the bubble
    // used to sit on top of its "Home" tab. data-support-chat lets the open menu drawer hide it.
    <div data-support-chat className={`fixed z-50 ${onListingDetail ? 'bottom-36' : 'bottom-20'} md:bottom-4 left-4`} style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {open && (
        <div className="mb-3 w-[calc(100vw-2rem)] max-w-sm h-[28rem] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-base" aria-hidden="true">🛟</span>
              <div className="min-w-0">
                <p className="text-sm font-bold leading-tight">Support Chat</p>
                <p className="text-[11px] text-white/60 leading-tight flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  {user ? 'Your chat is saved' : 'Ask us anything'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {user && messages.length > 1 && (
                <button type="button" onClick={clearChat} className="text-xs text-white/70 hover:text-white">Clear chat</button>
              )}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close support chat" className="text-white/70 hover:text-white">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug ${
                    m.role === 'user' ? 'bg-red-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {lastIsHandoff && handoffState !== 'done' && (
              <div className="flex justify-start">
                <div className="max-w-[85%] space-y-2">
                  {handoffState === 'form' || (handoffState === 'sending' && !user) ? (
                    <div className="rounded-2xl border border-gray-200 p-2.5 space-y-2">
                      <p className="text-xs text-gray-600">Leave an email or phone number so our team can reach you.</p>
                      <input
                        value={contact}
                        onChange={(e) => setContact(e.target.value)}
                        placeholder="Email or phone"
                        maxLength={200}
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                      />
                      <button
                        type="button"
                        disabled={handoffState === 'sending' || !contact.trim()}
                        onClick={() => connectToHuman(true)}
                        className="w-full rounded-lg bg-red-600 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        {handoffState === 'sending' ? 'Sending…' : 'Send to our team'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={handoffState === 'sending'}
                      onClick={() => connectToHuman(false)}
                      className="rounded-full bg-red-600 px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {handoffState === 'sending' ? 'Connecting…' : '👤 Connect me to a human'}
                    </button>
                  )}
                  {handoffError && <p className="text-xs text-red-600">{handoffError}</p>}
                </div>
              </div>
            )}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-400 rounded-2xl rounded-bl-sm px-3 py-2 text-sm">…</div>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="border-t border-gray-100 p-2.5 flex items-center gap-2 shrink-0"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your question…"
              maxLength={1000}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="w-9 h-9 shrink-0 rounded-xl bg-red-600 text-white flex items-center justify-center disabled:opacity-40"
              aria-label="Send"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close support chat' : 'Open support chat'}
        className="w-12 h-12 rounded-full bg-gray-900 text-white shadow-lg flex items-center justify-center border-2 border-white active:scale-95 transition-transform"
      >
        {open ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
        )}
      </button>
    </div>
  );
}
