// Shared SEO helpers: absolute URLs and schema.org JSON-LD builders.
// No client-only or server-only imports, so Server Components and client components can both use it.

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://piitrade.com').replace(/\/+$/, '');

/** Google rejects relative URLs in structured data and Open Graph tags; this makes any path absolute. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

/** JSON for an inline <script type="application/ld+json">; "<" is escaped so content can never close the tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** Plain-text snippet for descriptions: strips tags, collapses whitespace, cuts at a word boundary. */
export function toSnippet(text: string | null | undefined, max = 160): string {
  const clean = (text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(max / 2))).trimEnd()}…`;
}

export function organizationJsonLd(opts: { name: string; logoUrl?: string | null }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: opts.name,
    url: SITE_URL,
    ...(opts.logoUrl ? { logo: absoluteUrl(opts.logoUrl) } : {}),
  };
}

/** WebSite + SearchAction makes the site eligible for a Google sitelinks search box. */
export function websiteJsonLd(opts: { name: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: opts.name,
    url: SITE_URL,
    publisher: { '@id': `${SITE_URL}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/listings?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export interface ProductSource {
  id: string;
  title?: string;
  description?: string;
  price?: number;
  currency?: string;
  condition?: string;
  status?: string;
  images?: string[];
  expiresAt?: string | null;
}

/** Product rich result (price / availability in search). Returns null when there is not enough to be valid. */
export function productJsonLd(l: ProductSource, resolveImage: (u: string) => string = (u) => u) {
  if (!l.title) return null;
  const images = (l.images ?? []).filter(Boolean).slice(0, 6).map((u) => absoluteUrl(resolveImage(u)));
  const availability =
    l.status === 'ACTIVE' ? 'https://schema.org/InStock'
    : l.status === 'SOLD' ? 'https://schema.org/SoldOut'
    : l.status === 'EXPIRED' ? 'https://schema.org/Discontinued'
    : undefined;
  const hasPrice = typeof l.price === 'number' && Number.isFinite(l.price) && l.price >= 0;
  const validUntil = l.expiresAt && !Number.isNaN(new Date(l.expiresAt).getTime()) ? new Date(l.expiresAt).toISOString().slice(0, 10) : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: l.title,
    ...(l.description ? { description: toSnippet(l.description, 5000) } : {}),
    ...(images.length ? { image: images } : {}),
    url: absoluteUrl(`/listings/${l.id}`),
    ...(l.condition ? { itemCondition: l.condition === 'NEW' ? 'https://schema.org/NewCondition' : 'https://schema.org/UsedCondition' } : {}),
    ...(hasPrice ? {
      offers: {
        '@type': 'Offer',
        url: absoluteUrl(`/listings/${l.id}`),
        price: l.price,
        priceCurrency: l.currency || 'UGX',
        ...(availability ? { availability } : {}),
        ...(validUntil ? { priceValidUntil: validUntil } : {}),
      },
    } : {}),
  };
}

export function articleJsonLd(p: { slug: string; title: string; description?: string | null; image?: string | null; author?: string | null; published?: string | null; modified?: string | null; publisherName: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    mainEntityOfPage: { '@type': 'WebPage', '@id': absoluteUrl(`/blog/${p.slug}`) },
    headline: p.title.slice(0, 110),
    ...(p.description ? { description: toSnippet(p.description, 200) } : {}),
    ...(p.image ? { image: [absoluteUrl(p.image)] } : {}),
    ...(p.author ? { author: { '@type': 'Person', name: p.author } } : {}),
    ...(p.published ? { datePublished: p.published } : {}),
    dateModified: p.modified || p.published || undefined,
    publisher: { '@id': `${SITE_URL}/#organization`, '@type': 'Organization', name: p.publisherName },
  };
}
