import { describe, it, expect, vi } from 'vitest';

vi.mock('./prisma', () => ({ prisma: {} }));
import { severityFor, toQueueAlert, parseSince, QUEUES, OVERDUE_AFTER_HOURS } from './adminAlerts';

const now = new Date('2026-10-17T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe('severityFor', () => {
  it('is silent for an empty queue', () => expect(severityFor(0, null, now)).toBe('none'));
  it('escalates to critical once the oldest item is overdue', () => {
    expect(severityFor(1, hoursAgo(OVERDUE_AFTER_HOURS + 1), now)).toBe('critical');
    expect(severityFor(1, hoursAgo(OVERDUE_AFTER_HOURS - 1), now)).toBe('info');
  });
  it('warns on a large fresh backlog', () => expect(severityFor(25, hoursAgo(1), now)).toBe('warning'));
});

describe('toQueueAlert', () => {
  const def = { key: 'listings', label: 'Listings', href: '/admin/listings' };
  it('pulses only when something arrived since the caller last looked', () => {
    expect(toQueueAlert(def, { count: 4, newSince: 2, oldest: hoursAgo(1) }, now).pulse).toBe(true);
    expect(toQueueAlert(def, { count: 4, newSince: 0, oldest: hoursAgo(1) }, now).pulse).toBe(false);
  });
  it('reports overdue and the oldest timestamp only when there is something waiting', () => {
    const a = toQueueAlert(def, { count: 3, newSince: 0, oldest: hoursAgo(30) }, now);
    expect(a).toMatchObject({ overdue: true, severity: 'critical', oldestAt: hoursAgo(30).toISOString() });
    const empty = toQueueAlert(def, { count: 0, newSince: 0, oldest: null }, now);
    expect(empty).toMatchObject({ overdue: false, oldestAt: null, severity: 'none', pulse: false });
  });
});

describe('parseSince', () => {
  it('accepts a recent ISO timestamp', () => expect(parseSince(hoursAgo(2).toISOString(), now)?.getTime()).toBe(hoursAgo(2).getTime()));
  it('ignores junk, non-strings and future timestamps', () => {
    for (const v of [undefined, '', 'nope', 12345, {}, new Date(now.getTime() + 3_600_000).toISOString()]) expect(parseSince(v, now)).toBeNull();
  });
  it('clamps an ancient timestamp to 31 days so the query stays bounded', () => {
    const d = parseSince('2020-01-01T00:00:00Z', now)!;
    expect(now.getTime() - d.getTime()).toBe(31 * 24 * 3_600_000);
  });
});

describe('QUEUES', () => {
  it('has unique keys and links to admin pages', () => {
    expect(new Set(QUEUES.map((q) => q.key)).size).toBe(QUEUES.length);
    for (const q of QUEUES) expect(q.href).toMatch(/^\/admin\//);
  });
});
