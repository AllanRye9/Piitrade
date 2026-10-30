import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser, mkCategory, mkListing } from './testing/integrationDb';

configureTestEnv();

describe.skipIf(!TEST_DB)('category structure: ordering, retire, merge (real database)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let token: Awaited<ReturnType<typeof loadDeps>>['generateAccessToken'];
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const d = await loadDeps();
    prisma = d.prisma; token = d.generateAccessToken;
    const { default: app } = await import('./app');
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // GET /categories auto-seeds the default tree once per process (`seeded` flag). Do that now,
    // before the per-test resets, so the tests below see exactly the rows they create.
    await fetch(`${base}/api/categories`);
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });
  beforeEach(async () => { await resetDb(prisma); });

  type U = { id: string; email: string };
  const as = (u: U, role: 'ADMIN' | 'BUYER') => ({ Authorization: `Bearer ${token({ userId: u.id, email: u.email, role })}`, 'Content-Type': 'application/json' });
  const call = async (method: string, path: string, u?: U & { role?: 'ADMIN' | 'BUYER' }, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: u ? as(u, u.role ?? 'BUYER') : {}, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  const admin = async () => ({ ...(await mkUser(prisma, { role: 'ADMIN' })), role: 'ADMIN' as const });

  async function seedTree() {
    const services = await mkCategory(prisma, 'services');
    const motors = await mkCategory(prisma, 'motors');
    const a = await prisma.category.create({ data: { name: 'Welding', slug: 'welding', parentId: services.id } });
    const b = await prisma.category.create({ data: { name: 'Cleaning', slug: 'cleaning', parentId: services.id } });
    const c = await prisma.category.create({ data: { name: 'Tailoring', slug: 'tailoring', parentId: services.id } });
    return { services, motors, a, b, c };
  }

  it('GET /categories: alphabetical until sortOrder is set, then by sortOrder; retired hidden; children included', async () => {
    const { services, motors, a, b, c } = await seedTree();
    let res = await call('GET', '/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.map((x: { slug: string }) => x.slug)).toEqual(['motors', 'services']);
    expect(res.body[1].children.map((x: { slug: string }) => x.slug)).toEqual(['cleaning', 'tailoring', 'welding']);

    // The route caches nothing server-side besides the seed flag, so edits show up immediately.
    await prisma.category.update({ where: { id: services.id }, data: { sortOrder: -1 } });
    await prisma.category.update({ where: { id: a.id }, data: { sortOrder: 1 } });
    await prisma.category.update({ where: { id: c.id }, data: { sortOrder: 2 } });
    await prisma.category.update({ where: { id: b.id }, data: { isActive: false } });
    res = await call('GET', '/api/categories');
    expect(res.body.map((x: { slug: string }) => x.slug)).toEqual(['services', 'motors']);
    expect(res.body[0].children.map((x: { slug: string }) => x.slug)).toEqual(['welding', 'tailoring']);
    expect(res.body[0].children[0]).toMatchObject({ sortOrder: 1, isActive: true });

    await prisma.category.update({ where: { id: motors.id }, data: { isActive: false } });
    res = await call('GET', '/api/categories');
    expect(res.body.map((x: { slug: string }) => x.slug)).toEqual(['services']);
  });

  it('GET /categories/:slug/subcategories hides retired and honours order', async () => {
    const { b, c } = await seedTree();
    await prisma.category.update({ where: { id: c.id }, data: { sortOrder: -5 } });
    await prisma.category.update({ where: { id: b.id }, data: { isActive: false } });
    const res = await call('GET', '/api/categories/services/subcategories');
    expect(res.body.map((x: { slug: string }) => x.slug)).toEqual(['tailoring', 'welding']);
  });

  it('GET /categories/by-slug: parent view, child view with siblings and breadcrumb, 404 for retired/unknown/invalid', async () => {
    const { services, a, b } = await seedTree();
    await prisma.category.update({ where: { id: a.id }, data: { shortName: 'Welding Co', menuGroup: 'Building & Trades' } });
    const parent = await call('GET', '/api/categories/by-slug/services');
    expect(parent.status).toBe(200);
    expect(parent.body.parent).toBeNull();
    expect(parent.body.children.map((x: { slug: string }) => x.slug)).toEqual(['cleaning', 'tailoring', 'welding']);
    expect(parent.body.children.find((x: { slug: string }) => x.slug === 'welding')).toMatchObject({ shortName: 'Welding Co', menuGroup: 'Building & Trades' });
    expect(parent.headers.get('cache-control')).toContain('max-age=120');

    const child = await call('GET', '/api/categories/by-slug/welding');
    expect(child.body.parent).toMatchObject({ slug: 'services', id: services.id });
    expect(child.body.children).toEqual([]);
    expect(child.body.siblings.map((x: { slug: string }) => x.slug)).toEqual(['cleaning', 'tailoring']);

    await prisma.category.update({ where: { id: b.id }, data: { isActive: false } });
    expect((await call('GET', '/api/categories/by-slug/cleaning')).status).toBe(404);
    expect((await call('GET', '/api/categories/by-slug/nope')).status).toBe(404);
    expect((await call('GET', '/api/categories/by-slug/Bad_Slug!')).status).toBe(404);
    await prisma.category.update({ where: { id: services.id }, data: { isActive: false } });
    expect((await call('GET', '/api/categories/by-slug/welding')).status).toBe(404); // parent retired => child unreachable too
  });

  it('admin PUT/POST accept and validate display fields; non-admins are refused', async () => {
    const { a } = await seedTree();
    const ad = await admin();
    const buyer = await mkUser(prisma);
    expect((await call('PUT', `/api/admin/categories/${a.id}`, buyer, { shortName: 'x' })).status).toBe(403);

    const ok = await call('PUT', `/api/admin/categories/${a.id}`, ad, { shortName: '  Welders  ', menuGroup: 'Trades', sortOrder: 7, isActive: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ shortName: 'Welders', menuGroup: 'Trades', sortOrder: 7 });

    expect((await call('PUT', `/api/admin/categories/${a.id}`, ad, { shortName: 'x'.repeat(25) })).status).toBe(400);
    expect((await call('PUT', `/api/admin/categories/${a.id}`, ad, { sortOrder: 1.5 })).status).toBe(400);
    expect((await call('PUT', `/api/admin/categories/${a.id}`, ad, { sortOrder: '3' })).status).toBe(400);
    expect((await call('PUT', `/api/admin/categories/${a.id}`, ad, { isActive: 'no' })).status).toBe(400);
    expect((await call('PUT', `/api/admin/categories/${a.id}`, ad, { menuGroup: '<b>x</b>' })).status).toBe(400);
    const cleared = await call('PUT', `/api/admin/categories/${a.id}`, ad, { shortName: '', menuGroup: null });
    expect(cleared.body).toMatchObject({ shortName: null, menuGroup: null, sortOrder: 7 }); // untouched fields stay

    const created = await call('POST', '/api/admin/categories', ad, { name: 'Boda Boda', slug: 'boda', shortName: 'Boda', sortOrder: 3 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ shortName: 'Boda', sortOrder: 3, isActive: true });
  });

  it('GET /admin/categories-structure lists everything incl. retired, with display fields and listing counts', async () => {
    const { a, b } = await seedTree();
    const ad = await admin(); const seller = await mkUser(prisma);
    await mkListing(prisma, seller.id, a.id);
    await prisma.category.update({ where: { id: b.id }, data: { isActive: false, shortName: 'Clean' } });
    expect((await call('GET', '/api/admin/categories-structure', await mkUser(prisma))).status).toBe(403);
    const res = await call('GET', '/api/admin/categories-structure', ad);
    expect(res.status).toBe(200);
    const bySlug = Object.fromEntries(res.body.categories.map((c: { slug: string }) => [c.slug, c]));
    expect(bySlug.cleaning).toMatchObject({ isActive: false, shortName: 'Clean', sortOrder: 0 });   // retired still listed for admins
    expect(bySlug.welding._count.listings).toBe(1);
    expect(bySlug.welding.parentId).toBe(bySlug.services.id);
  });

  it('PUT /admin/categories-structure is all-or-nothing and audited', async () => {
    const { a, b, c } = await seedTree();
    const ad = await admin();
    const good = await call('PUT', '/api/admin/categories-structure', ad, { items: [
      { id: a.id, sortOrder: 10, menuGroup: 'Trades' }, { id: b.id, sortOrder: 20, shortName: 'Clean' }, { id: c.id, isActive: false },
    ] });
    expect(good.status).toBe(200);
    expect(good.body.updated).toBe(3);
    expect(await prisma.category.findUnique({ where: { id: b.id } })).toMatchObject({ sortOrder: 20, shortName: 'Clean' });
    expect((await prisma.category.findUnique({ where: { id: c.id } }))!.isActive).toBe(false);
    expect(await prisma.adminAuditLog.count({ where: { action: 'CATEGORY_STRUCTURE_UPDATE' } })).toBe(1);

    const before = await prisma.category.findUnique({ where: { id: a.id } });
    const bad = await call('PUT', '/api/admin/categories-structure', ad, { items: [{ id: a.id, sortOrder: 99 }, { id: b.id, shortName: 'y'.repeat(30) }] });
    expect(bad.status).toBe(400);
    expect((await prisma.category.findUnique({ where: { id: a.id } }))!.sortOrder).toBe(before!.sortOrder); // nothing applied
    expect((await call('PUT', '/api/admin/categories-structure', ad, { items: [{ id: 'missing-id', sortOrder: 1 }] })).status).toBe(404);
    expect((await call('PUT', '/api/admin/categories-structure', ad, { items: [] })).status).toBe(400);
    expect((await call('PUT', '/api/admin/categories-structure', ad, { items: [{ id: a.id, sortOrder: 1 }, { id: a.id, sortOrder: 2 }] })).status).toBe(400);
    expect((await call('PUT', '/api/admin/categories-structure', ad, { items: Array.from({ length: 501 }, () => ({ id: a.id })) })).status).toBe(400);
  });

  it('merge: listings, subcategories and saved searches move; source deleted; audited', async () => {
    const { services, motors, a } = await seedTree();
    const ad = await admin(); const seller = await mkUser(prisma); const buyer = await mkUser(prisma);
    const l1 = await mkListing(prisma, seller.id, a.id, { title: 'Weld a gate' });
    const l2 = await mkListing(prisma, seller.id, services.id, { title: 'Any service' });
    await prisma.savedSearch.create({ data: { userId: buyer.id, name: 'welders', filters: { category: 'welding', priceMax: 5 }, categorySlug: 'welding', emailAlert: true } });

    // child -> another category
    const r1 = await call('POST', `/api/admin/categories/${a.id}/merge`, ad, { targetId: motors.id });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ movedListings: 1, movedChildren: 0, updatedAlerts: 1, sourceSlug: 'welding', targetSlug: 'motors' });
    expect(await prisma.category.findUnique({ where: { id: a.id } })).toBeNull();
    expect((await prisma.listing.findUnique({ where: { id: l1.id } }))!.categoryId).toBe(motors.id);
    const ss = await prisma.savedSearch.findFirstOrThrow({ where: { userId: buyer.id } });
    expect(ss.categorySlug).toBe('motors');
    expect(ss.filters).toMatchObject({ category: 'motors', priceMax: 5 });
    expect(await prisma.adminAuditLog.count({ where: { action: 'CATEGORY_MERGE' } })).toBe(1);

    // parent with subcategories -> another top-level: children follow
    const r2 = await call('POST', `/api/admin/categories/${services.id}/merge`, ad, { targetId: motors.id });
    expect(r2.status).toBe(200);
    expect(r2.body.movedChildren).toBe(2);
    expect((await prisma.listing.findUnique({ where: { id: l2.id } }))!.categoryId).toBe(motors.id);
    expect((await prisma.category.findMany({ where: { parentId: motors.id } })).map((x) => x.slug).sort()).toEqual(['cleaning', 'tailoring']);
  });

  it('merge refuses impossible merges and changes nothing', async () => {
    const { services, motors, b } = await seedTree();
    const ad = await admin(); const seller = await mkUser(prisma);
    const l = await mkListing(prisma, seller.id, b.id);
    expect((await call('POST', `/api/admin/categories/${b.id}/merge`, ad, { targetId: b.id })).status).toBe(400);            // itself
    expect((await call('POST', `/api/admin/categories/${b.id}/merge`, ad, {})).status).toBe(400);                            // no target
    expect((await call('POST', `/api/admin/categories/${b.id}/merge`, ad, { targetId: 'nope' })).status).toBe(404);          // unknown target
    expect((await call('POST', `/api/admin/categories/nope/merge`, ad, { targetId: motors.id })).status).toBe(404);          // unknown source
    expect((await call('POST', `/api/admin/categories/${services.id}/merge`, ad, { targetId: b.id })).status).toBe(400);     // target inside source
    const motorsKid = await prisma.category.create({ data: { name: 'Cars', slug: 'cars', parentId: motors.id } });
    expect((await call('POST', `/api/admin/categories/${services.id}/merge`, ad, { targetId: motorsKid.id })).status).toBe(400); // would make a 3rd level
    expect((await call('POST', `/api/admin/categories/${b.id}/merge`, await mkUser(prisma), { targetId: motors.id })).status).toBe(403);
    expect(await prisma.category.count()).toBe(6); // 5 seeded + the "cars" subcategory added above
    expect((await prisma.listing.findUnique({ where: { id: l.id } }))!.categoryId).toBe(b.id);
  });

  it('a retired category is not offered for new listings', async () => {
    const { b } = await seedTree();
    const ad = await admin();
    const body = { title: 'Cleaning offer', description: 'We clean', price: 50000, location: 'Kampala', country: 'UGANDA', categoryId: b.id,
      // Services ads now carry required details (round 7 ad fields), so a valid post must include them.
      customFieldValues: { priceBasis: 'Per job / project', serviceArea: 'Kampala, Wakiso' } };
    await prisma.category.update({ where: { id: b.id }, data: { isActive: false } });
    const refused = await call('POST', '/api/listings', ad, body);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/no longer available/i);
    await prisma.category.update({ where: { id: b.id }, data: { isActive: true } });
    const ok = await call('POST', '/api/listings', ad, body);
    expect([200, 201]).toContain(ok.status);
  });
});
