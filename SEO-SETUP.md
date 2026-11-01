# SEO setup — what to do after deploying

1. Frontend env (Railway, build-time): `NEXT_PUBLIC_SITE_URL=https://piitrade.com` (already the default).
2. Search Console → Settings → Ownership verification → "HTML tag": copy the `content` value and set
   `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=<that value>` on the frontend, rebuild, then click Verify.
   (A Domain property verified by DNS needs nothing here.)
3. Search Console → Sitemaps → submit `https://piitrade.com/sitemap.xml`.
4. Spot-check one listing, one category and the homepage in the Rich Results Test; use "Validate fix" on the Breadcrumbs issue.
