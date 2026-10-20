import BrandsPageTemplate from '@/components/ui/BrandsPageTemplate';
import {
  FURNITURE_SUBCATEGORIES,
  FURNITURE_BRANDS_BY_SUBCATEGORY,
} from '../config';

export default function FurnitureSubcategoryPage() {
  return (
    <BrandsPageTemplate
      subcategories={FURNITURE_SUBCATEGORIES}
      brandsBySubcategory={FURNITURE_BRANDS_BY_SUBCATEGORY}
      basePath="/furniture"
      categoryLabel="Furniture"
      categoryHref="/furniture"
    />
  );
}
