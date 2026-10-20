import BrandsPageTemplate from '@/components/ui/BrandsPageTemplate';
import { GARDEN_SUBCATEGORIES, GARDEN_BRANDS_BY_SUBCATEGORY } from '../config';

export default function GardenSubcategoryPage() {
  return (
    <BrandsPageTemplate
      subcategories={GARDEN_SUBCATEGORIES}
      brandsBySubcategory={GARDEN_BRANDS_BY_SUBCATEGORY}
      basePath="/garden"
      categoryLabel="Garden"
      categoryHref="/garden"
    />
  );
}
