'use client';

import { useState, useRef, useEffect } from 'react';
import { api } from '@/lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const GREETING: ChatMessage = {
  role: 'assistant',
  text: "Hi! I'm the Piitrade support assistant. Ask me anything about orders, returns, or how the platform works.",
};

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
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
      setMessages((prev) => [...prev, { role: 'assistant', text: data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: "I'm sorry, I cannot find that information. Let me transfer you to a human agent." },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed z-50 bottom-4 left-4" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {open && (
        <div className="mb-3 w-[calc(100vw-2rem)] max-w-sm h-[28rem] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between shrink-0">
            <p className="text-sm font-bold">Support Chat</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close support chat" className="text-white/70 hover:text-white">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
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
