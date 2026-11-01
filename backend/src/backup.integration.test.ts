import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser, mkCategory, mkListing } from './testing/integrationDb';

configureTestEnv();

describe.skipIf(!TEST_DB)('admin backup & restore (real database)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let svc: typeof import('./utils/backup/backupService');
  let dir: string;

  beforeAll(async () => {
    ({ prisma } = await loadDeps());
    svc = await import('./utils/backup/backupService');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-test-'));
  });
  afterAll(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  beforeEach(async () => { await resetDb(prisma); });

  async function takeBackup(gzip = true): Promise<{ file: string; lines: string[] }> {
    const lines: string[] = [];
    await svc.exportBackup(async (l) => { lines.push(l); }, { createdBy: 'test@local' });
    const file = path.join(dir, `b-${Math.random().toString(36).slice(2)}${gzip ? '.ndjson.gz' : '.ndjson'}`);
    const raw = Buffer.from(lines.join(''));
    fs.writeFileSync(file, gzip ? zlib.gzipSync(raw) : raw);
    return { file, lines };
  }

  /** A content fingerprint per table, so "identical after restore" is checked on every column of every row. */
  async function fingerprint(): Promise<Record<string, string>> {
    const schema = await svc.introspect(prisma);
    const out: Record<string, string> = {};
    for (const t of schema.tables) {
      const r = await prisma.$queryRawUnsafe<{ h: string }[]>(`SELECT COALESCE(md5(string_agg(x::text, '|' ORDER BY x::text)), 'empty') AS h FROM ${svc.q(t)} x`);
      out[t] = r[0].h;
    }
    return out;
  }

  async function seed() {
    const admin = await mkUser(prisma, { role: 'ADMIN' });
    const seller = await mkUser(prisma, { name: 'Zoë "quotes" \\ and\nnewline' });
    const root = await mkCategory(prisma, 'motors');
    const child = await mkCategory(prisma, 'cars', root.id);
    const grandchild = await mkCategory(prisma, 'suvs', child.id);
    const l1 = await mkListing(prisma, seller.id, child.id, { description: 'multi\nline\ttext — ünïcode 🚗', price: 12345.5 });
    const l2 = await mkListing(prisma, seller.id, grandchild.id);
    await prisma.favorite.create({ data: { userId: admin.id, listingId: l1.id } });
    await prisma.siteConfig.create({ data: { id: 'global', generalSettings: { siteName: 'Backed Up', nested: { a: [1, 2, { b: null }] } }, enabledCountries: ['UGANDA'] } });
    return { admin, seller, root, child, grandchild, l1, l2 };
  }

  it('writes a header, every table in dependency order, and an end marker', async () => {
    await seed();
    const { lines } = await takeBackup();
    const header = JSON.parse(lines[0]);
    expect(header).toMatchObject({ type: 'header', format: 'piitrade-backup', version: 1, createdBy: 'test@local' });
    const names: string[] = header.tables.map((t: { name: string }) => t.name);
    expect(names.indexOf('User')).toBeLessThan(names.indexOf('Listing'));
    expect(names.indexOf('Category')).toBeLessThan(names.indexOf('Listing'));
    expect(names.indexOf('Listing')).toBeLessThan(names.indexOf('Favorite'));
    expect(header.deferred.Category).toContain('parentId'); // self-reference is loaded in two passes
    expect(names).not.toContain('_prisma_migrations');
    const end = JSON.parse(lines[lines.length - 1]);
    expect(end.type).toBe('end');
    expect(end.rows).toBe(header.tables.reduce((a: number, t: { rowCount: number }) => a + t.rowCount, 0));
    for (const l of lines) expect(l.endsWith('\n') && !l.slice(0, -1).includes('\n')).toBe(true); // strictly one record per line
  });

  it('REPLACE restores an identical database (all columns, JSON, unicode, self-referencing categories)', async () => {
    await seed();
    const before = await fingerprint();
    const { file } = await takeBackup();

    // wreck the data: delete rows, change rows, add junk
    await prisma.favorite.deleteMany();
    await prisma.listing.deleteMany();
    await prisma.category.updateMany({ data: { parentId: null } });
    await prisma.user.updateMany({ data: { name: 'changed' } });
    await mkUser(prisma);
    expect(await fingerprint()).not.toEqual(before);

    const report = await svc.restoreBackup(file, { mode: 'replace', dryRun: false });
    expect(report.totals.skipped).toBe(0);
    expect(await fingerprint()).toEqual(before);

    const suvs = await prisma.category.findUniqueOrThrow({ where: { slug: 'suvs' } });
    const cars = await prisma.category.findUniqueOrThrow({ where: { slug: 'cars' } });
    expect(suvs.parentId).toBe(cars.id);
  });

  it('works with an uncompressed file too', async () => {
    await seed();
    const before = await fingerprint();
    const { file } = await takeBackup(false);
    await resetDb(prisma);
    await svc.restoreBackup(file, { mode: 'replace', dryRun: false });
    expect(await fingerprint()).toEqual(before);
  });

  it('MERGE adds what is missing and never overwrites what exists', async () => {
    const s = await seed();
    const { file } = await takeBackup();
    await prisma.listing.delete({ where: { id: s.l2.id } });                       // missing -> must come back
    await prisma.listing.update({ where: { id: s.l1.id }, data: { title: 'EDITED AFTER BACKUP' } }); // existing -> must stay
    const extra = await mkUser(prisma, { name: 'created after backup' });             // not in backup -> must stay

    const report = await svc.restoreBackup(file, { mode: 'merge', dryRun: false });
    expect(report.tables.find((t) => t.name === 'Listing')).toMatchObject({ rowsInFile: 2, inserted: 1, skipped: 1 });
    expect(await prisma.listing.findUnique({ where: { id: s.l2.id } })).not.toBeNull();
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: s.l1.id } })).title).toBe('EDITED AFTER BACKUP');
    expect(await prisma.user.findUnique({ where: { id: extra.id } })).not.toBeNull();
  });

  it('a dry run validates and reports but changes nothing', async () => {
    await seed();
    const { file } = await takeBackup();
    await prisma.favorite.deleteMany();
    await prisma.listing.deleteMany();
    const before = await fingerprint();
    const report = await svc.restoreBackup(file, { mode: 'replace', dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.tables.find((t) => t.name === 'Listing')).toMatchObject({ rowsInFile: 2, rowsNow: 0 });
    expect(await fingerprint()).toEqual(before);
  });

  it('refuses a truncated file and leaves the database untouched (atomic)', async () => {
    await seed();
    const { lines } = await takeBackup(false);
    const cut = path.join(dir, 'cut.ndjson');
    fs.writeFileSync(cut, lines.slice(0, lines.length - 3).join('')); // drops rows + end marker
    await prisma.favorite.deleteMany();
    const before = await fingerprint();
    await expect(svc.restoreBackup(cut, { mode: 'replace', dryRun: false })).rejects.toBeInstanceOf(svc.BackupFileError);
    expect(await fingerprint()).toEqual(before); // the TRUNCATE was rolled back
  });

  it('rejects files that are not backups, damaged gzip, and incomplete replace sets', async () => {
    const junk = path.join(dir, 'junk.json');
    fs.writeFileSync(junk, '{"hello":"world"}\n');
    await expect(svc.restoreBackup(junk, { mode: 'merge', dryRun: true })).rejects.toBeInstanceOf(svc.BackupFileError);

    const badGz = path.join(dir, 'bad.ndjson.gz');
    fs.writeFileSync(badGz, Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from('definitely not gzip data')]));
    await expect(svc.restoreBackup(badGz, { mode: 'merge', dryRun: true })).rejects.toBeInstanceOf(svc.BackupFileError);

    await seed();
    const { lines } = await takeBackup(false);
    const header = JSON.parse(lines[0]);
    header.tables = header.tables.filter((t: { name: string }) => t.name !== 'Favorite');
    const partial = path.join(dir, 'partial.ndjson');
    fs.writeFileSync(partial, [JSON.stringify(header) + '\n', ...lines.slice(1).filter((l) => !l.includes('"table":"Favorite"'))].join(''));
    await expect(svc.restoreBackup(partial, { mode: 'replace', dryRun: true })).rejects.toThrow(/complete backup/);
    await expect(svc.restoreBackup(partial, { mode: 'merge', dryRun: true })).resolves.toBeTruthy();
  });

  it('only one backup/restore job runs at a time', async () => {
    await seed();
    const slow = svc.exportBackup(() => new Promise((r) => setTimeout(r, 150)), { createdBy: null });
    await new Promise((r) => setTimeout(r, 30));
    await expect(svc.exportBackup(async () => undefined, { createdBy: null })).rejects.toBeInstanceOf(svc.BackupBusyError);
    await slow;
    await expect(svc.exportBackup(async () => undefined, { createdBy: null })).resolves.toBeTruthy();
  });

  it('keeps auto-increment counters ahead of restored ids (also for tables added by future migrations)', async () => {
    // No table in today's schema uses a serial column, so prove the behaviour with a throwaway one;
    // it is picked up automatically because the backup reads the catalog, not a fixed table list.
    await prisma.$executeRawUnsafe(`CREATE TABLE "bk_seq_probe" (id serial PRIMARY KEY, v text NOT NULL)`);
    try {
      await prisma.$executeRawUnsafe(`INSERT INTO "bk_seq_probe" (id, v) VALUES (7, 'a'), (42, 'b')`);
      const { file } = await takeBackup();
      await svc.restoreBackup(file, { mode: 'replace', dryRun: false });
      const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(`INSERT INTO "bk_seq_probe" (v) VALUES ('new') RETURNING id`);
      expect(rows[0].id).toBeGreaterThan(42);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "bk_seq_probe"`);
    }
  });
});
