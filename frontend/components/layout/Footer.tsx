import Link from 'next/link';
import BrandLogo from '@/components/ui/BrandLogo';
import FooterLocations from '@/components/layout/FooterLocations';

interface SocialLinks {
  facebook?: string | null;
  instagram?: string | null;
  linkedin?: string | null;
  x?: string | null;
  whatsapp?: string | null;
  youtube?: string | null;
  tiktok?: string | null;
}

async function getSocialLinks(): Promise<SocialLinks> {
  try {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const res = await fetch(`${apiBase}/api/site-media/social-links`, { next: { revalidate: 300 } });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

const COUNTRY_LABELS: Record<string, string> = {
  UAE: 'the UAE', UGANDA: 'Uganda', KENYA: 'Kenya', CHINA: 'China',
};

/** Joins enabled country labels into "Uganda", "the UAE and Uganda", or
 *  "the UAE, Uganda and Kenya" — matching how the sentence read before this
 *  was made dynamic. */
function joinCountryLabels(countries: string[]): string {
  const labels = countries.map((c) => COUNTRY_LABELS[c] ?? c);
  if (labels.length === 0) return 'your region';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

async function getEnabledCountries(): Promise<string[]> {
  try {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const res = await fetch(`${apiBase}/api/public/site-config`, { next: { revalidate: 60 } });
    if (!res.ok) return ['UGANDA'];
    const data = await res.json();
    return Array.isArray(data.enabledCountries) && data.enabledCountries.length > 0
      ? data.enabledCountries
      : ['UGANDA'];
  } catch {
    return ['UGANDA'];
  }
}

export default async function Footer() {
  const [social, enabledCountries] = await Promise.all([getSocialLinks(), getEnabledCountries()]);

  const desktopSocials = [
    { label: 'Facebook', icon: 'f', href: social.facebook || '#' },
    { label: 'Twitter / X', icon: 'X', href: social.x || '#' },
    { label: 'Instagram', icon: '📷', href: social.instagram || '#' },
    { label: 'TikTok', icon: '🎵', href: social.tiktok || '#' },
    { label: 'WhatsApp', icon: '💬', href: social.whatsapp || '#' },
    { label: 'YouTube', icon: '▶', href: social.youtube || '#' },
  ];

  const mobileSocials = [
    { label: 'Facebook', icon: 'f', href: social.facebook || '#' },
    { label: 'Twitter', icon: 'X', href: social.x || '#' },
    { label: 'Instagram', icon: '📷', href: social.instagram || '#' },
    { label: 'TikTok', icon: '🎵', href: social.tiktok || '#' },
    { label: 'WhatsApp', icon: '💬', href: social.whatsapp || '#' },
  ];

  return (
    <footer className="bg-gradient-to-r from-indigo-900 via-sky-800 to-fuchsia-900 text-gray-300 px-[1%] md:px-[7%]">
      {/* Main footer content - hidden on mobile, shown on md+ */}
      <div className="hidden md:block">
        <div className="py-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
            {/* Brand column */}
            <div className="lg:col-span-2">
              <Link href="/" className="flex items-center gap-2 mb-3 w-fit hover:opacity-80 transition-opacity">
                <BrandLogo
                  imgHeight={32}
                  alt="Piitrade — Shop Smart. Shop Trusted."
                  fallback={
                    <>
                      <div className="w-8 h-8 bg-gradient-to-br from-fuchsia-500 via-sky-500 to-indigo-600 rounded-lg flex items-center justify-center font-black text-white text-sm border border-white/30 shadow-glow">Pi</div>
                      <div className="flex flex-col leading-none gap-0.5">
                        <span className="font-extrabold text-white text-lg tracking-tight">
                          Piitrade
                        </span>
                        <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/50">
                          Shop Smart. Shop Trusted.
                        </span>
                      </div>
                    </>
                  }
                />
              </Link>
              <p className="text-sm leading-relaxed mb-2 max-w-xs text-gray-300">
                The premier online marketplace connecting buyers and sellers across {joinCountryLabels(enabledCountries)}. Safe, fast, and free to list.
              </p>
              {/* Get Social */}
              <h4 className="text-white font-bold mb-2 text-sm uppercase tracking-wide">Get Social</h4>
              <div className="flex gap-2">
                {desktopSocials.map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    target={s.href !== '#' ? '_blank' : undefined}
                    rel={s.href !== '#' ? 'noopener noreferrer' : undefined}
                    aria-label={s.label}
                    className="w-9 h-9 rounded-lg bg-white/10 hover:bg-gradient-to-r hover:from-fuchsia-500 hover:to-sky-500 hover:text-white flex items-center justify-center text-xs text-gray-300 transition-colors interactive"
                  >
                    {s.icon}
                  </a>
                ))}
              </div>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-white font-bold mb-2 text-sm uppercase tracking-wide border-b border-white/10 pb-1">Company</h4>
              <ul className="space-y-1.5 text-sm">
                <li><Link href="/about" className="text-gray-300 hover:text-sky-200 transition-colors">About Us</Link></li>
                <li><Link href="/advertising" className="text-gray-300 hover:text-sky-200 transition-colors">Advertising</Link></li>
                <li><Link href="/blog" className="text-gray-300 hover:text-sky-200 transition-colors">Blog</Link></li>
                <li><Link href="/careers" className="text-gray-300 hover:text-sky-200 transition-colors">Careers</Link></li>
                <li><Link href="/press" className="text-gray-300 hover:text-sky-200 transition-colors">Press</Link></li>
              </ul>
            </div>

            {/* Our Locations */}
            <div>
              <h4 className="text-white font-bold mb-2 text-sm uppercase tracking-wide border-b border-white/10 pb-1">Our Locations</h4>
              <FooterLocations />
            </div>

            {/* Support */}
            <div>
              <h4 className="text-white font-bold mb-2 text-sm uppercase tracking-wide border-b border-white/10 pb-1">Support</h4>
              <ul className="space-y-1.5 text-sm">
                <li><Link href="/help" className="text-gray-300 hover:text-sky-200 transition-colors">Help Center</Link></li>
                <li><a href="mailto:support@piitrade.com" className="text-gray-300 hover:text-sky-200 transition-colors">Contact Us</a></li>
                <li><Link href="/safety" className="text-gray-300 hover:text-sky-200 transition-colors">Safety Tips</Link></li>
                <li><Link href="/privacy" className="text-gray-300 hover:text-sky-200 transition-colors">Privacy Policy</Link></li>
                <li><Link href="/terms" className="text-gray-300 hover:text-sky-200 transition-colors">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Compact mobile footer - shown only below md */}
      <div className="md:hidden py-6">
        <Link href="/" className="flex items-center justify-center gap-2 mb-4 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 bg-gradient-to-br from-fuchsia-500 via-sky-500 to-indigo-600 rounded-lg flex items-center justify-center font-black text-white text-xs border border-white/30 shadow-glow">Pi</div>
          <span className="font-extrabold text-white text-base tracking-tight">
            Piitrade
          </span>
        </Link>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2.5 text-xs mb-4">
          <Link href="/about" className="text-gray-300 hover:text-premium-gold transition-colors">About</Link>
          <Link href="/blog" className="text-gray-300 hover:text-premium-gold transition-colors">Blog</Link>
          <Link href="/safety" className="text-gray-300 hover:text-premium-gold transition-colors">Safety Tips</Link>
          <Link href="/help" className="text-gray-300 hover:text-premium-gold transition-colors">Help Center</Link>
          <a href="mailto:support@piitrade.com" className="text-gray-300 hover:text-premium-gold transition-colors">Contact</a>
          <Link href="/privacy" className="text-gray-300 hover:text-premium-gold transition-colors">Privacy</Link>
          <Link href="/terms" className="text-gray-300 hover:text-premium-gold transition-colors">Terms</Link>
        </div>
        <div className="flex justify-center gap-3 mb-4">
          {mobileSocials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target={s.href !== '#' ? '_blank' : undefined}
              rel={s.href !== '#' ? 'noopener noreferrer' : undefined}
              aria-label={s.label}
              className="w-9 h-9 rounded-lg bg-white/10 hover:bg-gradient-to-r hover:from-fuchsia-500 hover:to-sky-500 flex items-center justify-center text-xs text-gray-300 transition-colors interactive"
            >
              {s.icon}
            </a>
          ))}
        </div>
        <p className="text-center text-xs text-gray-400">&copy; {new Date().getFullYear()} Piitrade Marketplace</p>
      </div>

      {/* Bottom bar - desktop only */}
      <div className="hidden md:block border-t border-white/10">
        <div className="py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <p className="text-gray-300">&copy; {new Date().getFullYear()} Piitrade Marketplace. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="text-gray-300 hover:text-premium-gold transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="text-gray-300 hover:text-premium-gold transition-colors">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

