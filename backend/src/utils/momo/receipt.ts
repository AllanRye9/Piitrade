/**
 * momo/receipt.ts — digital receipts for completed mobile-money payments.
 *
 * A receipt exists once a payment is SUCCESSFUL *and* access has been granted (provisionedAt set),
 * i.e. exactly when the payer sees "Payment received". Issuing is idempotent and race-safe: a
 * conditional update stamps a unique tracking code once, however many callers (callback, polling,
 * reconciler, admin resolve) arrive together.
 *
 *  - Tracking code: `PTR-XXXX-XXXX-XXXX` (sandbox payments: `TST-…`), 12 characters from an alphabet
 *    without look-alikes (no 0/O/1/I/L), drawn with crypto.randomInt; unique in the database.
 *  - PDF: rebuilt on demand from the payment row (never stored), so it always matches the ledger.
 *  - Email: sent once with the PDF attached; failures are retried by the reconciler (max attempts),
 *    and never affect the payment itself. A copy always remains under Profile → Payment receipts.
 *  - Sandbox payments produce clearly marked TEST receipts so they can never pass as real ones.
 */
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { PaymentTransaction, PaymentPurpose } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { createError } from '../../middleware/errorHandler';
import { sendPaymentReceiptEmail } from '../email';
import { maskMsisdn } from './rules';
import { generateReceiptNumber, normalizeReceiptCode, formatMoney, RECEIPT_CODE_RE } from './receiptCode';

export { generateReceiptNumber, normalizeReceiptCode, formatMoney, RECEIPT_CODE_RE };

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://piitrade.com').replace(/\/+$/, '');

/** Stop emailing a receipt after this many failed tries (the PDF stays downloadable from the profile). */
export const RECEIPT_EMAIL_MAX_ATTEMPTS = 5;

const PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  SUBSCRIPTION: 'Seller subscription',
  SUBSCRIPTION_RENEWAL: 'Subscription renewal',
  SUBSCRIPTION_UPGRADE: 'Subscription upgrade',
  STORE_RENTAL: 'Merchant rental',
  STORE_RENEWAL: 'Merchant rental renewal',
  LISTING_TIER: 'Listing visibility upgrade',
  CV_DOWNLOAD: 'CV download',
};

export function isReceiptEligible(row: Pick<PaymentTransaction, 'status' | 'provisionedAt'>): boolean {
  return row.status === 'SUCCESSFUL' && row.provisionedAt !== null;
}

function itemLabel(row: PaymentTransaction): string {
  const meta = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
  const label = typeof meta.label === 'string' && meta.label.trim() ? meta.label.trim().slice(0, 120) : '';
  return label || PURPOSE_LABEL[row.purpose];
}

const dateFmt = (d: Date) =>
  d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }) + ' (EAT)';

// ─── Issuing ────────────────────────────────────────────────────────────────

/**
 * Stamp the receipt tracking code on an eligible payment (once) and, optionally, email it.
 * Never throws for email problems. Returns the fresh row, or null when the payment is not eligible.
 */
export async function issueReceipt(paymentId: string, opts: { sendEmail?: boolean; now?: Date } = {}): Promise<PaymentTransaction | null> {
  const now = opts.now ?? new Date();
  let row = await prisma.paymentTransaction.findUnique({ where: { id: paymentId } });
  if (!row || !isReceiptEligible(row)) return null;

  if (!row.receiptNumber) {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await prisma.paymentTransaction.updateMany({
          where: { id: row.id, receiptNumber: null, status: 'SUCCESSFUL', provisionedAt: { not: null } },
          data: { receiptNumber: generateReceiptNumber(row.environment), receiptIssuedAt: now },
        });
        break;
      } catch (err) {
        if ((err as { code?: string })?.code === 'P2002') continue; // astronomically unlikely code clash: draw another
        throw err;
      }
    }
    row = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
  }

  if (opts.sendEmail !== false && row.receiptNumber && !row.receiptEmailedAt) {
    await deliverReceiptEmail(row).catch((err) => logger.error(`MoMo: receipt email crashed for ${row!.id}`, err));
    row = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
  }
  return row;
}

async function deliverReceiptEmail(row: PaymentTransaction): Promise<void> {
  if (!row.receiptNumber || row.receiptEmailedAt || row.receiptEmailAttempts >= RECEIPT_EMAIL_MAX_ATTEMPTS) return;
  const claim = await prisma.paymentTransaction.updateMany({
    where: { id: row.id, receiptEmailedAt: null, receiptEmailAttempts: row.receiptEmailAttempts },
    data: { receiptEmailAttempts: { increment: 1 } },
  });
  if (claim.count !== 1) return; // another worker is sending it

  const user = row.userId ? await prisma.user.findUnique({ where: { id: row.userId }, select: { email: true, name: true } }) : null;
  if (!user?.email) {
    // Guest payment (e.g. a CV download): there is no address to send to. Stop retrying.
    await prisma.paymentTransaction.updateMany({ where: { id: row.id }, data: { receiptEmailAttempts: RECEIPT_EMAIL_MAX_ATTEMPTS } });
    return;
  }
  try {
    const pdf = await renderReceiptPdf(row, { name: user.name, email: user.email });
    await sendPaymentReceiptEmail(user.email, user.name, {
      receiptNumber: row.receiptNumber,
      itemLabel: itemLabel(row),
      amountText: formatMoney(Number(row.amount), row.currency),
      paidAt: row.lastCheckedAt ?? row.receiptIssuedAt ?? row.updatedAt,
      isTest: row.environment !== 'production',
    }, pdf);
    await prisma.paymentTransaction.updateMany({ where: { id: row.id, receiptEmailedAt: null }, data: { receiptEmailedAt: new Date() } });
  } catch (err) {
    logger.warn(`MoMo: receipt email for ${row.receiptNumber} failed (attempt ${row.receiptEmailAttempts + 1}/${RECEIPT_EMAIL_MAX_ATTEMPTS}): ${(err as Error).message}`);
  }
}

/** Reconciler hook: retry receipts whose email has not gone out yet (and issue any that were missed). */
export async function retryPendingReceipts(batch = 25): Promise<number> {
  const missing = await prisma.paymentTransaction.findMany({
    where: { status: 'SUCCESSFUL', provisionedAt: { not: null }, receiptNumber: null }, orderBy: { updatedAt: 'asc' }, take: batch,
  });
  const unsent = await prisma.paymentTransaction.findMany({
    where: { receiptNumber: { not: null }, receiptEmailedAt: null, receiptEmailAttempts: { lt: RECEIPT_EMAIL_MAX_ATTEMPTS }, userId: { not: null } },
    orderBy: { updatedAt: 'asc' }, take: batch,
  });
  let n = 0;
  for (const r of [...missing, ...unsent]) {
    await issueReceipt(r.id).catch((err) => logger.error(`MoMo: receipt retry failed for ${r.id}`, err));
    n++;
  }
  return n;
}

// ─── Reading ────────────────────────────────────────────────────────────────

export interface ReceiptView {
  paymentId: string;
  receiptNumber: string;
  item: string;
  amount: number;
  currency: string;
  issuedAt: Date;
  emailed: boolean;
  isTest: boolean;
}

function toReceiptView(row: PaymentTransaction): ReceiptView {
  return {
    paymentId: row.id,
    receiptNumber: row.receiptNumber as string,
    item: itemLabel(row),
    amount: Number(row.amount),
    currency: row.currency,
    issuedAt: row.receiptIssuedAt ?? row.updatedAt,
    emailed: row.receiptEmailedAt !== null,
    isTest: row.environment !== 'production',
  };
}

/** Everything the signed-in user has paid for, newest first. Older payments get their receipt on first view (no email). */
export async function listReceiptsForUser(userId: string, take = 100): Promise<ReceiptView[]> {
  const rows = await prisma.paymentTransaction.findMany({
    where: { userId, status: 'SUCCESSFUL', provisionedAt: { not: null } }, orderBy: { createdAt: 'desc' }, take,
  });
  const out: ReceiptView[] = [];
  for (const r of rows) {
    const full = r.receiptNumber ? r : await issueReceipt(r.id, { sendEmail: false });
    if (full?.receiptNumber) out.push(toReceiptView(full));
  }
  return out;
}

export async function getReceiptPdfForActor(
  paymentId: string, actor: { userId: string | null; role?: string | null },
): Promise<{ filename: string; pdf: Buffer }> {
  let row = await prisma.paymentTransaction.findUnique({ where: { id: paymentId } });
  if (!row) throw createError('Receipt not found', 404);
  const allowed = actor.role === 'ADMIN' || (actor.userId !== null && row.userId === actor.userId);
  if (!allowed) throw createError('Receipt not found', 404); // same answer for "not yours" and "does not exist"
  if (!isReceiptEligible(row)) throw createError('A receipt is available once the payment has completed.', 409);
  if (!row.receiptNumber) {
    const issued = await issueReceipt(row.id, { sendEmail: false });
    if (!issued?.receiptNumber) throw createError('Receipt is not ready yet. Please try again in a moment.', 409);
    row = issued;
  }
  const user = row.userId ? await prisma.user.findUnique({ where: { id: row.userId }, select: { name: true, email: true } }) : null;
  const pdf = await renderReceiptPdf(row, user);
  return { filename: `Piitrade-receipt-${row.receiptNumber}.pdf`, pdf };
}

/** Re-send the email for a receipt (the payer pressed "Email me this receipt"). Returns false when the address is missing. */
export async function resendReceiptEmail(paymentId: string, userId: string): Promise<boolean> {
  const row = await prisma.paymentTransaction.findUnique({ where: { id: paymentId } });
  if (!row || row.userId !== userId || !isReceiptEligible(row)) throw createError('Receipt not found', 404);
  const issued = row.receiptNumber ? row : await issueReceipt(row.id, { sendEmail: false });
  if (!issued?.receiptNumber) throw createError('Receipt is not ready yet. Please try again in a moment.', 409);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!user?.email) return false;
  const pdf = await renderReceiptPdf(issued, user);
  await sendPaymentReceiptEmail(user.email, user.name, {
    receiptNumber: issued.receiptNumber!, itemLabel: itemLabel(issued), amountText: formatMoney(Number(issued.amount), issued.currency),
    paidAt: issued.lastCheckedAt ?? issued.receiptIssuedAt ?? issued.updatedAt, isTest: issued.environment !== 'production',
  }, pdf);
  await prisma.paymentTransaction.updateMany({ where: { id: issued.id }, data: { receiptEmailedAt: new Date() } });
  return true;
}

/** Public check of a tracking code. Exposes only what is needed to confirm a receipt is genuine (no names, no phone). */
export async function verifyReceiptCode(raw: unknown): Promise<{ valid: false } | {
  valid: true; receiptNumber: string; item: string; amount: number; currency: string; issuedAt: Date; isTest: boolean; status: 'PAID';
}> {
  const code = normalizeReceiptCode(raw);
  if (!code) return { valid: false };
  const row = await prisma.paymentTransaction.findUnique({ where: { receiptNumber: code } });
  if (!row || !isReceiptEligible(row)) return { valid: false };
  return {
    valid: true, receiptNumber: code, item: itemLabel(row), amount: Number(row.amount), currency: row.currency,
    issuedAt: row.receiptIssuedAt ?? row.updatedAt, isTest: row.environment !== 'production', status: 'PAID',
  };
}

// ─── PDF ────────────────────────────────────────────────────────────────────

const ORANGE = '#F55906';
const INK = '#111827';
const MUTED = '#6B7280';
const LINE = '#E5E7EB';

export function renderReceiptPdf(row: PaymentTransaction, payer: { name: string; email: string } | null): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    if (!row.receiptNumber) return reject(new Error('Payment has no receipt number'));
    const isTest = row.environment !== 'production';
    const doc = new PDFDocument({
      size: 'A4', margin: 0,
      info: { Title: `Piitrade receipt ${row.receiptNumber}`, Author: 'Piitrade', Subject: 'Payment receipt', Keywords: row.receiptNumber },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const L = 48;
    const R = W - 48;

    // Header band
    doc.rect(0, 0, W, 96).fill(ORANGE);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(26).text('Piitrade', L, 30, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).text('SHOP SMART. SHOP TRUSTED.', L, 62, { lineBreak: false, characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(15).text('PAYMENT RECEIPT', L, 38, { width: R - L, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(10).text(dateFmt(row.receiptIssuedAt ?? new Date()), L, 62, { width: R - L, align: 'right', lineBreak: false });

    if (isTest) {
      // Light diagonal watermark so a sandbox receipt can never be mistaken for a real one.
      doc.save();
      doc.rotate(-30, { origin: [W / 2, 430] });
      doc.fillColor('#F3F4F6').font('Helvetica-Bold').fontSize(64).text('TEST RECEIPT', 0, 400, { width: W, align: 'center', lineBreak: false });
      doc.restore();
    }

    // Tracking code box
    let y = 130;
    doc.roundedRect(L, y, R - L, 78, 8).lineWidth(1.2).strokeColor(ORANGE).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('RECEIPT TRACKING CODE', L + 16, y + 14, { lineBreak: false, characterSpacing: 1 });
    doc.fillColor(INK).font('Courier-Bold').fontSize(26).text(row.receiptNumber, L + 16, y + 32, { lineBreak: false, characterSpacing: 1.5 });
    doc.roundedRect(R - 86, y + 24, 70, 28, 14).fill('#DCFCE7');
    doc.fillColor('#15803D').font('Helvetica-Bold').fontSize(13).text('PAID', R - 86, y + 31, { width: 70, align: 'center', lineBreak: false });

    if (isTest) {
      y += 90;
      doc.roundedRect(L, y, R - L, 26, 6).fill('#FEF3C7');
      doc.fillColor('#92400E').font('Helvetica-Bold').fontSize(10).text('TEST PAYMENT (sandbox): no real money was charged. This is not a valid proof of payment.', L + 12, y + 8, { width: R - L - 24, lineBreak: false });
      y += 26;
    } else {
      y += 78;
    }

    // Details
    y += 30;
    const paidAt = row.lastCheckedAt ?? row.receiptIssuedAt ?? row.updatedAt;
    const rows: Array<[string, string]> = [
      ['Description', itemLabel(row)],
      ['Paid by', payer?.name || 'Piitrade customer'],
      ...(payer?.email ? ([['Email', payer.email]] as Array<[string, string]>) : []),
      ['Mobile money number', maskMsisdn(row.msisdn)],
      ['Payment method', 'MTN Mobile Money'],
      ['Date and time paid', dateFmt(paidAt)],
      ...(row.financialTransactionId ? ([['MTN transaction ID', row.financialTransactionId]] as Array<[string, string]>) : []),
      ['Payment reference', row.referenceId],
    ];
    for (const [label, value] of rows) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(label, L, y, { width: 150, lineBreak: false });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(value, L + 160, y, { width: R - L - 160 });
      y = Math.max(y + 24, doc.y + 8);
      doc.moveTo(L, y - 6).lineTo(R, y - 6).lineWidth(0.5).strokeColor(LINE).stroke();
    }

    // Total
    y += 14;
    doc.roundedRect(L, y, R - L, 64, 8).fill('#FFF7ED');
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('TOTAL PAID', L + 18, y + 14, { lineBreak: false, characterSpacing: 1 });
    doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(26).text(formatMoney(Number(row.amount), row.currency), L + 18, y + 28, { width: R - L - 36, align: 'left', lineBreak: false });

    // Footer
    const fy = doc.page.height - 120;
    doc.moveTo(L, fy).lineTo(R, fy).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Verify this receipt', L, fy + 14, { lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(`Enter the tracking code at ${FRONTEND_URL}/receipts/verify  (or open ${FRONTEND_URL}/receipts/verify?code=${row.receiptNumber})`, L, fy + 30, { width: R - L });
    doc.text('This receipt is computer-generated and valid without a signature. A copy is kept under Profile > Payment receipts.', L, fy + 52, { width: R - L });
    doc.text('Questions? support@piitrade.com. Please quote the tracking code.', L, fy + 74, { width: R - L });

    doc.end();
  });
}

