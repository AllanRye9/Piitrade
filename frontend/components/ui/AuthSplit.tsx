'use client';

import { ReactNode } from 'react';

interface AuthSplitProps {
  /** Headline of the benefits panel (shown from `lg` up). */
  heading: string;
  subheading: string;
  points: { icon: string; title: string; text: string }[];
  chips: string[];
  /** `wide` gives the form side more room (registration). */
  wide?: boolean;
  children: ReactNode;
}

/**
 * Shared shell for the sign-in / registration cards: a compact form card on phones, and on large screens a
 * two-panel card (benefits on the left, the form on the right) so the page is filled by content, not by empty
 * gradient. Colours and surfaces match the existing auth pages.
 */
export default function AuthSplit({ heading, subheading, points, chips, wide = false, children }: AuthSplitProps) {
  return (
    <div className={`mx-auto w-full animate-fade-up ${wide ? 'max-w-md lg:max-w-5xl' : 'max-w-md lg:max-w-4xl'}`}>
      <div
        className={`grid overflow-hidden rounded-3xl border border-white/30 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-white/20 dark:bg-slate-900/85 ${
          wide ? 'lg:grid-cols-[4fr_7fr]' : 'lg:grid-cols-[5fr_6fr]'
        }`}
      >
        <aside className="relative hidden flex-col justify-between gap-6 overflow-hidden bg-gradient-to-br from-rose-600 via-red-600 to-fuchsia-700 p-8 text-white lg:flex">
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-amber-300/20 blur-3xl" />
          <div className="relative">
            <h2 className="text-2xl font-extrabold leading-tight">{heading}</h2>
            <p className="mt-2 text-sm text-white/85">{subheading}</p>
          </div>
          <ul className="relative space-y-3.5">
            {points.map((p) => (
              <li key={p.title} className="flex items-start gap-3">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-lg ring-1 ring-white/25">{p.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold leading-tight">{p.title}</span>
                  <span className="block text-xs leading-snug text-white/80">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="relative flex flex-wrap gap-2 text-[11px]">
            {chips.map((c) => (
              <span key={c} className="rounded-full border border-white/30 bg-white/15 px-3 py-1">{c}</span>
            ))}
          </div>
        </aside>

        <div className="min-w-0 p-5 sm:p-7 lg:p-8">{children}</div>
      </div>

      {/* Below `lg` the benefits panel is hidden, so the trust chips sit under the card. */}
      <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-white/95 lg:hidden">
        {chips.map((c) => (
          <span key={c} className="rounded-full border border-white/30 bg-white/15 px-3 py-1">{c}</span>
        ))}
      </div>
    </div>
  );
}
