'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Category, Country } from '@/lib/types';
import { getCurrency, getLocations } from '@/lib/utils';
import CategoryPicker from '@/components/ui/CategoryPicker';
import Image from 'next/image';

// ─── Category slug sets, mirrored from listings/create/page.tsx so a
// bulk-posted item gets exactly the same category-specific detail sections
// (vehicle / property / job) and product-option suggestions that a seller
// posting a single listing would see. Keep these in sync with that file. ───

const MOTOR_SLUGS = new Set([
  'motors', 'used-cars', 'new-cars', 'classic-cars', 'other-vehicles',
  'motorcycles', 'trucks-buses', 'boats', 'parts-accessories', 'car-parts',
  'tyres-wheels', 'car-accessories', 'vehicles', 'cars', 'trucks',
  'spare-parts',
]);

const PROPERTY_SLUGS = new Set([
  'property', 'real-estate', 'apartments-rent', 'houses-rent', 'rooms-rent',
  'apartments-sale', 'houses-sale', 'land-plots', 'office-space', 'shops-retail',
  'warehouses', 'villas', 'commercial', 'land',
]);

const JOBS_SLUGS = new Set([
  'jobs', 'full-time', 'part-time', 'freelance', 'internship', 'careers',
  'remote-jobs', 'job-listings',
]);

const LAPTOP_SLUGS = new Set([
  'laptops', 'computers', 'notebooks', 'ultrabooks', 'gaming-laptops',
  'macbooks', 'chromebooks', 'desktops', 'all-in-one',
]);

const CLOTHING_SLUGS = new Set([
  'fashion', 'clothing', 'clothes', 'shirts', 'trousers', 'dresses', 'skirts',
  'shoes', 'footwear', 'sneakers', 'heels', 'boots', 'accessories', 'bags',
  'women-fashion', 'men-fashion', 'kids-fashion', 'sportswear', 'underwear',
  'jackets', 'coats', 'suits', 'jeans', 'tops', 'activewear',
]);

const ELECTRONICS_SLUGS = new Set([
  'electronics', 'smartphones', 'tablets', 'headphones', 'cameras',
  'consoles', 'games-accessories', 'televisions', 'smart-home',
  'wearables', 'audio', 'networking', 'phones',
]);

const APPLIANCE_SLUGS = new Set([
  'appliances', 'home-appliances', 'washing-machines', 'refrigerators', 'fridges',
  'ovens', 'microwaves', 'dishwashers', 'air-conditioners', 'heaters', 'fans',
  'vacuum-cleaners', 'coffee-machines', 'blenders', 'kitchen-appliances',
]);

const FURNITURE_SLUGS = new Set([
  'furniture', 'sofas', 'beds', 'tables', 'chairs', 'wardrobes',
  'home-decor', 'kitchen', 'lighting', 'shelves', 'desks', 'cabinets',
]);

const VEHICLE_SLUGS = new Set([
  'motors', 'cars', 'used-cars', 'new-cars', 'motorcycles', 'trucks',
  'vehicles', 'classic-cars', 'trucks-buses', 'boats',
]);

const WATCH_JEWELLERY_SLUGS = new Set([
  'watches', 'fine-jewellery', 'jewellery', 'jewelry', 'rings', 'necklaces',
  'bracelets', 'earrings',
]);

const SPORT_SLUGS = new Set([
  'sports', 'fitness', 'gym', 'cycling', 'outdoor', 'camping', 'swimming',
  'sports-equipment',
]);

const FOOD_SLUGS = new Set([
  'food', 'food-beverages', 'groceries', 'beverages',
]);

/** Returns standard ecommerce product option suggestions based on category slug */
function getProductOptionSuggestions(categorySlug: string): Array<{ name: string; values: string }> {
  if (LAPTOP_SLUGS.has(categorySlug)) {
    return [
      { name: 'Color',   values: 'Space Gray, Silver, Black, White, Gold, Rose Gold' },
      { name: 'RAM',     values: '4GB, 8GB, 16GB, 32GB, 64GB' },
      { name: 'Storage', values: '128GB SSD, 256GB SSD, 512GB SSD, 1TB SSD, 2TB SSD' },
      { name: 'Processor', values: 'Intel Core i3, Intel Core i5, Intel Core i7, Intel Core i9, AMD Ryzen 5, AMD Ryzen 7, Apple M1, Apple M2, Apple M3' },
      { name: 'Screen Size', values: '13", 14", 15.6", 16", 17"' },
    ];
  }
  if (CLOTHING_SLUGS.has(categorySlug)) {
    return [
      { name: 'Size',    values: 'XS, S, M, L, XL, XXL, XXXL' },
      { name: 'Color',   values: 'Black, White, Red, Blue, Green, Yellow, Navy, Gray, Pink, Brown, Beige' },
      { name: 'Material', values: 'Cotton, Polyester, Linen, Silk, Wool, Denim, Leather, Nylon' },
    ];
  }
  if (APPLIANCE_SLUGS.has(categorySlug)) {
    return [
      { name: 'Color',    values: 'White, Silver, Black, Stainless Steel, Gray' },
      { name: 'Capacity', values: '5L, 7L, 10L, 15L, 20L, 50L, 100L, 200L, 300L' },
      { name: 'Wattage',  values: '500W, 750W, 1000W, 1200W, 1500W, 2000W, 2500W, 3000W' },
      { name: 'Energy Rating', values: 'A+, A++, A+++, B, C' },
      { name: 'Voltage', values: '110V, 220V, 240V, Dual Voltage' },
    ];
  }
  if (ELECTRONICS_SLUGS.has(categorySlug)) {
    return [
      { name: 'Brand',     values: 'Apple, Samsung, Sony, Huawei, Xiaomi, OnePlus, LG, Oppo' },
      { name: 'Storage',   values: '32GB, 64GB, 128GB, 256GB, 512GB, 1TB' },
      { name: 'Color',     values: 'Black, White, Silver, Gold, Blue, Green, Purple' },
      { name: 'Connectivity', values: 'Wi-Fi, 4G, 5G, Bluetooth, USB-C, HDMI' },
      { name: 'Condition', values: 'Brand New, Like New, Refurbished, Good, Fair' },
    ];
  }
  if (FURNITURE_SLUGS.has(categorySlug)) {
    return [
      { name: 'Color',    values: 'Brown, Black, White, Gray, Natural Wood, Beige, Oak, Walnut' },
      { name: 'Material', values: 'Solid Wood, MDF, Metal, Fabric, Leather, Glass, Plastic, Rattan' },
      { name: 'Dimensions', values: 'Small (1-2 seater), Medium (3 seater), Large (4+ seater), Custom' },
      { name: 'Assembly', values: 'Ready Assembled, Self-Assembly Required' },
    ];
  }
  if (VEHICLE_SLUGS.has(categorySlug)) {
    return [
      { name: 'Color',        values: 'White, Black, Silver, Gray, Red, Blue, Green, Brown' },
      { name: 'Transmission', values: 'Automatic, Manual, CVT, Semi-Automatic' },
      { name: 'Fuel Type',    values: 'Petrol, Diesel, Electric, Hybrid, LPG' },
      { name: 'Condition',    values: 'Brand New, Excellent, Good, Fair, For Parts' },
    ];
  }
  if (WATCH_JEWELLERY_SLUGS.has(categorySlug)) {
    return [
      { name: 'Material', values: 'Gold, Silver, Platinum, Rose Gold, Stainless Steel, Titanium' },
      { name: 'Color',    values: 'Gold, Silver, Rose Gold, Black, White, Blue' },
      { name: 'Size',     values: 'XS, S, M, L, XL, Custom' },
      { name: 'Gemstone', values: 'Diamond, Ruby, Sapphire, Emerald, Pearl, None' },
    ];
  }
  if (SPORT_SLUGS.has(categorySlug)) {
    return [
      { name: 'Size',   values: 'XS, S, M, L, XL, XXL' },
      { name: 'Color',  values: 'Black, White, Blue, Red, Green, Gray' },
      { name: 'Weight', values: '1kg, 2kg, 5kg, 10kg, 15kg, 20kg, Custom' },
    ];
  }
  if (FOOD_SLUGS.has(categorySlug)) {
    return [
      { name: 'Weight / Volume', values: '250g, 500g, 1kg, 2kg, 5kg, 250ml, 500ml, 1L, 2L' },
      { name: 'Dietary',        values: 'Halal, Organic, Vegan, Gluten-Free, Dairy-Free' },
    ];
  }
  // Default fallback for any other category
  return [
    { name: 'Color',  values: '' },
    { name: 'Size',   values: '' },
    { name: 'Material', values: '' },
  ];
}

const emptyMotorDetails = () => ({
  make: '', model: '', year: '', mileage: '', fuelType: '', transmission: '',
  bodyType: '', engineCC: '', color: '', doors: '',
});

const emptyPropertyDetails = () => ({
  propertyType: '', listingType: '', bedrooms: '', bathrooms: '',
  furnishedStatus: '', sizeSqft: '', floor: '',
});

const emptyJobDetails = () => ({
  employmentType: '', salaryMin: '', salaryMax: '', experienceLevel: '',
  workLocation: '', industry: '', applicationDeadline: '',
});

const emptyItem = () => ({
  title: '',
  description: '',
  price: '',
  condition: 'NEW',
  country: 'UAE' as Country,
  location: '',
  categoryId: '',
  stock: '',
  tags: '',
  images: [] as File[],
  imagePreviews: [] as string[],
  // Filenames (from the CSV "images" column) that the bulk image dropzone
  // should route to this item once the admin uploads the actual files —
  // this is the "marking" that directs each photo to its right listing.
  expectedImageFilenames: [] as string[],
  // Filenames from expectedImageFilenames that haven't been matched to an
  // uploaded file yet — drives the "waiting on photos" indicator.
  unmatchedImageFilenames: [] as string[],
  // Set when the CSV category cell didn't match exactly and had to be
  // resolved via a synonym or fuzzy guess — surfaced in the UI so the admin
  // can confirm it before publishing.
  categoryAutoMatchNote: '' as string,
  // Product options: colour, size, RAM, etc.
  productOptions: [] as { id: string; name: string; values: string }[],
  // Category-specific detail blocks — mirrors listings/create/page.tsx so a
  // bulk-posted vehicle/property/job listing carries the same structured
  // data a single listing would.
  motorDetails: emptyMotorDetails(),
  propertyDetails: emptyPropertyDetails(),
  jobDetails: emptyJobDetails(),
  // UI-only: collapsed items show a one-line summary instead of the full
  // form, so posting many listings in one go stays manageable.
  collapsed: false,
});

type BulkItem = ReturnType<typeof emptyItem>;

function findCategory(categories: Category[], id: string): Category | undefined {
  for (const cat of categories) {
    if (cat.id === id) return cat;
    if (cat.children) {
      const child = cat.children.find((c) => c.id === id);
      if (child) return child;
    }
  }
  return undefined;
}

function getCategoryLabel(categories: Category[], id: string): string {
  for (const category of categories) {
    if (category.id === id) return category.name;
    if (category.children) {
      for (const child of category.children) {
        if (child.id === id) return `${category.name} / ${child.name}`;
      }
    }
  }
  return '';
}

// ─── CSV import automation ──────────────────────────────────────────────────
// Lets an admin paste/upload a spreadsheet of listings instead of filling in
// each one by hand — this is what makes posting hundreds of listings through
// this page actually faster and more accurate than repeating the single
// /listings/create flow hundreds of times.

const CSV_COLUMNS = [
  'title', 'description', 'price', 'condition', 'country', 'location',
  'category', 'stock', 'tags', 'options', 'images',
] as const;

const CSV_TEMPLATE = [
  CSV_COLUMNS.join(','),
  [
    'iPhone 15 Pro Max 256GB', '"Brand new, sealed box, 1 year warranty"', '4200', 'NEW', 'UAE', 'Dubai',
    'Smartphones', '25', 'apple,iphone,5g', '"Color:Black|White|Titanium;Storage:256GB|512GB"', 'iphone-front.jpg|iphone-back.jpg',
  ].join(','),
  [
    'Toyota Camry 2019', '"Well maintained, single owner, full service history"', '65000', 'USED', 'UAE', 'Abu Dhabi',
    'Used Cars', '1', 'toyota,sedan', '', 'camry-1.jpg|camry-2.jpg|camry-3.jpg',
  ].join(','),
].join('\n');

/** Triggers a browser download of the CSV template so admins know the exact expected shape. */
function downloadCsvTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bulk-listings-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Minimal RFC4180-ish CSV parser: handles quoted fields, escaped quotes ("") and commas inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Normalize line endings so \r\n and \r don't produce stray blank rows.
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  // Flush the last field/row if the text didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

interface FlatCategory { id: string; slug: string; name: string; label: string }

function flattenCategories(categories: Category[]): FlatCategory[] {
  const flat: FlatCategory[] = [];
  for (const cat of categories) {
    flat.push({ id: cat.id, slug: cat.slug, name: cat.name, label: cat.name });
    for (const child of cat.children || []) {
      flat.push({ id: child.id, slug: child.slug, name: child.name, label: `${cat.name} / ${child.name}` });
    }
  }
  return flat;
}

// ─── Category synonym map ───────────────────────────────────────────────────
// CSV exports (especially AI-generated ones, like product feeds from
// DeepSeek/ChatGPT) tend to invent plausible-sounding category names —
// "Home Appliances", "Computers & Laptops", "Small Kitchen Appliances" —
// that don't exist verbatim in this site's taxonomy (which has "Appliances",
// "Laptops", etc). Rather than reject every row that doesn't spell the
// category exactly right, map the common variants straight to the real slug.
// Keep this in sync with backend/prisma/seed.ts's category list.
const CATEGORY_SYNONYMS: Record<string, string> = {
  'home appliances': 'appliances',
  'household appliances': 'appliances',
  'kitchen appliances': 'appliances',
  'small kitchen appliances': 'appliances',
  'small appliances': 'appliances',
  'major appliances': 'appliances',
  'white goods': 'appliances',
  'computers & laptops': 'laptops',
  'computers and laptops': 'laptops',
  'computers': 'laptops',
  'laptops & computers': 'laptops',
  'laptop': 'laptops',
  'desktop computers': 'desktops',
  'desktops & monitors': 'desktops',
  'monitors': 'desktops',
  'mobile phones': 'smartphones',
  'phones': 'smartphones',
  'cell phones': 'smartphones',
  'audio & headphones': 'headphones',
  'gaming': 'consoles',
  'gaming consoles': 'consoles',
  'kitchen & dining': 'kitchen-dining',
  'kitchen furniture': 'kitchen-dining',
  'sofas & living room': 'living-room',
  'bedroom furniture': 'bedroom',
  'used cars': 'used-cars',
  'new cars': 'new-cars',
  'car parts & accessories': 'car-parts',
};

/** Cheap token-overlap similarity so near-miss category names (typos, reordering, extra words) can still resolve. */
function fuzzyScore(a: string, b: string): number {
  const setA = new Set(a.split(/[^a-z0-9]+/).filter(Boolean));
  const setB = new Set(b.split(/[^a-z0-9]+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const tok of setA) if (setB.has(tok)) shared++;
  return shared / Math.max(setA.size, setB.size);
}

interface CategoryResolution {
  id: string | null;
  /** Set when the match wasn't exact, so the UI can flag it for a quick human check. */
  matchedVia?: 'synonym' | 'fuzzy';
  /** Closest candidate names to show in the error when nothing resolves. */
  suggestions?: string[];
}

/** Resolves a CSV "category" cell (slug, leaf name, "Parent / Child", known synonym, or close fuzzy match) to a category id. */
function resolveCategoryId(raw: string, flat: FlatCategory[]): CategoryResolution {
  const needle = raw.trim().toLowerCase();
  if (!needle) return { id: null };

  const bySlug = flat.find((c) => c.slug.toLowerCase() === needle);
  if (bySlug) return { id: bySlug.id };
  const byLabel = flat.find((c) => c.label.toLowerCase() === needle);
  if (byLabel) return { id: byLabel.id };
  const byName = flat.find((c) => c.name.toLowerCase() === needle);
  if (byName) return { id: byName.id };

  const synonymSlug = CATEGORY_SYNONYMS[needle];
  if (synonymSlug) {
    const bySynonym = flat.find((c) => c.slug === synonymSlug);
    if (bySynonym) return { id: bySynonym.id, matchedVia: 'synonym' };
  }

  // Fuzzy fallback: only auto-accept when there's one clearly-best candidate,
  // so an ambiguous CSV cell doesn't get silently misfiled.
  const scored = flat
    .map((c) => ({ c, score: Math.max(fuzzyScore(needle, c.name.toLowerCase()), fuzzyScore(needle, c.label.toLowerCase())) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0 && scored[0].score >= 0.5 && (scored.length === 1 || scored[0].score - scored[1].score >= 0.15)) {
    return { id: scored[0].c.id, matchedVia: 'fuzzy' };
  }

  return { id: null, suggestions: scored.slice(0, 3).map((s) => s.c.label) };
}

/** Parses the "Name:Value1|Value2;Name2:Value1|Value2" mini-syntax for product options. */
function parseOptionsCell(raw: string): { id: string; name: string; values: string }[] {
  if (!raw.trim()) return [];
  return raw
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [name, valuesPart = ''] = chunk.split(':');
      return {
        id: Math.random().toString(36).slice(2),
        name: (name || '').trim(),
        values: valuesPart.split('|').map((v) => v.trim()).filter(Boolean).join(', '),
      };
    })
    .filter((o) => o.name);
}

interface CsvImportResult {
  imported: BulkItem[];
  rowErrors: { row: number; message: string }[];
}

/** Converts parsed CSV rows into BulkItems, matching categories and validating each row independently. */
function csvRowsToItems(rows: string[][], categories: Category[]): CsvImportResult {
  const flat = flattenCategories(categories);
  const imported: BulkItem[] = [];
  const rowErrors: CsvImportResult['rowErrors'] = [];
  if (rows.length === 0) return { imported, rowErrors };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const colIndex = (name: string) => header.indexOf(name);
  const idx = {
    title: colIndex('title'),
    description: colIndex('description'),
    price: colIndex('price'),
    condition: colIndex('condition'),
    country: colIndex('country'),
    location: colIndex('location'),
    category: colIndex('category'),
    stock: colIndex('stock'),
    tags: colIndex('tags'),
    options: colIndex('options'),
    images: colIndex('images'),
  };
  if (idx.title === -1 || idx.price === -1 || idx.category === -1) {
    rowErrors.push({ row: 0, message: 'Header row must include at least "title", "price" and "category" columns.' });
    return { imported, rowErrors };
  }

  const VALID_COUNTRIES: Country[] = ['UAE', 'UGANDA', 'KENYA', 'CHINA'];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (i: number) => (i >= 0 && i < cells.length ? cells[i].trim() : '');
    const rowNum = r + 1; // 1-based, header is row 1

    // A row with more (or fewer) cells than the header almost always means a
    // text field — most often `tags` — contains a comma but wasn't wrapped
    // in quotes. An unquoted comma splits that one field into several, which
    // silently shifts every column after it: `options` ends up holding a
    // stray tag, and the real options data gets pushed off the end and
    // dropped entirely. Reject the row loudly instead of importing
    // misaligned, corrupted data.
    if (cells.length !== header.length) {
      rowErrors.push({
        row: rowNum,
        message: `Found ${cells.length} columns, expected ${header.length}. A field (commonly "tags") likely contains a comma but isn't wrapped in quotes — wrap it in double quotes (e.g. "britannia,ac,inverter") and re-export, or every column after it will be misaligned.`,
      });
      continue;
    }

    const title = get(idx.title);
    const price = get(idx.price);
    const categoryRaw = get(idx.category);
    if (!title) { rowErrors.push({ row: rowNum, message: 'Missing title' }); continue; }
    if (!price || isNaN(Number(price)) || Number(price) < 0) { rowErrors.push({ row: rowNum, message: 'Missing or invalid price' }); continue; }
    if (!categoryRaw) { rowErrors.push({ row: rowNum, message: 'Missing category' }); continue; }
    const categoryResolution = resolveCategoryId(categoryRaw, flat);
    if (!categoryResolution.id) {
      const hint = categoryResolution.suggestions?.length
        ? ` Did you mean: ${categoryResolution.suggestions.join(', ')}?`
        : '';
      rowErrors.push({ row: rowNum, message: `Category "${categoryRaw}" not found.${hint}` });
      continue;
    }
    const categoryId = categoryResolution.id;
    const categoryAutoMatchNote = categoryResolution.matchedVia
      ? `Matched "${categoryRaw}" → ${getCategoryLabel(categories, categoryId)} (${categoryResolution.matchedVia === 'synonym' ? 'known alias' : 'closest match'}) — double-check before publishing.`
      : '';

    const stockRaw = get(idx.stock);
    if (!stockRaw) { rowErrors.push({ row: rowNum, message: 'Missing stock' }); continue; }
    const stockNum = parseInt(stockRaw, 10);
    if (isNaN(stockNum) || stockNum < 0 || String(stockNum) !== stockRaw) {
      rowErrors.push({ row: rowNum, message: 'Stock must be a non-negative whole number' });
      continue;
    }

    const countryRaw = (get(idx.country) || 'UAE').toUpperCase() as Country;
    const country = VALID_COUNTRIES.includes(countryRaw) ? countryRaw : 'UAE';
    const conditionRaw = (get(idx.condition) || 'NEW').toUpperCase();
    const condition = conditionRaw === 'USED' ? 'USED' : 'NEW';
    const location = get(idx.location);
    if (!location) { rowErrors.push({ row: rowNum, message: 'Missing location' }); continue; }

    const imageFilenames = idx.images !== -1
      ? get(idx.images).split('|').map((f) => f.trim()).filter(Boolean)
      : [];

    const item: BulkItem = {
      ...emptyItem(),
      title,
      description: get(idx.description) || title,
      price,
      condition,
      country,
      location,
      categoryId,
      categoryAutoMatchNote,
      stock: stockRaw,
      tags: get(idx.tags),
      productOptions: idx.options !== -1 ? parseOptionsCell(get(idx.options)) : [],
      expectedImageFilenames: imageFilenames,
      unmatchedImageFilenames: imageFilenames,
      collapsed: true,
    };
    imported.push(item);
  }

  return { imported, rowErrors };
}


export default function AdminBulkPostPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<BulkItem[]>([emptyItem()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // "Apply to all" quick-fill — for bulk-posting many similar listings
  // (e.g. a stock drop in one category/country) effortlessly instead of
  // re-selecting the same category, country and condition on every item.
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkCountry, setBulkCountry] = useState<Country>('UAE');
  const [bulkCondition, setBulkCondition] = useState('NEW');

  // ── CSV import automation ──────────────────────────────────────────────
  // Populates `items` from a pasted/uploaded spreadsheet instead of manual
  // entry, so posting a large batch is a paste + click instead of N trips
  // through this form (or N trips through /listings/create).
  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvRowErrors, setCsvRowErrors] = useState<{ row: number; message: string }[]>([]);
  const [csvImportedCount, setCsvImportedCount] = useState<number | null>(null);
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Bulk image routing ─────────────────────────────────────────────────
  // Once listings are imported from CSV, they're "awaiting photos" — each
  // one knows which filenames it expects (from the CSV's `images` column,
  // e.g. "camry-1.jpg|camry-2.jpg"). This lets an admin select/drop ALL the
  // photos for the whole batch at once here, and each file gets routed to
  // the listing that named it, instead of opening every listing individually.
  const bulkImageInputRef = useRef<HTMLInputElement | null>(null);
  const [bulkImageMatchSummary, setBulkImageMatchSummary] = useState<{ matched: number; unmatchedFiles: string[] } | null>(null);

  // ── Chunked submission progress ────────────────────────────────────────
  // The backend caps a single bulk request at 50 listings, so batches
  // larger than that are automatically split into sequential chunks here —
  // the admin just clicks "Post" once regardless of how many listings are
  // queued up.
  const [submitProgress, setSubmitProgress] = useState<{ done: number; total: number; batch: number; batches: number } | null>(null);

  const handleCsvFile = (file: File) => {
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  };

  const handleImportCsv = () => {
    setError('');
    setCsvRowErrors([]);
    setCsvImportedCount(null);
    if (!csvText.trim()) {
      setError('Paste or upload CSV content first.');
      return;
    }
    const rows = parseCsv(csvText);
    const { imported, rowErrors } = csvRowsToItems(rows, categories);
    if (imported.length > 0) {
      setItems((prev) => {
        // Replace the single untouched default row instead of leaving a
        // blank listing at the top of a freshly-imported batch.
        const base = prev.length === 1 && !prev[0].title.trim() && !prev[0].description.trim() ? [] : prev.map((it) => ({ ...it, collapsed: true }));
        return [...base, ...imported];
      });
    }
    setCsvRowErrors(rowErrors);
    setCsvImportedCount(imported.length);
  };

  // Routes a batch of dropped/selected image files to whichever imported
  // listing named them in the CSV's `images` column (case-insensitive
  // filename match). Files that no listing expects are reported back so
  // nothing silently vanishes.
  const handleBulkImageFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);
    const claimed = new Set<number>();
    let matchedCount = 0;

    const next = items.map((item) => {
      if (item.unmatchedImageFilenames.length === 0) return item;
      const newImages: File[] = [];
      const newPreviews: string[] = [];
      const stillUnmatched: string[] = [];
      for (const expected of item.unmatchedImageFilenames) {
        const fileIdx = fileArr.findIndex((f, i) => !claimed.has(i) && f.name.toLowerCase() === expected.toLowerCase());
        if (fileIdx !== -1) {
          claimed.add(fileIdx);
          newImages.push(fileArr[fileIdx]);
          newPreviews.push(URL.createObjectURL(fileArr[fileIdx]));
          matchedCount++;
        } else {
          stillUnmatched.push(expected);
        }
      }
      if (newImages.length === 0) return item;
      return {
        ...item,
        images: [...item.images, ...newImages].slice(0, 10),
        imagePreviews: [...item.imagePreviews, ...newPreviews].slice(0, 10),
        unmatchedImageFilenames: stillUnmatched,
      };
    });

    const unmatchedFiles = fileArr.filter((_, i) => !claimed.has(i)).map((f) => f.name);
    setItems(next);
    setBulkImageMatchSummary({ matched: matchedCount, unmatchedFiles });
    if (bulkImageInputRef.current) bulkImageInputRef.current.value = '';
  };

  const fetchCategories = useCallback(async () => {
    try {
      const { data } = await api.get('/categories');
      setCategories(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role === 'ADMIN') fetchCategories();
  }, [user, fetchCategories]);

  // Adds a fresh, expanded item and collapses the rest so the page stays
  // short as the batch grows — the item you're actively filling in is
  // always the only one fully open.
  const addItems = (count: number) => {
    setItems((prev) => [
      ...prev.map((it) => ({ ...it, collapsed: true })),
      ...Array.from({ length: count }, () => emptyItem()),
    ]);
  };

  // Clones a listing (everything except its images — each listing should
  // get its own photos) right after the original, so near-identical items
  // (e.g. the same product in different colours) can be posted in seconds.
  const duplicateItem = (index: number) => {
    setItems((prev) => {
      const source = prev[index];
      const clone: BulkItem = {
        ...source,
        images: [],
        imagePreviews: [],
        expectedImageFilenames: [],
        unmatchedImageFilenames: [],
        productOptions: source.productOptions.map((o) => ({ ...o, id: Math.random().toString(36).slice(2) })),
        motorDetails: { ...source.motorDetails },
        propertyDetails: { ...source.propertyDetails },
        jobDetails: { ...source.jobDetails },
        collapsed: false,
      };
      const next = prev.map((it) => ({ ...it, collapsed: true }));
      next.splice(index + 1, 0, clone);
      return next;
    });
  };

  const toggleCollapsed = (index: number) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, collapsed: !it.collapsed } : it)));

  const setAllCollapsed = (collapsed: boolean) =>
    setItems((prev) => prev.map((it) => ({ ...it, collapsed })));

  const applyToAll = () => {
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        ...(bulkCategoryId ? { categoryId: bulkCategoryId } : {}),
        country: bulkCountry,
        // Locations are country-specific, so reset any that no longer match.
        location: getLocations(bulkCountry).includes(it.location) ? it.location : '',
        condition: bulkCondition,
      }))
    );
  };

  // Product option helpers
  const addProductOption = (listingIndex: number) =>
    setItems((prev) =>
      prev.map((item, i) =>
        i === listingIndex
          ? { ...item, productOptions: [...item.productOptions, { id: Math.random().toString(36).slice(2), name: '', values: '' }] }
          : item,
      ),
    );

  const removeProductOption = (listingIndex: number, optId: string) =>
    setItems((prev) =>
      prev.map((item, i) =>
        i === listingIndex
          ? { ...item, productOptions: item.productOptions.filter((o) => o.id !== optId) }
          : item,
      ),
    );

  const updateProductOption = (listingIndex: number, optId: string, field: 'name' | 'values', val: string) =>
    setItems((prev) =>
      prev.map((item, i) =>
        i === listingIndex
          ? {
              ...item,
              productOptions: item.productOptions.map((o) => (o.id === optId ? { ...o, [field]: val } : o)),
            }
          : item,
      ),
    );

  const addSuggestedOption = (listingIndex: number, suggestion: { name: string; values: string }) =>
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== listingIndex) return item;
        const exists = item.productOptions.some((o) => o.name.toLowerCase() === suggestion.name.toLowerCase());
        if (exists) return item;
        return {
          ...item,
          productOptions: [...item.productOptions, { id: Math.random().toString(36).slice(2), ...suggestion }],
        };
      }),
    );

  const removeItem = (index: number) => {
    setItems((prev) => {
      const item = prev[index];
      item.imagePreviews.forEach((url) => URL.revokeObjectURL(url));
      return prev.filter((_, i) => i !== index);
    });
  };

  const updateItem = (
    index: number,
    field: keyof Omit<BulkItem, 'images' | 'imagePreviews' | 'productOptions' | 'motorDetails' | 'propertyDetails' | 'jobDetails' | 'collapsed' | 'expectedImageFilenames' | 'unmatchedImageFilenames'>,
    value: string,
  ) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  // Changing country resets location (locations are country-specific) and
  // implicitly changes the currency the listing is priced in, mirroring
  // listings/create — currency is always derived from country, never picked
  // independently, so a listing can't end up mismatched (e.g. UGX pricing
  // tagged as a UAE listing).
  const updateItemCountry = (index: number, country: Country) =>
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, country, location: '' } : item))
    );

  const updateMotorDetail = (index: number, field: keyof BulkItem['motorDetails'], value: string) =>
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, motorDetails: { ...item.motorDetails, [field]: value } } : item))
    );

  const updatePropertyDetail = (index: number, field: keyof BulkItem['propertyDetails'], value: string) =>
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, propertyDetails: { ...item.propertyDetails, [field]: value } } : item))
    );

  const updateJobDetail = (index: number, field: keyof BulkItem['jobDetails'], value: string) =>
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, jobDetails: { ...item.jobDetails, [field]: value } } : item))
    );

  const handleImageChange = (index: number, files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    const newPreviews = newFiles.map((f) => URL.createObjectURL(f));
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              images: [...item.images, ...newFiles].slice(0, 10),
              imagePreviews: [...item.imagePreviews, ...newPreviews].slice(0, 10),
            }
          : item
      )
    );
    // Reset file input so same file can be re-selected
    if (fileInputRefs.current[index]) fileInputRefs.current[index]!.value = '';
  };

  const removeImage = (listingIndex: number, imageIndex: number) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== listingIndex) return item;
        const url = item.imagePreviews[imageIndex];
        if (url) URL.revokeObjectURL(url);
        return {
          ...item,
          images: item.images.filter((_, j) => j !== imageIndex),
          imagePreviews: item.imagePreviews.filter((_, j) => j !== imageIndex),
        };
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate all items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.title.trim() || !item.description.trim() || !item.price || !item.location.trim() || !item.categoryId) {
        setError(`Item ${i + 1}: Please fill in all required fields (title, description, price, location, category).`);
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, collapsed: false } : it)));
        return;
      }
      if (item.stock === '' || item.stock == null) {
        setError(`Item ${i + 1}: Stock is required.`);
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, collapsed: false } : it)));
        return;
      }
      const parsedStock = parseInt(item.stock, 10);
      if (isNaN(parsedStock) || parsedStock < 0 || String(parsedStock) !== item.stock.trim()) {
        setError(`Item ${i + 1}: Stock must be a valid non-negative whole number.`);
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, collapsed: false } : it)));
        return;
      }
    }

    // Listings imported from CSV with an `images` column are "awaiting
    // photos" until the bulk image dropzone routes files to them (or the
    // admin uploads manually). Publishing without those photos is allowed
    // (images are optional) but easy to do by accident, so confirm first.
    const stillAwaitingPhotos = items.filter((it) => it.unmatchedImageFilenames.length > 0);
    if (stillAwaitingPhotos.length > 0) {
      const proceed = window.confirm(
        `${stillAwaitingPhotos.length} listing${stillAwaitingPhotos.length !== 1 ? 's are' : ' is'} still awaiting photos named in the CSV. Publish anyway without them?`
      );
      if (!proceed) return;
    }

    setSubmitting(true);
    setSubmitProgress(null);
    let totalCreated = 0;
    try {
      // Build the shared payload fields for one item — same shape POST
      // /listings accepts, so bulk-posted listings are indistinguishable
      // from ones created through the regular single-listing flow.
      const toPayload = (item: BulkItem) => {
        const cat = findCategory(categories, item.categoryId);
        const slug = cat?.slug ?? '';
        const isMotor = MOTOR_SLUGS.has(slug);
        const isProperty = PROPERTY_SLUGS.has(slug);
        const isJob = JOBS_SLUGS.has(slug);

        return {
          title: item.title.trim(),
          description: item.description.trim(),
          price: parseFloat(item.price),
          currency: getCurrency(item.country),
          condition: item.condition,
          country: item.country,
          location: item.location.trim(),
          categoryId: item.categoryId,
          categorySlug: slug,
          stock: parseInt(item.stock, 10),
          tags: item.tags ? item.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
          productOptions: item.productOptions
            .filter((o) => o.name.trim())
            .map((o) => ({
              name: o.name.trim(),
              values: o.values.split(',').map((v) => v.trim()).filter(Boolean),
            })),
          ...(isMotor && Object.values(item.motorDetails).some(Boolean) ? { motorDetails: item.motorDetails } : {}),
          ...(isProperty && Object.values(item.propertyDetails).some(Boolean) ? { propertyDetails: item.propertyDetails } : {}),
          ...(isJob && Object.values(item.jobDetails).some(Boolean) ? { jobDetails: item.jobDetails } : {}),
        };
      };

      // The backend caps a single bulk request at 50 listings (POST
      // /admin/listings/bulk[-media]), so a batch larger than that is
      // automatically split into sequential chunks here. This is what lets
      // an admin queue up hundreds of listings and post them in one click —
      // each chunk is a separate transaction on the backend, so a failure
      // partway through still leaves everything before it created (the
      // error message says exactly how far it got).
      const CHUNK_SIZE = 50;
      const chunks: BulkItem[][] = [];
      for (let i = 0; i < items.length; i += CHUNK_SIZE) chunks.push(items.slice(i, i + CHUNK_SIZE));

      for (let b = 0; b < chunks.length; b++) {
        const chunk = chunks[b];
        setSubmitProgress({ done: totalCreated, total: items.length, batch: b + 1, batches: chunks.length });

        const hasImages = chunk.some((item) => item.images.length > 0);

        if (hasImages) {
          const formData = new FormData();
          const listingsPayload = chunk.map(toPayload);
          formData.append('listings', JSON.stringify(listingsPayload));
          chunk.forEach((item, idx) => {
            item.images.forEach((file) => {
              formData.append(`images_${idx}`, file);
            });
          });

          const { data } = await api.post('/admin/listings/bulk-media', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          totalCreated += data.created;
        } else {
          const listings = chunk.map(toPayload);
          const { data } = await api.post('/admin/listings/bulk', { listings });
          totalCreated += data.created;
        }
      }

      setSubmitProgress({ done: totalCreated, total: items.length, batch: chunks.length, batches: chunks.length });
      setSuccess(
        chunks.length > 1
          ? `Successfully created ${totalCreated} listing${totalCreated !== 1 ? 's' : ''} across ${chunks.length} batches!`
          : `Successfully created ${totalCreated} listing${totalCreated !== 1 ? 's' : ''}!`
      );

      // Clear all image object URLs
      items.forEach((item) => item.imagePreviews.forEach((url) => URL.revokeObjectURL(url)));
      setItems([emptyItem()]);
      setCsvText('');
      setCsvFileName('');
      setCsvRowErrors([]);
      setCsvImportedCount(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const progressNote = totalCreated > 0
        ? ` (${totalCreated} of ${items.length} were already created before this failure — they do not need to be re-posted.)`
        : '';
      setError((msg || 'Failed to create listings. Please try again.') + progressNote);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Bulk Post Listings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create multiple listings at once, with the same vehicle/property/job
          details and product options as a regular listing. Import a CSV to
          queue up a large batch in seconds, or add listings one by one.
          Batches over 50 are posted automatically in sequential chunks, so
          any batch size is supported in a single click. Each listing is
          published immediately as ACTIVE. Images are automatically
          watermarked with <strong>3relite.com</strong> and stored
          category-wise in the bucket.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
          {success}
        </div>
      )}

      {submitting && submitProgress && (
        <div className="mb-4 p-3 bg-sky-50 border border-sky-200 rounded-xl text-sm text-sky-700">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-semibold">
              Posting batch {submitProgress.batch} of {submitProgress.batches}…
            </span>
            <span>{submitProgress.done} / {submitProgress.total} created</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-sky-100 overflow-hidden">
            <div
              className="h-full bg-sky-500 transition-all"
              style={{ width: `${Math.round((submitProgress.done / Math.max(submitProgress.total, 1)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* CSV import — the fast path for large batches: paste or upload a
          spreadsheet and every row becomes a queued listing below, instead
          of filling in title/price/category/etc. by hand for each one. */}
      <div className="mb-6 bg-violet-50 border border-violet-200 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700">
            📥 Import Listings from CSV
          </p>
          <button
            type="button"
            onClick={downloadCsvTemplate}
            className="text-xs font-semibold text-violet-700 hover:text-violet-900 underline"
          >
            Download template
          </button>
        </div>
        <p className="text-xs text-gray-600 mb-3">
          Columns: <code className="bg-white px-1 rounded border border-violet-200">{CSV_COLUMNS.join(', ')}</code>.
          {' '}<code className="bg-white px-1 rounded border border-violet-200">category</code> can be a category name, slug, or common alias (e.g. &quot;Home Appliances&quot; auto-matches to &quot;Appliances&quot;) — near-misses are also matched automatically and flagged for a quick check.
          {' '}<code className="bg-white px-1 rounded border border-violet-200">options</code> uses <code className="bg-white px-1 rounded border border-violet-200">Name:Value1|Value2;Name2:Value1</code>.
          {' '}<code className="bg-white px-1 rounded border border-violet-200">images</code> (optional) lists the filenames you&apos;ll upload for this listing, pipe-separated (e.g. <code className="bg-white px-1 rounded border border-violet-200">camry-1.jpg|camry-2.jpg</code>) — imported listings wait for these, and you can drop all the batch&apos;s photos at once below to route each one to the right listing.
          Rows are validated and matched to categories automatically — this is the fastest way to queue up a large batch.
          {' '}If a text field like <code className="bg-white px-1 rounded border border-violet-200">tags</code> contains a comma, wrap it in double quotes or the row will be rejected with a column-count error instead of silently misaligning your data.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => csvFileInputRef.current?.click()}
            className="px-4 py-2 rounded-xl bg-white border border-violet-300 text-violet-700 text-xs font-semibold hover:bg-violet-100 transition-colors"
          >
            {csvFileName ? `📄 ${csvFileName}` : 'Upload CSV file'}
          </button>
          <input
            ref={csvFileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleCsvFile(e.target.files[0])}
          />
          <span className="text-xs text-gray-500 self-center">or paste CSV content below</span>
        </div>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={4}
          placeholder={CSV_TEMPLATE}
          className="mt-2 w-full rounded-lg border border-violet-200 px-3 py-2 text-xs font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-y"
        />
        <div className="flex items-center justify-between mt-3">
          <button
            type="button"
            onClick={handleImportCsv}
            disabled={!csvText.trim()}
            className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
          >
            Import rows into batch below
          </button>
          {csvImportedCount !== null && (
            <span className={`text-xs font-semibold ${csvRowErrors.length > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {csvImportedCount} row{csvImportedCount !== 1 ? 's' : ''} imported
              {csvRowErrors.length > 0 ? `, ${csvRowErrors.length} skipped` : ''}
            </span>
          )}
        </div>
        {csvRowErrors.length > 0 && (
          <div className="mt-2 max-h-32 overflow-y-auto bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800 space-y-0.5">
            {csvRowErrors.map((e, i) => (
              <div key={i}>{e.row > 0 ? `Row ${e.row}` : 'CSV'}: {e.message}</div>
            ))}
          </div>
        )}
      </div>

      {/* Bulk image routing — drop every photo for the whole batch at once;
          each file is matched by filename to the listing that named it in
          the CSV's `images` column, so listings imported without photos yet
          get them assigned automatically instead of one-by-one. */}
      {items.some((it) => it.expectedImageFilenames.length > 0) && (
        <div className="mb-6 bg-teal-50 border border-teal-200 rounded-2xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700 mb-2">
            🖼️ Bulk Image Routing
          </p>
          <p className="text-xs text-gray-600 mb-3">
            {items.reduce((n, it) => n + it.unmatchedImageFilenames.length, 0)} photo{items.reduce((n, it) => n + it.unmatchedImageFilenames.length, 0) !== 1 ? 's' : ''} still awaited across{' '}
            {items.filter((it) => it.unmatchedImageFilenames.length > 0).length} listing{items.filter((it) => it.unmatchedImageFilenames.length > 0).length !== 1 ? 's' : ''}.
            {' '}Select or drop all the photos for this batch at once — each file is routed to the listing whose{' '}
            <code className="bg-white px-1 rounded border border-teal-200">images</code> column named it (matched by filename, e.g. <code className="bg-white px-1 rounded border border-teal-200">camry-1.jpg</code>).
          </p>
          <div
            className="border-2 border-dashed border-teal-300 rounded-xl p-4 flex flex-col items-center justify-center gap-2 bg-white/60 hover:bg-teal-100/40 hover:border-teal-500 transition-colors cursor-pointer"
            onClick={() => bulkImageInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleBulkImageFiles(e.dataTransfer.files); }}
          >
            <svg className="w-8 h-8 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-xs text-teal-700 font-semibold">Click or drag &amp; drop all photos for this batch</p>
            <p className="text-[10px] text-gray-400">Filenames must match the CSV&apos;s images column</p>
          </div>
          <input
            ref={bulkImageInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleBulkImageFiles(e.target.files)}
          />
          {bulkImageMatchSummary && (
            <div className="mt-3 text-xs space-y-1">
              <p className="text-teal-700 font-semibold">
                ✓ {bulkImageMatchSummary.matched} photo{bulkImageMatchSummary.matched !== 1 ? 's' : ''} routed to their listings.
              </p>
              {bulkImageMatchSummary.unmatchedFiles.length > 0 && (
                <div className="text-amber-700">
                  <p className="font-semibold">{bulkImageMatchSummary.unmatchedFiles.length} file{bulkImageMatchSummary.unmatchedFiles.length !== 1 ? 's' : ''} didn&apos;t match any listing&apos;s expected filenames:</p>
                  <p className="text-amber-600">{bulkImageMatchSummary.unmatchedFiles.join(', ')}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Apply to all — quick-fill shared fields across every listing */}
      <div className="mb-6 bg-sky-50 border border-sky-200 rounded-2xl p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700 mb-3">
          ⚡ Apply to All {items.length} Listing{items.length !== 1 ? 's' : ''}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-gray-700 mb-1">Category</label>
            <CategoryPicker
              categories={categories}
              value={bulkCategoryId}
              onChange={setBulkCategoryId}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Country</label>
            <select
              value={bulkCountry}
              onChange={(e) => setBulkCountry(e.target.value as Country)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              <option value="UAE">🇦🇪 UAE</option>
              <option value="UGANDA">🇺🇬 Uganda</option>
              <option value="KENYA">🇰🇪 Kenya</option>
              <option value="CHINA">🇨🇳 China</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Condition</label>
            <select
              value={bulkCondition}
              onChange={(e) => setBulkCondition(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              <option value="NEW">New</option>
              <option value="USED">Used</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          <button
            type="button"
            onClick={applyToAll}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold transition-colors"
          >
            Apply to all {items.length} listing{items.length !== 1 ? 's' : ''}
          </button>
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => setAllCollapsed(true)} className="text-sky-700 hover:text-sky-900 font-semibold">
              Collapse all
            </button>
            <button type="button" onClick={() => setAllCollapsed(false)} className="text-sky-700 hover:text-sky-900 font-semibold">
              Expand all
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {items.map((item, index) => {
          const cat = findCategory(categories, item.categoryId);
          const slug = cat?.slug ?? '';
          const isMotorCategory = MOTOR_SLUGS.has(slug);
          const isPropertyCategory = PROPERTY_SLUGS.has(slug);
          const isJobCategory = JOBS_SLUGS.has(slug);
          const availableLocations = getLocations(item.country);
          const listingCurrency = getCurrency(item.country);
          const suggestions = cat ? getProductOptionSuggestions(cat.slug) : [];

          if (item.collapsed) {
            return (
              <div
                key={index}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex items-center justify-between gap-3 cursor-pointer hover:border-sky-300 transition-colors"
                onClick={() => toggleCollapsed(index)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {item.imagePreviews[0] ? (
                    <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                      <Image src={item.imagePreviews[0]} alt="" fill className="object-cover" unoptimized />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-gray-100 shrink-0 flex items-center justify-center text-gray-300">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 8h16" />
                      </svg>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {index + 1}. {item.title.trim() || 'Untitled listing'}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {item.price ? `${listingCurrency} ${item.price}` : 'No price'}
                      {cat ? ` · ${getCategoryLabel(categories, item.categoryId)}` : ' · No category'}
                      {item.imagePreviews.length > 0 ? ` · ${item.imagePreviews.length} photo${item.imagePreviews.length !== 1 ? 's' : ''}` : ''}
                      {item.unmatchedImageFilenames.length > 0 ? ` · ⏳ awaiting ${item.unmatchedImageFilenames.length} photo${item.unmatchedImageFilenames.length !== 1 ? 's' : ''}` : ''}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-sky-600 font-semibold shrink-0">Expand</span>
              </div>
            );
          }

          return (
            <div key={index} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <button
                  type="button"
                  onClick={() => toggleCollapsed(index)}
                  className="flex items-center gap-2 text-base font-semibold text-gray-800"
                >
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  Listing {index + 1}
                </button>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => duplicateItem(index)}
                    className="text-sky-600 hover:text-sky-800 text-sm font-medium"
                  >
                    Duplicate
                  </button>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="text-red-500 hover:text-red-700 text-sm font-medium"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {item.categoryAutoMatchNote && (
                <div className="mb-4 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  ⚠️ {item.categoryAutoMatchNote}
                </div>
              )}
              {item.unmatchedImageFilenames.length > 0 && (
                <div className="mb-4 p-2.5 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-800">
                  ⏳ Awaiting {item.unmatchedImageFilenames.length} photo{item.unmatchedImageFilenames.length !== 1 ? 's' : ''} from the CSV: {item.unmatchedImageFilenames.join(', ')}. Use the bulk image dropzone above, or upload manually below.
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Title */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={item.title}
                    onChange={(e) => updateItem(index, 'title', e.target.value)}
                    placeholder="Product title"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>

                {/* Description */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    value={item.description}
                    onChange={(e) => updateItem(index, 'description', e.target.value)}
                    placeholder="Product description. Use ## for headings and - for bullet points."
                    rows={3}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none"
                  />
                </div>

                {/* Country */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Country</label>
                  <select
                    value={item.country}
                    onChange={(e) => updateItemCountry(index, e.target.value as Country)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  >
                    <option value="UAE">🇦🇪 UAE</option>
                    <option value="UGANDA">🇺🇬 Uganda</option>
                    <option value="KENYA">🇰🇪 Kenya</option>
                    <option value="CHINA">🇨🇳 China</option>
                  </select>
                </div>

                {/* Price — currency is derived from country, same as listings/create */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Price ({listingCurrency}) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={item.price}
                    onChange={(e) => updateItem(index, 'price', e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>

                {/* Condition */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Condition</label>
                  <select
                    value={item.condition}
                    onChange={(e) => updateItem(index, 'condition', e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  >
                    <option value="NEW">New</option>
                    <option value="USED">Used</option>
                  </select>
                </div>

                {/* Location — country-specific select, matching listings/create */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Location <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={item.location}
                    onChange={(e) => updateItem(index, 'location', e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  >
                    <option value="">Select location</option>
                    {availableLocations.map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                </div>

                {/* Category */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Category <span className="text-red-500">*</span>
                  </label>
                  <CategoryPicker
                    categories={categories}
                    value={item.categoryId}
                    onChange={(id) => updateItem(index, 'categoryId', id)}
                  />
                </div>

                {/* Stock */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Stock *</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={item.stock}
                    onChange={(e) => updateItem(index, 'stock', e.target.value)}
                    placeholder="e.g. 10"
                    required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>

                {/* Tags */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Tags (optional, comma-separated)
                  </label>
                  <input
                    type="text"
                    value={item.tags}
                    onChange={(e) => updateItem(index, 'tags', e.target.value)}
                    placeholder="e.g. electronics, new, sale"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>

                {/* ─── MOTOR DETAILS SECTION ─── */}
                {isMotorCategory && (
                  <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700 mb-3">🚗 Vehicle Details</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Make / Brand</label>
                        <input
                          type="text"
                          value={item.motorDetails.make}
                          onChange={(e) => updateMotorDetail(index, 'make', e.target.value)}
                          placeholder="e.g. Toyota"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Model</label>
                        <input
                          type="text"
                          value={item.motorDetails.model}
                          onChange={(e) => updateMotorDetail(index, 'model', e.target.value)}
                          placeholder="e.g. Camry"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Year</label>
                        <input
                          type="number"
                          value={item.motorDetails.year}
                          onChange={(e) => updateMotorDetail(index, 'year', e.target.value)}
                          placeholder="e.g. 2020"
                          min="1900"
                          max={new Date().getFullYear() + 1}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Mileage (km)</label>
                        <input
                          type="number"
                          value={item.motorDetails.mileage}
                          onChange={(e) => updateMotorDetail(index, 'mileage', e.target.value)}
                          placeholder="e.g. 50000"
                          min="0"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Fuel Type</label>
                        <select
                          value={item.motorDetails.fuelType}
                          onChange={(e) => updateMotorDetail(index, 'fuelType', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        >
                          <option value="">Select fuel type</option>
                          <option>Petrol</option>
                          <option>Diesel</option>
                          <option>Hybrid</option>
                          <option>Electric</option>
                          <option>LPG</option>
                          <option>Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Transmission</label>
                        <select
                          value={item.motorDetails.transmission}
                          onChange={(e) => updateMotorDetail(index, 'transmission', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        >
                          <option value="">Select transmission</option>
                          <option>Automatic</option>
                          <option>Manual</option>
                          <option>Semi-Automatic</option>
                          <option>CVT</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Body Type</label>
                        <select
                          value={item.motorDetails.bodyType}
                          onChange={(e) => updateMotorDetail(index, 'bodyType', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        >
                          <option value="">Select body type</option>
                          <option>Sedan</option>
                          <option>SUV</option>
                          <option>Hatchback</option>
                          <option>Pickup Truck</option>
                          <option>Coupe</option>
                          <option>Convertible</option>
                          <option>Van</option>
                          <option>Bus</option>
                          <option>Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Engine (cc)</label>
                        <input
                          type="text"
                          value={item.motorDetails.engineCC}
                          onChange={(e) => updateMotorDetail(index, 'engineCC', e.target.value)}
                          placeholder="e.g. 2000"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Colour</label>
                        <input
                          type="text"
                          value={item.motorDetails.color}
                          onChange={(e) => updateMotorDetail(index, 'color', e.target.value)}
                          placeholder="e.g. Silver"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Doors</label>
                        <select
                          value={item.motorDetails.doors}
                          onChange={(e) => updateMotorDetail(index, 'doors', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        >
                          <option value="">Select</option>
                          <option>2</option>
                          <option>3</option>
                          <option>4</option>
                          <option>5</option>
                          <option>6+</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* ─── PROPERTY DETAILS SECTION ─── */}
                {isPropertyCategory && (
                  <div className="sm:col-span-2 rounded-xl border border-sky-200 bg-sky-50/50 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700 mb-3">🏠 Property Details</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Property Type</label>
                        <select
                          value={item.propertyDetails.propertyType}
                          onChange={(e) => updatePropertyDetail(index, 'propertyType', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                        >
                          <option value="">Select type</option>
                          <option>Apartment</option>
                          <option>Villa</option>
                          <option>House</option>
                          <option>Room</option>
                          <option>Office</option>
                          <option>Shop / Retail</option>
                          <option>Warehouse</option>
                          <option>Land / Plot</option>
                          <option>Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Listing Type</label>
                        <select
                          value={item.propertyDetails.listingType}
                          onChange={(e) => updatePropertyDetail(index, 'listingType', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                        >
                          <option value="">Select</option>
                          <option>For Rent</option>
                          <option>For Sale</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Bedrooms</label>
                        <select
                          value={item.propertyDetails.bedrooms}
                          onChange={(e) => updatePropertyDetail(index, 'bedrooms', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                        >
                          <option value="">Select</option>
                          <option>Studio</option>
                          <option>1</option>
                          <option>2</option>
                          <option>3</option>
                          <option>4</option>
                          <option>5</option>
                          <option>6+</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Bathrooms</label>
                        <select
                          value={item.propertyDetails.bathrooms}
                          onChange={(e) => updatePropertyDetail(index, 'bathrooms', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                        >
                          <option value="">Select</option>
                          <option>1</option>
                          <option>2</option>
                          <option>3</option>
                          <option>4+</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Furnished Status</label>
                        <select
                          value={item.propertyDetails.furnishedStatus}
                          onChange={(e) => updatePropertyDetail(index, 'furnishedStatus', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                        >
                          <option value="">Select</option>
                          <option>Furnished</option>
                          <option>Unfurnished</option>
                          <option>Part Furnished</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Size (sq ft)</label>
                        <input
                          type="number"
                          value={item.propertyDetails.sizeSqft}
                          onChange={(e) => updatePropertyDetail(index, 'sizeSqft', e.target.value)}
                          placeholder="e.g. 1200"
                          min="0"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Floor</label>
                        <input
                          type="text"
                          value={item.propertyDetails.floor}
                          onChange={(e) => updatePropertyDetail(index, 'floor', e.target.value)}
                          placeholder="e.g. Ground, 3rd"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ─── JOB DETAILS SECTION ─── */}
                {isJobCategory && (
                  <div className="sm:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 mb-3">💼 Job Details</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Employment Type</label>
                        <select
                          value={item.jobDetails.employmentType}
                          onChange={(e) => updateJobDetail(index, 'employmentType', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        >
                          <option value="">Select type</option>
                          <option>Full-Time</option>
                          <option>Part-Time</option>
                          <option>Freelance / Contract</option>
                          <option>Internship</option>
                          <option>Temporary</option>
                          <option>Volunteer</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Experience Level</label>
                        <select
                          value={item.jobDetails.experienceLevel}
                          onChange={(e) => updateJobDetail(index, 'experienceLevel', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        >
                          <option value="">Select level</option>
                          <option>Entry Level (0–2 yrs)</option>
                          <option>Mid Level (2–5 yrs)</option>
                          <option>Senior Level (5–10 yrs)</option>
                          <option>Executive (10+ yrs)</option>
                          <option>No Experience Required</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Salary Min</label>
                        <input
                          type="number"
                          value={item.jobDetails.salaryMin}
                          onChange={(e) => updateJobDetail(index, 'salaryMin', e.target.value)}
                          placeholder="e.g. 2000"
                          min="0"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Salary Max</label>
                        <input
                          type="number"
                          value={item.jobDetails.salaryMax}
                          onChange={(e) => updateJobDetail(index, 'salaryMax', e.target.value)}
                          placeholder="e.g. 5000"
                          min="0"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Work Location</label>
                        <select
                          value={item.jobDetails.workLocation}
                          onChange={(e) => updateJobDetail(index, 'workLocation', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        >
                          <option value="">Select</option>
                          <option>On-site</option>
                          <option>Remote</option>
                          <option>Hybrid</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Industry</label>
                        <input
                          type="text"
                          value={item.jobDetails.industry}
                          onChange={(e) => updateJobDetail(index, 'industry', e.target.value)}
                          placeholder="e.g. Technology, Finance"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="mb-1 block text-xs font-medium text-gray-700">Application Deadline</label>
                        <input
                          type="date"
                          value={item.jobDetails.applicationDeadline}
                          onChange={(e) => updateJobDetail(index, 'applicationDeadline', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Product Options */}
                <div className="sm:col-span-2 rounded-xl border border-purple-200 bg-purple-50/50 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-purple-700">🎨 Product Options</p>
                    <button
                      type="button"
                      onClick={() => addProductOption(index)}
                      className="text-xs text-purple-600 hover:text-purple-800 font-semibold"
                    >
                      + Add Option
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">
                    Add buyer-selectable options (Color, Size, RAM, Storage…). Values are comma-separated.
                  </p>
                  {suggestions.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] font-semibold text-purple-600 mb-1.5 uppercase tracking-wider">Suggested for this category:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestions.map((s) => (
                          <button
                            key={s.name}
                            type="button"
                            onClick={() => addSuggestedOption(index, s)}
                            className="text-[10px] bg-purple-100 text-purple-700 border border-purple-200 rounded-full px-2.5 py-1 font-semibold hover:bg-purple-200 transition-colors"
                          >
                            + {s.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {item.productOptions.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">No options added.</p>
                  ) : (
                    <div className="space-y-2">
                      {item.productOptions.map((opt) => (
                        <div key={opt.id} className="flex gap-2 items-start">
                          <input
                            type="text"
                            placeholder="Option (e.g. Color)"
                            value={opt.name}
                            onChange={(e) => updateProductOption(index, opt.id, 'name', e.target.value)}
                            className="w-28 shrink-0 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
                          />
                          <input
                            type="text"
                            placeholder="Values (e.g. Red, Blue, Green)"
                            value={opt.values}
                            onChange={(e) => updateProductOption(index, opt.id, 'values', e.target.value)}
                            className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
                          />
                          <button
                            type="button"
                            onClick={() => removeProductOption(index, opt.id)}
                            className="text-gray-400 hover:text-red-500 text-lg leading-none mt-0.5"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Images */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Images (optional · up to 10)
                  </label>
                  <div
                    className="border-2 border-dashed border-sky-200 rounded-xl p-4 flex flex-col items-center justify-center gap-2 bg-sky-50/40 hover:bg-sky-50 hover:border-sky-400 transition-colors cursor-pointer"
                    onClick={() => fileInputRefs.current[index]?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleImageChange(index, e.dataTransfer.files);
                    }}
                  >
                    <svg className="w-8 h-8 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-xs text-sky-600 font-semibold">Click or drag &amp; drop images</p>
                    <p className="text-[10px] text-gray-400">JPEG, PNG, GIF, WEBP · up to 20 MB each</p>
                  </div>
                  <input
                    ref={(el) => { fileInputRefs.current[index] = el; }}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => handleImageChange(index, e.target.files)}
                  />

                  {item.imagePreviews.length > 0 && (
                    <div className="mt-3 grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {item.imagePreviews.map((url, imgIdx) => (
                        <div key={url} className="relative group aspect-square rounded-lg overflow-hidden bg-gray-100">
                          <Image src={url} alt={`Preview ${imgIdx + 1}`} fill className="object-cover" unoptimized />
                          <button
                            type="button"
                            onClick={() => removeImage(index, imgIdx)}
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => addItems(1)}
            className="px-5 py-2.5 rounded-xl border border-sky-300 text-sky-700 text-sm font-semibold hover:bg-sky-50 transition-colors disabled:opacity-50"
          >
            + Add Another Listing
          </button>
          <button
            type="button"
            onClick={() => addItems(5)}
            className="px-5 py-2.5 rounded-xl border border-sky-300 text-sky-700 text-sm font-semibold hover:bg-sky-50 transition-colors disabled:opacity-50"
          >
            + Add 5 More
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 ml-auto"
          >
            {submitting
              ? (submitProgress ? `Publishing batch ${submitProgress.batch}/${submitProgress.batches}…` : 'Publishing…')
              : `Publish ${items.length} Listing${items.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </form>
    </div>
  );
}
