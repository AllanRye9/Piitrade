import type { SubCategory } from '@/components/ui/CategoryPageTemplate';
import type { BrandItem } from '@/components/ui/BrandsPageTemplate';

export const FURNITURE_SUBCATEGORIES: Record<string, SubCategory> = {
  'living-room': { slug: 'living-room', label: 'Living Room', icon: '🛋️', color: 'from-amber-600 to-orange-700', desc: 'Sofas, tables & decor' },
  'bedroom': { slug: 'bedroom', label: 'Bedroom', icon: '🛏️', color: 'from-violet-600 to-purple-700', desc: 'Beds, wardrobes & more' },
  'kitchen-dining': { slug: 'kitchen-dining', label: 'Kitchen & Dining', icon: '🍽️', color: 'from-rose-600 to-pink-700', desc: 'Dining tables & kitchenware' },
};

export const FURNITURE_BRANDS_BY_SUBCATEGORY: Record<string, BrandItem[]> = {
  'living-room': [
    { name: 'IKEA', slug: 'ikea', icon: '🛋️', color: 'from-blue-600 to-blue-800' },
    { name: 'Ashley', slug: 'ashley', icon: '🛋️', color: 'from-amber-700 to-orange-900' },
    { name: 'La-Z-Boy', slug: 'la-z-boy', icon: '🛋️', color: 'from-red-600 to-red-800' },
    { name: 'Pottery Barn', slug: 'pottery-barn', icon: '🛋️', color: 'from-orange-700 to-amber-900' },
    { name: 'West Elm', slug: 'west-elm', icon: '🛋️', color: 'from-slate-600 to-gray-800' },
    { name: 'Other', slug: 'other', icon: '🏷️', color: 'from-gray-500 to-slate-700' },
  ],
  'bedroom': [
    { name: 'IKEA', slug: 'ikea', icon: '🛏️', color: 'from-blue-600 to-blue-800' },
    { name: 'Ashley', slug: 'ashley', icon: '🛏️', color: 'from-amber-700 to-orange-900' },
    { name: 'Simmons', slug: 'simmons', icon: '🛏️', color: 'from-slate-600 to-gray-800' },
    { name: 'Sealy', slug: 'sealy', icon: '🛏️', color: 'from-blue-700 to-indigo-900' },
    { name: 'Sleep Number', slug: 'sleep-number', icon: '🛏️', color: 'from-emerald-600 to-teal-800' },
    { name: 'Other', slug: 'other', icon: '🏷️', color: 'from-gray-500 to-slate-700' },
  ],
  'kitchen-dining': [
    { name: 'IKEA', slug: 'ikea', icon: '🍽️', color: 'from-blue-600 to-blue-800' },
    { name: 'KitchenAid', slug: 'kitchenaid', icon: '🍽️', color: 'from-red-600 to-red-800' },
    { name: 'Cuisinart', slug: 'cuisinart', icon: '🍽️', color: 'from-gray-600 to-gray-800' },
    { name: 'Other', slug: 'other', icon: '🏷️', color: 'from-gray-500 to-slate-700' },
  ],
};

export const FURNITURE_PRICE_RANGES = [
  { label: 'Any Price', min: '', max: '' },
  { label: 'Under $100', min: '', max: '100' },
  { label: '$100–$500', min: '100', max: '500' },
  { label: '$500–$2k', min: '500', max: '2000' },
  { label: '$2k–$10k', min: '2000', max: '10000' },
  { label: 'Over $10k', min: '10000', max: '' },
];
