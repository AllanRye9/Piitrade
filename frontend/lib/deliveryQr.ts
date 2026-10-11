// QR payload for the delivery-confirmation code.
//
// The buyer's order page shows a QR; the seller scans it at handover instead of
// typing the 6 digits. The payload carries the ORDER NUMBER as well as the code
// so a seller who scans the wrong customer's QR gets a clear message instead of
// a confusing "wrong code" (which would also use up one of the 5 attempts).
// The server still verifies the code against the order — this file only
// shapes and reads the text.

const PREFIX = 'PTD1';

export function encodeDeliveryQr(orderNumber: string, code: string): string {
  return `${PREFIX}|${orderNumber}|${code}`;
}

export interface ParsedDeliveryQr {
  /** Present when the QR came from Piitrade; absent for a bare 6-digit code. */
  orderNumber?: string;
  code: string;
}

export function parseDeliveryQr(text: string): ParsedDeliveryQr | null {
  const t = (text || '').trim();
  const m = /^PTD1\|([^|\s]{1,64})\|(\d{6})$/.exec(t);
  if (m) return { orderNumber: m[1], code: m[2] };
  const bare = t.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(bare) ? { code: bare } : null;
}
