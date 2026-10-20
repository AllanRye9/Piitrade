import CategoryPageTemplate from '@/components/ui/CategoryPageTemplate';

const GARDEN_SUBCATEGORIES = [
  { slug: 'garden-furniture', label: 'Garden Furniture', icon: '🌿', color: 'from-lime-500 to-green-600', desc: 'Outdoor tables & chairs' },
  { slug: 'bbq-grills', label: 'BBQ & Grills', icon: '🔥', color: 'from-red-500 to-rose-600', desc: 'Grills & outdoor cooking' },
  { slug: 'plants-seeds', label: 'Plants & Seeds', icon: '🌱', color: 'from-emerald-500 to-teal-600', desc: 'Indoor & outdoor plants' },
];

export default function GardenPage() {
  return (
    <CategoryPageTemplate
      categorySlug="garden"
      categoryLabel="Garden"
      heroGradient="from-green-900 via-emerald-800 to-green-900"
      heroIcon="🌿"
      heroTitle={
        <>
          Your <span className="text-lime-400">Garden</span>
        </>
      }
      heroSubtitle="Outdoor furniture, grills, plants and seeds from verified sellers."
      subcategories={GARDEN_SUBCATEGORIES}
      basePath="/garden"
      postCtaLabel="+ List Garden Item"
    />
  );
}
