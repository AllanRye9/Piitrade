import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROW_ITEM_DEFAULT } from '@/components/ui/RowCarousel';

// Contract tests for the phone layout (360px is the most common phone width in Uganda, per StatCounter):
// carousels must not fall back to 3 cards across a portrait phone (~106px cards, titles cut at ~12 characters).
describe('mobile carousel card width', () => {
  const classes = ROW_ITEM_DEFAULT.split(' ');

  it('shows ~2.25 cards on portrait phones (the un-prefixed class)', () => {
    expect(classes[0]).toBe('basis-[clamp(8.5rem,39.5vw,11rem)]');
  });

  it('keeps 3 across from 480px, then 4 / 5 / 6 on wider screens', () => {
    // Fixed widths (not a share of the row), so cards are identical in every section.
    expect(classes).toContain('min-[480px]:basis-[7rem]');
    expect(classes).toContain('sm:basis-[9.25rem]');
    expect(classes).toContain('md:basis-[10rem]');
    expect(classes).toContain('lg:basis-[11.5rem]');
  });

  it('gives a 360px phone cards wider than the old 3-across layout', () => {
    const container = 360 - 22; // page side padding
    const gap = 8;
    const oldWidth = 7 * 16; // the previous fixed phone width (7rem)
    const newWidth = Math.min(Math.max(8.5 * 16, 0.395 * 360), 11 * 16); // clamp(8.5rem, 39.5vw, 11rem)
    expect(Math.round(oldWidth)).toBe(112);
    expect(Math.round(newWidth)).toBe(142);
    expect(newWidth).toBeGreaterThan(oldWidth * 1.2);
    // a third card still peeks (so people know to swipe): 2 full cards + 2 gaps leave room for part of the next
    expect(container - (2 * newWidth + 2 * gap)).toBeGreaterThan(newWidth * 0.2);
  });

  it('loading skeletons use the same phone width, so the layout does not jump when data arrives', () => {
    for (const f of ['CountryFeaturedDeal', 'BackToSchoolSection', 'FlashDealsSection']) {
      const src = readFileSync(join(process.cwd(), 'components/ui', `${f}.tsx`), 'utf8');
      expect(src).toContain('basis-[clamp(8.5rem,39.5vw,11rem)] min-[480px]:basis-[7rem]');
      expect(src).not.toMatch(/shrink-0 basis-\[7rem\] sm:/);
    }
  });
});
