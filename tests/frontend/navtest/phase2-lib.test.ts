import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanPrice, formatUgxInput, formToParams, paramsToForm, EMPTY_FORM, describeAlert, mergeFeed, rememberId, ALERT_PRESETS, presetToForm, hasCriteria } from '@/lib/alerts';
import { parseSseBuffer, parseAlertEvent, runAlertStream } from '@/lib/alertStream';
import { buildSubcategorySuggestions } from '@/lib/subcategorySuggestions';
import { buildTileGroups, buildBreadcrumb } from '@/components/categories/categoryPageModel';
import {
  buildTree, reorder, computeChanges, validateDraft, initialDrafts, mergeTargets, matchesSearch, groupSuggestions, firstError, type FlatCategory,
} from '@/components/admin/categoryStructureModel';

describe('alerts helpers', () => {
  it('cleanPrice / formatUgxInput accept human input, reject junk', () => {
    expect(cleanPrice('5,000,000')).toBe('5000000');
    expect(cleanPrice('5 000 000')).toBe('5000000');
    expect(cleanPrice('250000')).toBe('250000');
    for (const bad of ['', '0', '-5', '5.5', 'abc', '1e6', '9999999999999']) expect(cleanPrice(bad)).toBe('');
    expect(formatUgxInput('5000000')).toBe('5,000,000');
    expect(formatUgxInput('12ab')).toBe('12');
  });
  it('form <-> params round trip, only set fields are sent', () => {
    const f = { ...EMPTY_FORM, categorySlug: 'land-plots', priceMax: '5,000,000', location: ' Wakiso ', condition: 'USED' as const, withPhotos: true };
    const p = formToParams(f);
    expect(p).toEqual({ category: 'land-plots', priceMax: '5000000', location: 'Wakiso', condition: 'USED', withPhotos: 'true' });
    expect(paramsToForm(p)).toMatchObject({ categorySlug: 'land-plots', priceMax: '5,000,000', location: 'Wakiso', condition: 'USED', withPhotos: true, verifiedOnly: false });
    expect(formToParams(EMPTY_FORM)).toEqual({});
    expect(hasCriteria(EMPTY_FORM)).toBe(false);
    expect(hasCriteria({ ...EMPTY_FORM, priceMax: '0' })).toBe(false);
  });
  it('presets cover the examples from the brief and produce valid forms', () => {
    const land = ALERT_PRESETS.find((p) => p.categorySlug === 'land-plots')!;
    const phones = ALERT_PRESETS.find((p) => p.categorySlug === 'smartphones')!;
    expect(formToParams(presetToForm(land))).toEqual({ category: 'land-plots', priceMax: '5000000' });
    expect(formToParams(presetToForm(phones))).toEqual({ category: 'smartphones', priceMax: '250000' });
    for (const p of ALERT_PRESETS) expect(hasCriteria(presetToForm(p))).toBe(true);
  });
  it('describeAlert is readable', () => {
    expect(describeAlert({ category: 'smartphones', priceMax: '250000', location: 'Kampala' }, 'Smartphones')).toBe('Smartphones · max UGX 250,000 · Kampala');
    expect(describeAlert({ priceMin: '1000', priceMax: '2000' })).toBe('UGX 1,000–2,000');
    expect(describeAlert({})).toBe('Any listing');
  });
  it('mergeFeed prepends new events newest-first and never duplicates', () => {
    const ev = (id: string, t: string) => ({ id, listingId: 'l', alertName: 'a', title: id, message: '', href: '/x', image: null, sound: true, createdAt: t });
    const feed = mergeFeed([], [ev('a', '2026-01-01T00:00:01Z'), ev('b', '2026-01-01T00:00:02Z')]);
    expect(feed.map((f) => f.id)).toEqual(['b', 'a']);
    expect(feed.every((f) => f.isRead === false)).toBe(true);
    expect(mergeFeed(feed, [ev('b', 'x'), ev('c', '2026-01-01T00:00:03Z')]).map((f) => f.id)).toEqual(['c', 'b', 'a']);
  });
  it('rememberId is true once per id and stays bounded', () => {
    const s = new Set<string>();
    expect(rememberId(s, 'a')).toBe(true);
    expect(rememberId(s, 'a')).toBe(false);
    for (let i = 0; i < 300; i++) rememberId(s, `id${i}`, 50);
    expect(s.size).toBeLessThanOrEqual(50);
  });
});

describe('SSE parsing', () => {
  it('splits complete messages, keeps the unfinished tail, ignores comments, handles CRLF and multi-line data', () => {
    const { messages, rest } = parseSseBuffer(': connected\n\nid: 1\nevent: alert\ndata: {"a":1}\n\nevent: alert\r\ndata: x\r\ndata: y\r\n\nid: 3\nevent: al');
    expect(messages).toEqual([{ event: 'alert', data: '{"a":1}', id: '1' }, { event: 'alert', data: 'x\ny', id: undefined }]);
    expect(rest).toBe('id: 3\nevent: al');
    expect(parseSseBuffer(rest + 'ert\ndata: {}\n\n').messages[0]).toMatchObject({ event: 'alert', id: '3' });
  });
  it('parseAlertEvent validates, defaults sound to on, and refuses external hrefs', () => {
    const base = { id: 'n1', title: 'T', message: 'M', listingId: 'l', alertName: 'A', createdAt: '2026-01-01T00:00:00Z', image: null };
    const ok = parseAlertEvent({ event: 'alert', data: JSON.stringify({ ...base, href: '/listings/1' }) })!;
    expect(ok).toMatchObject({ id: 'n1', sound: true, href: '/listings/1' });
    expect(parseAlertEvent({ event: 'alert', data: JSON.stringify({ ...base, href: 'https://evil.example' }) })!.href).toBe('/profile/alerts');
    for (const bad of ['//evil.example', '/\\evil.example', 'javascript:alert(1)', '', 'listings/1']) {
      expect(parseAlertEvent({ event: 'alert', data: JSON.stringify({ ...base, href: bad }) })!.href).toBe('/profile/alerts');
    }
    expect(parseAlertEvent({ event: 'alert', data: JSON.stringify({ ...base, href: '/listings/abc?x=1#y' }) })!.href).toBe('/listings/abc?x=1#y');
    expect(parseAlertEvent({ event: 'alert', data: JSON.stringify({ ...base, sound: false, href: '/x' }) })!.sound).toBe(false);
    expect(parseAlertEvent({ event: 'alert', data: 'not json' })).toBeNull();
    expect(parseAlertEvent({ event: 'alert', data: '{"x":1}' })).toBeNull();
    expect(parseAlertEvent({ event: 'other', data: JSON.stringify({ ...base, href: '/x' }) })).toBeNull();
  });
});

describe('runAlertStream', () => {
  const enc = new TextEncoder();
  const body = (chunks: string[]) => new ReadableStream<Uint8Array>({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } });
  const frame = (id: string) => `id: ${id}\nevent: alert\ndata: ${JSON.stringify({ id, title: `T${id}`, message: '', href: '/x', listingId: 'l', alertName: 'a', createdAt: 'c', image: null })}\n\n`;

  it('delivers events even when a message is split across network chunks, then reconnects with backoff', async () => {
    const ctl = new AbortController();
    const got: string[] = []; const sleeps: number[] = []; const status: boolean[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      calls += 1;
      expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      if (calls >= 3) ctl.abort();
      const f = frame(`e${calls}`);
      return { ok: true, status: 200, body: body([f.slice(0, 20), f.slice(20)]) } as unknown as Response;
    });
    await runAlertStream({ url: 'http://x/api/alerts/stream', getToken: () => 'tok', onEvent: (e) => got.push(e.id), onStatus: (c) => status.push(c), signal: ctl.signal, fetchImpl: fetchImpl as never, sleep: async (ms) => { sleeps.push(ms); } });
    expect(got).toEqual(['e1', 'e2', 'e3']);
    expect(sleeps.slice(0, 2)).toEqual([1000, 2000]);   // exponential backoff between reconnects
    expect(status.includes(true) && status.includes(false)).toBe(true);
  });
  it('on 401 asks the caller to refresh the token, then retries', async () => {
    const ctl = new AbortController(); let calls = 0; const refresh = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => { calls += 1; if (calls === 2) ctl.abort(); return (calls === 1 ? { ok: false, status: 401, body: null } : { ok: true, status: 200, body: body([]) }) as unknown as Response; });
    await runAlertStream({ url: 'u', getToken: () => 't', onEvent: () => undefined, refreshAuth: refresh, signal: ctl.signal, fetchImpl: fetchImpl as never, sleep: async () => undefined });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });
  it('never calls the network without a token, and stops on abort', async () => {
    const ctl = new AbortController(); const fetchImpl = vi.fn();
    let sleeps = 0;
    await runAlertStream({ url: 'u', getToken: () => null, onEvent: () => undefined, signal: ctl.signal, fetchImpl: fetchImpl as never, sleep: async () => { sleeps += 1; if (sleeps >= 2) ctl.abort(); } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('ignores malformed events but keeps reading', async () => {
    const ctl = new AbortController(); const got: string[] = [];
    const fetchImpl = vi.fn(async () => { ctl.abort(); return { ok: true, status: 200, body: body(['event: alert\ndata: {oops\n\n', frame('good')]) } as unknown as Response; });
    await runAlertStream({ url: 'u', getToken: () => 't', onEvent: (e) => got.push(e.id), signal: ctl.signal, fetchImpl: fetchImpl as never, sleep: async () => undefined });
    expect(got).toEqual(['good']);
  });
});

describe('alertSound', () => {
  beforeEach(() => { vi.resetModules(); window.localStorage.clear(); });
  afterEach(() => { delete (window as unknown as { AudioContext?: unknown }).AudioContext; });
  const fakeCtx = (state: 'running' | 'suspended') => {
    const starts: number[] = [];
    class Ctx {
      state = state; currentTime = 0; destination = {};
      resume = vi.fn(async () => undefined);
      createOscillator() { return { type: '', frequency: { value: 0 }, connect() { return { connect: () => undefined }; }, start: (t: number) => starts.push(t), stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect: () => undefined }) }; }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = Ctx;
    return starts;
  };
  it('plays a two-note chime when audio is allowed', async () => {
    const starts = fakeCtx('running');
    const { playAlertSound, audioIsReady } = await import('@/lib/alertSound');
    expect(await playAlertSound()).toBe(true);
    expect(starts).toHaveLength(2);
    expect(audioIsReady()).toBe(true);
  });
  it('returns false (no crash) when the browser is blocking audio', async () => {
    const starts = fakeCtx('suspended');
    const { playAlertSound } = await import('@/lib/alertSound');
    expect(await playAlertSound()).toBe(false);
    expect(starts).toHaveLength(0);
  });
  it('returns false when there is no Web Audio at all', async () => {
    const { playAlertSound } = await import('@/lib/alertSound');
    expect(await playAlertSound()).toBe(false);
  });
  it('the on/off preference persists and defaults to on', async () => {
    const { isSoundEnabled, setSoundEnabled } = await import('@/lib/alertSound');
    expect(isSoundEnabled()).toBe(true);
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });
});

describe('subcategory suggestions (tree based)', () => {
  const tree = [
    { slug: 'services', name: 'Services', children: [{ slug: 'beauty-salons-barbers', name: 'Salons, Barbers & Hairdressing', shortName: 'Salons & Barbers' }, { slug: 'funeral-services', name: 'Funeral & Memorial Services' }] },
    { slug: 'pets-animals', name: 'Pets', children: [{ slug: 'dogs-puppies', name: 'Dogs & Puppies' }] },
    { slug: 'motors', name: 'Motors', children: [{ slug: 'vans-minibuses', name: 'Taxis & Shuttles' }] },
  ];
  const counts = { services: 3, 'beauty-salons-barbers': 3, motors: 2, 'vans-minibuses': 2 };
  it('only live subcategories, keeps the search behaviour (parent slug + name as q)', () => {
    expect(buildSubcategorySuggestions(tree, counts, 'salon')).toEqual([{ label: 'Salons, Barbers & Hairdressing', categorySlug: 'services', q: 'Salons, Barbers & Hairdressing' }]);
    expect(buildSubcategorySuggestions(tree, counts, 'funeral')).toEqual([]);   // no listings
    expect(buildSubcategorySuggestions(tree, counts, 'dogs')).toEqual([]);      // parent empty too
  });
  it('matches short names and synonyms, respects admin hidden, fails closed while loading', () => {
    expect(buildSubcategorySuggestions(tree, counts, 'barbers &')).toHaveLength(1);
    expect(buildSubcategorySuggestions(tree, counts, 'matatu')[0].categorySlug).toBe('motors');
    expect(buildSubcategorySuggestions(tree, counts, 'salon', ['services'])).toEqual([]);
    expect(buildSubcategorySuggestions(null, counts, 'salon')).toEqual([]);
    expect(buildSubcategorySuggestions(tree, null, 'salon')).toEqual([]);
    expect(buildSubcategorySuggestions(tree, counts, '')).toEqual([]);
  });
});

describe('category page model', () => {
  const kids = [
    { slug: 'welding-metalwork', name: 'Welding & Metal Fabrication', shortName: 'Welding', menuGroup: 'Building & Trades' },
    { slug: 'cleaning', name: 'Cleaning', menuGroup: 'Home & Safety' },
    { slug: 'masonry-building', name: 'Masonry', menuGroup: 'Building & Trades' },
    { slug: 'misc', name: 'Misc' },
    { slug: 'empty-one', name: 'Empty', menuGroup: 'Home & Safety' },
  ];
  it('groups by menuGroup in first-seen order, hides empty subcategories, trailing "More" for ungrouped', () => {
    const g = buildTileGroups(kids, { welding: 1, 'welding-metalwork': 4, cleaning: 2, 'masonry-building': 1, misc: 1 }, 'services', '🔧');
    expect(g.map((x) => x.heading)).toEqual(['Building & Trades', 'Home & Safety', 'More']);
    expect(g[0].tiles.map((t) => t.slug)).toEqual(['welding-metalwork', 'masonry-building']);
    expect(g[0].tiles[0]).toMatchObject({ label: 'Welding', name: 'Welding & Metal Fabrication', icon: '🔧', count: 4, href: '/category/welding-metalwork' });
    expect(g[1].tiles.map((t) => t.slug)).toEqual(['cleaning']);
  });
  it('ungrouped-only parents get no heading; unknown counts show everything', () => {
    expect(buildTileGroups([{ slug: 'a', name: 'A' }], { a: 1 }, 'p')[0].heading).toBeNull();
    expect(buildTileGroups(kids, null, 'services').flatMap((g) => g.tiles)).toHaveLength(5);
  });
  it('breadcrumb: home, all categories, parent (if any), current', () => {
    const href = (s: string) => `/${s}`;
    expect(buildBreadcrumb({ name: 'Welding', slug: 'w' }, { name: 'Services', slug: 'services' }, href).map((c) => c.label)).toEqual(['Home', 'All categories', 'Services', 'Welding']);
    expect(buildBreadcrumb({ name: 'Services', slug: 's' }, null, href).at(-1)).toEqual({ label: 'Services', href: null });
  });
});

describe('category structure model', () => {
  const cat = (id: string, name: string, parentId: string | null, over: Partial<FlatCategory> = {}): FlatCategory =>
    ({ id, name, slug: name.toLowerCase(), icon: null, parentId, sortOrder: 0, shortName: null, menuGroup: null, isActive: true, _count: { listings: 0 }, ...over });
  const flat = [cat('p1', 'Services', null), cat('p2', 'Motors', null), cat('a', 'Welding', 'p1'), cat('b', 'Cleaning', 'p1'), cat('c', 'Tailoring', 'p1')];

  it('tree is alphabetical until sortOrder says otherwise', () => {
    const t = buildTree(flat, initialDrafts(flat));
    expect(t.map((n) => n.cat.name)).toEqual(['Motors', 'Services']);
    expect(t[1].children.map((c) => c.name)).toEqual(['Cleaning', 'Tailoring', 'Welding']);
  });
  it('reorder swaps neighbours and renumbers siblings 0,10,20; edges are no-ops', () => {
    const drafts = initialDrafts(flat);
    const sibs = flat.filter((c) => c.parentId === 'p1');
    expect(reorder(sibs, drafts, 'c', -1)).toEqual({ b: 10, c: 0, a: 20 }); // Cleaning,Tailoring,Welding -> Tailoring,Cleaning,Welding
    expect(reorder(sibs, drafts, 'b', -1)).toEqual({});
    expect(reorder(sibs, drafts, 'a', 1)).toEqual({});
  });
  it('computeChanges sends only what changed, normalises blanks, ignores untouched rows', () => {
    const drafts = initialDrafts(flat);
    expect(computeChanges(flat, drafts)).toEqual([]);
    drafts.a = { ...drafts.a, shortName: '  Welders  ', isActive: false };
    drafts.b = { ...drafts.b, menuGroup: '   ' };       // blank == still null == unchanged
    drafts.c = { ...drafts.c, sortOrder: 20 };
    expect(computeChanges(flat, drafts)).toEqual([{ id: 'a', shortName: 'Welders', isActive: false }, { id: 'c', sortOrder: 20 }]);
  });
  it('validation: lengths and angle brackets', () => {
    const d = initialDrafts(flat);
    expect(validateDraft({ ...d.a, shortName: 'x'.repeat(25) })).toMatch(/24/);
    expect(validateDraft({ ...d.a, menuGroup: 'y'.repeat(41) })).toMatch(/40/);
    expect(validateDraft({ ...d.a, shortName: '<b>' })).toMatch(/</);
    expect(validateDraft({ ...d.a, shortName: 'x'.repeat(24) })).toBeNull();
    expect(firstError(flat, { ...d, c: { ...d.c, shortName: 'z'.repeat(30) } })).toMatchObject({ id: 'c' });
    expect(firstError(flat, d)).toBeNull();
  });
  it('merge targets exclude itself and its own subcategories; a parent with children can only merge into a top-level', () => {
    const svc = flat[0];
    expect(mergeTargets(flat, svc).map((c) => c.id)).toEqual(['p2']);
    expect(mergeTargets(flat, flat[2]).map((c) => c.id).sort()).toEqual(['b', 'c', 'p1', 'p2'].sort());
  });
  it('search matches name, slug, short name and group; group suggestions come from siblings', () => {
    const d = initialDrafts(flat); d.a = { ...d.a, menuGroup: 'Building & Trades', shortName: 'Welders' };
    expect(matchesSearch(flat[2], d.a, 'weld')).toBe(true);
    expect(matchesSearch(flat[2], d.a, 'trades')).toBe(true);
    expect(matchesSearch(flat[3], d.b, 'trades')).toBe(false);
    expect(matchesSearch(flat[3], d.b, '')).toBe(true);
    expect(groupSuggestions(flat, 'p1', d)).toEqual(['Building & Trades']);
  });
});
