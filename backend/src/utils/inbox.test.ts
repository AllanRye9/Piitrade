import { describe, it, expect, vi } from 'vitest';

vi.mock('./prisma', () => ({ prisma: {} }));
import { encodeCursor, decodeCursor, clampLimit, toConversation, DEFAULT_PAGE, MAX_PAGE } from './inbox';

describe('cursor', () => {
  it('round-trips', () => {
    const c = { at: new Date('2026-10-17T10:00:00.123Z'), id: '3f1b2c4d-aaaa-bbbb-cccc-1234567890ab' };
    const back = decodeCursor(encodeCursor(c))!;
    expect(back.at.toISOString()).toBe(c.at.toISOString());
    expect(back.id).toBe(c.id);
  });
  it('rejects anything we did not issue', () => {
    for (const bad of [undefined, '', 'x'.repeat(500), 'not base64!', Buffer.from('garbage').toString('base64url'),
      Buffer.from("2026-10-17T10:00:00Z|1; DROP TABLE \"Message\"").toString('base64url'),
      Buffer.from('not-a-date|3f1b2c4d-aaaa').toString('base64url'), 42, {}]) {
      expect(decodeCursor(bad)).toBeNull();
    }
  });
});

describe('clampLimit', () => {
  it('defaults, floors and caps', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE);
    expect(clampLimit('abc')).toBe(DEFAULT_PAGE);
    expect(clampLimit('0')).toBe(DEFAULT_PAGE);
    expect(clampLimit('-5')).toBe(DEFAULT_PAGE);
    expect(clampLimit('20')).toBe(20);
    expect(clampLimit('100000')).toBe(MAX_PAGE);
  });
});

describe('toConversation', () => {
  const base = {
    id: 'm1', content: 'hello', createdAt: new Date('2026-10-17T10:00:00Z'), listingId: 'l1', senderId: 'them',
    cpId: 'them', cpName: 'Amina', cpAvatar: null, cpLastActiveAt: new Date('2026-10-17T09:59:30Z'),
    listingTitle: 'Toyota', listingImages: ['a.jpg'], unread: 2,
  };
  it('maps a row, marks online within 2 minutes and detects who sent last', () => {
    const c = toConversation(base, 'me', new Date('2026-10-17T10:00:00Z').getTime());
    expect(c).toMatchObject({ lastMessageFromMe: false, unreadCount: 2, listing: { id: 'l1', title: 'Toyota', images: ['a.jpg'] } });
    expect(c.counterpart.online).toBe(true);
    expect(toConversation({ ...base, senderId: 'me' }, 'me').lastMessageFromMe).toBe(true);
  });
  it('treats a general (no-listing) thread and an idle counterpart correctly', () => {
    const c = toConversation({ ...base, listingId: null, listingImages: null, cpLastActiveAt: new Date('2026-10-17T09:00:00Z') }, 'me', new Date('2026-10-17T10:00:00Z').getTime());
    expect(c.listing).toBeNull();
    expect(c.counterpart.online).toBe(false);
  });
});
