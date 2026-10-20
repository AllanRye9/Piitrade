import type { SubCategory } from '@/components/ui/CategoryPageTemplate';
import type { BrandItem } from '@/components/ui/BrandsPageTemplate';

export const GARDEN_SUBCATEGORIES: Record<string, SubCategory> = {
  'garden-furniture': { slug: 'garden-furniture', label: 'Garden Furniture', icon: '🌿', color: 'from-lime-600 to-green-700', desc: 'Outdoor tables & chairs' },
  'bbq-grills': { slug: 'bbq-grills', label: 'BBQ & Grills', icon: '🔥', color: 'from-red-600 to-rose-700', desc: 'Grills & outdoor cooking' },
  'plants-seeds': { slug: 'plants-seeds', label: 'Plants & Seeds', icon: '🌱', color: 'from-emerald-600 to-teal-700', desc: 'Indoor & outdoor plants' },
};

export const GARDEN_BRANDS_BY_SUBCATEGORY: Record<string, BrandItem[]> = {
  'garden-furniture': [
    { name: 'IKEA', slug: 'ikea', icon: '🌿', color: 'from-blue-600 to-blue-800' },
    { name: 'Keter', slug: 'keter', icon: '🌿', color: 'from-green-600 to-emerald-800' },
    { name: 'Lifetime', slug: 'lifetime', icon: '🌿', color: 'from-amber-600 to-orange-800' },
    { name: 'Other', slug: 'other', icon: '🏷️', color: 'from-gray-500 to-slate-700' },
  ],
  'bbq-grills': [
    { name: 'Weber', slug: 'weber', icon: '🔥', color: 'from-red-600 to-red-900' },
    { name: 'Traeger', slug: 'traeger', icon: '🔥', color: 'from-orange-600 to-red-800' },
    { name: 'Napoleon', slug: 'napoleon', icon: '🔥', color: 'from-slate-700 to-gray-900' },
    { name: 'Char-Griller', slug: 'char-griller', icon: '🔥', color: 'from-amber-700 to-orange-900' },
    { name: 'Other', slug: 'other', icon: '🏷️', color: 'from-gray-500 to-slate-700' },
  ],
  'plants-seeds': [
    { name: 'Miracle-Gro', slug: 'miracle-gro', icon: '🌱', color: 'from-green-600 to-emerald-800' },
    { name: 'Burpee', slug: 'burpee', icon: '🌱', color: 'from-lime-600 to-green-800' },
    { name: 'Other', slug: 'other', icon: '🏷️', color: 'from-gray-500 to-slate-700' },
  ],
};

export const GARDEN_PRICE_RANGES = [
  { label: 'Any Price', min: '', max: '' },
  { label: 'Under $100', min: '', max: '100' },
  { label: '$100–$500', min: '100', max: '500' },
  { label: '$500–$2k', min: '500', max: '2000' },
  { label: 'Over $2k', min: '2000', max: '' },
];
