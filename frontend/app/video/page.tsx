import type { Metadata } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://3relite.com';
const VIDEO_URL = `${BASE_URL}/logo.mp4`;
const PAGE_URL = `${BASE_URL}/video`;

export const metadata: Metadata = {
  title: '3R-Elite – Marketplace Promo Video',
  description:
    'Watch the 3R-Elite marketplace promo video. Buy and sell electronics, vehicles, fashion, real estate and more across UAE, Uganda, Kenya and China.',
  alternates: { canonical: PAGE_URL },
  openGraph: {
    type: 'video.other',
    url: PAGE_URL,
    title: '3R-Elite – Marketplace Promo Video',
    description:
      'Watch the 3R-Elite marketplace promo video. Buy and sell in UAE, Uganda, Kenya and China.',
    videos: [{ url: VIDEO_URL, type: 'video/mp4' }],
    siteName: '3R-Elite Marketplace',
  },
  twitter: {
    card: 'player',
    title: '3R-Elite – Marketplace Promo Video',
    description:
      'Watch the 3R-Elite marketplace promo video.',
    players: [{ playerUrl: PAGE_URL, streamUrl: VIDEO_URL, width: 1280, height: 720 }],
  },
};

const videoJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'VideoObject',
  name: '3R-Elite Marketplace Promo',
  description:
    'Promotional video for 3R-Elite — the trusted marketplace for UAE, Uganda, Kenya and China. Discover millions of listings across electronics, fashion, vehicles, real estate and more.',
  contentUrl: VIDEO_URL,
  embedUrl: PAGE_URL,
  uploadDate: '2024-01-01T00:00:00+00:00',
  publisher: {
    '@type': 'Organization',
    name: '3R-Elite',
    url: BASE_URL,
  },
};

export default function VideoPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(videoJsonLd) }}
      />

      <div className="max-w-4xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-elite-navy mb-2">
          3R-Elite Marketplace Promo
        </h1>
        <p className="text-gray-600 mb-6">
          Discover millions of listings across electronics, fashion, vehicles, real estate and more
          — trusted by buyers and sellers in UAE, Uganda, Kenya and China.
        </p>

        <div className="relative w-full rounded-xl overflow-hidden shadow-lg bg-black aspect-video">
          <video
            src="/logo.mp4"
            controls
            playsInline
            preload="metadata"
            className="w-full h-full"
            aria-label="3R-Elite marketplace promo video"
          />
        </div>
      </div>
    </>
  );
}
