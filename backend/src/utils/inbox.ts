/**
 * inbox.ts — fast, paginated conversation list for the messages page.
 *
 * Old approach: fetch the user's latest 500 messages with sender, receiver and listing joined
 * (including every listing's full image array), then group them in JavaScript. That transfers far
 * more than the screen shows, gives no way to reach conversation #51, and computed unread counts
 * only over the 500-message window (so they were wrong for busy accounts).
 *
 * Now: ONE query picks the newest message per (counterpart, listing) pair with DISTINCT ON, joins
 * just the counterpart and the listing's first image, and counts unread per conversation in the
 * database. Pages are keyset-paginated on (last message time, id) so deep pages cost the same as
 * the first and no row is ever repeated. (A conversation that receives new mail while the client is
 * mid-paging moves ahead of the cursor, so later pages don't re-send it; it appears at the top when
 * the client refreshes page 1 — the normal pattern for a live inbox.)
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export const DEFAULT_PAGE = 30;
export const MAX_PAGE = 100;
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export interface InboxCursor { at: Date; id: string }

export function encodeCursor(c: InboxCursor): string {
  return Buffer.from(`${c.at.toISOString()}|${c.id}`, 'utf8').toString('base64url');
}

/** Returns null for anything that isn't a cursor we issued (never trust client input). */
export function decodeCursor(raw: unknown): InboxCursor | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return null;
  try {
    const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    const at = new Date(iso);
    if (!iso || !id || Number.isNaN(at.getTime()) || !/^[0-9a-fA-F-]{8,64}$/.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export function clampLimit(raw: unknown, def = DEFAULT_PAGE, max = MAX_PAGE): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

interface Row {
  id: string; content: string; createdAt: Date; listingId: string | null; senderId: string;
  cpId: string; cpName: string; cpAvatar: string | null; cpLastActiveAt: Date | null;
  listingTitle: string | null; listingImages: string[] | null; unread: number;
  listingOwnerId?: string | null;
}

export interface Conversation {
  counterpart: { id: string; name: string; avatar: string | null; online: boolean; lastActiveAt: Date | null };
  lastMessage: string;
  lastMessageId: string;
  lastMessageAt: string;
  lastMessageFromMe: boolean;
  listing: { id: string; title: string; images: string[] } | null;
  unreadCount: number;
}

export function toConversation(r: Row, userId: string, now = Date.now()): Conversation {
  return {
    counterpart: {
      id: r.cpId, name: r.cpName, avatar: r.cpAvatar,
      online: !!r.cpLastActiveAt && now - r.cpLastActiveAt.getTime() < ONLINE_WINDOW_MS,
      lastActiveAt: r.cpLastActiveAt,
    },
    lastMessage: r.content,
    lastMessageId: r.id,
    lastMessageAt: r.createdAt.toISOString(),
    lastMessageFromMe: r.senderId === userId,
    listing: r.listingId ? { id: r.listingId, title: r.listingTitle ?? '', images: r.listingImages ?? [] } : null,
    unreadCount: r.unread,
  };
}

export async function getConversations(
  userId: string,
  opts: { limit?: number; cursor?: InboxCursor | null; unreadOnly?: boolean; /** only threads about listings this user owns (a store's enquiries) */ sellerOnly?: boolean } = {},
): Promise<{ conversations: Conversation[]; nextCursor: string | null; hasMore: boolean }> {
  const limit = opts.limit ?? DEFAULT_PAGE;
  const after = opts.cursor
    ? Prisma.sql`AND (c."createdAt", c."id") < (${opts.cursor.at}, ${opts.cursor.id})`
    : Prisma.empty;
  const unreadOnly = opts.unreadOnly ? Prisma.sql`AND c."unread" > 0` : Prisma.empty;
  const sellerOnly = opts.sellerOnly ? Prisma.sql`AND c."listingOwnerId" = ${userId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT c.*
    FROM (
      SELECT l."id", l."content", l."createdAt", l."listingId", l."senderId",
             l."cp" AS "cpId", u."name" AS "cpName", u."avatar" AS "cpAvatar", u."lastActiveAt" AS "cpLastActiveAt",
             li."title" AS "listingTitle", li."images"[1:1] AS "listingImages", li."userId" AS "listingOwnerId",
             (SELECT COUNT(*)::int FROM "Message" x
               WHERE x."receiverId" = ${userId} AND x."senderId" = l."cp" AND x."read" = false
                 AND x."listingId" IS NOT DISTINCT FROM l."listingId") AS "unread"
      FROM (
        SELECT DISTINCT ON ("cp", m."listingId")
               m."id", m."content", m."createdAt", m."listingId", m."senderId",
               CASE WHEN m."senderId" = ${userId} THEN m."receiverId" ELSE m."senderId" END AS "cp"
        FROM "Message" m
        WHERE m."senderId" = ${userId} OR m."receiverId" = ${userId}
        ORDER BY "cp", m."listingId", m."createdAt" DESC, m."id" DESC
      ) l
      JOIN "User" u ON u."id" = l."cp"
      LEFT JOIN "Listing" li ON li."id" = l."listingId"
    ) c
    WHERE TRUE ${after} ${unreadOnly} ${sellerOnly}
    ORDER BY c."createdAt" DESC, c."id" DESC
    LIMIT ${limit + 1}`);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    conversations: page.map((r) => toConversation(r, userId)),
    nextCursor: hasMore && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
    hasMore,
  };
}

export async function getUnreadTotal(userId: string): Promise<number> {
  return prisma.message.count({ where: { receiverId: userId, read: false } });
}
