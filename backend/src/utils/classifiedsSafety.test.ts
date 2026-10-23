import { describe, it, expect } from 'vitest';
import { publicSocialLinks, maskUserContact, maskUserContactKeepSocial } from './contactPrivacy';
import { ownerMayChangeStatus } from './listingStatus';
import { checkText, parsePrice, parseCoordinate, parseFutureDate, checkJsonBlob, sanitizeImageUrls } from './listingInput';

describe('contactPrivacy', () => {
  it('removes WhatsApp/phone keys but keeps social profiles', () => {
    expect(publicSocialLinks({ whatsapp: '+256700', WhatsApp: 'x', phone: '1', facebook: 'fb', instagram: 'ig' }))
      .toEqual({ facebook: 'fb', instagram: 'ig' });
  });
  it('tolerates null / non-object social links', () => {
    expect(publicSocialLinks(null)).toBeNull();
    expect(publicSocialLinks('x')).toBe('x');
  });
  it('maskUserContact blanks phone and socialLinks entirely', () => {
    expect(maskUserContact({ id: 1, phone: '+256', socialLinks: { whatsapp: '1' } } as never))
      .toMatchObject({ id: 1, phone: null, socialLinks: null });
    expect(maskUserContact(null)).toBeNull();
  });
  it('maskUserContactKeepSocial keeps non-contact links', () => {
    expect(maskUserContactKeepSocial({ socialLinks: { whatsapp: '1', facebook: 'f' } })).toEqual({ socialLinks: { facebook: 'f' } });
  });
});

describe('ownerMayChangeStatus', () => {
  it('an owner cannot undo a moderator removal, but can un-hide their own', () => {
    expect(ownerMayChangeStatus('HIDDEN', 'ACTIVE', true)).toBe(false);
    expect(ownerMayChangeStatus('HIDDEN', 'ACTIVE', false)).toBe(true);
  });
  it('blocks every route around moderation', () => {
    expect(ownerMayChangeStatus('PENDING', 'ACTIVE')).toBe(false);
    expect(ownerMayChangeStatus('REJECTED', 'ACTIVE')).toBe(false);
    expect(ownerMayChangeStatus('EXPIRED', 'ACTIVE')).toBe(false);
    expect(ownerMayChangeStatus('PENDING', 'HIDDEN')).toBe(false);
  });
  it('allows normal seller actions', () => {
    expect(ownerMayChangeStatus('ACTIVE', 'SOLD')).toBe(true);
    expect(ownerMayChangeStatus('ACTIVE', 'HIDDEN')).toBe(true);
    expect(ownerMayChangeStatus('HIDDEN', 'ACTIVE')).toBe(true);
    expect(ownerMayChangeStatus('SOLD', 'ACTIVE')).toBe(true);
  });
  it('lets a rejected listing be resubmitted for review, never published', () => {
    expect(ownerMayChangeStatus('REJECTED', 'PENDING')).toBe(true);
  });
  it('treats unchanged status as a no-op and unknown values as forbidden', () => {
    expect(ownerMayChangeStatus('PENDING', 'PENDING')).toBe(true);
    expect(ownerMayChangeStatus('ACTIVE', 'DELETED')).toBe(false);
    expect(ownerMayChangeStatus('NOPE', 'ACTIVE')).toBe(false);
  });
});

describe('listingInput', () => {
  it('parsePrice rejects NaN, Infinity, negatives and absurd values', () => {
    for (const bad of ['abc', 'Infinity', '1e999', -1, NaN, {}, undefined, 1e15]) expect(parsePrice(bad).ok).toBe(false);
    expect(parsePrice('150000')).toEqual({ ok: true, value: 150000 });
    expect(parsePrice(0).ok).toBe(true);
  });
  it('checkText enforces type, required and length', () => {
    expect(checkText('Title', 'ok', 5, true).ok).toBe(true);
    expect(checkText('Title', '  ', 5, true).ok).toBe(false);
    expect(checkText('Title', 'toolong', 5).ok).toBe(false);
    expect(checkText('Title', { a: 1 }, 5).ok).toBe(false);
    expect(checkText('Title', undefined, 5).ok).toBe(true);
  });
  it('coordinates and dates', () => {
    expect(parseCoordinate('0.31', 'lat').ok).toBe(true);
    expect(parseCoordinate(91, 'lat').ok).toBe(false);
    expect(parseCoordinate('x', 'lng').ok).toBe(false);
    expect(parseFutureDate('2027-01-01').ok).toBe(true);
    expect(parseFutureDate('not a date').ok).toBe(false);
  });
  it('JSON blobs must be small objects', () => {
    expect(checkJsonBlob('d', { a: 1 }).ok).toBe(true);
    expect(checkJsonBlob('d', 'str').ok).toBe(false);
    expect(checkJsonBlob('d', { big: 'x'.repeat(30_000) }).ok).toBe(false);
  });
  it('image URLs must be bounded http(s) or site-relative', () => {
    expect(sanitizeImageUrls(['https://cdn.x/a.jpg', '/api/images/a.jpg'], 5).ok).toBe(true);
    expect(sanitizeImageUrls(['javascript:alert(1)'], 5).ok).toBe(false);
    expect(sanitizeImageUrls(['//evil.com/x.jpg'], 5).ok).toBe(false);
    expect(sanitizeImageUrls(['https://a/1', 'https://a/2'], 1).ok).toBe(false);
    expect(sanitizeImageUrls('x', 5).ok).toBe(false);
  });
});
