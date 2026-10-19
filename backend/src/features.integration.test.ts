import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser, mkCategory, mkListing, daysFromNow } from './testing/integrationDb';

configureTestEnv();

describe.skipIf(!TEST_DB)('counts, alerts, inbox, preferences (real database)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let token: Awaited<ReturnType<typeof loadDeps>>['generateAccessToken'];
  let server: Server;
  let base = '';
  let counts: typeof import('./utils/categoryCounts');

  beforeAll(async () => {
    const d = await loadDeps();
    prisma = d.prisma; token = d.generateAccessToken;
    counts = await import('./utils/categoryCounts');
    const { default: app } = await import('./app');
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });
  beforeEach(async () => { await resetDb(prisma); counts.invalidateCategoryCounts(); });

  const auth = (u: { id: string; email: string }, role = 'BUYER') => ({ Authorization: `Bearer ${token({ userId: u.id, email: u.email, role })}` });
  const getJson = async (path: string, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, { headers });
    return { status: res.status, headers: res.headers, body: res.status === 304 ? null : await res.json() };
  };

  // ───────────────────────── Category counts ─────────────────────────
  describe('category counts', () => {
    async function seed() {
      const seller = await mkUser(prisma);
      const motors = await mkCategory(prisma, 'motors');
      const cars = await mkCategory(prisma, 'cars', motors.id);
      const [a, b] = await Promise.all([mkListing(prisma, seller.id, cars.id), mkListing(prisma, seller.id, cars.id)]);
      await mkListing(prisma, seller.id, cars.id, { status: 'PENDING' });                                  // not live
      await mkListing(prisma, seller.id, cars.id, { expiresAt: new Date(Date.now() - 60_000) });          // lapsed, sweep hasn't run
      await mkListing(prisma, seller.id, motors.id, { createdAt: new Date(Date.now() - 25 * 3_600_000) }); // direct, older than 24h
      return { seller, motors, cars, a, b };
    }

    it('counts exactly what visitors can see, rolled up, with direct and last-24h figures', async () => {
      await seed();
      const { status, body } = await getJson('/api/categories/counts');
      expect(status).toBe(200);
      expect(body.counts).toMatchObject({ cars: 2, motors: 3 });
      expect(body.direct).toEqual({ cars: 2, motors: 1 });
      expect(body.new24h).toEqual({ cars: 2, motors: 2 });
      expect(body.total).toBe(3);
      // the older endpoints agree with it, with their original shapes
      expect((await getJson('/api/categories/rollup-counts')).body).toMatchObject({ counts: { cars: 2, motors: 3 }, total: 3 });
      expect((await getJson('/api/categories/active-counts')).body.counts).toEqual({ cars: 2, motors: 1 });
    });

    it('is real-time: a listing change is reflected on the very next request', async () => {
      const { seller, a } = await seed();
      expect((await getJson('/api/categories/counts')).body.counts.cars).toBe(2);   // primes the cache
      const sold = await fetch(`${base}/api/listings/${a.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(seller) }, body: JSON.stringify({ status: 'SOLD' }),
      });
      expect(sold.status).toBe(200);
      expect((await getJson('/api/categories/counts')).body.counts).toMatchObject({ cars: 1, motors: 2 }); // no waiting for the TTL
    });

    it('supports conditional requests (304 until a number changes)', async () => {
      await seed();
      const first = await getJson('/api/categories/counts');
      const etag = first.headers.get('etag')!;
      expect((await getJson('/api/categories/counts', { 'If-None-Match': etag })).status).toBe(304);
      await mkListing(prisma, (await prisma.user.findFirstOrThrow()).id, (await prisma.category.findFirstOrThrow({ where: { slug: 'cars' } })).id);
      counts.invalidateCategoryCounts();
      const changed = await getJson('/api/categories/counts', { 'If-None-Match': etag });
      expect(changed.status).toBe(200);
      expect(changed.body.counts.cars).toBe(3);
    });

    it('uses open job posts for "jobs" and scopes by country', async () => {
      const u = await mkUser(prisma);
      await mkCategory(prisma, 'jobs');
      await prisma.jobPost.create({ data: { title: 'Driver', company: 'Acme', type: 'FULL_TIME', category: 'transport', qualification: 'none', description: 'd', postedById: u.id, status: 'ACTIVE' } });
      expect((await getJson('/api/categories/counts?country=UGANDA')).body.counts.jobs).toBe(1);
      expect((await getJson('/api/categories/counts?country=ATLANTIS')).body.country).toBeNull();
    });
  });

  // ───────────────────────── Admin alerts ─────────────────────────
  describe('admin alerts', () => {
    async function seed() {
      const admin = await mkUser(prisma, { role: 'ADMIN' });
      const seller = await mkUser(prisma, { kycStatus: 'PENDING', kycSubmittedAt: new Date() });
      const cat = await mkCategory(prisma, 'misc');
      await mkListing(prisma, seller.id, cat.id, { status: 'PENDING', createdAt: new Date(Date.now() - 30 * 3_600_000) }); // overdue
      await mkListing(prisma, seller.id, cat.id, { status: 'PENDING' });
      await mkListing(prisma, seller.id, cat.id, { status: 'PENDING' });
      await mkListing(prisma, seller.id, cat.id, { status: 'ACTIVE' });
      await prisma.storeRental.create({ data: { userId: seller.id, status: 'PENDING', endDate: daysFromNow(30) } });
      await prisma.storeRental.create({ data: { userId: admin.id, status: 'ACTIVE', endDate: daysFromNow(30), placements: { pendingRenewal: { plan: 'MONTHLY', tier: 'GOLD', newEndDate: daysFromNow(60).toISOString(), fee: 1, currency: 'UGX' } } } });
      await prisma.storeRental.create({ data: { userId: seller.id, status: 'EXPIRED', endDate: daysFromNow(-3), placements: { pendingRenewal: null } } });
      await prisma.supportRequest.create({ data: { question: 'Help?' } as never });
      return { admin, seller };
    }

    it('reports per-queue counts, newest-since, overdue escalation and totals', async () => {
      const { admin } = await seed();
      const since = new Date(Date.now() - 3_600_000).toISOString();
      const { status, body } = await getJson(`/api/admin/alerts?since=${encodeURIComponent(since)}`, auth(admin, 'ADMIN'));
      expect(status).toBe(200);
      const q = Object.fromEntries(body.queues.map((x: { key: string }) => [x.key, x]));
      expect(q.listings).toMatchObject({ count: 3, newSince: 2, overdue: true, severity: 'critical', pulse: true });
      expect(q.kyc.count).toBe(1);
      expect(q.storeRentals.count).toBe(1);
      expect(q.renewals.count).toBe(1);              // JSON null (already confirmed) is not a pending renewal
      expect(q.support.count).toBe(1);
      expect(q.reports.count).toBe(0);
      expect(q.reports).toMatchObject({ severity: 'none', pulse: false });
      expect(body.totals.pending).toBe(3 + 1 + 1 + 1 + 1);
      expect(body.totals.severity).toBe('critical');
      expect(body.activity.length).toBeGreaterThan(0);
      expect(body.activity[0]).toMatchObject({ href: expect.stringMatching(/^\/admin\//) });
      expect(body.watch).toHaveProperty('expiringStoreRentals7d');
    });

    it('without `since` nothing is flagged new, and an unchanged dashboard answers 304', async () => {
      const { admin } = await seed();
      const first = await getJson('/api/admin/alerts', auth(admin, 'ADMIN'));
      expect(first.body.totals.newSince).toBe(0);
      expect(first.body.queues.every((x: { pulse: boolean }) => !x.pulse)).toBe(true);
      const etag = first.headers.get('etag')!;
      expect((await getJson('/api/admin/alerts', { ...auth(admin, 'ADMIN'), 'If-None-Match': etag })).status).toBe(304);
    });

    it('is admin-only and tolerates a junk `since`', async () => {
      const { admin, seller } = await seed();
      expect((await getJson('/api/admin/alerts')).status).toBe(401);
      expect((await getJson('/api/admin/alerts', auth(seller))).status).toBe(403);
      expect((await getJson('/api/admin/alerts?since=%27%3B%20DROP%20TABLE', auth(admin, 'ADMIN'))).status).toBe(200);
    });
  });

  // ───────────────────────── Inbox ─────────────────────────
  describe('messages inbox', () => {
    async function seed() {
      const me = await mkUser(prisma);
      const others = await Promise.all(Array.from({ length: 4 }, () => mkUser(prisma)));
      const cat = await mkCategory(prisma, 'misc');
      const listing = await mkListing(prisma, others[0].id, cat.id, { title: 'Blue bike', images: ['a.jpg', 'b.jpg', 'c.jpg'] });
      let t = Date.now() - 10 * 3_600_000;
      const msg = (from: string, to: string, content: string, listingId: string | null = null, read = false) =>
        ({ senderId: from, receiverId: to, content, listingId, read, createdAt: new Date((t += 60_000)) });
      const [a, b, c, d] = others;
      await prisma.message.createMany({ data: [
        msg(me.id, a.id, 'hi about the bike', listing.id, true),
        msg(a.id, me.id, 'yes available', listing.id),            // unread
        msg(a.id, me.id, 'cash only', listing.id),                // unread  -> a/listing: 2 unread, last from a
        msg(a.id, me.id, 'general hello'),                        // unread  -> a/general: 1 unread
        msg(me.id, b.id, 'is it still for sale?', listing.id),    // last from me, nothing unread
        msg(c.id, me.id, 'ping'),                                 // c/general: 1 unread
        msg(d.id, me.id, 'old', null, true),                      // all read
      ] });
      return { me, a, b, c, d, listing };
    }

    it('groups per person+listing with correct unread counts, newest first, trimmed images', async () => {
      const { me, a, b, listing } = await seed();
      const { status, body } = await getJson('/api/messages/conversations', auth(me));
      expect(status).toBe(200);
      expect(body.conversations).toHaveLength(5);
      expect(body.hasMore).toBe(false);
      expect(body.nextCursor).toBeNull();
      expect(body.unreadTotal).toBe(4);
      const times = body.conversations.map((c: { lastMessageAt: string }) => c.lastMessageAt);
      expect([...times].sort().reverse()).toEqual(times);
      const find = (id: string, lid: string | null) => body.conversations.find((c: any) => c.counterpart.id === id && (c.listing?.id ?? null) === lid);
      expect(find(a.id, listing.id)).toMatchObject({ unreadCount: 2, lastMessage: 'cash only', lastMessageFromMe: false });
      expect(find(a.id, listing.id).listing).toMatchObject({ title: 'Blue bike', images: ['a.jpg'] }); // first image only
      expect(find(a.id, null)).toMatchObject({ unreadCount: 1, lastMessage: 'general hello' });
      expect(find(b.id, listing.id)).toMatchObject({ unreadCount: 0, lastMessageFromMe: true });
    });

    it('paginates with a cursor: never repeats a row; a conversation that jumps to the top mid-paging shows up on a refreshed first page', async () => {
      const { me, a } = await seed();
      const seen: string[] = [];
      const p1 = await getJson('/api/messages/conversations?limit=2', auth(me));
      expect(p1.body.conversations).toHaveLength(2);
      expect(p1.body.hasMore).toBe(true);
      seen.push(...p1.body.conversations.map((c: any) => `${c.counterpart.id}|${c.listing?.id ?? ''}`));
      // a brand-new message lands (moves that conversation to the very top, i.e. before the cursor)
      await prisma.message.create({ data: { senderId: a.id, receiverId: me.id, content: 'new!', createdAt: new Date() } });
      let cursor = p1.body.nextCursor as string | null;
      while (cursor) {
        const p = await getJson(`/api/messages/conversations?limit=2&cursor=${encodeURIComponent(cursor)}`, auth(me));
        seen.push(...p.body.conversations.map((c: any) => `${c.counterpart.id}|${c.listing?.id ?? ''}`));
        cursor = p.body.nextCursor;
      }
      expect(new Set(seen).size).toBe(seen.length);   // nothing is ever repeated
      // The conversation that received new mail jumped ahead of the cursor, so later pages
      // (correctly) don't re-send it — the client sees it by refreshing page 1, which now leads with it.
      const refreshed = await getJson('/api/messages/conversations?limit=2', auth(me));
      expect(refreshed.body.conversations[0].counterpart.id).toBe(a.id);
      expect(refreshed.body.conversations[0].lastMessage).toBe('new!');
      const everything = new Set([...seen, ...refreshed.body.conversations.map((c: any) => `${c.counterpart.id}|${c.listing?.id ?? ''}`)]);
      expect(everything.size).toBe(5);                // nothing is ever lost
    });

    it('unreadOnly filters, and a forged cursor is rejected', async () => {
      const { me } = await seed();
      const unread = await getJson('/api/messages/conversations?unreadOnly=true', auth(me));
      expect(unread.body.conversations.every((c: any) => c.unreadCount > 0)).toBe(true);
      expect(unread.body.conversations).toHaveLength(3);
      expect((await getJson('/api/messages/conversations?cursor=garbage', auth(me))).status).toBe(400);
      expect((await getJson('/api/messages/conversations')).status).toBe(401);
    });

    it('thread pagination: newest page first, older pages via `before`, and `before` cannot reach other conversations', async () => {
      const me = await mkUser(prisma);
      const other = await mkUser(prisma);
      const stranger = await mkUser(prisma);
      let t = Date.now() - 3_600_000;
      await prisma.message.createMany({ data: Array.from({ length: 120 }, (_, i) => ({
        senderId: i % 2 ? me.id : other.id, receiverId: i % 2 ? other.id : me.id, content: `m${i}`, createdAt: new Date((t += 1000)),
      })) });
      const foreign = await prisma.message.create({ data: { senderId: stranger.id, receiverId: other.id, content: 'secret' } });

      const p1 = await getJson(`/api/messages/thread/${other.id}`, auth(me));
      expect(p1.body.messages).toHaveLength(100);
      expect(p1.body.messages[0].content).toBe('m20');           // oldest of the newest 100 …
      expect(p1.body.messages[99].content).toBe('m119');         // … ending with the newest, ascending
      expect(p1.body.hasMore).toBe(true);
      const p2 = await getJson(`/api/messages/thread/${other.id}?before=${p1.body.nextBefore}`, auth(me));
      expect(p2.body.messages).toHaveLength(20);
      expect(p2.body.messages[0].content).toBe('m0');
      expect(p2.body.hasMore).toBe(false);
      expect((await getJson(`/api/messages/thread/${other.id}?before=${foreign.id}`, auth(me))).status).toBe(400);
      // reading the thread marks incoming messages read
      expect(await prisma.message.count({ where: { receiverId: me.id, read: false } })).toBe(0);
    });
  });

  // ───────────────────────── Column preference ─────────────────────────
  describe('profile/listings column preference', () => {
    const put = (u: { id: string; email: string }, body: unknown) => fetch(`${base}/api/users/me/preferences`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth(u) }, body: JSON.stringify(body),
    });

    it('stores, returns, clears and validates the preference', async () => {
      const u = await mkUser(prisma);
      expect((await getJson('/api/users/me/preferences', auth(u))).body).toEqual({ preferences: { listingColumns: null } });
      expect(await (await put(u, { listingColumns: 4 })).json()).toEqual({ preferences: { listingColumns: 4 } });
      expect((await getJson('/api/users/me/preferences', auth(u))).body.preferences.listingColumns).toBe(4);
      expect((await prisma.user.findUnique({ where: { id: u.id } }))!.listingColumns).toBe(4);
      // returned with the profile too, so the page renders correctly on first paint
      const me = await getJson('/api/users/me', auth(u));
      expect((me.body.user ?? me.body).listingColumns).toBe(4);
      expect(await (await put(u, { listingColumns: '3' })).json()).toEqual({ preferences: { listingColumns: 3 } });
      expect(await (await put(u, { listingColumns: null })).json()).toEqual({ preferences: { listingColumns: null } });
      for (const bad of [0, 7, 2.5, 'wide', [], {}]) expect((await put(u, { listingColumns: bad })).status).toBe(400);
      expect((await put(u, {})).status).toBe(400);
      expect((await fetch(`${base}/api/users/me/preferences`)).status).toBe(401);
    });

    it('the database itself refuses out-of-range values', async () => {
      const u = await mkUser(prisma);
      await expect(prisma.user.update({ where: { id: u.id }, data: { listingColumns: 9 } })).rejects.toThrow();
    });

    it('one user cannot change another user\'s preference', async () => {
      const [a, b] = [await mkUser(prisma), await mkUser(prisma)];
      await put(a, { listingColumns: 2 });
      expect((await prisma.user.findUnique({ where: { id: b.id } }))!.listingColumns).toBeNull();
    });
  });
});
