// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import { runAlertStream } from '@/lib/alertStream';
import type { AlertEvent } from '@/lib/alerts';

const seed = JSON.parse(fs.readFileSync('/tmp/e2e_seed.json', 'utf8')) as { token: string; sellerId: string; landId: string };
const BASE = 'http://127.0.0.1:5055';
const psql = (sql: string) => spawnSync('psql', ['-h', 'localhost', '-U', 'pi', '-d', 'piitrade_e2e', '-tAc', sql], { env: { ...process.env, PGPASSWORD: 'pi' }, encoding: 'utf8' }).stdout.trim();
const until = async (pred: () => boolean, ms: number) => { const t = Date.now(); while (!pred()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 20)); } return true; };
const insertListing = (title: string, price: number) => psql(`INSERT INTO "Listing" ("id","title","description","price","location","userId","categoryId","status","updatedAt") VALUES (gen_random_uuid()::text,'${title}','d',${price},'Wakiso','${seed.sellerId}','${seed.landId}','ACTIVE',now())`);

describe('REAL server process + REAL client stream library', () => {
  it('a listing posted straight into the database reaches a connected browser within a moment, with the right payload; non-matches do not', async () => {
    const ctl = new AbortController();
    const got: AlertEvent[] = []; let connected = false;
    void runAlertStream({ url: `${BASE}/api/alerts/stream`, getToken: () => seed.token, onEvent: (e) => got.push(e), onStatus: (c) => { if (c) connected = true; }, signal: ctl.signal });
    expect(await until(() => connected, 8000)).toBe(true);

    insertListing('Too pricey plot', 9_000_000);
    insertListing('Bargain plot in Wakiso', 3_500_000);
    const t0 = Date.now();
    expect(await until(() => got.length >= 1, 5000)).toBe(true);
    const latency = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 1500));
    ctl.abort();

    expect(got).toHaveLength(1);                                   // the 9M plot did not alert
    expect(got[0]).toMatchObject({ title: 'New match: Bargain plot in Wakiso', alertName: 'Land under 5M', sound: true });
    expect(got[0].message).toContain('UGX 3,500,000');
    expect(got[0].href).toMatch(/^\/listings\/[0-9a-f-]{36}$/);
    console.log(`E2E latency from INSERT to browser event: ~${latency} ms`);
    expect(latency).toBeLessThan(3000);

    // the same alert is in the profile feed, unread, and recoverable by the poll fallback
    const feed = await (await fetch(`${BASE}/api/alerts/feed`, { headers: { Authorization: `Bearer ${seed.token}` } })).json() as { total: number; unread: number; items: { id: string }[] };
    expect(feed).toMatchObject({ total: 1, unread: 1 });
    expect(feed.items[0].id).toBe(got[0].id);
    const recent = await (await fetch(`${BASE}/api/alerts/recent?since=2000-01-01T00:00:00Z`, { headers: { Authorization: `Bearer ${seed.token}` } })).json() as { events: { id: string }[] };
    expect(recent.events.map((e) => e.id)).toEqual([got[0].id]);
    expect(psql(`SELECT count(*) FROM "ListingAlertDelivery"`)).toBe('1');
    expect(psql(`SELECT count(*) FROM "ListingAlertEvent" WHERE "processedAt" IS NULL`)).toBe('0');   // queue fully drained
  }, 30_000);
});
