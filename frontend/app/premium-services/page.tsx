import CategoryPageTemplate from '@/components/ui/CategoryPageTemplate';

const SERVICES_SUBCATEGORIES = [
  { slug: 'legal', label: 'Legal Services', icon: '⚖️', color: 'from-slate-600 to-gray-700', desc: 'Lawyers, notaries & legal advice' },
  { slug: 'financial', label: 'Financial Advisory', icon: '📊', color: 'from-emerald-500 to-teal-600', desc: 'Investment, tax & wealth planning' },
  { slug: 'medical', label: 'Medical & Health', icon: '🏥', color: 'from-red-500 to-rose-600', desc: 'Private healthcare & wellness' },
  { slug: 'education', label: 'Education & Tutoring', icon: '🎓', color: 'from-blue-500 to-indigo-600', desc: 'Tutors, coaching & training' },
  { slug: 'home-services', label: 'Home Services', icon: '🏡', color: 'from-amber-500 to-orange-600', desc: 'Cleaning, repairs & maintenance' },
  { slug: 'events', label: 'Events & Entertainment', icon: '🎉', color: 'from-fuchsia-500 to-violet-600', desc: 'Event planning & entertainment' },
  { slug: 'tech-services', label: 'Tech & IT Services', icon: '💻', color: 'from-sky-500 to-cyan-600', desc: 'Web, app & IT support' },
  { slug: 'other-services', label: 'Other Services', icon: '🤝', color: 'from-violet-500 to-purple-600', desc: 'Bespoke & specialist services' },
];

export default function PremiumServicesPage() {
  return (
    <CategoryPageTemplate
      categorySlug="premium-services"
      categoryLabel="Premium Services"
      heroGradient="from-fuchsia-900 via-violet-800 to-fuchsia-900"
      heroIcon="🤝"
      heroTitle={
        <>
          Elite-Grade <span className="text-fuchsia-400">Premium Services</span>
        </>
      }
      heroSubtitle="Connect with top-tier service providers — legal, financial, medical, home, tech and beyond — across UAE, Uganda, Kenya and China."
      subcategories={SERVICES_SUBCATEGORIES}
      basePath="/premium-services"
      postCtaLabel="+ Offer Your Service"
      whyItems={[
        { icon: '🔒', title: 'Verified Providers', desc: 'All service providers are screened and identity-verified.' },
        { icon: '⭐', title: 'Rated & Reviewed', desc: 'Transparent ratings and reviews from real clients.' },
        { icon: '💬', title: 'Direct Contact', desc: 'Message and negotiate with providers directly on the platform.' },
        { icon: '🌍', title: 'Regional Network', desc: 'Premium service listings across UAE, Uganda, Kenya and China.' },
      ]}
    />
  );
}
