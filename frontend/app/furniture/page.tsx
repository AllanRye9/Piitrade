import CategoryPageTemplate from '@/components/ui/CategoryPageTemplate';

const FURNITURE_SUBCATEGORIES = [
  { slug: 'living-room', label: 'Living Room', icon: '🛋️', color: 'from-amber-500 to-orange-600', desc: 'Sofas, tables & decor' },
  { slug: 'bedroom', label: 'Bedroom', icon: '🛏️', color: 'from-violet-500 to-purple-600', desc: 'Beds, wardrobes & more' },
  { slug: 'kitchen-dining', label: 'Kitchen & Dining', icon: '🍽️', color: 'from-rose-500 to-pink-600', desc: 'Dining tables & kitchenware' },
];

export default function FurniturePage() {
  return (
    <CategoryPageTemplate
      categorySlug="furniture"
      categoryLabel="Furniture"
      heroGradient="from-amber-900 via-yellow-800 to-amber-900"
      heroIcon="🛋️"
      heroTitle={
        <>
          Quality <span className="text-amber-400">Furniture</span>
        </>
      }
      heroSubtitle="Furnish your home with quality pieces from verified sellers."
      subcategories={FURNITURE_SUBCATEGORIES}
      basePath="/furniture"
      postCtaLabel="+ List Furniture"
    />
  );
}
