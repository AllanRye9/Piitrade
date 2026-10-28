import type { Metadata } from 'next';
import CategoriesIndex from '@/components/categories/CategoriesIndex';

export const metadata: Metadata = {
  title: 'All categories – Piitrade Marketplace',
  description: 'Browse every category on Piitrade Uganda: vehicles, property, electronics, fashion, jobs, services, food, building materials, farm produce and more.',
  alternates: { canonical: '/categories' },
  openGraph: {
    title: 'All categories – Piitrade Marketplace',
    description: 'Browse every category on Piitrade Uganda.',
  },
};

export default function CategoriesPage() {
  return <CategoriesIndex />;
}
