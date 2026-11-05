'use client';

import { useEffect, useState } from 'react';
import { applyLite, readLitePref, resolveLite, writeLitePref, type LitePref } from '@/lib/liteMode';

const EVENT = 'piitrade-lite-change';

/** Mounted once in the root layout: applies Lite mode (saved choice, else automatic) on every page load. */
export function LiteModeBoot() {
  useEffect(() => {
    applyLite(resolveLite(readLitePref()));
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return null;
}

/** Switch for Lite mode (footer). Several can exist on a page (mobile + desktop footers); they stay in sync. */
export default function LiteModeToggle({ className = '' }: { className?: string }) {
  const [pref, setPref] = useState<LitePref>('auto');
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => {
      setPref(readLitePref());
      setOn(document.documentElement.getAttribute('data-lite') === '1');
    };
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const toggle = () => {
    const next: LitePref = on ? 'off' : 'on';
    writeLitePref(next);
    applyLite(next === 'on');
    window.dispatchEvent(new Event(EVENT));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={on}
      title="Lite mode uses less data: smaller pictures and no animations. Good for slow connections."
      className={`inline-flex items-center gap-2 rounded-full border border-white/25 px-3 py-1 text-xs font-medium text-white/90 hover:bg-white/10 ${className}`}
    >
      <span className={`relative inline-block h-4 w-7 rounded-full transition-colors ${on ? 'bg-emerald-400' : 'bg-white/30'}`} aria-hidden="true">
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
      Lite mode{pref === 'auto' && on ? ' (auto)' : ''}
    </button>
  );
}
