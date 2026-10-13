/**
 * Seeds a structured "brand" custom field onto every subcategory that has a
 * "Shop by Brand" page on the frontend (Electronics, Fashion, Furniture &
 * Garden), so `Listing.customFieldValues.brand` becomes a real, queryable
 * value instead of relying on brand names showing up in free-text
 * title/description search.
 *
 * The options for each subcategory are copied 1:1 from the frontend's
 * `*_BRANDS_BY_SUBCATEGORY` configs (frontend/app/electronics/config.ts,
 * frontend/app/fashion/config.ts, frontend/app/furniture/config.ts) so the
 * dropdown a seller sees while posting matches exactly what the brand pages
 * filter on. If those frontend configs change, update the lists below to
 * match.
 *
 * Idempotent / additive: for a category that already has other custom
 * fields, this only inserts-or-updates the "brand" entry and leaves
 * everything else in fieldSchema untouched. Safe to re-run.
 *
 * Usage:
 *   cd backend
 *   npx ts-node --transpile-only scripts/seed-brand-fields.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const rawUrl = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL;
if (!rawUrl) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}
const databaseUrl = rawUrl.startsWith('postgres://')
  ? rawUrl.replace('postgres://', 'postgresql://')
  : rawUrl;

// Prisma 7: the `datasources` option was removed; connections go through a
// driver adapter (same setup as src/utils/prisma.ts).
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

interface CategoryFieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea';
  options?: string[];
  required?: boolean;
}

// subcategory slug -> brand option list (names, matching BrandItem.name in
// the frontend configs exactly, since the listing form's select stores the
// option string verbatim into customFieldValues.brand).
const BRANDS_BY_SUBCATEGORY: Record<string, string[]> = {
  // Electronics
  laptops: ['Apple', 'Dell', 'HP', 'Lenovo', 'ASUS', 'Acer', 'Samsung', 'Huawei', 'Microsoft', 'Other'],
  smartphones: ['Apple', 'Samsung', 'Huawei', 'Xiaomi', 'Google', 'OnePlus', 'OPPO', 'Vivo', 'Nokia', 'Tecno', 'Infinix', 'Other'],
  tablets: ['Apple', 'Samsung', 'Huawei', 'Lenovo', 'Amazon', 'Microsoft', 'Other'],
  desktops: ['Apple', 'Dell', 'HP', 'Lenovo', 'ASUS', 'Acer', 'Other'],
  headphones: ['Sony', 'Apple', 'Samsung', 'Bose', 'JBL', 'Sennheiser', 'Jabra', 'Other'],
  cameras: ['Canon', 'Nikon', 'Sony', 'Fujifilm', 'Panasonic', 'Olympus', 'GoPro', 'Other'],
  consoles: ['PlayStation', 'Xbox', 'Nintendo', 'Other'],
  'games-accessories': ['PlayStation', 'Xbox', 'Nintendo', 'PC Gaming', 'Other'],
  // Fashion
  'women-clothing': ['Zara', 'H&M', 'Gucci', 'Chanel', 'Nike', 'Adidas', 'Shein', 'Other'],
  'women-shoes': ['Nike', 'Adidas', 'Puma', 'Gucci', 'Louis Vuitton', 'Jimmy Choo', 'Other'],
  'women-bags': ['Louis Vuitton', 'Gucci', 'Chanel', 'Prada', 'Michael Kors', 'Coach', 'Other'],
  'men-clothing': ['Nike', 'Adidas', 'Zara', 'H&M', 'Ralph Lauren', 'Tommy Hilfiger', 'Other'],
  'men-shoes': ['Nike', 'Adidas', 'Puma', 'New Balance', 'Jordan', 'Timberland', 'Other'],
  watches: ['Rolex', 'Omega', 'Casio', 'Seiko', 'Apple', 'Samsung', 'Tag Heuer', 'Other'],
  'girls-clothing': ['Zara Kids', 'H&M Kids', 'Nike', 'Adidas', 'Other'],
  'boys-clothing': ['Nike', 'Adidas', 'Zara Kids', 'H&M Kids', 'Other'],
  // Furniture & Garden
  'living-room': ['IKEA', 'Ashley', 'La-Z-Boy', 'Pottery Barn', 'West Elm', 'Other'],
  bedroom: ['IKEA', 'Ashley', 'Simmons', 'Sealy', 'Sleep Number', 'Other'],
  'kitchen-dining': ['IKEA', 'KitchenAid', 'Cuisinart', 'Other'],
  'garden-furniture': ['IKEA', 'Keter', 'Lifetime', 'Other'],
  'bbq-grills': ['Weber', 'Traeger', 'Napoleon', 'Char-Griller', 'Other'],
  'plants-seeds': ['Miracle-Gro', 'Burpee', 'Other'],
};

async function main() {
  console.log('Seeding "brand" custom field onto subcategories...');

  let updated = 0;
  let skipped = 0;

  for (const [slug, options] of Object.entries(BRANDS_BY_SUBCATEGORY)) {
    const category = await prisma.category.findUnique({ where: { slug } });
    if (!category) {
      console.warn(`  ⚠ No category with slug "${slug}" found — skipping.`);
      skipped += 1;
      continue;
    }

    const existingSchema = Array.isArray(category.fieldSchema)
      ? (category.fieldSchema as unknown as CategoryFieldDef[])
      : [];

    const brandField: CategoryFieldDef = {
      name: 'brand',
      label: 'Brand',
      type: 'select',
      options,
      required: false,
    };

    const nextSchema = [
      brandField,
      ...existingSchema.filter((f) => f.name !== 'brand'),
    ];

    await prisma.category.update({
      where: { id: category.id },
      data: { fieldSchema: nextSchema as unknown as object },
    });

    console.log(`  ✓ ${category.name} (${slug}): ${options.length} brand options`);
    updated += 1;
  }

  console.log(`Done. Updated ${updated} categories, skipped ${skipped}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
