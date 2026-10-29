'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { CountBadge } from '@/components/ui/CountBadge';
import type { MegaColumn } from '@/lib/megaMenu';

/**
 * The three dropdowns of the category bar, designed as one family:
 *   • AllCategoriesPanel – "All": a category rail on the left, the hovered category's subcategories on the right
 *   • CategoryMegaPanel  – one category tab: a branded header + evenly sized columns
 *   • MoreCategoriesPanel – "More": the tabs that did not fit, as cards
 * They share the same shell (rounded card, soft shadow, accent hairline, a notch pointing at the tab),
 * the same link style and the same footer. Purely presentational: CategoryBar owns data and positioning.
 */

type Tr = (s: string) => string;

export interface NavCategory {
  label: string;
  icon: string;
  href: string;
  slug: string;
  count?: number;
  fresh?: number;
}
export interface NavSub { label: string; href: string; count: number }

const LINK_BASE =
  'group/link flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-[13px] text-gray-700 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:bg-red-50 focus-visible:text-red-700 focus-visible:outline-none';

/** Rounded tile that gives every emoji icon the same footprint. */
function IconTile({ icon, size = 'md', tone = 'gray' }: { icon: string; size?: 'sm' | 'md' | 'lg'; tone?: 'gray' | 'brand' }) {
  const dims = size === 'lg' ? 'h-12 w-12 text-[24px] rounded-2xl' : size === 'sm' ? 'h-8 w-8 text-[16px] rounded-lg' : 'h-9 w-9 text-[18px] rounded-xl';
  const bg = tone === 'brand' ? 'bg-white shadow-sm ring-1 ring-red-100' : 'bg-gray-50 ring-1 ring-gray-100';
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center leading-none ${dims} ${bg}`}>
      {icon || '•'}
    </span>
  );
}

/** Shared card: notch pointing at the tab, accent hairline, soft shadow, scale-in. */
function Shell({
  caretPx, tint = false, className = '', style, label, children,
}: { caretPx: number; tint?: boolean; className?: string; style?: CSSProperties; label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ transformOrigin: `${Math.max(caretPx, 24)}px top`, ...style }}
      className={`relative animate-scale-in rounded-2xl border border-gray-200/80 bg-white shadow-[0_18px_50px_-12px_rgba(15,23,42,0.35)] ${className}`}
    >
      <span
        aria-hidden="true"
        style={{ left: `${caretPx - 7}px` }}
        className={`pointer-events-none absolute -top-[7px] h-3.5 w-3.5 rotate-45 rounded-sm border-l border-t border-gray-200/80 ${tint ? 'bg-red-50' : 'bg-white'}`}
      />
      <div className="relative overflow-hidden rounded-2xl">
        <div aria-hidden="true" className="h-[3px] w-full bg-gradient-to-r from-red-600 via-red-500 to-amber-400" />
        {children}
      </div>
    </div>
  );
}

function Footer({ tr, onNavigate, total }: { tr: Tr; onNavigate: () => void; total?: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/70 px-5 py-2.5 text-[13px] font-semibold">
      <Link href="/categories" onClick={onNavigate} className="inline-flex items-center gap-1 text-red-600 transition-colors hover:text-red-700 hover:underline">
        {tr('All categories')} <span aria-hidden="true">→</span>
      </Link>
      <Link href="/listings" onClick={onNavigate} className="inline-flex items-center gap-1.5 text-gray-600 transition-colors hover:text-red-600">
        {tr('Browse all listings')}
        {total ? <CountBadge tone="light" count={total} /> : null}
      </Link>
    </div>
  );
}

/* ───────────────────────────── All ───────────────────────────── */

export interface AllSection { cat: NavCategory; subs: NavSub[] }

export function AllCategoriesPanel({
  sections, activeSlug, caretPx, total, tr, onNavigate,
}: { sections: AllSection[]; activeSlug?: string; caretPx: number; total?: number; tr: Tr; onNavigate: () => void }) {
  const start = Math.max(0, sections.findIndex((s) => s.cat.slug === activeSlug));
  const [idx, setIdx] = useState(start);
  useEffect(() => { if (idx >= sections.length) setIdx(0); }, [idx, sections.length]);
  const current = sections[Math.min(idx, sections.length - 1)];
  if (!current) return null;
  const { cat, subs } = current;
  const SHOWN = 24;

  return (
    <Shell caretPx={caretPx} label={tr('All categories')} className="w-[min(96vw,980px)]">
      <div className="flex h-[min(68vh,28rem)]">
        {/* rail */}
        <div className="relative w-[17.5rem] shrink-0 border-r border-gray-100 bg-gray-50/60">
        <nav aria-label={tr('Categories')} className="h-full overflow-y-auto p-2 pb-8 [scrollbar-width:thin]">
          {sections.map((s, i) => {
            const on = i === idx;
            return (
              <Link
                key={s.cat.slug}
                href={s.cat.href}
                onClick={onNavigate}
                onMouseEnter={() => setIdx(i)}
                onFocus={() => setIdx(i)}
                aria-current={on ? 'true' : undefined}
                className={`flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none ${
                  on ? 'bg-white text-red-700 shadow-sm ring-1 ring-red-100' : 'text-gray-700 hover:bg-white/70'
                }`}
              >
                <IconTile icon={s.cat.icon} size="sm" tone={on ? 'brand' : 'gray'} />
                <span className="min-w-0 flex-1 leading-tight">{tr(s.cat.label)}</span>
                <CountBadge tone="light" count={s.cat.count} fresh={s.cat.fresh} />
                <svg aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </Link>
            );
          })}
        </nav>
        {/* fade: hints that the rail scrolls */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-gray-50 to-transparent" />
        </div>

        {/* detail */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3.5">
            <IconTile icon={cat.icon} size="lg" tone="brand" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[17px] font-extrabold leading-tight text-gray-900">{tr(cat.label)}</div>
              <div className="text-[12px] text-gray-500">
                {cat.count ? `${cat.count.toLocaleString('en-US')} ${tr('listings')}` : tr('Browse the category')}
                {cat.fresh ? <span className="ml-2 font-semibold text-emerald-600">● {cat.fresh} {tr('new today')}</span> : null}
              </div>
            </div>
            <Link href={cat.href} onClick={onNavigate} className="shrink-0 rounded-full bg-red-600 px-3.5 py-1.5 text-[12.5px] font-bold text-white shadow-sm transition-colors hover:bg-red-700">
              {tr('See all')} →
            </Link>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin]">
            {subs.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px] text-gray-500">{tr('Listings are being added to this category.')}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5 xl:grid-cols-3">
                {subs.slice(0, SHOWN).map((sub) => (
                  <li key={sub.href + sub.label}>
                    <Link href={sub.href} onClick={onNavigate} className={LINK_BASE}>
                      <span className="min-w-0 leading-snug">{tr(sub.label)}</span>
                      <CountBadge tone="light" count={sub.count} />
                    </Link>
                  </li>
                ))}
                {subs.length > SHOWN && (
                  <li>
                    <Link href={cat.href} onClick={onNavigate} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-bold text-red-600 hover:bg-red-50">
                      +{subs.length - SHOWN} {tr('more')} →
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </div>
      <Footer tr={tr} onNavigate={onNavigate} total={total} />
    </Shell>
  );
}

/* ───────────────────────── One category ───────────────────────── */

export function CategoryMegaPanel({
  cat, columns, caretPx, tr, onNavigate, countFor,
}: {
  cat: NavCategory;
  columns: MegaColumn[];
  caretPx: number;
  tr: Tr;
  onNavigate: () => void;
  /** Count for a link (slug resolved by the caller). */
  countFor: (link: MegaColumn['links'][number]) => { count: number | undefined; fresh: number };
}) {
  // The generated "More in X" column is the last one; give it a quiet card so it reads as "popular right now".
  const cols = columns.length;
  const shown = Math.min(Math.max(cols, 1), 4);
  const width = Math.max(460, shown * 212 + 40);
  return (
    <Shell caretPx={caretPx} tint label={tr(cat.label)} style={{ width: `min(calc(100vw - 2rem), ${width}px)` }}>
      <div className="flex items-center gap-3 border-b border-red-100/70 bg-gradient-to-r from-red-50 via-white to-white px-5 py-3.5">
        <IconTile icon={cat.icon} size="lg" tone="brand" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-extrabold leading-tight text-gray-900">{tr(cat.label)}</div>
          <div className="text-[12px] text-gray-500">
            {cat.count ? `${cat.count.toLocaleString('en-US')} ${tr('listings')}` : tr('Browse the category')}
            {cat.fresh ? <span className="ml-2 font-semibold text-emerald-600">● {cat.fresh} {tr('new today')}</span> : null}
          </div>
        </div>
        <Link href={cat.href} onClick={onNavigate} className="shrink-0 rounded-full bg-red-600 px-3.5 py-1.5 text-[12.5px] font-bold text-white shadow-sm transition-colors hover:bg-red-700">
          {tr('See all')} →
        </Link>
      </div>
      <div
        className="grid max-h-[min(58vh,24rem)] gap-x-5 gap-y-5 overflow-y-auto p-4 [scrollbar-width:thin]"
        style={{ gridTemplateColumns: `repeat(${shown}, minmax(0, 1fr))` }}
      >
        {columns.map((col, ci) => {
          const extra = ci === cols - 1 && cols > 1 && /^more in /i.test(col.heading);
          return (
            <section key={col.heading} className={`min-w-0 ${extra ? 'rounded-xl bg-gray-50 p-2.5 ring-1 ring-gray-100' : ''}`}>
              <h4 className={`mb-1.5 flex items-center gap-2 px-2.5 text-[11px] font-extrabold uppercase tracking-[0.09em] ${extra ? 'text-red-600' : 'text-gray-400'}`}>
                <span className="truncate">{tr(col.heading)}</span>
                <span aria-hidden="true" className="h-px flex-1 bg-current opacity-20" />
              </h4>
              <ul className="space-y-0.5">
                {col.links.map((link) => {
                  const { count, fresh } = countFor(link);
                  return (
                    <li key={link.label + link.href}>
                      <Link href={link.href} onClick={onNavigate} className={LINK_BASE}>
                        <span className="min-w-0 leading-snug">{tr(link.label)}</span>
                        <CountBadge tone="light" count={count} fresh={fresh} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </Shell>
  );
}

/* ─────────────────────────────── More ─────────────────────────────── */

export function MoreCategoriesPanel({
  items, caretPx, total, tr, onNavigate,
}: { items: NavCategory[]; caretPx: number; total?: number; tr: Tr; onNavigate: () => void }) {
  return (
    <Shell caretPx={caretPx} label={tr('More categories')} className="w-[min(92vw,700px)]">
      <div className="flex items-baseline justify-between px-5 pb-1 pt-3.5">
        <h3 className="text-[15px] font-extrabold text-gray-900">{tr('More categories')}</h3>
        <span className="text-[12px] text-gray-500">{items.length} {tr('more to explore')}</span>
      </div>
      <ul className="grid max-h-[min(56vh,22rem)] grid-cols-2 gap-2 overflow-y-auto p-3 [scrollbar-width:thin] lg:grid-cols-3">
        {items.map((cat) => (
          <li key={cat.slug}>
            <Link
              href={cat.href}
              onClick={onNavigate}
              className="group/card flex h-full items-center gap-3 rounded-xl border border-gray-100 bg-white p-2.5 transition-all hover:-translate-y-px hover:border-red-200 hover:bg-red-50/60 hover:shadow-sm focus-visible:border-red-300 focus-visible:outline-none"
            >
              <IconTile icon={cat.icon} />
              <span className="min-w-0 flex-1 text-[13px] font-semibold leading-tight text-gray-800 group-hover/card:text-red-700">{tr(cat.label)}</span>
              <CountBadge tone="light" count={cat.count} fresh={cat.fresh} />
            </Link>
          </li>
        ))}
      </ul>
      <Footer tr={tr} onNavigate={onNavigate} total={total} />
    </Shell>
  );
}
