import BrandListingsTemplate from '@/components/ui/BrandListingsTemplate';
import {
  FURNITURE_SUBCATEGORIES,
  FURNITURE_BRANDS_BY_SUBCATEGORY,
  FURNITURE_PRICE_RANGES,
} from '../../config';

export default function FurnitureBrandPage() {
  return (
    <BrandListingsTemplate
      subcategories={FURNITURE_SUBCATEGORIES}
      brandsBySubcategory={FURNITURE_BRANDS_BY_SUBCATEGORY}
      basePath="/furniture"
      categoryLabel="Furniture"
      categoryHref="/furniture"
      priceRanges={FURNITURE_PRICE_RANGES}
    />
  );
}
