import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import http from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser, mkCategory, mkListing } from './testing/integrationDb';

// Capture e-mails instead of sending them; everything else in ./utils/email stays real.
const sent = vi.hoisted(() => [] as Array<{ to: string; name: string; alert: { alertName: string; listingTitle: string; priceText: string; listingId: string } }>);
vi.mock('./utils/email', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./utils/email')>();
  return { ...orig, sendListingAlertEmail: async (to: string, name: string, alert: never) => { sent.push({ to, name, alert }); } };
});

configureTestEnv();

describe.skipIf(!TEST_DB)('instant listing alerts (real database: trigger → queue → worker → feed / stream / e-mail)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let token: Awaited<ReturnType<typeof loadDeps>>['generateAccessToken'];
  let server: Server;
  let base = '';
  let worker: typeof import('./utils/alertWorker');
  let engine: typeof import('./utils/listingAlerts');
  let hub: typeof import('./utils/alertHub');

  beforeAll(async () => {
    const d = await loadDeps();
    prisma = d.prisma; token = d.generateAccessToken;
    worker = await import('./utils/alertWorker');
    engine = await import('./utils/listingAlerts');
    hub = await import('./utils/alertHub');
    const { default: app } = await import('./app');
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await fetch(`${base}/api/categories`); // one-off default-tree seeding, before the per-test resets
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });
  beforeEach(async () => { await resetDb(prisma); sent.length = 0; hub._resetHubForTests(); });

  type U = { id: string; email: string };
  const hdr = (u: U) => ({ Authorization: `Bearer ${token({ userId: u.id, email: u.email, role: 'BUYER' })}`, 'Content-Type': 'application/json' });
  const call = async (method: string, path: string, u?: U, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: u ? hdr(u) : {}, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const drain = async () => { const n = await worker.processPendingAlertEvents(); await engine.waitForAlertEmails(); return n; };
  const alertFor = (u: U, params: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    prisma.savedSearch.create({ data: { userId: u.id, name: (over.name as string) ?? 'my alert', filters: params as object, categorySlug: (params.category as string) ?? null, emailAlert: true, ...over } });
  const notes = (u: U) => prisma.notification.findMany({ where: { userId: u.id, type: 'LISTING_ALERT' }, orderBy: { createdAt: 'asc' } });

  async function tree() {
    const property = await mkCategory(prisma, 'property');
    const land = await prisma.category.create({ data: { name: 'Land', slug: 'land-plots', parentId: property.id } });
    const electronics = await mkCategory(prisma, 'electronics');
    const phones = await prisma.category.create({ data: { name: 'Smartphones', slug: 'smartphones', parentId: electronics.id } });
    return { property, land, electronics, phones };
  }

  it('the DB trigger queues a listing only when it is (or becomes) ACTIVE, or its price changes while ACTIVE', async () => {
    const { land } = await tree(); const seller = await mkUser(prisma);
    const pending = await mkListing(prisma, seller.id, land.id, { status: 'PENDING' });
    expect(await prisma.listingAlertEvent.count()).toBe(0);                                  // not live: nothing
    await prisma.listing.update({ where: { id: pending.id }, data: { title: 'edited title' } });
    expect(await prisma.listingAlertEvent.count()).toBe(0);                                  // edit of a non-live listing
    await prisma.listing.update({ where: { id: pending.id }, data: { status: 'ACTIVE' } });
    expect(await prisma.listingAlertEvent.count()).toBe(1);                                  // approved -> queued
    await prisma.listing.update({ where: { id: pending.id }, data: { views: { increment: 1 }, title: 'again' } });
    expect(await prisma.listingAlertEvent.count()).toBe(1);                                  // views/title edits: not queued
    await prisma.listing.update({ where: { id: pending.id }, data: { price: 1234 } });
    expect(await prisma.listingAlertEvent.count()).toBe(1);                                  // price change collapses into the one pending row
    await mkListing(prisma, seller.id, land.id, { status: 'ACTIVE' });
    expect(await prisma.listingAlertEvent.count()).toBe(2);                                  // a new ACTIVE listing
    await drain();
    await prisma.listing.update({ where: { id: pending.id }, data: { price: 999 } });
    expect(await prisma.listingAlertEvent.count({ where: { processedAt: null } })).toBe(1);  // after processing, a price change queues again
  });

  it('land under 5,000,000 and smartphones under 250,000: only real matches are alerted, each user once, with e-mail and profile entry', async () => {
    const { land, phones } = await tree();
    const seller = await mkUser(prisma); const amos = await mkUser(prisma, { name: 'Amos' }); const bea = await mkUser(prisma, { name: 'Bea' });
    await alertFor(amos, { category: 'land-plots', priceMax: 5_000_000 }, { name: 'Land under 5M' });
    await alertFor(amos, { category: 'smartphones', priceMax: 250_000 }, { name: 'Phones under 250k' });
    await alertFor(bea, { category: 'property', priceMax: 5_000_000 }, { name: 'Any property under 5M' });   // parent category

    await mkListing(prisma, seller.id, land.id, { title: 'Plot in Wakiso', price: 4_500_000 });      // matches Amos + Bea
    await mkListing(prisma, seller.id, land.id, { title: 'Big plot', price: 9_000_000 });             // too expensive
    await mkListing(prisma, seller.id, phones.id, { title: 'Tecno Spark', price: 240_000 });         // matches Amos
    await mkListing(prisma, seller.id, phones.id, { title: 'iPhone 15', price: 3_000_000 });         // too expensive
    expect(await drain()).toBe(4);

    const a = await notes(amos); const b = await notes(bea);
    expect(a.map((n) => n.title).sort()).toEqual(['New match: Plot in Wakiso', 'New match: Tecno Spark']);
    expect(b.map((n) => n.title)).toEqual(['New match: Plot in Wakiso']);
    expect(a[0].message).toMatch(/UGX/);
    expect((a.find((n) => n.title.includes('Tecno'))!.data as { alertName: string; href: string }).alertName).toBe('Phones under 250k');
    expect(sent.map((s) => s.to).sort()).toEqual([amos.email, amos.email, bea.email].sort());
    expect(sent.find((s) => s.alert.listingTitle === 'Tecno Spark')!.alert.priceText).toBe('UGX 240,000');
    expect(await prisma.listingAlertDelivery.count({ where: { emailedAt: { not: null } } })).toBe(3);
  });

  it('exactly once: reprocessing, a later price edit, and a seller never alerting themselves', async () => {
    const { land } = await tree();
    const seller = await mkUser(prisma); const buyer = await mkUser(prisma);
    await alertFor(buyer, { category: 'land-plots', priceMax: 5_000_000 });
    await alertFor(seller, { category: 'land-plots', priceMax: 5_000_000 }, { name: "seller's own" });
    const l = await mkListing(prisma, seller.id, land.id, { price: 4_000_000 });
    await drain();
    expect((await engine.dispatchListingAlerts(l.id)).delivered).toBe(0);           // direct re-dispatch: already delivered
    await prisma.listing.update({ where: { id: l.id }, data: { price: 3_500_000 } }); // price drop on a listing they already heard about
    await drain();
    expect(await notes(buyer)).toHaveLength(1);
    expect(await notes(seller)).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it('a price drop INTO the range alerts once (the listing did not match before)', async () => {
    const { phones } = await tree(); const seller = await mkUser(prisma); const buyer = await mkUser(prisma);
    await alertFor(buyer, { category: 'smartphones', priceMax: 250_000 });
    const l = await mkListing(prisma, seller.id, phones.id, { price: 400_000 });
    await drain();
    expect(await notes(buyer)).toHaveLength(0);
    await prisma.listing.update({ where: { id: l.id }, data: { price: 230_000 } });
    await drain();
    expect(await notes(buyer)).toHaveLength(1);
  });

  it('respects switches and eligibility: alerts off, banned user, unverified e-mail, email/sound toggles', async () => {
    const { land } = await tree(); const seller = await mkUser(prisma);
    const off = await mkUser(prisma); const banned = await mkUser(prisma, { isBanned: true }); const unverified = await mkUser(prisma, { isVerified: false });
    const quiet = await mkUser(prisma); const mute = await mkUser(prisma);
    const p = { category: 'land-plots' };
    await alertFor(off, p, { emailAlert: false });
    await alertFor(banned, p);
    await alertFor(unverified, p);
    await alertFor(quiet, p, { notifyEmail: false });
    await alertFor(mute, p, { notifySound: false });
    await mkListing(prisma, seller.id, land.id);
    await drain();
    expect(await notes(off)).toHaveLength(0);
    expect(await notes(banned)).toHaveLength(0);
    expect(await notes(unverified)).toHaveLength(1);   // profile entry yes ...
    expect(await notes(quiet)).toHaveLength(1);
    expect(await notes(mute)).toHaveLength(1);
    expect((await notes(mute))[0].data).toMatchObject({ sound: false });
    expect((await notes(quiet))[0].data).toMatchObject({ sound: true });
    expect(sent.map((s) => s.to).sort()).toEqual([mute.email]);   // ... but e-mail only for verified + notifyEmail users
  });

  it('keyword, location, condition and photo criteria; non-UGX listings only match alerts without a price bound', async () => {
    const { phones } = await tree(); const seller = await mkUser(prisma); const buyer = await mkUser(prisma);
    await alertFor(buyer, { q: 'tecno', location: 'Kampala', condition: 'USED', withPhotos: true }, { name: 'tecno kla' });
    await mkListing(prisma, seller.id, phones.id, { title: 'Tecno Camon 20', location: 'Kampala, Nakawa', condition: 'USED', images: ['a.jpg'] }); // match
    await mkListing(prisma, seller.id, phones.id, { title: 'Samsung A14', location: 'Kampala', condition: 'USED', images: ['a.jpg'] });             // keyword
    await mkListing(prisma, seller.id, phones.id, { title: 'Tecno Spark', location: 'Gulu', condition: 'USED', images: ['a.jpg'] });                 // location
    await mkListing(prisma, seller.id, phones.id, { title: 'Tecno Pop', location: 'Kampala', condition: 'NEW', images: ['a.jpg'] });                 // condition
    await mkListing(prisma, seller.id, phones.id, { title: 'Tecno Phantom', location: 'Kampala', condition: 'USED', images: [] });                   // photo
    await drain();
    expect((await notes(buyer)).map((n) => n.title)).toEqual(['New match: Tecno Camon 20']);

    const other = await mkUser(prisma);
    await alertFor(other, { category: 'smartphones', priceMax: 250_000 }, { name: 'priced' });
    await alertFor(other, { category: 'smartphones' }, { name: 'unpriced' });
    await mkListing(prisma, seller.id, phones.id, { title: 'Dollar phone', price: 100, currency: 'USD' });
    await drain();
    const o = await notes(other);
    expect(o).toHaveLength(1);
    expect((o[0].data as { alertName: string }).alertName).toBe('unpriced');
  });

  it('one user with several matching alerts gets one notification, from the alert with the most channels on', async () => {
    const { land } = await tree(); const seller = await mkUser(prisma); const buyer = await mkUser(prisma);
    await alertFor(buyer, { category: 'land-plots' }, { name: 'silent', notifyEmail: false, notifySound: false });
    await alertFor(buyer, { category: 'property' }, { name: 'loud' });
    await mkListing(prisma, seller.id, land.id);
    await drain();
    const n = await notes(buyer);
    expect(n).toHaveLength(1);
    expect((n[0].data as { alertName: string }).alertName).toBe('loud');
    expect(sent).toHaveLength(1);
  });

  it('daily e-mail cap: past the cap the profile entry still arrives, the e-mail does not', async () => {
    const { land } = await tree(); const seller = await mkUser(prisma); const buyer = await mkUser(prisma);
    const a = await alertFor(buyer, { category: 'land-plots' });
    const old = await mkListing(prisma, seller.id, land.id, { status: 'PENDING' });
    await prisma.listingAlertEvent.deleteMany();
    for (let i = 0; i < engine.MAX_ALERT_EMAILS_PER_USER_PER_DAY; i++) {
      const l = await mkListing(prisma, seller.id, land.id, { status: 'PENDING' });
      await prisma.listingAlertDelivery.create({ data: { savedSearchId: a.id, listingId: l.id, userId: buyer.id, emailedAt: new Date() } });
    }
    await prisma.listing.update({ where: { id: old.id }, data: { status: 'ACTIVE' } });
    await drain();
    expect(await notes(buyer)).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it('claiming is exclusive: concurrent workers never share an event, and a stale claim is retried', async () => {
    const { land } = await tree(); const seller = await mkUser(prisma);
    for (let i = 0; i < 12; i++) await mkListing(prisma, seller.id, land.id);
    const [a, b, c] = await Promise.all([worker.claimAlertEvents(5), worker.claimAlertEvents(5), worker.claimAlertEvents(5)]);
    const ids = [...a, ...b, ...c].map((e) => e.id);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(await worker.claimAlertEvents()).toHaveLength(0);                                // all claimed, none stale
    await prisma.$executeRaw`UPDATE "ListingAlertEvent" SET "claimedAt" = now() - interval '10 minutes' WHERE "id" = ${ids[0]}`;
    expect((await worker.claimAlertEvents()).map((e) => e.id)).toEqual([ids[0]]);          // crashed worker's claim comes back
    expect((await prisma.listingAlertEvent.findUnique({ where: { id: ids[0] } }))!.attempts).toBe(2);
  });

  it('retired events are purged after 3 days; pending ones are never purged', async () => {
    const { land } = await tree(); const seller = await mkUser(prisma);
    await mkListing(prisma, seller.id, land.id); await mkListing(prisma, seller.id, land.id);
    await drain();
    const [first] = await prisma.listingAlertEvent.findMany();
    await prisma.$executeRaw`UPDATE "ListingAlertEvent" SET "createdAt" = now() - interval '5 days' WHERE "id" = ${first.id}`;
    const pendingOld = await mkListing(prisma, seller.id, land.id);
    await prisma.$executeRaw`UPDATE "ListingAlertEvent" SET "createdAt" = now() - interval '9 days' WHERE "listingId" = ${pendingOld.id}`;
    expect(await worker.purgeOldAlertEvents(3)).toBe(1);
    expect(await prisma.listingAlertEvent.count({ where: { listingId: pendingOld.id } })).toBe(1);
  });

  it('HTTP: feed, unread counts, mark read, recent poll, preview, and strict per-user isolation', async () => {
    const { land } = await tree(); const seller = await mkUser(prisma); const buyer = await mkUser(prisma); const other = await mkUser(prisma);
    expect((await call('GET', '/api/alerts/feed')).status).toBe(401);
    await alertFor(buyer, { category: 'land-plots', priceMax: 5_000_000 });
    const t0 = new Date(Date.now() - 1000).toISOString();
    await mkListing(prisma, seller.id, land.id, { title: 'Plot A', price: 1_000_000 });
    await mkListing(prisma, seller.id, land.id, { title: 'Plot B', price: 2_000_000 });
    await drain();

    const feed = await call('GET', '/api/alerts/feed', buyer);
    expect(feed.body).toMatchObject({ total: 2, unread: 2, page: 1 });
    expect(feed.body.items[0]).toMatchObject({ sound: true, isRead: false });
    expect(feed.body.items[0].href).toMatch(/^\/listings\//);
    expect((await call('GET', '/api/alerts/feed', other)).body).toMatchObject({ total: 0, unread: 0 });

    const recent = await call('GET', `/api/alerts/recent?since=${encodeURIComponent(t0)}`, buyer);
    expect(recent.body.events).toHaveLength(2);
    expect(recent.body.events[0].createdAt <= recent.body.events[1].createdAt).toBe(true);   // oldest first
    expect((await call('GET', `/api/alerts/recent?since=${encodeURIComponent(recent.body.now)}`, buyer)).body.events).toHaveLength(0);
    expect((await call('GET', `/api/alerts/recent?since=${encodeURIComponent(t0)}`, other)).body.events).toHaveLength(0);

    expect((await call('POST', '/api/alerts/feed/read', other, {})).body.updated).toBe(0);   // can't mark someone else's
    expect((await call('POST', '/api/alerts/feed/read', buyer, { ids: [feed.body.items[0].id] })).body.updated).toBe(1);
    expect((await call('GET', '/api/alerts/feed', buyer)).body.unread).toBe(1);
    expect((await call('POST', '/api/alerts/feed/read', buyer, {})).body.updated).toBe(1);
    expect((await call('GET', '/api/alerts/feed', buyer)).body.unread).toBe(0);

    const preview = await call('POST', '/api/alerts/preview', buyer, { params: { category: 'land-plots', priceMax: 1_500_000 } });
    expect(preview.body.count).toBe(1);
    expect(preview.body.samples[0].title).toBe('Plot A');
    expect((await call('POST', '/api/alerts/preview', buyer, { params: {} })).status).toBe(400);
  });

  it('HTTP: alert links are only ever same-site paths, whatever is stored in the notification', async () => {
    const buyer = await mkUser(prisma);
    for (const [i, href] of ['//evil.example/x', 'https://evil.example', 'javascript:alert(1)', '/listings/ok-1'].entries()) {
      await prisma.notification.create({ data: { userId: buyer.id, type: 'LISTING_ALERT', title: `t${i}`, message: 'm', data: { kind: 'LISTING_ALERT', href, listingId: 'x' } } });
    }
    const feed = await call('GET', '/api/alerts/feed', buyer);
    const hrefs = new Map<string, string>(feed.body.items.map((x: { title: string; href: string }) => [x.title, x.href]));
    expect(hrefs.get('t0')).toBe('/profile/alerts');
    expect(hrefs.get('t1')).toBe('/profile/alerts');
    expect(hrefs.get('t2')).toBe('/profile/alerts');
    expect(hrefs.get('t3')).toBe('/listings/ok-1');
  });

  it('HTTP: alert settings via /saved-searches (channels, criteria edit, category slug kept in sync, 20-alert cap)', async () => {
    const buyer = await mkUser(prisma);
    const made = await call('POST', '/api/saved-searches', buyer, { params: { category: 'smartphones', priceMax: 250000 }, name: 'Phones', notifyEmail: false, notifySound: false });
    expect(made.status).toBe(201);
    let row = await prisma.savedSearch.findUniqueOrThrow({ where: { id: made.body.id } });
    expect(row).toMatchObject({ categorySlug: 'smartphones', emailAlert: true, notifyEmail: false, notifySound: false, name: 'Phones' });

    const patched = await call('PATCH', `/api/saved-searches/${row.id}`, buyer, { notifySound: true, params: { category: 'land-plots', priceMax: 5000000 } });
    expect(patched.body).toMatchObject({ notifySound: true, notifyEmail: false, notify: true });
    row = await prisma.savedSearch.findUniqueOrThrow({ where: { id: row.id } });
    expect(row.categorySlug).toBe('land-plots');
    expect(row.filters).toMatchObject({ category: 'land-plots', priceMax: '5000000' });
    expect(row.name).toBe('Phones');                                                     // a user-chosen name is kept
    expect((await call('PATCH', `/api/saved-searches/${row.id}`, buyer, { params: {} })).status).toBe(400);
    const listed = await call('GET', '/api/saved-searches', buyer);
    expect(listed.body.searches[0]).toMatchObject({ notifyEmail: false, notifySound: true, notify: true });
    expect(listed.body.max).toBe(20);

    for (let i = 1; i < 20; i++) expect((await call('POST', '/api/saved-searches', buyer, { params: { q: `thing${i}` } })).status).toBe(201);
    expect((await call('POST', '/api/saved-searches', buyer, { params: { q: 'one-too-many' } })).status).toBe(400);
  });

  it('LIVE STREAM: the matching user receives the alert over SSE the moment the worker handles the listing', async () => {
    const { land } = await tree(); const seller = await mkUser(prisma); const buyer = await mkUser(prisma); const other = await mkUser(prisma);
    await alertFor(buyer, { category: 'land-plots', priceMax: 5_000_000 }, { name: 'Land under 5M' });

    const open = (u: U) => new Promise<{ chunks: string[]; status: number; close: () => void }>((resolve, reject) => {
      const chunks: string[] = [];
      const req = http.get(`${base}/api/alerts/stream`, { headers: hdr(u) }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (c: string) => chunks.push(c));
        resolve({ chunks, status: res.statusCode ?? 0, close: () => req.destroy() });
      });
      req.on('error', reject);
    });
    const waitFor = async (pred: () => boolean, ms = 3000) => { const t = Date.now(); while (!pred()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 25)); } };

    const bs = await open(buyer); const os = await open(other);
    expect(bs.status).toBe(200);
    await waitFor(() => bs.chunks.join('').includes(': connected'));
    expect(hub.streamCount(buyer.id)).toBe(1);

    await mkListing(prisma, seller.id, land.id, { title: 'Plot with title', price: 3_000_000 });
    await drain();
    await waitFor(() => bs.chunks.join('').includes('event: alert'));
    const text = bs.chunks.join('');
    const data = JSON.parse(text.split('data: ')[1].split('\n')[0]);
    expect(data).toMatchObject({ title: 'New match: Plot with title', alertName: 'Land under 5M', sound: true });
    expect(data.href).toMatch(/^\/listings\//);
    expect(text).toContain(`id: ${data.id}`);
    expect(os.chunks.join('')).not.toContain('event: alert');                       // not delivered to another user

    bs.close(); os.close();
    await waitFor(() => hub.streamCount() === 0);                                  // closing the tab frees the slot
  });

  it('stream: needs a login and is capped per user', async () => {
    const buyer = await mkUser(prisma);
    expect((await fetch(`${base}/api/alerts/stream`)).status).toBe(401);
    const reqs: http.ClientRequest[] = [];
    const statuses: number[] = [];
    for (let i = 0; i < hub.MAX_STREAMS_PER_USER + 1; i++) {
      await new Promise<void>((resolve) => {
        const r = http.get(`${base}/api/alerts/stream`, { headers: hdr(buyer) }, (res) => { statuses.push(res.statusCode ?? 0); if (res.statusCode !== 200) res.resume(); resolve(); });
        reqs.push(r);
      });
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(hub.MAX_STREAMS_PER_USER);
    expect(statuses[statuses.length - 1]).toBe(429);
    reqs.forEach((r) => r.destroy());
  });

  it('END TO END with no manual drain: LISTEN wakes the worker, the alert lands within seconds; cross-instance relay reaches the stream', async () => {
    const { land } = await tree(); const seller = await mkUser(prisma); const buyer = await mkUser(prisma);
    await alertFor(buyer, { category: 'land-plots', priceMax: 5_000_000 });
    const w = worker.startAlertWorker();
    try {
      const until = async (pred: () => boolean | Promise<boolean>, ms: number) => { const t = Date.now(); while (!(await pred())) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 25)); } return true; };
      expect(await until(() => worker.isAlertListenerHealthy(), 8000)).toBe(true);       // connected AND the ping round-tripped

      const startedAt = Date.now();
      await mkListing(prisma, seller.id, land.id, { title: 'Instant plot', price: 2_000_000 });
      expect(await until(async () => (await notes(buyer)).length === 1, 4000)).toBe(true);
      const latency = Date.now() - startedAt;
      expect(latency).toBeLessThan(3000);                                                  // LISTEN path, not the 30 s poll
      await engine.waitForAlertEmails();
      expect(sent).toHaveLength(1);

      // Another server instance announces an alert for a user connected to THIS instance.
      const chunks: string[] = [];
      const req = http.get(`${base}/api/alerts/stream`, { headers: hdr(buyer) }, (res) => { res.setEncoding('utf8'); res.on('data', (c: string) => chunks.push(c)); });
      expect(await until(() => hub.streamCount(buyer.id) === 1, 3000)).toBe(true);
      const event = { id: 'remote-1', listingId: 'x', alertName: 'remote', title: 'From another instance', message: 'm', href: '/listings/x', image: null, sound: true, createdAt: new Date().toISOString() };
      await prisma.$executeRaw`SELECT pg_notify('alert_user', ${JSON.stringify({ o: 'some-other-instance', userId: buyer.id, event })})`;
      expect(await until(() => chunks.join('').includes('From another instance'), 3000)).toBe(true);
      req.destroy();
    } finally {
      await w.stop();
    }
    expect(worker.isAlertListenerHealthy()).toBe(false);
  });

  it('one bad event does not block the rest, and it is retried', async () => {
    const { land } = await tree(); const seller = await mkUser(prisma); const buyer = await mkUser(prisma);
    await alertFor(buyer, { category: 'land-plots' });
    const good = await mkListing(prisma, seller.id, land.id, { title: 'Good plot' });
    await prisma.$executeRaw`INSERT INTO "ListingAlertEvent" ("id","listingId","createdAt") VALUES ('bad-1','does-not-exist', now() - interval '1 minute')`;
    await drain();
    expect((await notes(buyer)).map((n) => n.title)).toEqual(['New match: Good plot']);
    // a listing that vanished is "done" (nothing to alert about) rather than retried forever
    expect((await prisma.listingAlertEvent.findUnique({ where: { id: 'bad-1' } }))!.processedAt).not.toBeNull();
    expect(good.id).toBeTruthy();
  });
});
