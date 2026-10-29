import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor, act } from '@testing-library/react';

// ── shared mocks ─────────────────────────────────────────────────────────────────────────────
let mockUser: { id: string } | null = { id: 'u1' };
let mockTree: any[] | null = null;
let mockCounts: Record<string, number> | null = null;
const apiGet = vi.fn(); const apiPost = vi.fn(); const apiPatch = vi.fn(); const apiPut = vi.fn(); const apiDelete = vi.fn();
const streamCtl: { opts: any | null } = { opts: null };
const sound = vi.hoisted(() => ({ play: vi.fn(async () => true), enabled: true, unlock: vi.fn() }));

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useSearchParams: () => new URLSearchParams(''), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/i18n/useTr', () => ({ useTr: () => (s: string) => s }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mockUser, loading: false }) }));
vi.mock('@/context/CountryContext', () => ({ useCountry: () => ({ country: 'UGANDA', locations: [] }) }));
vi.mock('@/hooks/useCategoryTree', () => ({ useCategoryTree: () => ({ tree: mockTree }) }));
vi.mock('@/hooks/useActiveSubcategoryCounts', () => ({ useNavCategoryCounts: () => ({ data: mockCounts ? { counts: mockCounts, direct: {}, new24h: {}, total: 9 } : null, loading: false }) }));
vi.mock('@/lib/api', () => ({
  API_URL: 'http://api.test',
  api: { get: (...a: any[]) => apiGet(...a), post: (...a: any[]) => apiPost(...a), patch: (...a: any[]) => apiPatch(...a), put: (...a: any[]) => apiPut(...a), delete: (...a: any[]) => apiDelete(...a) },
}));
vi.mock('@/lib/authStorage', () => ({ getAccessToken: () => 'tok' }));
vi.mock('@/lib/alertStream', () => ({ runAlertStream: (o: any) => { streamCtl.opts = o; return new Promise<void>((r) => o.signal.addEventListener('abort', () => r())); } }));
vi.mock('@/lib/alertSound', () => ({
  playAlertSound: (...a: any[]) => (sound.play as any)(...a), isSoundEnabled: () => sound.enabled, setSoundEnabled: (on: boolean) => { sound.enabled = on; },
  unlockAudio: () => sound.unlock(), audioIsReady: () => true,
}));
vi.mock('@/components/listings/ListingGrid', () => ({ ListingGrid: ({ listings }: any) => <ul data-testid="grid">{listings.map((l: any) => <li key={l.id}>{l.title}</li>)}</ul> }));
vi.mock('@/components/ui/PageSkeleton', () => ({ ListPageSkeleton: () => <div>loading…</div> }));

import AlertListener, { ALERT_EVENT } from '@/components/alerts/AlertListener';
import AlertsPage from '@/app/profile/alerts/page';
import CategoryPageClient from '@/components/categories/CategoryPageClient';
import AdminCategoryStructurePage from '@/app/admin/category-structure/page';

const ev = (id: string, over: Record<string, unknown> = {}) => ({
  id, listingId: `l-${id}`, alertName: 'Land under 5M', title: `New match: Plot ${id}`, message: 'UGX 4,500,000 · Wakiso — matches “Land under 5M”',
  href: `/listings/l-${id}`, image: null, sound: true, createdAt: new Date().toISOString(), ...over,
});

beforeEach(() => {
  mockUser = { id: 'u1' }; mockTree = null; mockCounts = null; streamCtl.opts = null;
  [apiGet, apiPost, apiPatch, apiPut, apiDelete].forEach((m) => m.mockReset());
  sound.play.mockReset(); sound.play.mockResolvedValue(true); sound.enabled = true; sound.unlock.mockReset();
  window.localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('AlertListener (live alerts)', () => {
  it('does nothing for visitors who are not signed in', () => {
    mockUser = null;
    const { container } = render(<AlertListener />);
    expect(container.firstChild).toBeNull();
    expect(streamCtl.opts).toBeNull();
  });

  it('opens the stream with the right URL and token; an alert shows a clickable toast, plays the chime and tells the rest of the site', async () => {
    const heard: string[] = [];
    const onHeard = (e: Event) => heard.push((e as CustomEvent).detail.id);
    window.addEventListener(ALERT_EVENT, onHeard);
    render(<AlertListener />);
    expect(streamCtl.opts.url).toBe('http://api.test/api/alerts/stream');
    expect(streamCtl.opts.getToken()).toBe('tok');
    await act(async () => { streamCtl.opts.onEvent(ev('a')); });
    const toast = screen.getByRole('alert');
    expect(within(toast).getByText('Plot a')).toBeTruthy();                 // "New match:" prefix trimmed
    expect(within(toast).getByText(/Alert · Land under 5M/)).toBeTruthy();
    expect(toast.querySelector('a')!.getAttribute('href')).toBe('/listings/l-a');
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(heard).toEqual(['a']);
    window.removeEventListener(ALERT_EVENT, onHeard);
  });

  it('shows an alert once even when the stream and the poll both deliver it', async () => {
    vi.useFakeTimers();
    render(<AlertListener />);
    await act(async () => { streamCtl.opts.onEvent(ev('dup')); });
    apiGet.mockResolvedValue({ data: { events: [ev('dup'), ev('new')], now: new Date().toISOString() } });
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(apiGet).toHaveBeenCalledWith('/alerts/recent', expect.objectContaining({ params: expect.objectContaining({ since: expect.any(String) }) }));
    expect(screen.getAllByRole('alert')).toHaveLength(2);                   // dup (once) + new
    expect(sound.play).toHaveBeenCalledTimes(2);
  });

  it('respects the alert’s own sound flag and the browser preference; reports a blocked browser in the toast', async () => {
    render(<AlertListener />);
    await act(async () => { streamCtl.opts.onEvent(ev('quiet', { sound: false })); });
    expect(sound.play).not.toHaveBeenCalled();
    sound.enabled = false;
    await act(async () => { streamCtl.opts.onEvent(ev('muted')); });
    expect(sound.play).not.toHaveBeenCalled();
    sound.enabled = true; sound.play.mockResolvedValue(false);
    await act(async () => { streamCtl.opts.onEvent(ev('blocked')); });
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Click anywhere once to enable alert sound/)).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(3);                   // toasts still show in every case
  });

  it('keeps at most 3 toasts, can be dismissed, and auto-dismisses', async () => {
    vi.useFakeTimers();
    render(<AlertListener />);
    for (const id of ['1', '2', '3', '4']) await act(async () => { streamCtl.opts.onEvent(ev(id)); });
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(screen.queryByText('Plot 1')).toBeNull();                        // oldest dropped
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('never follows an external link from alert data', async () => {
    render(<AlertListener />);
    await act(async () => { streamCtl.opts.onEvent(ev('x', { href: '//evil.example/phish' })); });
    expect(screen.getByRole('alert').querySelector('a')!.getAttribute('href')).toBe('/profile/alerts');
  });

  it('flashes the tab title while the tab is hidden and restores it when the visitor returns', async () => {
    vi.useFakeTimers();
    document.title = 'Piitrade';
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    render(<AlertListener />);
    await act(async () => { streamCtl.opts.onEvent(ev('t1')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(document.title).toContain('🔔');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(document.title).toBe('Piitrade');
  });

  it('closes the stream when the visitor signs out / leaves', () => {
    const { unmount } = render(<AlertListener />);
    expect(streamCtl.opts.signal.aborted).toBe(false);
    unmount();
    expect(streamCtl.opts.signal.aborted).toBe(true);
  });
});

describe('Alerts page', () => {
  const tree = [
    { id: 'prop', name: 'Property', slug: 'property', icon: '🏠', children: [{ id: 'land', name: 'Land & Plots', slug: 'land-plots' }] },
    { id: 'el', name: 'Electronics', slug: 'electronics', icon: '📱', children: [{ id: 'ph', name: 'Smartphones', slug: 'smartphones' }] },
  ];
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'r1', name: 'Phones under 250k', params: { category: 'smartphones', priceMax: '250000' }, notify: true, notifyEmail: true, notifySound: true,
    createdAt: '2026-10-20T00:00:00Z', lastCheckedAt: '2026-10-20T00:00:00Z', lastAlertAt: null, newCount: 0, ...over,
  });
  const feedItem = (id: string, isRead = false) => ({ ...ev(id), isRead });
  function setup(rows: any[] = [row()], feed: any[] = [feedItem('f1'), feedItem('f2', true)]) {
    mockTree = tree;
    apiGet.mockImplementation((url: string) => {
      if (url === '/saved-searches') return Promise.resolve({ data: { searches: rows, max: 20 } });
      if (url === '/alerts/feed') return Promise.resolve({ data: { items: feed, total: feed.length, unread: feed.filter((f) => !f.isRead).length, page: 1, pages: 1 } });
      return Promise.resolve({ data: {} });
    });
    apiPost.mockImplementation((url: string) => {
      if (url === '/alerts/preview') return Promise.resolve({ data: { count: 7, samples: [{ id: 'x', title: 'Plot in Wakiso', price: 1, currency: 'UGX' }] } });
      if (url === '/saved-searches') return Promise.resolve({ data: { id: 'new' } });
      return Promise.resolve({ data: { updated: 1 } });
    });
    apiPatch.mockResolvedValue({ data: {} }); apiDelete.mockResolvedValue({ data: { ok: true } });
    return render(<AlertsPage />);
  }

  it('asks visitors to sign in', () => {
    mockUser = null; render(<AlertsPage />);
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  });

  it('quick start “Land under UGX 5,000,000” creates exactly the right alert, with a live match preview', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Phones under 250k')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Land under UGX 5,000,000' }));
    expect((screen.getByLabelText('Maximum price in UGX') as HTMLInputElement).value).toBe('5,000,000');
    await waitFor(() => expect(screen.getByText(/listings match right now/)).toBeTruthy(), { timeout: 2000 });
    expect(apiPost).toHaveBeenCalledWith('/alerts/preview', { params: { category: 'land-plots', priceMax: '5000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/saved-searches', { params: { category: 'land-plots', priceMax: '5000000' }, notifyEmail: true, notifySound: true }));
    await waitFor(() => expect(screen.getByText(/Alert created/)).toBeTruthy());
  });

  it('smartphones below 250,000 with e-mail switched off, typed by hand', async () => {
    setup([]);
    await waitFor(() => expect(screen.getByText(/No alerts yet/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Smartphones under UGX 250,000' }));
    fireEvent.change(screen.getByLabelText('Maximum price in UGX'), { target: { value: '240000' } });
    fireEvent.click(screen.getByLabelText(/E-mail/));
    fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/saved-searches', { params: { category: 'smartphones', priceMax: '240000' }, notifyEmail: false, notifySound: true }));
  });

  it('refuses an empty alert and explains why; says so when the alert already exists', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Phones under 250k')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(screen.getByRole('status').textContent).toMatch(/Pick a category/);
    expect(apiPost).not.toHaveBeenCalledWith('/saved-searches', expect.anything());
    apiPost.mockImplementation((u: string) => Promise.resolve({ data: u === '/saved-searches' ? { duplicate: true } : { count: 0, samples: [] } }));
    fireEvent.click(screen.getByRole('button', { name: 'Smartphones under UGX 250,000' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/already have/));
  });

  it('per-alert switches, edit, delete', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Phones under 250k')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Sound: Phones under 250k'));
    expect(apiPatch).toHaveBeenCalledWith('/saved-searches/r1', { notifySound: false });
    fireEvent.click(screen.getByLabelText('Alerts on: Phones under 250k'));
    expect(apiPatch).toHaveBeenCalledWith('/saved-searches/r1', { notify: false });
    expect((screen.getByLabelText('E-mail: Phones under 250k') as HTMLInputElement).disabled).toBe(true);   // channels off when alerts are off

    fireEvent.click(screen.getByRole('button', { name: 'Edit Phones under 250k' }));
    expect((screen.getByLabelText('Maximum price in UGX') as HTMLInputElement).value).toBe('250,000');
    fireEvent.change(screen.getByLabelText('Maximum price in UGX'), { target: { value: '200000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/saved-searches/r1', expect.objectContaining({ params: { category: 'smartphones', priceMax: '200000' }, name: 'Phones under 250k' })));

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Phones under 250k' }));
    expect(apiDelete).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Phones under 250k' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/saved-searches/r1'));
    confirm.mockRestore();
  });

  it('feed: unread count and dot, mark all read, opening one marks it read, and a live alert appears at the top instantly', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Plot f1')).toBeTruthy());
    expect(screen.getByLabelText('1 unread')).toBeTruthy();
    fireEvent.click(screen.getByText('Plot f1'));
    expect(apiPost).toHaveBeenCalledWith('/alerts/feed/read', { ids: ['f1'] });
    expect(screen.queryByLabelText(/unread$/)).toBeNull();

    await act(async () => { window.dispatchEvent(new CustomEvent(ALERT_EVENT, { detail: ev('live', { createdAt: new Date(Date.now() + 5000).toISOString() }) })); });
    const first = screen.getAllByRole('listitem').find((li) => li.textContent?.includes('Plot'))!;
    expect(screen.getByText('Plot live')).toBeTruthy();
    expect(screen.getByLabelText('1 unread')).toBeTruthy();
    const changed = vi.fn(); window.addEventListener('piitrade:notifications-changed', changed);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(apiPost).toHaveBeenCalledWith('/alerts/feed/read', {});
    await waitFor(() => expect(changed).toHaveBeenCalled());           // the header bell refreshes
    expect(screen.getByText('Plot live')).toBeTruthy();                 // and the page itself keeps working
    expect(screen.queryByLabelText(/unread$/)).toBeNull();
    expect(first).toBeTruthy();
    window.removeEventListener('piitrade:notifications-changed', changed);
  });

  it('sound controls: saved per browser, and the test button tells you if the browser blocks audio', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Phones under 250k')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Play a sound for new alerts in this browser'));
    expect(sound.enabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await waitFor(() => expect(screen.getByText(/✓ Played/)).toBeTruthy());
    sound.play.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await waitFor(() => expect(screen.getByText(/blocking sound/)).toBeTruthy());
  });
});

describe('generic category page', () => {
  const data = {
    category: { id: 'c1', name: 'Services', slug: 'services', icon: '🔧' },
    parent: null,
    children: [
      { name: 'Welding & Metal Fabrication', slug: 'welding-metalwork', shortName: 'Welding', menuGroup: 'Building & Trades' },
      { name: 'Cleaning', slug: 'cleaning', menuGroup: 'Home & Safety' },
      { name: 'Funeral Services', slug: 'funeral-services', menuGroup: 'Home & Safety' },
    ],
    siblings: [],
  };
  it('breadcrumb, header count, grouped live tiles with short names, listings, filter link; empty subcategories hidden', async () => {
    mockCounts = { services: 12, 'welding-metalwork': 5, cleaning: 3 };
    apiGet.mockResolvedValue({ data: { listings: [{ id: '1', title: 'Weld a gate' }, { id: '2', title: 'Fix a roof' }] } });
    render(<CategoryPageClient data={data as any} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Services' })).toBeTruthy();
    expect(screen.getByText('12 listings')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All categories' }).getAttribute('href')).toBe('/categories');
    expect(screen.getByText('Building & Trades')).toBeTruthy();
    expect(screen.getByText('Home & Safety')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Welding/ }).getAttribute('href')).toBe('/category/welding-metalwork');
    expect(screen.queryByText('Welding & Metal Fabrication')).toBeNull();   // short name used in the tile
    expect(screen.queryByText('Funeral Services')).toBeNull();               // no listings
    await waitFor(() => expect(screen.getByText('Weld a gate')).toBeTruthy());
    expect(apiGet).toHaveBeenCalledWith('/listings', { params: { category: 'services', limit: 24, country: 'UGANDA' } });
    expect(screen.getByRole('link', { name: /Filter & sort/ }).getAttribute('href')).toBe('/listings?category=services');
    expect(document.querySelector('script[type="application/ld+json"]')!.textContent).toContain('BreadcrumbList');
  });
  it('a subcategory shows its parent in the breadcrumb and live siblings; an empty one offers to post or set an alert', async () => {
    mockCounts = { 'welding-metalwork': 0, cleaning: 4, 'pest-control': 0 };
    apiGet.mockResolvedValue({ data: { listings: [] } });
    const sub = {
      category: { id: 'w', name: 'Welding & Metal Fabrication', slug: 'welding-metalwork', icon: '🔥' },
      parent: { id: 'c1', name: 'Services', slug: 'services', icon: '🔧' }, children: [],
      siblings: [{ name: 'Cleaning', slug: 'cleaning' }, { name: 'Pest Control', slug: 'pest-control' }],
    };
    render(<CategoryPageClient data={sub as any} />);
    expect(screen.getByRole('link', { name: 'Services' }).getAttribute('href')).toBe('/services');
    expect(screen.getByRole('link', { name: 'Cleaning' }).getAttribute('href')).toBe('/category/cleaning');
    expect(screen.queryByRole('link', { name: 'Pest Control' })).toBeNull();
    await waitFor(() => expect(screen.getByText('No listings here yet.')).toBeTruthy());
    expect(screen.getByRole('link', { name: /Alert me when one is posted/ }).getAttribute('href')).toBe('/profile/alerts');
  });
});

describe('Admin → Category structure', () => {
  const cat = (id: string, name: string, parentId: string | null, over: Record<string, unknown> = {}) =>
    ({ id, name, slug: name.toLowerCase().replace(/\W+/g, '-'), icon: '📦', parentId, sortOrder: 0, shortName: null, menuGroup: null, isActive: true, _count: { listings: 0 }, ...over });
  const list = [cat('s', 'Services', null, { _count: { listings: 3 } }), cat('m', 'Motors', null),
    cat('w', 'Welding', 's', { _count: { listings: 2 } }), cat('c', 'Cleaning', 's'), cat('t', 'Tailoring', 's', { menuGroup: 'Beauty & Personal' })];
  const setup = () => {
    apiGet.mockResolvedValue({ data: { categories: list } });
    apiPut.mockResolvedValue({ data: { updated: 1 } });
    render(<AdminCategoryStructurePage />);
    return waitFor(() => expect(screen.getByText('Services')).toBeTruthy());
  };
  const expand = () => fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));

  it('edits send ONLY the changed fields, in one batch; discard restores', async () => {
    await setup(); expand();
    expect((screen.getByRole('button', { name: 'No changes' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Short name for Welding'), { target: { value: '  Welders ' } });
    fireEvent.click(screen.getByLabelText('Active: Cleaning'));
    fireEvent.change(screen.getByLabelText('Group for Welding'), { target: { value: 'Building & Trades' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 changes' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/admin/categories-structure', { items: [
      { id: 'w', shortName: 'Welders', menuGroup: 'Building & Trades' }, { id: 'c', isActive: false },
    ] }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Saved 2 changes/));

    fireEvent.change(screen.getByLabelText('Short name for Welding'), { target: { value: 'changed again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect((screen.getByLabelText('Short name for Welding') as HTMLInputElement).value).toBe('');
  });

  it('too-long short names block saving and say why', async () => {
    await setup(); expand();
    fireEvent.change(screen.getByLabelText('Short name for Welding'), { target: { value: 'x'.repeat(25) } });
    expect((screen.getByRole('button', { name: /Save 1 change/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Too long/)).toBeTruthy();
  });

  it('reordering renumbers the sibling set 0,10,20 and moves the row', async () => {
    await setup(); expand();
    const names = () => screen.getAllByLabelText(/^Short name for /).map((i) => i.getAttribute('aria-label')!.replace('Short name for ', ''));
    expect(names().slice(2)).toEqual(['Cleaning', 'Tailoring', 'Welding']);                     // alphabetical to start
    fireEvent.click(screen.getByRole('button', { name: 'Move Welding up' }));
    expect(names().slice(2)).toEqual(['Cleaning', 'Welding', 'Tailoring']);
    // Cleaning keeps sortOrder 0, so only the two rows that actually changed are sent.
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 changes' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/admin/categories-structure', { items: [
      { id: 'w', sortOrder: 10 }, { id: 't', sortOrder: 20 },
    ] }));
  });

  it('search filters to matches (reordering paused) and shows the parent of a matching child', async () => {
    await setup();
    fireEvent.change(screen.getByLabelText('Search categories'), { target: { value: 'beauty' } });
    expect(screen.getByLabelText('Short name for Tailoring')).toBeTruthy();
    expect(screen.queryByLabelText('Short name for Welding')).toBeNull();
    expect(screen.queryByText('Motors')).toBeNull();
    expect((screen.getByRole('button', { name: 'Move Tailoring down' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Reordering is paused/)).toBeTruthy();
  });

  it('merge needs a target AND the typed slug; then posts and reports what moved', async () => {
    await setup(); expand();
    apiPost.mockResolvedValue({ data: { movedListings: 2, movedChildren: 0, updatedAlerts: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge Welding into another category' }));
    const dialog = screen.getByRole('dialog');
    const go = within(dialog).getByRole('button', { name: 'Merge and delete' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    const options = Array.from(within(dialog).getByLabelText('Merge target').querySelectorAll('option')).map((o) => o.textContent);
    expect(options.some((o) => o?.includes('Welding'))).toBe(false);                          // not itself
    fireEvent.change(within(dialog).getByLabelText('Merge target'), { target: { value: 'c' } });
    expect(go.disabled).toBe(true);                                                           // still needs the slug
    fireEvent.change(within(dialog).getByLabelText('Type the category slug to confirm'), { target: { value: 'welding' } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/admin/categories/w/merge', { targetId: 'c' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/2 listing\(s\).*1 alert\(s\)/));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a failed merge keeps the dialog and shows the server message', async () => {
    await setup(); expand();
    apiPost.mockRejectedValue({ response: { data: { message: 'Pick a different target' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge Cleaning into another category' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Merge target'), { target: { value: 'w' } });
    fireEvent.change(within(dialog).getByLabelText('Type the category slug to confirm'), { target: { value: 'cleaning' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge and delete' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Pick a different target'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
