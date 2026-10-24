'use client';

import { Children, useCallback, useEffect, useRef, useState, ReactNode } from 'react';

/**
 * Fixed card widths (not a share of the row), so a listing card is exactly the same size in every
 * section, whatever padding the section has around it. About 3 across on a phone, up to 6 on desktop;
 * a partly visible next card hints that the row scrolls.
 */
export const ROW_ITEM_DEFAULT = 'basis-[7rem] sm:basis-[9.25rem] md:basis-[10rem] lg:basis-[11.5rem]';

interface RowCarouselProps {
  children: ReactNode;
  /** Width classes for each item (a `basis-*` set). Defaults to 3 / 4 / 5 / 6 per row. */
  itemClassName?: string;
  /** aria-label for the scrollable region, e.g. "Flash deal listings". */
  ariaLabel?: string;
  /** Extra classes on the outer wrapper. */
  className?: string;
}

/**
 * One-row horizontal carousel used by every homepage section except "Other Collections".
 *
 *  - Always a single row at every screen size: swipe/scroll on touch, back/forward arrows on all
 *    breakpoints (an arrow hides itself at its end, and both hide when everything already fits).
 *  - Card widths come from `itemClassName`, so each section controls how many show per row.
 *  - Arrows page by ~one viewport of cards; scroll-snap keeps cards aligned after each move.
 *  - Separate from each section's "View all" link, which keeps going to the full listing page.
 */
export function RowCarousel({ children, itemClassName = ROW_ITEM_DEFAULT, ariaLabel, className = '' }: RowCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const items = Children.toArray(children);

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    updateEdges();
    // Images and data can settle a beat after mount; re-check so arrows reflect the final width.
    const t = setTimeout(updateEdges, 300);
    window.addEventListener('resize', updateEdges, { passive: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', updateEdges);
    };
  }, [items.length, updateEdges]);

  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  if (items.length === 0) return null;

  const arrowBase =
    'absolute top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-700 shadow-md transition hover:bg-white hover:text-[var(--theme-primary-dark,#c2410c)] active:scale-95 sm:h-9 sm:w-9';

  return (
    <div className={`relative ${className}`}>
      <div
        ref={scrollerRef}
        onScroll={updateEdges}
        role="list"
        aria-label={ariaLabel}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth px-0.5 pb-1 pt-1 scrollbar-none"
      >
        {items.map((child, i) => (
          <div key={i} role="listitem" className={`min-w-0 shrink-0 grow-0 snap-start ${itemClassName}`}>
            {child}
          </div>
        ))}
      </div>

      {!atStart && (
        <button type="button" onClick={() => scrollByPage(-1)} aria-label="Previous" className={`${arrowBase} -left-1.5 lg:-left-3`}>
          <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {!atEnd && (
        <button type="button" onClick={() => scrollByPage(1)} aria-label="Next" className={`${arrowBase} -right-1.5 lg:-right-3`}>
          <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
