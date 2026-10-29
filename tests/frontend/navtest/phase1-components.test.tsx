import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';

let mockCounts: Record<string, number> | null = null;
let mockTree: any[] | null = null;
let mockLayout = { rank: [] as string[], hidden: [] as string[] };
let mockLoading = false;
const apiGet = vi.fn();
const apiPut = vi.fn();

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useSearchParams: () => new URLSearchParams(''), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/i18n/useTr', () => ({ useTr: () => (s: string) => s }));
vi.mock('@/context/CountryContext', () => ({ useCountry: () => ({ country: 'UGANDA', locations: [] }) }));
vi.mock('@/hooks/useActiveSubcategoryCounts', () => ({
  useNavCategoryCounts: () => ({ data: mockCounts ? { counts: mockCounts, direct: {}, new24h: {}, total: 9 } : null, loading: mockLoading }),
}));
vi.mock('@/hooks/useCategoryCounts', () => ({ useCategoryCounts: () => ({ counts: mockCounts, total: 9, loading: mockLoading }) }));
vi.mock('@/hooks/useCategoryTree', () => ({ useCategoryTree: () => ({ tree: mockTree }) }));
vi.mock('@/hooks/useCategoryLayout', () => ({ useCategoryLayout: () => mockLayout }));
vi.mock('@/lib/api', () => ({ api: { get: (...a: any[]) => apiGet(...a), put: (...a: any[]) => apiPut(...a) } }));
vi.mock('@/components/ui/RowCarousel', () => ({ RowCarousel: ({ children }: any) => <div data-testid="row">{children}</div> }));

import CategoriesIndex from '@/components/categories/CategoriesIndex';
import MobileCategoryGrid from '@/components/ui/MobileCategoryGrid';
import HomeCategoryTiles from '@/components/ui/HomeCategoryTiles';
import CategoryPicker from '@/components/ui/CategoryPicker';
import AdminCategoryLayoutPage from '@/app/admin/category-layout/page';
import { HOME_CATEGORIES } from '@/lib/homeCategories';

const liveAll = () => Object.fromEntries(HOME_CATEGORIES.filter((c) => c.countKey).map((c) => [c.countKey!, 5]));
const tree = [
  { id: 'a', name: 'Services', slug: 'services', icon: '🔧', children: [
    { id: 'a1', name: 'Salons, Barbers & Hairdressing', slug: 'beauty-salons-barbers' },
    { id: 'a2', name: 'Welding & Metal Fabrication', slug: 'welding-metalwork' } ] },
  { id: 'b', name: 'Food, Drinks & Groceries', slug: 'food-groceries', icon: '🛒', children: [{ id: 'b1', name: 'Bakery, Cakes & Pastries', slug: 'bakery-cakes' }] },
  { id: 'c', name: 'Pets & Pet Supplies', slug: 'pets-animals', icon: '🐕', children: [{ id: 'c1', name: 'Dogs & Puppies', slug: 'dogs-puppies' }] },
  { id: 'd', name: 'Motors', slug: 'motors', icon: '🚗', children: [{ id: 'd1', name: 'Boda Boda & Delivery Bikes', slug: 'boda-boda-bikes' }, { id: 'd2', name: 'Used Cars', slug: 'used-cars' }] },
];

beforeEach(() => {
  mockCounts = { ...liveAll(), services: 8, 'beauty-salons-barbers': 5, 'welding-metalwork': 3, 'food-groceries': 2, 'bakery-cakes': 2 };
  mockTree = tree; mockLayout = { rank: [], hidden: [] }; mockLoading = false;
  apiGet.mockReset(); apiPut.mockReset();
  window.localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;
});
afterEach(() => cleanup());

describe('/categories index', () => {
  it('lists live categories only, with chips and links; empty (pets) hidden', () => {
    render(<CategoriesIndex />);
    expect(screen.getByRole('heading', { name: 'All categories' })).toBeTruthy();
    const names = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(names.some((t) => t?.includes('Food, Drinks & Groceries'))).toBe(true);
    expect(screen.queryByText('Pets & Pet Supplies')).toBeNull();
    const chip = screen.getByRole('link', { name: /Salons, Barbers & Hairdressing/ });
    expect(chip.getAttribute('href')).toBe('/category/beauty-salons-barbers');
    expect(screen.getAllByRole('link', { name: /Food, Drinks/ })[0].getAttribute('href')).toBe('/category/food-groceries');
  });
  it('search filters by synonym ("barber") and shows an empty state', () => {
    render(<CategoriesIndex />);
    fireEvent.change(screen.getByLabelText('Find a category'), { target: { value: 'barber' } });
    expect(screen.queryByText('Food, Drinks & Groceries')).toBeNull();
    expect(screen.getByRole('link', { name: /Salons, Barbers/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find a category'), { target: { value: 'zzzzqq' } });
    expect(screen.getByRole('status').textContent).toContain('No categories match');
  });
  it('shows a skeleton until the tree is loaded and a fallback if it is empty', () => {
    mockTree = null;
    const { container, rerender } = render(<CategoriesIndex />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    mockTree = [];
    rerender(<CategoriesIndex />);
    expect(screen.getByText(/Categories are unavailable/)).toBeTruthy();
  });
  it('honours admin hidden and rank', () => {
    mockLayout = { rank: ['food-groceries'], hidden: ['services'] };
    render(<CategoriesIndex />);
    expect(screen.queryByText('Services')).toBeNull();
    const first = screen.getAllByRole('listitem').find((li) => li.className.includes('rounded-2xl'))!;
    expect(first.textContent).toContain('Food, Drinks & Groceries');
  });
});

describe('home tiles', () => {
  it('mobile grid: 7 ranked tiles + More → /categories; hidden respected', () => {
    mockLayout = { rank: [], hidden: ['motors'] };
    const { container } = render(<MobileCategoryGrid />);
    const links = Array.from(container.querySelectorAll('a'));
    expect(links).toHaveLength(8);
    expect(links[7].getAttribute('href')).toBe('/categories');
    expect(links.some((a) => a.getAttribute('href') === '/motors')).toBe(false);
    expect(links[0].getAttribute('href')).toBe('/property');
  });
  it('mobile grid: a live new category can outrank hand-made tiles via admin rank', () => {
    mockLayout = { rank: ['food-groceries'], hidden: [] };
    const { container } = render(<MobileCategoryGrid />);
    expect(container.querySelectorAll('a')[0].getAttribute('href')).toBe('/category/food-groceries');
  });
  it('desktop tiles: capped at 12 + All categories tile', () => {
    mockTree = [...tree, ...Array.from({ length: 10 }, (_, i) => ({ id: 'x' + i, name: 'Extra ' + i, slug: 'extra-' + i, icon: '📦', children: [] }))];
    mockCounts = { ...mockCounts!, ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['extra-' + i, 1])) };
    const { container } = render(<HomeCategoryTiles />);
    const tiles = Array.from(container.querySelectorAll('[data-testid="row"] a'));
    expect(tiles).toHaveLength(13);
    expect(tiles[12].getAttribute('href')).toBe('/categories');
  });
});

describe('CategoryPicker', () => {
  const cats: any[] = tree.map((t) => ({ ...t, children: t.children.map((c: any) => ({ ...c })) }));
  const Harness = ({ onPick }: { onPick: (id: string) => void }) => {
    const [v, setV] = React.useState('');
    return <CategoryPicker categories={cats} value={v} onChange={(id) => { setV(id); onPick(id); }} />;
  };
  it('desktop: search finds by synonym, Enter selects, never count-gated (empty pets selectable)', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /Select a category/ }));
    const input = screen.getByLabelText('Search categories');
    fireEvent.change(input, { target: { value: 'boda' } });
    expect(screen.getAllByRole('option')[0].textContent).toContain('Boda Boda');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('d1');
    // reopen: shown as recent; empty category is searchable too
    fireEvent.click(screen.getByRole('button', { name: /Motors › Boda Boda/ }));
    expect(screen.getByText('Recent')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search categories'), { target: { value: 'puppies' } });
    expect(screen.getAllByRole('option')[0].textContent).toContain('Dogs & Puppies');
  });
  it('desktop: arrow keys move the highlight', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /Select a category/ }));
    const input = screen.getByLabelText('Search categories');
    fireEvent.change(input, { target: { value: 's' } });
    const opts = screen.getAllByRole('option');
    expect(opts.length).toBeGreaterThan(1);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).not.toBe(undefined);
  });
  it('recents persist in localStorage and survive a remount', () => {
    const onPick = vi.fn();
    const { unmount } = render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /Select a category/ }));
    fireEvent.change(screen.getByLabelText('Search categories'), { target: { value: 'welding' } });
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(JSON.parse(window.localStorage.getItem('piitrade_recent_categories')!)).toEqual(['a2']);
    unmount();
    render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /Select a category/ }));
    expect(screen.getByText('Recent')).toBeTruthy();
  });
  it('phone: full-screen sheet with drill-down and back', () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /Select a category/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Services/ }));
    expect(within(dialog).getByText('All in Services')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to all categories' }));
    expect(within(dialog).getByRole('button', { name: /Motors/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Services/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Welding/ }));
    expect(onPick).toHaveBeenCalledWith('a2');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('Escape closes', () => {
    render(<Harness onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Select a category/ }));
    expect(screen.getByLabelText('Search categories')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByLabelText('Search categories')).toBeNull();
  });
});

describe('Admin → Category layout', () => {
  const parents = [
    { id: 'm', name: 'Motors', slug: 'motors', icon: '🚗', children: [] },
    { id: 'p', name: 'Property', slug: 'property', icon: '🏠', children: [] },
    { id: 's', name: 'Services', slug: 'services', icon: '🔧', children: [{ id: 'x', name: 'x', slug: 'x' }] },
  ];
  beforeEach(() => {
    mockCounts = { motors: 4, property: 0, services: 2 };
    apiGet.mockImplementation((url: string) => Promise.resolve({ data: url === '/categories' ? parents : { categoryRank: ['services'], hiddenCategories: ['property'] } }));
    apiPut.mockResolvedValue({ data: {} });
  });
  it('loads saved order/hidden, edits, and saves the exact payload', async () => {
    render(<AdminCategoryLayoutPage />);
    await waitFor(() => expect(screen.getByText('Services')).toBeTruthy());
    const rows = () => screen.getAllByRole('listitem').map((li) => li.querySelector('p')?.textContent);
    expect(rows()).toEqual(['Services', 'Motors', 'Property']);
    expect((screen.getByLabelText('Hide Property from buyers') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/No listings yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move Property to the top' }));
    fireEvent.click(screen.getByLabelText('Hide Motors from buyers'));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(apiPut).toHaveBeenCalledWith('/admin/settings', { categoryRank: ['property', 'services', 'motors'], hiddenCategories: ['property', 'motors'] });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved'));
  });
  it('reset to default clears hidden and restores default order; save disabled when unchanged', async () => {
    render(<AdminCategoryLayoutPage />);
    await waitFor(() => expect(screen.getByText('Services')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Saved' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    const rows = screen.getAllByRole('listitem').map((li) => li.querySelector('p')?.textContent);
    expect(rows).toEqual(['Motors', 'Property', 'Services']);
    expect((screen.getByLabelText('Hide Property from buyers') as HTMLInputElement).checked).toBe(false);
  });
  it('shows an error when saving fails', async () => {
    apiPut.mockRejectedValue({ response: { data: { message: 'Nope' } } });
    render(<AdminCategoryLayoutPage />);
    await waitFor(() => expect(screen.getByText('Services')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Hide Motors from buyers'));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Nope'));
  });
});
