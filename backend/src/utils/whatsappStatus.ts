/**
 * whatsappStatus.ts — applies Meta delivery receipts (from the webhook) to NotificationDelivery rows.
 *
 * A row is found by the message id Meta returned when the message was accepted (stored by
 * notificationDispatch.ts and routes/push.ts). Receipts are idempotent and order-safe
 * (see shouldApplyStatus): a retry from Meta or an out-of-order "sent" after "delivered" changes nothing.
 *
 * `status` keeps meaning "did Meta accept it": SENT stays SENT through delivered/read (the daily WhatsApp
 * cap counts SENT rows). Only an asynchronous failure flips it to FAILED. The receipt itself lives in
 * providerStatus / providerStatusAt.
 */
import { prisma } from './prisma';
import { logger } from './logger';
import { collapseStatuses, shouldApplyStatus, type ParsedStatus } from './whatsappWebhook';

export interface ApplyResult {
  /** Receipts whose message id belongs to one of our delivery rows. */
  matched: number;
  /** Rows actually changed. */
  updated: number;
  /** Receipts with no row (yet) — the id may not have been saved at the moment the receipt arrived. */
  unmatched: ParsedStatus[];
}

export function failureDetail(s: Pick<ParsedStatus, 'errorCode' | 'errorTitle'>): string {
  const code = s.errorCode !== null ? ` ${s.errorCode}` : '';
  const title = s.errorTitle ? `: ${s.errorTitle}` : '';
  return `WhatsApp reported a delivery failure${code}${title}`.slice(0, 300);
}

export async function applyWhatsAppStatuses(statuses: ParsedStatus[]): Promise<ApplyResult> {
  const list = collapseStatuses(statuses);
  const result: ApplyResult = { matched: 0, updated: 0, unmatched: [] };
  if (!list.length) return result;

  const rows = await prisma.notificationDelivery.findMany({
    where: { providerMessageId: { in: list.map((s) => s.messageId) } },
    select: { id: true, providerMessageId: true, providerStatus: true },
  });
  const byMessage = new Map(rows.map((r) => [r.providerMessageId, r]));

  for (const s of list) {
    const row = byMessage.get(s.messageId);
    if (!row) {
      result.unmatched.push(s);
      continue;
    }
    result.matched += 1;
    if (!shouldApplyStatus(row.providerStatus, s.status)) continue;

    // The extra providerStatus condition makes this a compare-and-set: if another receipt for the same
    // message landed meanwhile, this write matches nothing and is simply skipped.
    const r = await prisma.notificationDelivery.updateMany({
      where: { id: row.id, providerStatus: row.providerStatus },
      data: {
        providerStatus: s.status,
        providerStatusAt: s.at ?? new Date(),
        ...(s.status === 'failed' ? { status: 'FAILED', detail: failureDetail(s) } : {}),
      },
    });
    result.updated += r.count;
    if (s.status === 'failed' && r.count > 0) logger.warn(`WhatsApp message failed after being accepted (${failureDetail(s)})`);
  }
  return result;
}
