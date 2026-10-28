import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act } from '@testing-library/react';

let mockCounts: Record<string, number> | null = null;
let mockTree: any[] | null = null;
let mockPath = '/';
let mockLayout: { rank: string[]; hidden: string[] } = { rank: [], hidden: [] };
let mockSearch = '';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPath,
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/lib/i18n/useTr', () => ({ useTr: () => (s: string) => s }));
vi.mock('@/context/CountryContext', () => ({ useCountry: () => ({ country: 'UGANDA' }) }));
vi.mock('@/hooks/useActiveSubcategoryCounts', () => ({
  useNavCategoryCounts: () => ({ data: mockCounts ? { counts: mockCounts, direct: {}, new24h: {}, total: 99 } : null, loading: false }),
}));
vi.mock('@/hooks/useCategoryLayout', () => ({ useCategoryLayout: () => mockLayout }));
vi.mock('@/hooks/useCategoryTree', () => ({ useCategoryTree: () => ({ tree: mockTree }) }));

import CategoryBar, { topCategories } from '@/components/layout/CategoryBar';

const TAB_W = 120;
function setLayout(wide: boolean, rowWidth: number) {
  window.matchMedia = ((q: string) => ({
    matches: wide, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
  })) as any;
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return TAB_W; } });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).className?.toString().includes('divide-x') ? rowWidth : 1200; } });
  (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
}

const staticSlugs = topCategories.map((c) => new URL(c.href, 'http://x').pathname.slice(1));
const allLive = () => Object.fromEntries(staticSlugs.map((s) => [s, 5]));

// The visible row is the one with divide-x that is NOT the hidden measurer.
function visibleRow(container: HTMLElement) {
  return Array.from(container.querySelectorAll('div')).find((d) => d.className.includes('divide-x') && !d.className.includes('invisible'))!;
}
const clean = (t?: string | null) => (t ?? '').replace(/^[^A-Za-z]+/, '').replace(/\d+$/, '').trim();
const labelsIn = (row: Element) => Array.from(row.querySelectorAll('a')).map((a) => clean(a.textContent));
const panelOf = (container: HTMLElement) => container.querySelector('div.absolute.top-full') as HTMLElement | null;

beforeEach(() => { mockLayout = { rank: [], hidden: [] }; mockCounts = allLive(); mockTree = null; mockPath = '/'; mockSearch = ''; });
afterEach(() => cleanup());

describe('CategoryBar priority+ (Phase 0)', () => {
  it('narrow screens: all tabs, no More button (swipe strip)', () => {
    setLayout(false, 600);
    const { container } = render(<CategoryBar />);
    const row = visibleRow(container);
    expect(within(row as HTMLElement).queryByText('More')).toBeNull();
    expect(row.className).toContain('overflow-x-auto');
  });

  it('wide screen, everything fits: no More', () => {
    setLayout(true, 5000);
    const { container } = render(<CategoryBar />);
    const row = visibleRow(container);
    expect(within(row as HTMLElement).queryByText('More')).toBeNull();
    expect(row.className).toContain('overflow-hidden');
  });

  it('wide screen, too narrow: fits N tabs + More, never scrolls, overflow lives in the menu', () => {
    setLayout(true, 800); // All(121) + More(121) reserved => (800-242)/121 = 4 tabs
    const { container } = render(<CategoryBar />);
    const row = visibleRow(container) as HTMLElement;
    const tabsShown = labelsIn(row).filter((l) => l && l !== 'All' && l !== 'More');
    expect(tabsShown).toHaveLength(4);
    expect(tabsShown.length).toBeLessThan(topCategories.length);
    const more = within(row).getByText('More');
    fireEvent.click(more);
    const menuLinks = Array.from(panelOf(container)!.querySelectorAll('a')).map((a) => clean(a.textContent) || a.textContent!.trim());
    // every static tab is reachable: visible + menu
    const reachable = new Set([...tabsShown, ...menuLinks]);
    for (const c of topCategories) expect(reachable.has(c.label)).toBe(true);
    expect(menuLinks).toContain('All categories →');
    expect(menuLinks).toContain('Browse all listings');
  });

  it('active tab hidden by overflow is swapped into the last visible slot', () => {
    setLayout(true, 800);
    const last = topCategories[topCategories.length - 1];
    mockPath = new URL(last.href, 'http://x').pathname;
    const { container } = render(<CategoryBar />);
    const row = visibleRow(container) as HTMLElement;
    expect(labelsIn(row)).toContain(last.label);
    expect(row.querySelector('[aria-current="page"]')?.textContent).toContain(last.label);
  });

  it('Escape closes the More menu', () => {
    setLayout(true, 800);
    const { container } = render(<CategoryBar />);
    fireEvent.click(within(visibleRow(container) as HTMLElement).getByText('More'));
    expect(panelOf(container)).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panelOf(container)).toBeNull();
  });
});

describe('CategoryBar live-category extras (gating)', () => {
  const tree = [
    { id: '1', name: 'Pets & Pet Supplies', slug: 'pets-animals', icon: '🐕', children: [] },
    { id: '2', name: 'Food, Drinks & Groceries', slug: 'food-groceries', icon: '🛒', children: [] },
  ];
  it('shows a new category only once it has live listings', () => {
    setLayout(true, 5000);
    mockTree = tree;
    mockCounts = { ...allLive(), 'food-groceries': 3 };
    const { container } = render(<CategoryBar />);
    const row = visibleRow(container) as HTMLElement;
    expect(labelsIn(row)).toContain('Food, Drinks & Groceries');
    expect(labelsIn(row)).not.toContain('Pets & Pet Supplies');
    const link = Array.from(row.querySelectorAll('a')).find((a) => a.textContent?.includes('Food'))!;
    expect(link.getAttribute('href')).toBe('/category/food-groceries');
  });
  it('never shows extras while counts are unknown', () => {
    setLayout(true, 5000);
    mockTree = tree; mockCounts = null;
    const { container } = render(<CategoryBar />);
    expect(labelsIn(visibleRow(container))).not.toContain('Food, Drinks & Groceries');
  });
  it('extras marked active on their own /category/<slug> page (and not on a longer slug that shares the prefix)', () => {
    setLayout(true, 5000);
    mockTree = tree; mockCounts = { ...allLive(), 'food-groceries': 3 };
    mockPath = '/category/food-groceries'; mockSearch = '';
    const { container } = render(<CategoryBar />);
    expect((visibleRow(container).querySelector('[aria-current="page"]'))?.textContent).toContain('Food');
    cleanup();
    mockPath = '/category/food-groceries-extra';
    const again = render(<CategoryBar />);
    expect(visibleRow(again.container).querySelector('[aria-current="page"]')).toBeNull();
  });
});

describe('CategoryBar mega menu', () => {
  it('adds a "More in X" column of live, non-curated subcategories + See all footer', () => {
    setLayout(true, 5000);
    const svc = topCategories.find((c) => c.label === 'Services')!;
    mockTree = [{ id: 's', name: 'Services', slug: 'services', icon: '🔧', children: [
      { id: 'a', name: 'Welding & Metal Fabrication', slug: 'welding-metalwork' },
      { id: 'b', name: 'Funeral & Memorial Services', slug: 'funeral-services' },
      { id: 'c', name: 'Cleaning', slug: 'cleaning' },
    ] }];
    mockCounts = { ...allLive(), 'welding-metalwork': 7, cleaning: 4 };
    const { container } = render(<CategoryBar />);
    const tab = Array.from(visibleRow(container).querySelectorAll('div')).find((d) => d.textContent?.startsWith('🔧Services') || d.textContent?.includes('Services'))!;
    fireEvent.mouseEnter(tab);
    const panel = panelOf(container)!;
    expect(panel.textContent).toContain('More in Services');
    expect(panel.textContent).toContain('Welding & Metal Fabrication');
    expect(panel.textContent).not.toContain('Funeral & Memorial Services'); // 0 live listings
    expect(panel.textContent).toContain('See all in Services');
    const links = Array.from(panel.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/category/welding-metalwork');
    expect(links).toContain(svc.href);
  });
});

describe('CategoryBar admin layout', () => {
  it('admin rank reorders tabs; unlisted tabs follow in original order', () => {
    setLayout(true, 5000);
    mockLayout = { rank: ['services', 'agriculture'], hidden: [] };
    const { container } = render(<CategoryBar />);
    const labels = labelsIn(visibleRow(container)).filter((l) => l && l !== 'All');
    expect(labels.slice(0, 2)).toEqual(['Services', 'Agriculture']);
    expect(labels).toHaveLength(topCategories.length);
  });
  it('admin hidden removes a tab (and a hidden live extra)', () => {
    setLayout(true, 5000);
    mockTree = [{ id: '2', name: 'Food, Drinks & Groceries', slug: 'food-groceries', icon: '🛒', children: [] }];
    mockCounts = { ...allLive(), 'food-groceries': 3 };
    mockLayout = { rank: [], hidden: ['furniture', 'food-groceries'] };
    const { container } = render(<CategoryBar />);
    const labels = labelsIn(visibleRow(container));
    expect(labels).not.toContain('Furniture');
    expect(labels).not.toContain('Food, Drinks & Groceries');
    expect(labels).toContain('Motors');
  });
});

describe('CategoryBar "All" panel', () => {
  it('opens a panel listing every category with its live subcategories and "+N more"', () => {
    setLayout(true, 5000);
    mockTree = [{ id: '1', slug: 'electronics', name: 'Electronics', icon: '💻', children: Array.from({ length: 7 }, (_, i) => ({ id: `e${i}`, slug: `sub-${i}`, name: `Sub ${i}` })) }];
    mockCounts = { ...allLive(), ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`sub-${i}`, 10 - i])) };
    const { container } = render(<CategoryBar />);
    const row = visibleRow(container) as HTMLElement;
    fireEvent.mouseEnter(within(row).getByText('All').closest('div')!);
    const panel = panelOf(container)!;
    expect(panel).toBeTruthy();
    const links = Array.from(panel.querySelectorAll('a')).map((a) => a.textContent!.trim());
    expect(links.some((t) => t.startsWith('Sub 0'))).toBe(true);
    expect(links).toContain('+2 more →');
    expect(links).toContain('All categories →');
    for (const c of topCategories) expect(links.some((t) => t.includes(c.label))).toBe(true);
  });
  it('does not open on narrow screens', () => {
    setLayout(false, 600);
    const { container } = render(<CategoryBar />);
    fireEvent.mouseEnter(within(visibleRow(container) as HTMLElement).getByText('All').closest('div')!);
    expect(panelOf(container)).toBeNull();
  });
});
