import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://piitrade.com';

export default function robots(): MetadataRoute.Robots {
  const commonDisallowRules = [
    '/admin/',
    '/dashboard/',
    '/api/',
    '/auth/',
    '/checkout/',
    '/cart/',
    '/profile/',
    '/cdn-cgi/',
  ];

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          ...commonDisallowRules,
          '/notifications/',
          '/profile/edit',
          '/listings/create',
          '/listings/*/edit',
        ],
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: commonDisallowRules,
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
