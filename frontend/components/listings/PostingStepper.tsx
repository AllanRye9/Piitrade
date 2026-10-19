'use client';

import { useEffect, useState } from 'react';
import { T } from '@/components/ui/T';
import { resolveImageUrl } from '@/lib/utils';

export interface PostingStep {
  id: string; // DOM id of the section the step scrolls to
  label: string;
  done: boolean;
}

/**
 * Sticky progress stepper: Photos → Details → Category & price → Review.
 * Each step is derived from what the seller has actually filled in, and tapping
 * a step scrolls to its section. The highlighted step follows the scroll position.
 */
export function PostingStepper({ steps }: { steps: PostingStep[] }) {
  const [current, setCurrent] = useState(steps[0]?.id);

  useEffect(() => {
    const els = steps.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setCurrent(visible.target.id);
      },
      { rootMargin: '-120px 0px -55% 0px', threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [steps]);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <nav
      aria-label="Posting progress"
      className="sticky z-30 -mx-3 mb-3 border-b border-gray-200 bg-white/95 px-3 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border"
      style={{ top: 'var(--site-header-h, 0px)' }}
    >
      <ol className="flex items-center gap-1 sm:gap-2">
        {steps.map((s, i) => {
          const active = current === s.id;
          return (
            <li key={s.id} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => go(s.id)}
                aria-current={active ? 'step' : undefined}
                className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors ${active ? 'bg-red-50' : 'hover:bg-gray-50'}`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                    s.done ? 'bg-emerald-500 text-white' : active ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {s.done ? '✓' : i + 1}
                </span>
                <span className={`truncate text-[11px] font-semibold sm:text-xs ${active ? 'text-red-700' : s.done ? 'text-gray-800' : 'text-gray-500'}`}>
                  {s.label}
                </span>
              </button>
              {i < steps.length - 1 && <span aria-hidden="true" className={`hidden h-px w-4 sm:block ${s.done ? 'bg-emerald-400' : 'bg-gray-200'}`} />}
            </li>
          );
        })}
      </ol>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
        <div className="h-full rounded-full bg-gradient-to-r from-red-500 to-emerald-500 transition-all duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
    </nav>
  );
}

/** Live "how buyers will see it" card, updated as the seller types. */
export function ListingPreviewCard({
  title, price, location, condition, image, category, currency = 'UGX',
}: {
  title: string; price: string; location: string; condition: string; image?: string; category?: string; currency?: string;
}) {
  const p = Number(price);
  const hasPrice = price !== '' && Number.isFinite(p);
  return (
    <aside className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm" aria-label="Listing preview">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500"><T>Live preview</T></p>
      <div className="overflow-hidden rounded-xl border border-gray-100">
        <div className="relative aspect-[4/3] bg-gray-100">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.startsWith('blob:') || image.startsWith('data:') ? image : resolveImageUrl(image)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-gray-400"><T>Add a photo</T></div>
          )}
          <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-gray-700">
            {condition === 'NEW' ? 'New' : 'Used'}
          </span>
        </div>
        <div className="space-y-1 p-3">
          <p className={`line-clamp-2 text-sm font-semibold ${title ? 'text-gray-900' : 'text-gray-300'}`}>{title || 'Your title appears here'}</p>
          <p className={`text-base font-extrabold ${hasPrice ? 'text-red-600' : 'text-gray-300'}`}>
            {hasPrice ? `${currency} ${p.toLocaleString('en-UG')}` : `${currency} —`}
          </p>
          <p className="truncate text-xs text-gray-500">{[location, category].filter(Boolean).join(' · ') || 'Location · Category'}</p>
        </div>
      </div>
    </aside>
  );
}
