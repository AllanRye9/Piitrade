import CategorySubcategoryTemplate from '@/components/ui/CategorySubcategoryTemplate';
import type { SubCategory } from '@/components/ui/CategoryPageTemplate';

const AGRICULTURE_SUBCATEGORIES: Record<string, SubCategory> = {
  'crops-grains': { slug: 'crops-grains', label: 'Crops & Grains', icon: '🌽', color: 'from-amber-500 to-yellow-600', desc: 'Maize, beans, rice & more' },
  'fruits-vegetables': { slug: 'fruits-vegetables', label: 'Fruits & Vegetables', icon: '🍅', color: 'from-red-500 to-rose-600', desc: 'Fresh produce' },
  'livestock': { slug: 'livestock', label: 'Livestock', icon: '🐄', color: 'from-orange-600 to-amber-700', desc: 'Cattle, goats, pigs & more' },
  'poultry-eggs': { slug: 'poultry-eggs', label: 'Poultry & Eggs', icon: '🐔', color: 'from-yellow-500 to-orange-600', desc: 'Chicken, eggs & more' },
  'dairy-products': { slug: 'dairy-products', label: 'Dairy Products', icon: '🥛', color: 'from-sky-500 to-blue-600', desc: 'Milk, ghee & dairy' },
  'seeds-inputs': { slug: 'seeds-inputs', label: 'Seeds & Inputs', icon: '🌱', color: 'from-emerald-500 to-green-600', desc: 'Seeds, fertilizer & inputs' },
  'farm-equipment': { slug: 'farm-equipment', label: 'Farm Equipment', icon: '🚜', color: 'from-lime-600 to-green-700', desc: 'Tools & machinery' },
};

export default function AgricultureSubcategoryPage() {
  return (
    <CategorySubcategoryTemplate
      subcategories={AGRICULTURE_SUBCATEGORIES}
      basePath="/agriculture"
      categoryLabel="Agriculture"
      categoryHref="/agriculture"
      postCtaHref="/listings/create-produce"
    />
  );
}
