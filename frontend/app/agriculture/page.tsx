import CategoryPageTemplate from '@/components/ui/CategoryPageTemplate';

const AGRICULTURE_SUBCATEGORIES = [
  { slug: 'crops-grains', label: 'Crops & Grains', icon: '🌽', color: 'from-amber-500 to-yellow-600', desc: 'Maize, beans, rice & more' },
  { slug: 'fruits-vegetables', label: 'Fruits & Vegetables', icon: '🍅', color: 'from-red-500 to-rose-600', desc: 'Fresh produce' },
  { slug: 'livestock', label: 'Livestock', icon: '🐄', color: 'from-orange-600 to-amber-700', desc: 'Cattle, goats, pigs & more' },
  { slug: 'poultry-eggs', label: 'Poultry & Eggs', icon: '🐔', color: 'from-yellow-500 to-orange-600', desc: 'Chicken, eggs & more' },
  { slug: 'dairy-products', label: 'Dairy Products', icon: '🥛', color: 'from-sky-500 to-blue-600', desc: 'Milk, ghee & dairy' },
  { slug: 'seeds-inputs', label: 'Seeds & Inputs', icon: '🌱', color: 'from-emerald-500 to-green-600', desc: 'Seeds, fertilizer & inputs' },
  { slug: 'farm-equipment', label: 'Farm Equipment', icon: '🚜', color: 'from-lime-600 to-green-700', desc: 'Tools & machinery' },
];

export default function AgriculturePage() {
  return (
    <CategoryPageTemplate
      categorySlug="agriculture"
      categoryLabel="Agriculture"
      heroGradient="from-green-900 via-emerald-800 to-green-900"
      heroIcon="🌾"
      heroTitle={
        <>
          Farm <span className="text-amber-400">Produce</span> Marketplace
        </>
      }
      heroSubtitle="Buy fresh produce and farm supplies directly from farmers and sellers across Uganda."
      subcategories={AGRICULTURE_SUBCATEGORIES}
      basePath="/agriculture"
      postCtaLabel="+ Sell Produce"
      postCtaHref="/listings/create-produce"
    />
  );
}
