import { describe, it, expect } from 'vitest';
import { absoluteUrl, articleJsonLd, jsonLdString, organizationJsonLd, productJsonLd, toSnippet, websiteJsonLd, SITE_URL } from '@/lib/seo';

describe('seo helpers', () => {
  it('absoluteUrl makes paths absolute and leaves full URLs alone', () => {
    expect(absoluteUrl('/category/x')).toBe(`${SITE_URL}/category/x`);
    expect(absoluteUrl('category/x')).toBe(`${SITE_URL}/category/x`);
    expect(absoluteUrl('https://cdn.test/a.jpg')).toBe('https://cdn.test/a.jpg');
  });
  it('jsonLdString cannot close the script tag', () => {
    expect(jsonLdString({ a: '</script><b>' })).not.toContain('<');
  });
  it('toSnippet strips tags and cuts on a word boundary', () => {
    expect(toSnippet('<p>Hello   <b>world</b></p>', 50)).toBe('Hello world');
    const s = toSnippet('word '.repeat(100), 40);
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('…')).toBe(true);
  });
  it('WebSite exposes a search action pointing at /listings?q=', () => {
    const w = websiteJsonLd({ name: 'Piitrade' });
    expect(w.potentialAction.target.urlTemplate).toBe(`${SITE_URL}/listings?q={search_term_string}`);
    expect(organizationJsonLd({ name: 'Piitrade', logoUrl: '/uploads/logo.png' }).logo).toBe(`${SITE_URL}/uploads/logo.png`);
  });
  it('productJsonLd: absolute urls, offer, availability, condition', () => {
    const p: any = productJsonLd({ id: 'l1', title: 'Phone', description: '<p>Nice</p>', price: 240000, currency: 'UGX', condition: 'USED', status: 'ACTIVE', images: ['/uploads/a.jpg'], expiresAt: '2027-01-02T10:00:00Z' });
    expect(p['@type']).toBe('Product');
    expect(p.url).toBe(`${SITE_URL}/listings/l1`);
    expect(p.image).toEqual([`${SITE_URL}/uploads/a.jpg`]);
    expect(p.offers).toMatchObject({ price: 240000, priceCurrency: 'UGX', availability: 'https://schema.org/InStock', priceValidUntil: '2027-01-02' });
    expect(p.itemCondition).toBe('https://schema.org/UsedCondition');
    expect(productJsonLd({ id: 'x', status: 'SOLD', price: 1, title: 'T' })!.offers!.availability).toBe('https://schema.org/SoldOut');
  });
  it('productJsonLd: no title → null; no price → no offers (never an invalid Offer)', () => {
    expect(productJsonLd({ id: 'x' })).toBeNull();
    expect((productJsonLd({ id: 'x', title: 'T' }) as any).offers).toBeUndefined();
  });
  it('articleJsonLd carries dates, author and an absolute image', () => {
    const a: any = articleJsonLd({ slug: 's', title: 'T', image: '/uploads/i.jpg', author: 'Rye', published: '2026-01-01T00:00:00Z', publisherName: 'Piitrade' });
    expect(a.image[0]).toBe(`${SITE_URL}/uploads/i.jpg`);
    expect(a.mainEntityOfPage['@id']).toBe(`${SITE_URL}/blog/s`);
    expect(a.dateModified).toBe('2026-01-01T00:00:00Z');
  });
});
