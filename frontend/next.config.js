/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  output: 'standalone',
  // Without this, Next.js sees the root-level package-lock.json (from the
  // monorepo's root package.json — see ../package.json) alongside this
  // directory's own package-lock.json and guesses at the "workspace root",
  // printing a noisy "multiple lockfiles" warning on every dev/build/lint
  // run (this is the exact warning that showed up in the original Railway
  // deploy log during earlier troubleshooting). Pinning it explicitly to
  // this directory removes the guesswork and the warning — it's cosmetic
  // either way (the build still succeeds without this), but clean deploy
  // logs make real errors much easier to spot.
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**.railway.app' },
      { protocol: 'https', hostname: '**.onrender.com' },
      { protocol: 'https', hostname: '**.up.railway.app' },
      // Catch-all: allow any HTTPS host (API proxy, CDN, custom domains)
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    minimumCacheTTL: 86400,
  },
  // Cross-browser: ensure proper HTTP security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
