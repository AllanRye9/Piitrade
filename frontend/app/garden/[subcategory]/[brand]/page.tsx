import BrandListingsTemplate from '@/components/ui/BrandListingsTemplate';
import { GARDEN_SUBCATEGORIES, GARDEN_BRANDS_BY_SUBCATEGORY, GARDEN_PRICE_RANGES } from '../../config';

export default function GardenBrandPage() {
  return (
    <BrandListingsTemplate
      subcategories={GARDEN_SUBCATEGORIES}
      brandsBySubcategory={GARDEN_BRANDS_BY_SUBCATEGORY}
      basePath="/garden"
      categoryLabel="Garden"
      categoryHref="/garden"
      priceRanges={GARDEN_PRICE_RANGES}
    />
  );
}
