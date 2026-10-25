import { describe, it, expect } from 'vitest';
import { generateReceiptNumber, normalizeReceiptCode, RECEIPT_CODE_RE, formatMoney } from './receiptCode';

describe('receipt tracking codes', () => {
  it('has the PTR-XXXX-XXXX-XXXX shape (TST- for sandbox) with no look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateReceiptNumber('production')).toMatch(/^PTR-/);
      expect(generateReceiptNumber('sandbox')).toMatch(/^TST-/);
      expect(generateReceiptNumber('production')).toMatch(RECEIPT_CODE_RE);
    }
    const sample = Array.from({ length: 300 }, () => generateReceiptNumber('production').slice(4)).join('');
    expect(sample).not.toMatch(/[01OIL]/);
  });
  it('does not repeat in a large sample', () => {
    const set = new Set(Array.from({ length: 20000 }, () => generateReceiptNumber('production')));
    expect(set.size).toBe(20000);
  });
  it('normalises what people type', () => {
    expect(normalizeReceiptCode('ptr 7k2m 9qxa 4d8h')).toBe('PTR-7K2M-9QXA-4D8H');
    expect(normalizeReceiptCode('PTR7K2M9QXA4D8H')).toBe('PTR-7K2M-9QXA-4D8H');
    expect(normalizeReceiptCode('PTR-7K2M-9QXA')).toBeNull();
    expect(normalizeReceiptCode('PTR-0K2M-9QXA-4D8H')).toBeNull(); // 0 is never issued
    expect(normalizeReceiptCode(42)).toBeNull();
  });
  it('formats money as whole shillings', () => {
    expect(formatMoney(25000, 'UGX')).toBe('UGX 25,000');
    expect(formatMoney(1234567.4, 'UGX')).toBe('UGX 1,234,567');
  });
});
