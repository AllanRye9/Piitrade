import Link from 'next/link';
import Image from 'next/image';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { resolveImageUrl } from '@/lib/utils';
import { API_URL } from '@/lib/apiUrl';

const SERVICES = [
  {
    href: '/cv-services/writing',
    icon: '✍️',
    title: 'CV / Resume',
    desc: 'Generate polished, ATS-ready CV content instantly inside the platform.',
    color: 'from-sky-500 to-blue-600',
    badge: 'Free to build',
  },
  {
    href: '/cv-services/interview',
    icon: '🎤',
    title: 'Interview Simulator',
    desc: 'Practise with structured interview flows and instant preparation guides.',
    color: 'from-rose-500 to-red-600',
    badge: 'Free',
  },
  {
    href: '/cv-generator/cover-letter',
    icon: '📝',
    title: 'Cover Letter',
    desc: 'Generate a tailored cover letter from your role and company details. Pay only when you download.',
    color: 'from-pink-500 to-fuchsia-600',
    badge: 'Pay on download',
  },
];

const JOB_MARKET_LINKS = [
  { href: '/jobs', icon: '🔍', title: 'Browse CVs', desc: 'Find skilled candidates ready to hire.' },
  { href: '/profile#cv-documents', icon: '📤', title: 'Upload a CV', desc: 'Upload your CV to appear in the job market.' },
  { href: '/jobs', icon: '💼', title: 'Find Talent', desc: 'Search professionals across multiple countries.' },
  { href: '/jobs', icon: '🤝', title: 'Hire Talent', desc: 'Contact candidates directly and build your team.' },
];

interface CVShowcaseImage {
  id: string;
  cdnUrl: string;
  title?: string | null;
  altText?: string | null;
  linkUrl?: string | null;
}

/** Fetches up to 6 admin-uploaded showcase images for the CV Services page.
 *  Mirrors the same fetch/revalidate/fallback pattern used by getHomeData()
 *  on the homepage for consistency. Fails gracefully to an empty array so
 *  the page renders normally even if no images have been uploaded yet. */
async function getCVServiceImages(): Promise<CVShowcaseImage[]> {
  try {
    const res = await fetch(`${API_URL}/api/site-media?section=cv-service`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(10000), // 10s timeout to prevent build hangs
    });
    if (!res.ok) return [];
    const data = await res.json();
    const media: CVShowcaseImage[] = Array.isArray(data?.media) ? data.media : [];
    return media.slice(0, 6);
  } catch {
    return [];
  }
}

export default async function CVServicesPage() {
  const showcaseImages = await getCVServiceImages();

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 sm:py-5 animate-fade-in">
      <Breadcrumb
        className="mb-3"
        items={[{ label: 'Home', href: '/' }, { label: 'CV Services' }]}
      />

      {/* Hero — compact single-row banner so services sit higher on the page */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-red-700 via-red-600 to-red-500 px-4 py-3 text-white shadow-lg mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-black tracking-tight whitespace-nowrap">CV &amp; Career Suite</h1>
              <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/85">
                Piitrade
              </span>
            </div>
            <p className="mt-0.5 max-w-2xl text-xs text-white/85 leading-snug">
              Build for free — pay only when you download. No subscription, no hidden fees.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link
              href="/cv-generator"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white text-red-700 rounded-xl text-xs font-bold hover:bg-red-50 transition-colors shadow-sm whitespace-nowrap"
            >
              📄 Build My CV
            </Link>
            <Link
              href="/jobs"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white/15 hover:bg-white/25 border border-white/30 text-white rounded-xl text-xs font-semibold transition-colors whitespace-nowrap"
            >
              🔍 Browse
            </Link>
          </div>
        </div>
      </div>

      {/* Showcase — admin-uploaded images, up to 6, at least 3 visible per row without scrolling */}
      {showcaseImages.length > 0 && (
        <section className="mb-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {showcaseImages.map((img) => {
              const frame = (
                <div className="group relative aspect-[4/3] overflow-hidden rounded-2xl border border-gray-100 shadow-sm">
                  <Image
                    src={resolveImageUrl(img.cdnUrl)}
                    alt={img.altText || img.title || 'CV Services'}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    sizes="(max-width: 640px) 50vw, 33vw"
                    quality={75}
                    loading="lazy"
                  />
                  {img.title && (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 py-2">
                      <p className="text-xs font-semibold text-white truncate">{img.title}</p>
                    </div>
                  )}
                </div>
              );
              return img.linkUrl ? (
                <Link key={img.id} href={img.linkUrl}>{frame}</Link>
              ) : (
                <div key={img.id}>{frame}</div>
              );
            })}
          </div>
        </section>
      )}

      {/* Professional Services */}
      <section className="mb-5">
        <h2 className="text-lg font-black text-gray-900 mb-1">Professional Services</h2>
        <p className="text-xs text-gray-500 mb-2.5">Automated digital tools for every step of your career journey. Use for free — pay only to download.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SERVICES.map((svc) => (
            <Link
              key={svc.href}
              href={svc.href}
              className="group relative bg-white rounded-2xl border border-gray-100 shadow-sm p-3 hover:shadow-lg transition-all overflow-hidden"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${svc.color} opacity-0 group-hover:opacity-5 transition-opacity`} />
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${svc.color} flex items-center justify-center text-xl shrink-0`}>
                  {svc.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="font-bold text-gray-900 text-sm">{svc.title}</h3>
                    {svc.badge && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        {svc.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{svc.desc}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end text-xs font-semibold text-red-600 group-hover:gap-1.5 transition-all gap-1">
                Learn more <span className="group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Job Market Quick Links */}
      <section>
        <h2 className="text-lg font-black text-gray-900 mb-1">Job Market</h2>
        <p className="text-xs text-gray-500 mb-2.5">Connect directly with employers and candidates.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {JOB_MARKET_LINKS.map((link) => (
            <Link
              key={`${link.href}-${link.title}`}
              href={link.href}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-2.5 hover:shadow-md hover:border-red-200 transition-all text-center group"
            >
              <div className="text-2xl mb-1.5 group-hover:scale-110 transition-transform inline-block">
                {link.icon}
              </div>
              <p className="font-bold text-gray-900 text-sm">{link.title}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-snug">{link.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
