import Link from 'next/link';

// Where a campaign can actually appear across the live site today.
const PLACEMENTS = [
  { icon: '🏠', title: 'Homepage Banner', desc: 'Top-of-page placement seen by every visitor before they browse a category.' },
  { icon: '🔥', title: 'Featured Deals & Flash Deals', desc: 'Slot your listing into the Today\u2019s Deals rail or a time-boxed Flash Deal spotlight.' },
  { icon: '🔍', title: 'Search & Category Results', desc: 'Priority placement inside Listings search results and category pages (Motors, Property, Electronics, Fashion, and more).' },
  { icon: '🏪', title: 'Verified Partner Directory', desc: 'A branded storefront and logo placement on the Our Partners page, reserved for approved partners.' },
  { icon: '📋', title: 'Job Market & CV Services', desc: 'Reach jobseekers and employers browsing CV Services and the Job Market.' },
  { icon: '🌾', title: 'Market Prices Sponsorship', desc: 'Sponsor a commodity category on the Uganda Market Price Watch page.' },
];

// The live categories a buyer can be reached in — kept in sync with the site's own category bar.
const CATEGORIES = [
  'Motors', 'Property', 'Jobs & CV', 'Electronics', 'Fashion', 'Furniture',
  'Fine Jewellery', 'Arts & Collectibles', 'Classifieds', 'Services', 'Market Prices',
];

const STEPS = [
  { title: 'Share your goals', desc: 'Tell us your campaign goals, target market, budget, and preferred timing.' },
  { title: 'Get a placement plan', desc: 'We recommend the placements and rollout timing that best fit your audience and budget.' },
  { title: 'Launch & track', desc: 'Your campaign goes live across the agreed placements, with results shared back to you.' },
];

export default function AdvertisingPage() {
  return (
    <div className="bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.08),_transparent_38%),linear-gradient(180deg,_#ffffff_0%,_#f8fafc_100%)]">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="rounded-[2rem] border border-red-100 bg-white/90 p-5 shadow-[0_25px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-8">
          <span className="inline-flex rounded-full bg-red-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-red-700">
            Advertising on Piitrade
          </span>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-premium-navy sm:text-5xl">
            Promote products to active local shoppers
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
            Piitrade is a live multi-category marketplace across Motors, Property, Jobs, Electronics, Fashion, and more. Advertising here means direct visibility inside a marketplace already built around buyer intent — not a generic ad network.
          </p>

          {/* Where your ad appears */}
          <div className="mt-7">
            <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-slate-900 sm:text-xl">
              📍 Where Your Campaign Can Appear
            </h2>
            <p className="mb-3 text-sm text-slate-500">Real placements on the live site today — not mockups.</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {PLACEMENTS.map((p) => (
                <div key={p.title} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 hover:border-red-200 hover:bg-red-50/40 transition-colors">
                  <div className="text-xl mb-1.5">{p.icon}</div>
                  <h3 className="font-bold text-slate-900 text-sm mb-1">{p.title}</h3>
                  <p className="text-xs leading-relaxed text-slate-500">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Categories covered */}
          <div className="mt-7">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-slate-900 sm:text-xl">
              🗂️ Categories You Can Target
            </h2>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <span key={c} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
                  {c}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-7 grid sm:grid-cols-2 gap-4">
            <section className="rounded-2xl border border-slate-100 bg-slate-50/70 p-6">
              <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Who this is for</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-slate-600 sm:text-base">
                <p>Retailers, service providers, distributors, and local businesses can use placements to reach users already browsing by category, location, and product intent.</p>
              </div>
            </section>
            <section className="rounded-2xl border border-slate-100 bg-slate-50/70 p-6">
              <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Why Piitrade</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-slate-600 sm:text-base">
                <p>Placements sit next to real buyer activity — search results, category browsing, and job seekers — instead of a passive display network.</p>
              </div>
            </section>
          </div>

          {/* How to get started */}
          <div className="mt-5">
            <h2 className="text-lg font-bold text-slate-900 sm:text-xl mb-3">How to get started</h2>
            <div className="grid sm:grid-cols-3 gap-3">
              {STEPS.map((step, i) => (
                <div key={step.title} className="rounded-2xl border border-slate-100 bg-white p-4 relative">
                  <div className="w-7 h-7 rounded-full bg-premium-navy text-white text-xs font-black flex items-center justify-center mb-2">
                    {i + 1}
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm mb-1">{step.title}</h3>
                  <p className="text-xs leading-relaxed text-slate-500">{step.desc}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Send the details above to <a href="mailto:support@piitrade.com" className="font-semibold text-red-600 hover:text-red-700">support@piitrade.com</a> and we&apos;ll follow up with a placement plan.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="mailto:support@piitrade.com"
              className="inline-flex items-center justify-center rounded-xl bg-premium-navy px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-700"
            >
              Contact advertising
            </a>
            <Link
              href="/listings"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Browse listings
            </Link>
            <Link
              href="/stores"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              See our partners
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}