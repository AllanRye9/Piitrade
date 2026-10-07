'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useCountry } from '@/context/CountryContext';
import { api } from '@/lib/api';
import { Category, Country, SellerPackage, SellerSubscription } from '@/lib/types';
import { getCurrency, getLocations, resolveImageUrl } from '@/lib/utils';
import CategoryPicker from '@/components/ui/CategoryPicker';
import {
  saveListingDraft,
  loadListingDraft,
  clearListingDraft,
  isDraftMeaningful,
  type ListingDraftData,
} from '@/lib/listingDraft';
import { classifyImageUrl, identifyImageUrl, describeFromText } from '@/lib/imageAi';
import { suggestCategory, matchesSameItem, type CategoryMatch } from '@/lib/categoryMatch';

// Motors/Property/Jobs/Agriculture category-type gating no longer uses flat
// slug lists like the ones below — see isCategoryOrDescendant(), which
// walks the real category tree instead. That function replaced this
// exact class of bug: JOBS_SLUGS here never had 'technology', 'healthcare',
// or 'finance', so a listing posted under those real Jobs subcategories
// silently never got the Job Details fields (employment type, salary,
// etc.) at all. The product-option-suggestion slug sets just below this
// comment are a different, finer-grained mechanism (e.g. 'laptops' and
// 'smartphones' are both under Electronics but want different suggested
// option fields) that doesn't reduce to "is this under parent X" the way
// category-type gating does, so those remain flat lists — just kept in
// sync with the real seeded subcategory slugs (see the sync note on each
// one below for which seeded subcategories it covers).

// ─── Category slug sets for smart product option suggestions ──────────────────

const LAPTOP_SLUGS = new Set([
  'laptops', 'computers', 'notebooks', 'ultrabooks', 'gaming-laptops',
  'macbooks', 'chromebooks', 'desktops', 'all-in-one',
]);

const CLOTHING_SLUGS = new Set([
  'fashion', 'clothing', 'clothes', 'shirts', 'trousers', 'dresses', 'skirts',
  'shoes', 'footwear', 'sneakers', 'heels', 'boots', 'accessories', 'bags',
  'women-fashion', 'men-fashion', 'kids-fashion', 'sportswear', 'underwear',
  'jackets', 'coats', 'suits', 'jeans', 'tops', 'activewear',
  // Real seeded Fashion subcategory slugs (none of the above matched any
  // of these — see the gating-fix comment near the top of this file) —
  // kept alongside the generic aliases above for forward-compatibility.
  'women-clothing', 'women-shoes', 'women-bags', 'men-clothing', 'men-shoes',
  'girls-clothing', 'boys-clothing',
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
  // Real seeded Furniture & Garden / Classifieds subcategory slugs.
  'living-room', 'bedroom', 'kitchen-dining', 'garden-furniture',
  'furniture-classifieds',
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
  // Real seeded Classifieds subcategory slug.
  'sports-outdoors',
]);

// No "Food & Groceries" category exists anywhere in the seeded taxonomy
// (categories.ts) — fresh produce is covered by the Agriculture category
// instead (see isAgricultureCategory and its own priceUnit selector
// above). Nothing currently matches this set; left in place rather than
// deleted in case a Food category gets added later, at which point its
// real slugs should be added here the same way the other sets above were
// just synced.
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

// Filler openers the identify model tends to prepend ("a photo of a...",
// "this image shows a...") that make for a bad, non-product-like listing
// title if left in. Stripped before anything else so the classify label
// (usually the cleanest, shortest signal — e.g. "laptop computer") can lead.
const TITLE_FILLER_PREFIXES = [
  /^(this is|this|here is|here's)\s+/i,
  /^(a|an|the)\s+(photo|picture|image)\s+(of|showing)\s+/i,
  /^(a|an|the)\s+close-?up\s+(of|shot of)\s+/i,
  /^(image|photo|picture)\s+(of|showing)\s+/i,
  /^it\s+(is|appears to be|looks like)\s+/i,
  /^(showing|shows|displaying|featuring)\s+/i,
];

function toTitleCase(text: string): string {
  const SMALL_WORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'to']);
  return text
    .split(' ')
    .map((word, i) => {
      if (!word) return word;
      // Preserve things that already look intentional (model numbers, all-caps
      // acronyms like "SSD", mixed-case brand names like "iPhone").
      if (/[A-Z]/.test(word.slice(1)) || /\d/.test(word)) return word;
      if (i > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

const TITLE_MAX_LENGTH = 70; // short, scannable — matches standard ecommerce listing titles

/**
 * Builds a short, listing-style title from the AI's outputs.
 *
 * Per spec: the TITLE comes from the *identification* (the vision-language
 * model's natural-language description of what's actually in the photo —
 * brand, model, distinguishing detail), not the classifier. Classification
 * is a generic taxonomy label (e.g. "laptop computer, notebook computer")
 * and is reserved for the separate cross-photo matching check — using it
 * as the title source would produce generic, non-product-specific titles.
 * The classify label is only used here as a last-resort fallback when
 * identification returned nothing at all.
 */
function buildSuggestedTitle(description: string, classifyLabel: string | null): string {
  const cleanLabel = (classifyLabel || '').split(',')[0].trim(); // classify labels are often "a, b, c" synonym lists — first is best
  let base = (description || cleanLabel || '').trim();
  if (!base) return '';

  for (const re of TITLE_FILLER_PREFIXES) base = base.replace(re, '');
  // Use only the first clause/sentence — titles shouldn't be full descriptions.
  base = (base.split(/[.!?]|,\s+(?=and|which|it)/i)[0] || base).trim();
  base = base.replace(/\s+/g, ' ').trim();
  if (!base) return '';

  const title = toTitleCase(base);
  return title.length > TITLE_MAX_LENGTH ? `${title.slice(0, TITLE_MAX_LENGTH - 1).trim()}…` : title;
}

/**
 * Builds a standard ecommerce-listing-style description from the AI's raw
 * outputs: a short opening line, then a "Key details" bullet list (brand,
 * category, condition) and a closing prompt. Used as the local fallback
 * when the `describeFromText` worker call fails or is thin, and as the
 * shape the worker is asked to produce otherwise.
 */
function buildFallbackEcommerceDescription(
  description: string,
  classifyLabel: string | null,
  categoryLabel: string | null,
  condition: string
): string {
  const opener = description || classifyLabel || 'Item in good condition, as shown in photos.';
  const bullets: string[] = [];
  if (classifyLabel) bullets.push(`Type: ${toTitleCase(classifyLabel.split(',')[0].trim())}`);
  if (categoryLabel) bullets.push(`Category: ${categoryLabel}`);
  bullets.push(`Condition: ${condition === 'NEW' ? 'Brand New' : 'Used — Good'}`);
  bullets.push('See photos for full visual details.');

  return [
    opener.charAt(0).toUpperCase() + opener.slice(1),
    '',
    'Key details:',
    ...bullets.map((b) => `• ${b}`),
    '',
    'Message the seller for more details or to arrange a viewing.',
  ].join('\n');
}

/**
 * Asks the image-AI worker's /describe endpoint to expand the raw
 * classify/identify output into a proper, standard ecommerce listing
 * description (opening line + key-details bullets). Falls back to a
 * locally-built version in the same shape if the worker call fails or
 * returns something too short to be useful.
 */
async function buildEcommerceDescription(
  description: string,
  classifyLabel: string | null,
  categoryLabel: string | null,
  condition: string
): Promise<string> {
  const fallback = buildFallbackEcommerceDescription(description, classifyLabel, categoryLabel, condition);
  const sourceText = [
    classifyLabel ? `Item type: ${classifyLabel}.` : '',
    description ? `Visual description: ${description}.` : '',
    categoryLabel ? `Listing category: ${categoryLabel}.` : '',
    `Condition: ${condition === 'NEW' ? 'Brand New' : 'Used'}.`,
    'Write this as a standard ecommerce marketplace listing description: a short opening line, '
      + 'then a "Key details" bullet list, in plain, buyer-facing language. No made-up specs.',
  ].filter(Boolean).join(' ');

  try {
    const result = await describeFromText(sourceText, 'detailed');
    return result.description && result.description.trim().length > 20 ? result.description.trim() : fallback;
  } catch {
    return fallback;
  }
}

// Is the selected category this top-level category itself, or one of its
// subcategories? Checked by walking the real category tree rather than
// maintaining a flat list of every subcategory slug — the latter is
// exactly what drifted out of sync with the seeded taxonomy (see
// MOTOR_SLUGS/PROPERTY_SLUGS/JOBS_SLUGS below, since replaced by this:
// JOBS_SLUGS never had 'technology'/'healthcare'/'finance', so a listing
// posted under those real Jobs subcategories silently never got the Job
// Details fields at all). A category belongs here the moment it's added
// as a child of `parentSlug` in the seed data — no second list to update.
function isCategoryOrDescendant(categories: Category[], categoryId: string, parentSlug: string): boolean {
  if (!categoryId) return false;
  const parent = categories.find((c) => c.slug === parentSlug);
  if (!parent) return false;
  if (parent.id === categoryId) return true;
  return Boolean(parent.children?.some((child) => child.id === categoryId));
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

/** Human-readable tier label for a package */
function pkgTierLabel(pkg: SellerPackage): string {
  // Duration-based label, driven by whatever the admin actually configured —
  // previously this assumed every free package was a "7-Day" trial, so an
  // admin-created free package with a different duration (e.g. 14 days)
  // rendered with the wrong label on the end-user side.
  if (pkg.isFree) return `${pkg.durationDays}-Day Free Trial`;
  if (pkg.durationDays === 30) return 'Monthly Plan';
  if (pkg.durationDays === 365) return 'Yearly Plan';
  return `${pkg.durationDays}-Day Plan`;
}

/** Price display string for a package */
function pkgPriceLabel(pkg: SellerPackage): string {
  if (pkg.isFree) return 'Free';
  // Respect the admin-configured currency instead of always showing "$" —
  // the admin form defaults new packages to AED, so a non-USD package was
  // previously mislabeled with a dollar sign on this page.
  const amount = pkg.currency === 'USD'
    ? `$${pkg.price}`
    : `${pkg.price.toLocaleString('en-US')} ${pkg.currency}`;
  if (pkg.durationDays === 365) return `${amount} / year`;
  if (pkg.durationDays === 30) return `${amount} / month`;
  return `${amount} / ${pkg.durationDays} days`;
}

function CreateListingContent() {
  const { user, loading } = useAuth();
  const { country: selectedCountry, setCountry } = useCountry();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams?.get('edit') ?? null;
  const isEditMode = editId !== null;

  const [categories, setCategories] = useState<Category[]>([]);
  const [packages, setPackages] = useState<SellerPackage[]>([]);
  const [subscription, setSubscription] = useState<SellerSubscription | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [redirectToSub, setRedirectToSub] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [pendingImageIds, setPendingImageIds] = useState<string[]>([]);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [editLoading, setEditLoading] = useState(isEditMode);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  // Tracks which already-uploaded photos failed to actually load (e.g. a
  // relative /uploads/ or /api/images/ URL that 404s). Keyed by the raw
  // (unresolved) src string rather than array index, since removeImage()
  // shifts indices but the raw src stays a stable identity for whichever
  // photo actually failed. Uploaded photos must always remain visible —
  // a failed load falls back to a placeholder instead of a broken image.
  const [failedPreviewSrcs, setFailedPreviewSrcs] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Package selection state (shown when no active subscription)
  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState('');
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeError, setSubscribeError] = useState('');
  const [form, setForm] = useState({
    title: '',
    description: '',
    price: '',
    priceUnit: 'ITEM' as 'ITEM' | 'KG' | 'TONNE',
    condition: 'USED',
    country: selectedCountry,
    location: '',
    categoryId: '',
    stock: '',
  });
  const [geoLocation, setGeoLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');

  // ── Visibility tier (Free/Gold/Platinum) ──
  // Store owners (an active rental) never see this selector at all — their
  // tier is managed once in the Store Dashboard and inherited by every
  // listing they post, not chosen per listing (see the spec's rule that
  // package management "applies to the store", not per-listing). Everyone
  // else sees it, priced from the admin's published catalog, only at the
  // final confirm step right before "Post Listing" — never earlier in the
  // form, so it doesn't read as a mandatory gate to even start posting.
  const [activeStoreRental, setActiveStoreRental] = useState<{ tier: 'FREE' | 'GOLD' | 'PLATINUM' } | null>(null);
  const [storeRentalChecked, setStoreRentalChecked] = useState(false);
  const [tierPricing, setTierPricing] = useState({ currency: 'UGX', goldPrice: 20000, platinumPrice: 50000, durationDays: 30 });
  const [selectedTier, setSelectedTier] = useState<'FREE' | 'GOLD' | 'PLATINUM'>('FREE');

  useEffect(() => {
    if (!user) { setStoreRentalChecked(true); return; }
    api.get('/store-rentals/my')
      .then(({ data }) => setActiveStoreRental(data?.rental?.status === 'ACTIVE' ? { tier: data.rental.tier } : null))
      .catch(() => setActiveStoreRental(null))
      .finally(() => setStoreRentalChecked(true));
  }, [user]);

  useEffect(() => {
    api.get('/public/site-config')
      .then(({ data }) => { if (data.listingTierPricing) setTierPricing(data.listingTierPricing); })
      .catch(() => {});
  }, []);
  const [motorDetails, setMotorDetails] = useState({
    make: '',
    model: '',
    year: '',
    mileage: '',
    fuelType: '',
    transmission: '',
    bodyType: '',
    engineCC: '',
    color: '',
    doors: '',
  });

  const [propertyDetails, setPropertyDetails] = useState({
    propertyType: '',
    listingType: '',
    bedrooms: '',
    bathrooms: '',
    furnishedStatus: '',
    sizeSqft: '',
    floor: '',
  });

  const [jobDetails, setJobDetails] = useState({
    employmentType: '',
    salaryMin: '',
    salaryMax: '',
    experienceLevel: '',
    workLocation: '',
    industry: '',
    applicationDeadline: '',
  });

  // Product options (size, colour, etc.) — dynamic option groups
  const [productOptions, setProductOptions] = useState<{ id: string; name: string; values: string }[]>([]);
  const addProductOption = () => setProductOptions((prev) => [...prev, { id: Math.random().toString(36).slice(2), name: '', values: '' }]);
  const removeProductOption = (id: string) => setProductOptions((prev) => prev.filter((o) => o.id !== id));
  const updateProductOption = (id: string, field: 'name' | 'values', val: string) =>
    setProductOptions((prev) => prev.map((o) => (o.id === id ? { ...o, [field]: val } : o)));

  // Answers to the selected category's admin-defined custom fields
  // (Category.fieldSchema — configured under /admin/categories "Custom Fields").
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const updateCustomField = (name: string, value: string) =>
    setCustomFieldValues((prev) => ({ ...prev, [name]: value }));

  // ── Draft autosave (create mode only) ────────────────────────────────
  // See lib/listingDraft.ts for the full rationale. `draftPromptResolved`
  // gates the autosave effect below so a freshly-loaded page doesn't
  // immediately overwrite a not-yet-reviewed saved draft with its own
  // (still-empty) initial state before the seller has chosen to restore or
  // discard it.
  const [restorableDraft, setRestorableDraft] = useState<ListingDraftData | null>(null);
  const [draftPromptResolved, setDraftPromptResolved] = useState(isEditMode);
  const [draftRestored, setDraftRestored] = useState(false);

  useEffect(() => {
    if (isEditMode || !user?.id) return;
    const draft = loadListingDraft(user.id);
    if (draft && isDraftMeaningful(draft)) {
      setRestorableDraft(draft);
    } else {
      setDraftPromptResolved(true);
    }
    // Only ever check once per mount — re-running this on every `user`
    // reference change (e.g. after updateUser() touches unrelated fields)
    // would re-surface a prompt the seller already dismissed this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, user?.id]);

  const handleRestoreDraft = () => {
    if (!restorableDraft) return;
    setForm((prev) => ({ ...prev, ...restorableDraft.form }));
    setMotorDetails((prev) => ({ ...prev, ...restorableDraft.motorDetails }));
    setPropertyDetails((prev) => ({ ...prev, ...restorableDraft.propertyDetails }));
    setJobDetails((prev) => ({ ...prev, ...restorableDraft.jobDetails }));
    setProductOptions(restorableDraft.productOptions ?? []);
    setCustomFieldValues(restorableDraft.customFieldValues ?? {});
    setPendingImageIds(restorableDraft.pendingImageIds ?? []);
    setImagePreviews(restorableDraft.imagePreviews ?? []);
    setUploadedCount((restorableDraft.pendingImageIds ?? []).length);
    setDraftRestored(true);
    setRestorableDraft(null);
    setDraftPromptResolved(true);
  };

  const handleDiscardDraft = () => {
    if (user?.id) clearListingDraft(user.id);
    setRestorableDraft(null);
    setDraftPromptResolved(true);
  };

  // Debounced autosave — persists the form ~1s after the seller stops
  // typing/changing anything, rather than on every keystroke.
  useEffect(() => {
    if (isEditMode || !user?.id || !draftPromptResolved) return;
    const timer = setTimeout(() => {
      saveListingDraft(user.id, {
        form,
        motorDetails,
        propertyDetails,
        jobDetails,
        productOptions,
        customFieldValues,
        pendingImageIds,
        imagePreviews,
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    isEditMode, user?.id, draftPromptResolved,
    form, motorDetails, propertyDetails, jobDetails,
    productOptions, customFieldValues, pendingImageIds, imagePreviews,
  ]);

  useEffect(() => {
    api.get('/categories').then(({ data }) => setCategories(data)).catch(() => {});
    api.get('/packages?scope=LISTING').then(({ data }) => setPackages(data.packages ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (user && user.role !== 'ADMIN') {
      api.get('/packages/my-subscription?scope=LISTING')
        .then(({ data }) => setSubscription(data.subscription ?? null))
        .catch(() => setSubscription(null));
    }
  }, [user]);

  useEffect(() => {
    // New listings can only be created for Uganda — the global country
    // switcher (used for browsing) no longer drives the create form's
    // country field. Editing an existing listing keeps its original
    // country (handled in the edit-mode effect below) so listings created
    // before this restriction remain fully editable.
    if (editId) return;
    setForm((prev) => (prev.country === 'UGANDA' ? prev : { ...prev, country: 'UGANDA', location: '' }));
  }, [editId, selectedCountry]);

  // Pre-populate form when in edit mode
  useEffect(() => {
    if (!editId || categories.length === 0) return;
    setEditLoading(true);
    api.get(`/listings/${editId}`)
      .then(({ data }) => {
        const l = data;
        // Sync country context if different
        if (l.country && l.country !== selectedCountry) {
          setCountry(l.country as Country);
        }
        setForm({
          title:      l.title       ?? '',
          description: l.description ?? '',
          price:      l.price != null ? String(l.price) : '',
          priceUnit:  (l.priceUnit as 'ITEM' | 'KG' | 'TONNE') ?? 'ITEM',
          condition:  l.condition   ?? 'USED',
          country:    l.country     ?? selectedCountry,
          location:   l.location    ?? '',
          categoryId: l.categoryId  ?? '',
          stock:      l.stock != null ? String(l.stock) : '',
        });
        if (l.motorDetails)    setMotorDetails(l.motorDetails);
        if (l.propertyDetails) setPropertyDetails(l.propertyDetails);
        if (l.jobDetails)      setJobDetails(l.jobDetails);
        if (Array.isArray(l.productOptions) && l.productOptions.length > 0) {
          setProductOptions(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            l.productOptions.map((opt: any) => ({
              id:     opt.id     ?? Math.random().toString(36).slice(2),
              name:   opt.name   ?? '',
              values: Array.isArray(opt.values) ? opt.values.join(', ') : (opt.values ?? ''),
            }))
          );
        }
        if (l.customFieldValues && typeof l.customFieldValues === 'object') {
          setCustomFieldValues(l.customFieldValues);
        }
        // Images: prefer CDN productImages, fall back to images array
        const imgs: string[] =
          (l.productImages as Array<{ cdnUrl: string | null }> | undefined)
            ?.map((p) => p.cdnUrl)
            .filter(Boolean) as string[] ?? [];
        const fallback: string[] = imgs.length > 0 ? imgs : (Array.isArray(l.images) ? l.images : []);
        setImagePreviews(fallback);
        setExistingImages(fallback);
        if (l.latitude != null || l.longitude != null) {
          setGeoLocation((prev) => ({
            latitude: l.latitude ?? prev?.latitude ?? 0,
            longitude: l.longitude ?? prev?.longitude ?? 0,
          }));
        }
      })
      .catch(() => { /* listing may not exist — leave form blank */ })
      .finally(() => setEditLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, categories, selectedCountry, setCountry]);

  const selectedCategoryLabel = getCategoryLabel(categories, form.categoryId);
  const selectedCategory = categories.flatMap((c) => [c, ...(c.children || [])]).find((c) => c.id === form.categoryId);
  const selectedCategoryFieldSchema = selectedCategory?.fieldSchema ?? [];
  const availableLocations = getLocations(form.country as Country);
  const listingCurrency = getCurrency(form.country as Country);
  const selectedPkg = packages.find((p) => p.id === selectedPkgId) ?? null;

  // Check if selected category is motor-related
  const isMotorCategory = isCategoryOrDescendant(categories, form.categoryId, 'motors');

  // Check if selected category is property-related
  const isPropertyCategory = isCategoryOrDescendant(categories, form.categoryId, 'property');

  // Check if selected category is Agriculture (top-level "agriculture" or
  // any of its subcategories) — mirrors the backend's own detection
  // (`categoryExists.slug === 'agriculture' || categoryExists.parent?.slug
  // === 'agriculture'`, see backend/src/routes/listings.ts) so a listing
  // that qualifies for the price-unit selector here is exactly the same
  // one the backend already accepts a non-ITEM priceUnit for. Produce is
  // commonly sold by weight rather than per item — a sack of maize or a
  // crate of tomatoes priced "per kg" or "per tonne" — which the general
  // form never previously offered a way to express (only the separate
  // /listings/create-produce quick-post flow could set it).
  const isAgricultureCategory = isCategoryOrDescendant(categories, form.categoryId, 'agriculture');

  // Reset to the default unit whenever the category is switched away from
  // Agriculture — the selector above disappears in that case, and leaving
  // a stale KG/TONNE value in state would silently price a non-agriculture
  // listing "per kg" with no visible control to notice or fix it.
  useEffect(() => {
    if (!isAgricultureCategory && form.priceUnit !== 'ITEM') {
      setForm((prev) => ({ ...prev, priceUnit: 'ITEM' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAgricultureCategory]);

  // Check if selected category is jobs-related
  const isJobCategory = isCategoryOrDescendant(categories, form.categoryId, 'jobs');

  const handleSubscribe = async () => {
    if (!selectedPkg) return;
    if (!selectedPkg.isFree && !paymentRef.trim()) {
      setSubscribeError('Please enter a payment reference for paid packages.');
      return;
    }
    setSubscribing(true);
    setSubscribeError('');
    try {
      await api.post(`/packages/${selectedPkg.id}/subscribe`, {
        paymentRef: selectedPkg.isFree ? undefined : paymentRef.trim() || undefined,
      });
      // Refresh subscription state
      const { data } = await api.get('/packages/my-subscription?scope=LISTING');
      setSubscription(data.subscription ?? null);
      setSelectedPkgId(null);
      setPaymentRef('');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setSubscribeError(msg || 'Failed to subscribe. Please try again.');
    } finally {
      setSubscribing(false);
    }
  };

  const handleImageFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Show local previews immediately (blob URLs – no server round trip needed)
    const newPreviews: string[] = [];
    for (const file of Array.from(files)) {
      newPreviews.push(URL.createObjectURL(file));
    }
    setImagePreviews((prev) => [...prev, ...newPreviews]);

    // Upload to server; receive imageIds for pending moderation records.
    setUploadingImages(true);
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) {
        formData.append('images', file);
      }
      const { data } = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const ids: string[] = data.imageIds || [];
      const urls: string[] = data.urls || [];
      setPendingImageIds((prev) => [...prev, ...ids]);
      setUploadedCount((prev) => prev + ids.length);
      // Swap the transient blob: previews for this batch out for their
      // permanent CDN URLs now that the upload has actually completed.
      // A blob: URL only lives as long as the page that created it — it
      // can't survive a reload — so this is what makes an autosaved draft
      // (see lib/listingDraft.ts) able to actually show the seller's
      // already-uploaded photos again after restoring it.
      setImagePreviews((prev) => {
        const next = [...prev];
        const startIndex = next.length - newPreviews.length;
        for (let i = 0; i < urls.length && startIndex + i >= 0 && startIndex + i < next.length; i++) {
          const old = next[startIndex + i];
          if (urls[i]) {
            next[startIndex + i] = urls[i];
            if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
          }
        }
        return next;
      });
    } catch {
      setError('Image upload failed. Please try again.');
      setImagePreviews((prev) => prev.slice(0, prev.length - newPreviews.length));
    } finally {
      setUploadingImages(false);
    }
  };

  const removeImage = (index: number) => {
    const removedUrl = imagePreviews[index];
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
    setPendingImageIds((prev) => prev.filter((_, i) => i !== index));
    if (removedUrl) setExistingImages((prev) => prev.filter((url) => url !== removedUrl));
    if (removedUrl) {
      setFailedPreviewSrcs((prev) => {
        if (!prev.has(removedUrl)) return prev;
        const next = new Set(prev);
        next.delete(removedUrl);
        return next;
      });
      checkedImageSrcs.current.delete(removedUrl);
    }
    if (uploadedCount > 0) setUploadedCount((prev) => prev - 1);
    // Re-key the per-photo match-status map since every index after the
    // removed photo shifts down by one.
    setImageMatchStatus((prev) => {
      const next: typeof prev = {};
      Object.entries(prev).forEach(([key, status]) => {
        const i = Number(key);
        if (i < index) next[i] = status;
        else if (i > index) next[i - 1] = status;
      });
      return next;
    });
    // A removed photo may be the one an existing AI suggestion was based on —
    // clear it rather than leave a suggestion pointing at a gone image.
    if (aiSuggestion) {
      setAiSuggestion(null);
      setAiState('idle');
    }
  };

  // ── AI photo auto-fill (classify + identify via the image-AI worker) ───
  // Never writes to `form` on its own — it only ever populates `aiSuggestion`,
  // and the fields are applied to the form via an explicit click: either
  // individually via each field's "Use" button, or all at once via "Apply
  // all". Either way it's a deliberate user action, so an in-progress
  // title/description/category is never silently overwritten.
  const [aiState, setAiState] = useState<'idle' | 'analyzing' | 'ready' | 'error'>('idle');
  const [aiError, setAiError] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState<{
    title: string;
    description: string;
    category: CategoryMatch | null;
    classifyLabel: string | null;
    classifyConfidence: number | null;
    // The top classify predictions for photo 1, kept around so the "do the
    // other photos match" check can reuse them without re-analyzing photo 1.
    classifyHints: string[];
  } | null>(null);
  // Manual vs AI-assisted entry. Manual (default) leaves every field exactly
  // as before. AI mode auto-runs the photo analysis as soon as the first
  // photo finishes uploading, auto-applies the result, and folds the
  // title/description inputs away behind a confirmation banner — the
  // seller only has to write anything by hand if they choose to edit.
  const [aiMode, setAiMode] = useState<'manual' | 'ai'>('manual');
  // Whether title+description were just auto-filled by AI (either the
  // "Apply all" button in manual mode, or automatically in AI mode). Drives
  // hiding the raw inputs behind a compact "auto-filled ✓" summary.
  const [fieldsAutoFilled, setFieldsAutoFilled] = useState(false);
  const [aiNotification, setAiNotification] = useState('');
  // Per-photo (index >= 1) "does this look like the same item as photo 1"
  // check — keyed by index into `imagePreviews`. Only populated in AI mode.
  const [imageMatchStatus, setImageMatchStatus] = useState<Record<number, 'checking' | 'matched' | 'unmatched'>>({});
  const checkedImageSrcs = useRef<Set<string>>(new Set());

  const applyAiSuggestion = (s: NonNullable<typeof aiSuggestion>) => {
    setForm((prev) => ({
      ...prev,
      ...(s.title ? { title: s.title } : {}),
      ...(s.description ? { description: s.description } : {}),
      ...(s.category ? { categoryId: s.category.id } : {}),
    }));
    setFieldsAutoFilled(true);
    setAiNotification('✨ Title, description and category were auto-filled by AI from your first photo.');
  };

  const handleAIAutoFill = async () => {
    // Use the first fully-uploaded photo (a permanent CDN URL, whether that's
    // an S3-backed /api/images/... URL or the local-storage fallback — either
    // way it must already be a real, publicly-reachable URL). A `blob:`
    // preview is local to this browser tab and can't be fetched by the
    // worker, so images still uploading are skipped. This is deliberately
    // ONLY ever the first photo — the rest are checked for a matching item
    // below rather than analyzed for their own title/description.
    const firstIndex = imagePreviews.findIndex((src) => !src.startsWith('blob:'));
    const rawSourceUrl = firstIndex >= 0 ? imagePreviews[firstIndex] : undefined;
    if (!rawSourceUrl) {
      setAiError('Please wait for at least one photo to finish uploading first.');
      setAiState('error');
      return;
    }
    // The image-AI worker is an external Cloudflare Worker with no browser
    // context — it can only fetch an absolute, publicly-reachable URL, not
    // a relative "/uploads/..." or "/api/images/..." path. resolveImageUrl
    // turns that into the full backend URL the worker can actually reach
    // (which, for S3-backed uploads, is the /api/images proxy that streams
    // straight from the bucket).
    const sourceUrl = resolveImageUrl(rawSourceUrl);

    setAiState('analyzing');
    setAiError('');
    try {
      const [identifyResult, classifyResult] = await Promise.allSettled([
        identifyImageUrl(sourceUrl),
        classifyImageUrl(sourceUrl),
      ]);

      // IDENTIFICATION -> title. The vision-language model's natural-language
      // description is what actually names the item (brand/model/material),
      // so it — not the classifier — is the source for the title.
      const description = identifyResult.status === 'fulfilled' ? identifyResult.value.description.trim() : '';
      // CLASSIFICATION -> cross-photo matching only (see classifyHints below).
      const classifyLabel =
        classifyResult.status === 'fulfilled' ? classifyResult.value.topPrediction?.label ?? null : null;
      const classifyConfidence =
        classifyResult.status === 'fulfilled' ? classifyResult.value.topPrediction?.confidence ?? null : null;
      // Take the top few predictions (not just #1) as the matching signal —
      // classifiers are often ambiguous between close labels (e.g. "laptop,
      // notebook computer, portable computer"), so using only the single top
      // label would make the same-item check too brittle.
      const classifyHints =
        classifyResult.status === 'fulfilled'
          ? classifyResult.value.predictions.slice(0, 3).map((p) => p.label)
          : [];

      if (!description && !classifyLabel) {
        const firstError =
          (identifyResult.status === 'rejected' && (identifyResult.reason as Error)?.message) ||
          (classifyResult.status === 'rejected' && (classifyResult.reason as Error)?.message) ||
          'The AI service could not analyze this photo. Please try again.';
        throw new Error(firstError);
      }

      const category = suggestCategory(categories, [classifyLabel, description].filter(Boolean) as string[]);
      const categoryLabelForDescription = category?.label ?? selectedCategoryLabel ?? null;
      const ecommerceDescription = await buildEcommerceDescription(
        description, classifyLabel, categoryLabelForDescription, form.condition
      );

      const suggestion = {
        title: buildSuggestedTitle(description, classifyLabel),
        description: ecommerceDescription,
        category,
        classifyLabel,
        classifyConfidence,
        classifyHints: classifyHints.length > 0 ? classifyHints : ([classifyLabel].filter(Boolean) as string[]),
      };
      setAiSuggestion(suggestion);
      setAiState('ready');

      if (aiMode === 'ai') {
        applyAiSuggestion(suggestion);
      }

      // Kick off the "do the other photos match" check, using CLASSIFICATION
      // only (not identification) as the signal — see checkOtherImagesForMatch.
      checkOtherImagesForMatch(firstIndex, suggestion.classifyHints);
    } catch (err) {
      setAiError((err as Error)?.message || 'AI analysis failed. Please try again.');
      setAiState('error');
    }
  };

  /**
   * Checks every other already-uploaded photo (skipping `baseIndex`, the
   * one just analyzed for title/description) against photo 1's
   * *classification* — not its identification/description. Classification
   * gives a stable taxonomy label ("laptop computer", "smartphone", etc.)
   * that's a much more reliable "is this the same kind of item" signal than
   * comparing two free-text descriptions, which vary a lot in wording even
   * for the same physical item. Each other photo only needs its own
   * classify call (no identify call — its description is never used, since
   * only photo 1 supplies the title). Flagged 'unmatched' when it shares no
   * classification keyword with photo 1 (e.g. a phone photo attached to a
   * laptop listing).
   */
  const checkOtherImagesForMatch = (baseIndex: number, baseClassifyHints: string[]) => {
    imagePreviews.forEach((src, i) => {
      if (i === baseIndex) return;
      if (src.startsWith('blob:')) return; // still uploading — picked up by the effect below once it resolves
      if (checkedImageSrcs.current.has(src)) return;
      checkedImageSrcs.current.add(src);

      setImageMatchStatus((prev) => ({ ...prev, [i]: 'checking' }));
      const url = resolveImageUrl(src);
      classifyImageUrl(url)
        .then((result) => {
          const otherHints = result.predictions.slice(0, 3).map((p) => p.label);
          const { isMatch } = matchesSameItem(baseClassifyHints, otherHints);
          setImageMatchStatus((prev) => ({ ...prev, [i]: isMatch ? 'matched' : 'unmatched' }));
        })
        .catch(() => {
          // Classification failed for this one photo — don't block the listing over it.
          setImageMatchStatus((prev) => ({ ...prev, [i]: 'matched' }));
        });
    });
  };

  // Once a base suggestion exists, re-run the match check whenever a
  // previously-uploading (`blob:`) photo resolves to its permanent URL, so
  // photos added or finished uploading after the initial AI pass still get
  // checked.
  useEffect(() => {
    if (!aiSuggestion) return;
    const baseIndex = imagePreviews.findIndex((src) => !src.startsWith('blob:'));
    if (baseIndex === -1) return;
    checkOtherImagesForMatch(baseIndex, aiSuggestion.classifyHints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePreviews, aiSuggestion]);

  // AI mode: automatically run the analysis as soon as the first photo has
  // finished uploading (no manual button press required). Manual mode never
  // triggers this — the seller must press "Auto-fill from photo".
  useEffect(() => {
    if (aiMode !== 'ai') return;
    if (aiState !== 'idle') return;
    if (uploadingImages) return;
    const hasUploadedPhoto = imagePreviews.some((src) => !src.startsWith('blob:'));
    if (!hasUploadedPhoto) return;
    handleAIAutoFill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMode, aiState, uploadingImages, imagePreviews]);

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }
    setGeoLoading(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setGeoLoading(false);
      },
      () => {
        setGeoError('Unable to get location. Please allow location access.');
        setGeoLoading(false);
      }
    );
  };

  const [showConfirm, setShowConfirm] = useState(false);
  // Which review-modal thumbnail (if any) is zoomed into a fullscreen lightbox.
  const [zoomedReviewImage, setZoomedReviewImage] = useState<string | null>(null);
  // Shown when the backend rejects a listing because the seller's package
  // (or store rental) has reached its maximum active-listing quota.
  const [showMaxListingsModal, setShowMaxListingsModal] = useState(false);
  const [maxListingsMessage, setMaxListingsMessage] = useState('');

  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.title || !form.description || !form.price || !form.location || !form.categoryId || form.stock === '') {
      setError('Please fill in all required fields');
      return;
    }
    const parsedStock = parseInt(form.stock, 10);
    if (isNaN(parsedStock) || parsedStock < 0 || String(parsedStock) !== form.stock.trim()) {
      setError('Stock must be a valid non-negative whole number');
      return;
    }
    if (!form.country) {
      setError('Country is required — please select your listing country to continue.');
      return;
    }
    if (!listingCurrency) {
      setError('Currency could not be determined. Please select a valid country.');
      return;
    }
    if (uploadingImages) {
      setError('Please wait for images to finish uploading');
      return;
    }
    // Category-specific required fields (admin-defined under /admin/categories)
    const missingCustomFields = selectedCategoryFieldSchema
      .filter((f) => f.required && !customFieldValues[f.name]?.trim())
      .map((f) => f.label);
    if (missingCustomFields.length > 0) {
      setError(`Please fill in the following required field(s): ${missingCustomFields.join(', ')}`);
      return;
    }
  // Subscription gate — scroll to package picker instead of redirecting
    if (!isEditMode && user?.role !== 'ADMIN' && subscription === null) {
      setError('Please choose a posting plan below before submitting.');
      document.getElementById('package-picker')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setShowConfirm(true);
  };

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    const SUBSCRIPTION_REDIRECT_DELAY_MS = 4000;
    try {
      const payload = {
        ...form,
        price: parseFloat(form.price),
        stock: parseInt(form.stock, 10),
        country: form.country,
        currency: listingCurrency,
        imageIds: pendingImageIds,
        // Store owners never send this — their tier comes from the store's
        // own subscription, not a per-listing request (see the
        // activeStoreRental check above the tier selector UI).
        ...(!activeStoreRental && selectedTier !== 'FREE' && { requestedTier: selectedTier }),
        ...(existingImages.length > 0 ? { images: existingImages } : {}),
        ...(isMotorCategory && Object.values(motorDetails).some(Boolean) ? { motorDetails } : {}),
        ...(isPropertyCategory && Object.values(propertyDetails).some(Boolean) ? { propertyDetails } : {}),
        ...(isJobCategory && Object.values(jobDetails).some(Boolean) ? { jobDetails } : {}),
        ...(productOptions.length > 0 ? { productOptions: productOptions.filter(o => o.name).map(o => ({ name: o.name, values: o.values.split(',').map((v: string) => v.trim()).filter(Boolean) })) } : {}),
        ...(Object.keys(customFieldValues).length > 0 ? { customFieldValues } : {}),
        ...(geoLocation ? { latitude: geoLocation.latitude, longitude: geoLocation.longitude } : {}),
      };

      if (isEditMode && editId) {
        await api.put(`/listings/${editId}`, payload);
        setSubmitted(true);
        setShowConfirm(false);
        router.push('/profile/listings');
        return;
      }

      await api.post('/listings', payload);
      // Listing successfully created — the autosaved draft has served its
      // purpose, clear it so it isn't offered for restore again next time.
      if (user?.id) clearListingDraft(user.id);
      // Offer an upgrade nudge unless the seller is already on a yearly plan —
      // sellers on free trial or monthly plans can still upgrade further.
      const hasYearlyPlan = user?.role === 'ADMIN' || (subscription && subscription.status === 'ACTIVE' && subscription.package.durationDays === 365);
      if (!hasYearlyPlan) {
        setRedirectToSub(true);
        setTimeout(() => router.push('/profile/subscription'), SUBSCRIPTION_REDIRECT_DELAY_MS);
      }
      setSubmitted(true);
      setShowConfirm(false);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string } } };
      const message = axiosErr.response?.data?.message || 'Failed to create listing';
      setShowConfirm(false);

      // The backend returns this specific message (403) when the seller's
      // active package has reached its maxListings quota — pop up a
      // dedicated modal that forwards the seller to the package upgrade
      // page, rather than just showing the inline error banner.
      const isMaxListingsExceeded =
        axiosErr.response?.status === 403 &&
        /maximum of .* active listings/i.test(message) &&
        /upgrade your plan/i.test(message);

      if (isMaxListingsExceeded) {
        setMaxListingsMessage(message);
        setShowMaxListingsModal(true);
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (isEditMode && editLoading) return <div className="p-8 text-center">Loading listing…</div>;

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-premium-navy via-red-600 to-red-400 text-white shadow-xl">
          <div className="px-5 py-5 sm:px-6 sm:py-6">
            <p className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/90">
              Seller Access
            </p>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Post products after you sign in</h1>
            <p className="mt-3 max-w-2xl text-sm text-white/85 sm:text-base">
              Sign in or create an account to publish products, attach images, and place each item in its correct category for Uganda buyers.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/auth/login?redirect=/listings/create"
                className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-premium-navy transition-colors hover:bg-red-50"
              >
                Sign In to Post
              </Link>
              <Link
                href="/auth/register"
                className="rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-white/20"
              >
                Create Account
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const ALLOWED_LISTING_ROLES = ['ADMIN', 'AGENT', 'COMPANY', 'ORGANIZATION'];

  if (user && !ALLOWED_LISTING_ROLES.includes(user.role)) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-violet-700 via-purple-600 to-red-600 text-white shadow-xl">
          <div className="px-5 py-5 sm:px-6 sm:py-6">
            <p className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/90">
              🏪 Seller Access Required
            </p>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Register a Web Store to Post Listings</h1>
            <p className="mt-3 max-w-2xl text-sm text-white/85 sm:text-base">
              Posting listings requires a registered store on Piitrade. Register your store — it only takes a minute. Your account type is currently <span className="font-bold bg-white/20 px-1.5 py-0.5 rounded">{user.role}</span>.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-white/80">
              <li className="flex items-center gap-2"><span className="text-green-300">✓</span> Free 3-day trial available</li>
              <li className="flex items-center gap-2"><span className="text-green-300">✓</span> Post to multiple site sections</li>
              <li className="flex items-center gap-2"><span className="text-green-300">✓</span> Flash Deals managed by admin only</li>
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/stores/register"
                className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-violet-700 transition-colors hover:bg-violet-50"
              >
                Register Your Store
              </Link>
              <Link
                href="/listings"
                className="rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-white/20"
              >
                Browse Listings
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8 text-center animate-fade-in">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Listing Submitted!</h2>
          <p className="text-sm text-gray-500 mb-4">
            Your listing has been <span className="font-semibold text-amber-600">submitted for approval by admin</span>. Once approved you will receive an email and your listing countdown begins.
          </p>

          {redirectToSub && (
            <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl text-left">
              <p className="text-sm font-bold text-red-800 mb-1">🚀 Unlock more listings</p>
              <p className="text-xs text-red-700 mb-2">
                Upgrade your plan to post more listings and reach more buyers. Choose from:
              </p>
              {packages.length > 0 ? (
                <ul className="text-xs text-red-700 space-y-0.5 mb-3">
                  {packages.map((pkg) => (
                    <li key={pkg.id}>
                      {pkg.isFree ? '✅' : pkg.durationDays === 365 ? '⭐' : '💳'}{' '}
                      <span className="font-semibold">{pkgTierLabel(pkg)}</span> — {pkgPriceLabel(pkg)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-red-500 italic mb-3">Loading plans…</p>
              )}
              <p className="text-[10px] text-red-500">Redirecting to subscription plans in a moment…</p>
            </div>
          )}

          <div className="flex gap-3 justify-center">
            <Link
              href="/profile/listings"
              className="px-4 py-2 text-sm font-semibold text-brand-600 border border-brand-200 rounded-lg hover:bg-brand-50 transition-colors"
            >
              My Listings
            </Link>
            {redirectToSub ? (
              <Link
                href="/profile/subscription"
                className="px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Choose a Plan
              </Link>
            ) : (
              <Link
                href="/"
                className="px-4 py-2 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
              >
                Go Home
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-3 py-4 sm:py-6 animate-fade-in">
      {/* Compact hero banner */}
      <section className="relative overflow-hidden rounded-xl bg-gradient-to-r from-premium-navy to-red-600 px-4 py-3 text-white shadow-md">
        <div className="absolute right-0 top-0 h-16 w-16 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-extrabold tracking-tight">{isEditMode ? 'Edit Your Listing' : 'Post Your Product'}</h1>
            <p className="mt-0.5 text-xs text-white/80">
              {user.name} · {form.country} · {listingCurrency}
              {selectedCategoryLabel && <> · <span className="text-white/90">{selectedCategoryLabel}</span></>}
            </p>
          </div>
          {user.role !== 'ADMIN' && subscription && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 border border-emerald-300/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
              ✓ Active plan
            </span>
          )}
        </div>
      </section>

      {/* Restorable draft banner — shown when an earlier, interrupted
          session left an autosaved draft behind (see lib/listingDraft.ts) */}
      {restorableDraft && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 animate-fade-in">
          <p className="text-xs text-amber-800">
            <span className="font-bold">You have an unsaved listing draft</span>
            {restorableDraft.form.title && <> — &ldquo;{restorableDraft.form.title}&rdquo;</>} from earlier. Restore it and continue where you left off?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRestoreDraft}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
            >
              Restore draft
            </button>
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
            >
              Discard
            </button>
          </div>
        </div>
      )}
      {draftRestored && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 animate-fade-in">
          ✓ Draft restored — pick up right where you left off.
        </div>
      )}

      {/* Package picker — shown inline when the user has no active subscription */}
      {user.role !== 'ADMIN' && subscription === null && (
        <div id="package-picker" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 animate-fade-in">
          <p className="text-sm font-bold text-red-800 mb-1">📦 Choose a posting plan</p>
          <p className="text-xs text-red-600 mb-4">
            Select a plan to post your listing. Free trial activates instantly; paid plans are activated after admin approval, then your listing countdown begins.
          </p>

          {packages.length === 0 && (
            <p className="text-xs text-gray-500 italic">Loading plans…</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {packages.map((pkg) => {
              const isSelected = selectedPkgId === pkg.id;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => { setSelectedPkgId(pkg.id); setSubscribeError(''); }}
                  className={`relative flex flex-col rounded-xl border-2 p-3 text-left transition-all ${
                    isSelected
                      ? 'border-red-500 bg-white shadow-md'
                      : 'border-gray-200 bg-white hover:border-red-300'
                  }`}
                >
                  {pkg.isFree && (
                    <span className="absolute right-2 top-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">FREE</span>
                  )}
                  {!pkg.isFree && pkg.durationDays >= 360 && (
                    <span className="absolute right-2 top-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">BEST VALUE</span>
                  )}
                  <span className="text-xs font-bold text-gray-900 mb-1">{pkgTierLabel(pkg)}</span>
                  <span className="text-lg font-extrabold text-red-700">{pkgPriceLabel(pkg)}</span>
                  {pkg.description && (
                    <span className="mt-1 text-[11px] text-gray-500 leading-tight">{pkg.description}</span>
                  )}
                  {isSelected && (
                    <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-red-600">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      Selected
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedPkg && !selectedPkg.isFree && (
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Payment Reference <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                placeholder="e.g. TXN123456 or bank transfer ref"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
              <p className="mt-1 text-[11px] text-gray-500">Enter your payment reference. Your subscription will be activated after admin approval.</p>
            </div>
          )}

          {subscribeError && (
            <p className="mb-2 text-xs text-red-600 font-medium">{subscribeError}</p>
          )}

          {selectedPkgId && (
            <button
              type="button"
              onClick={handleSubscribe}
              disabled={subscribing}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors"
            >
              {subscribing
                ? 'Processing…'
                : selectedPkg?.isFree
                  ? 'Start Free Trial & Continue'
                  : 'Submit Plan Request'}
            </button>
          )}

          {selectedPkg && !selectedPkg.isFree && selectedPkgId && (
            <p className="mt-2 text-[11px] text-amber-700">
              ⚠️ Your paid plan request will go to admin for approval. Once approved, you&apos;ll receive a confirmation email and your listing will begin its countdown.
            </p>
          )}
        </div>
      )}

      {user.role !== 'ADMIN' && subscription && subscription.status === 'PENDING_PAYMENT' && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 animate-fade-in">
          <p className="text-sm font-semibold text-amber-800">⏳ Subscription pending approval</p>
          <p className="text-xs text-amber-600 mt-0.5">
            Your <span className="font-semibold">{subscription.package.name}</span> subscription is awaiting admin approval. You will receive an email once activated.
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_0.65fr]">
        <form onSubmit={handlePreSubmit} className="space-y-4">
          {/* ─── PHOTOS — first, so the AI has something to analyze before ─── */}
          {/* the seller ever reaches the title/description/category fields.  */}
          <section className="rounded-xl border border-white/60 bg-white/95 p-4 shadow-sm animate-slide-up">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-700">Photos</p>

              {/* Manual vs AI-assisted toggle — AI stays fully optional. */}
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setAiMode('manual')}
                  aria-pressed={aiMode === 'manual'}
                  className={`rounded-md px-2.5 py-1 transition-colors ${aiMode === 'manual' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => setAiMode('ai')}
                  aria-pressed={aiMode === 'ai'}
                  className={`rounded-md px-2.5 py-1 transition-colors ${aiMode === 'ai' ? 'bg-violet-600 text-white shadow-sm' : 'text-gray-500'}`}
                >
                  ✨ AI Auto-fill
                </button>
              </div>
            </div>

            {aiMode === 'ai' && (
              <p className="mb-3 text-[11px] text-violet-700">
                AI will read your first photo to suggest a title, description and category, then check the rest of your photos to make sure they&apos;re the same item.
              </p>
            )}

            {uploadedCount > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <p className="text-xs text-amber-700">
                  <span className="font-semibold">{uploadedCount} image{uploadedCount !== 1 ? 's' : ''}</span> pending admin review — uploaded to secure storage, will appear on listing once approved.
                </p>
              </div>
            )}

            {imagePreviews.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {imagePreviews.map((src, i) => {
                  const failed = failedPreviewSrcs.has(src);
                  const isFirst = i === (imagePreviews.findIndex((s) => !s.startsWith('blob:')) === -1 ? 0 : imagePreviews.findIndex((s) => !s.startsWith('blob:')));
                  const matchStatus = aiMode === 'ai' && !isFirst ? imageMatchStatus[i] : undefined;
                  return (
                    <div key={i} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200">
                      {failed ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gray-100">
                          <svg className="h-6 w-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p className="px-1 text-center text-[7px] text-gray-400">Preview unavailable</p>
                        </div>
                      ) : (
                        <Image
                          src={resolveImageUrl(src)}
                          alt={`Preview ${i + 1}`}
                          fill
                          className="object-cover"
                          unoptimized
                          onError={() => setFailedPreviewSrcs((prev) => new Set(prev).add(src))}
                        />
                      )}
                      <div
                        role="status"
                        aria-label="Image pending approval"
                        className="absolute bottom-0 left-0 right-0 bg-amber-500/80 text-white text-[8px] font-bold text-center py-0.5"
                      >
                        PENDING
                      </div>
                      {/* AI badges: photo 1 is the analyzed "source of truth"; the
                          rest are flagged if they don't look like the same item. */}
                      {aiMode === 'ai' && isFirst && aiState !== 'idle' && (
                        <div className="absolute left-0 top-0 rounded-br-lg bg-violet-600/90 px-1 py-0.5 text-[7px] font-bold text-white">
                          ANALYZED
                        </div>
                      )}
                      {matchStatus === 'checking' && (
                        <div className="absolute left-0 top-0 rounded-br-lg bg-gray-500/90 px-1 py-0.5 text-[7px] font-bold text-white">
                          CHECKING…
                        </div>
                      )}
                      {matchStatus === 'unmatched' && (
                        <div className="absolute left-0 top-0 rounded-br-lg bg-red-600/90 px-1 py-0.5 text-[7px] font-bold text-white" title="This photo doesn't look like the same item as your first photo">
                          ⚠ UNMATCHED
                        </div>
                      )}
                      {matchStatus === 'matched' && (
                        <div className="absolute left-0 top-0 rounded-br-lg bg-emerald-600/90 px-1 py-0.5 text-[7px] font-bold text-white">
                          ✓ MATCH
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white opacity-80 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                        aria-label="Remove image"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {Object.values(imageMatchStatus).some((s) => s === 'unmatched') && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
                <p className="text-xs text-red-700">
                  <span className="font-semibold">⚠ Unmatched photo(s) detected —</span> one or more photos don&apos;t look like the same item as your first photo. Remove them or re-check they belong to this listing before posting.
                </p>
              </div>
            )}

            {imagePreviews.some((src) => !src.startsWith('blob:')) && (
              <div className="mb-3">
                {aiMode === 'manual' && (
                  <button
                    type="button"
                    onClick={handleAIAutoFill}
                    disabled={aiState === 'analyzing' || uploadingImages}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60 transition-colors"
                  >
                    {aiState === 'analyzing' ? 'Analyzing photo…' : '✨ Auto-fill from photo (AI)'}
                  </button>
                )}
                {aiMode === 'ai' && aiState === 'analyzing' && (
                  <p className="text-center text-xs font-medium text-violet-700">✨ Analyzing your first photo…</p>
                )}

                {aiState === 'error' && aiError && (
                  <p className="mt-2 text-xs text-red-600">{aiError}</p>
                )}

                {/* Manual mode: suggestion is shown as opt-in Use/Apply buttons.
                    AI mode: the suggestion is applied automatically (see
                    applyAiSuggestion in handleAIAutoFill), so nothing further
                    to show here once it's ready — the notification banner
                    lives in the Product details section instead. */}
                {aiMode === 'manual' && aiState === 'ready' && aiSuggestion && (
                  <div className="mt-3 space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-semibold text-violet-800">
                        AI Suggestions
                        {aiSuggestion.classifyLabel && (
                          <span className="font-normal text-violet-600">
                            {' '}· detected &ldquo;{aiSuggestion.classifyLabel}&rdquo;
                            {aiSuggestion.classifyConfidence != null && ` (${aiSuggestion.classifyConfidence.toFixed(0)}%)`}
                          </span>
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => applyAiSuggestion(aiSuggestion)}
                        className="shrink-0 rounded-md border border-violet-600 px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-100"
                      >
                        Apply all
                      </button>
                    </div>

                    {aiSuggestion.title && (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-violet-500">Title</p>
                          <p className="truncate text-xs text-gray-700">{aiSuggestion.title}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, title: aiSuggestion.title }))}
                          className="shrink-0 rounded-md bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-violet-700"
                        >
                          Use
                        </button>
                      </div>
                    )}

                    {aiSuggestion.description && (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-violet-500">Description</p>
                          <p className="line-clamp-3 text-xs text-gray-700">{aiSuggestion.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, description: aiSuggestion.description }))}
                          className="shrink-0 rounded-md bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-violet-700"
                        >
                          Use
                        </button>
                      </div>
                    )}

                    {aiSuggestion.category && (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium uppercase tracking-wide text-violet-500">Category</p>
                          <p className="truncate text-xs text-gray-700">{aiSuggestion.category.label}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, categoryId: aiSuggestion.category!.id }))}
                          className="shrink-0 rounded-md bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-violet-700"
                        >
                          Use
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => { setAiSuggestion(null); setAiState('idle'); }}
                      className="text-[11px] text-gray-500 underline"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            )}

            <div
              role="button"
              tabIndex={0}
              className="rounded-xl border-2 border-dashed border-gray-300 p-4 text-center transition-colors hover:border-red-400 cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
            >
              {uploadingImages ? (
                <p className="text-sm text-gray-500">Uploading to secure storage…</p>
              ) : (
                <>
                  <p className="mb-1 text-2xl">📷</p>
                  <p className="text-sm font-medium text-gray-700">Click to upload photos</p>
                  <p className="mt-0.5 text-xs text-gray-400">JPG, PNG, GIF · up to 10 MB each</p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif"
              multiple
              className="hidden"
              onChange={(e) => handleImageFiles(e.target.files)}
            />
          </section>

          <section className="rounded-xl border border-white/60 bg-white/95 p-4 shadow-sm animate-slide-up">
            {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-700">Product details</p>
              {fieldsAutoFilled && (
                <button
                  type="button"
                  onClick={() => { setFieldsAutoFilled(false); setAiNotification(''); }}
                  className="text-[11px] font-semibold text-violet-700 underline"
                >
                  Edit manually
                </button>
              )}
            </div>

            {fieldsAutoFilled ? (
              // Fields were just auto-filled by AI — collapse the raw inputs
              // behind a compact, read-only summary + notification rather
              // than showing the (now redundant) editable form underneath.
              <div className="space-y-2">
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
                  <span className="text-emerald-600">✓</span>
                  <p className="text-xs text-emerald-800">{aiNotification || 'Title and description were auto-filled by AI.'}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Title</p>
                  <p className="text-sm font-medium text-gray-800">{form.title}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Description</p>
                  <p className="whitespace-pre-line text-xs text-gray-700 line-clamp-6">{form.description}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="e.g. iPhone 15 Pro Max 256GB"
                    maxLength={100}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Description *</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={4}
                    placeholder="Describe brand, model, condition, warranty, accessories, and any details a buyer should know."
                    className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
              </div>
            )}
          </section>

          <section
            id="category-pricing-section"
            className="relative z-20 overflow-visible rounded-xl border border-white/60 bg-white/95 p-4 shadow-sm animate-slide-up scroll-mt-24"
            style={{ animationDelay: '60ms' }}
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-700 mb-3">Category &amp; pricing</p>

            <div className="space-y-3 md:space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Category *</label>
                <CategoryPicker
                  categories={categories}
                  value={form.categoryId}
                  onChange={(id) => setForm({ ...form, categoryId: id })}
                  className="z-20"
                />
                {selectedCategoryLabel && (
                  <p className="mt-1.5 text-xs font-medium text-red-700">Listed under: {selectedCategoryLabel}</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Country <span className="text-red-500">*</span></label>
                  {editId && form.country !== 'UGANDA' ? (
                    // Editing a listing created before the Uganda-only restriction —
                    // keep it fully editable so existing non-Uganda listings aren't stranded.
                    <select
                      value={form.country}
                      onChange={(e) => {
                        const nextCountry = e.target.value as Country;
                        setCountry(nextCountry);
                        setForm({ ...form, country: nextCountry, location: '' });
                      }}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
                      required
                    >
                      <option value="UAE">🇦🇪 UAE</option>
                      <option value="UGANDA">🇺🇬 Uganda</option>
                      <option value="KENYA">🇰🇪 Kenya</option>
                      <option value="CHINA">🇨🇳 China</option>
                    </select>
                  ) : (
                    <select
                      value="UGANDA"
                      disabled
                      aria-readonly
                      className="w-full cursor-not-allowed rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-700 focus:outline-none"
                    >
                      <option value="UGANDA">🇺🇬 Uganda</option>
                    </select>
                  )}
                  <p className="mt-1 text-[11px] text-red-600 font-medium">
                    {editId && form.country !== 'UGANDA'
                      ? <>Currency: <span className="font-bold">{listingCurrency}</span> — listings will only appear to buyers in this country.</>
                      : 'New listings can currently only be posted for Uganda.'}
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Price ({listingCurrency}) *</label>
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                  {isAgricultureCategory && (
                    <div className="mt-2">
                      <label className="mb-1 block text-xs font-medium text-gray-700">Priced per</label>
                      <div className="flex gap-1.5">
                        {(['ITEM', 'KG', 'TONNE'] as const).map((unit) => (
                          <button
                            key={unit}
                            type="button"
                            onClick={() => setForm({ ...form, priceUnit: unit })}
                            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${
                              form.priceUnit === unit
                                ? 'border-red-500 bg-red-50 text-red-600'
                                : 'border-gray-300 text-gray-600 hover:border-gray-400'
                            }`}
                          >
                            {unit === 'ITEM' ? 'Item' : unit === 'KG' ? 'Kg' : 'Tonne'}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">
                        Produce is often sold by weight rather than per item — this shows as &quot;/ kg&quot; or &quot;/ tonne&quot; next to the price on the listing.
                      </p>
                    </div>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Stock *</label>
                  <input
                    type="number"
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                    placeholder="e.g. 1"
                    min="0"
                    step="1"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                  <p className="mt-1 text-[11px] text-gray-500">Number of units available for this listing.</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Condition *</label>
                  <select
                    value={form.condition}
                    onChange={(e) => setForm({ ...form, condition: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
                  >
                    <option value="USED">Used</option>
                    <option value="NEW">New</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Location *</label>
                  <select
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
                  >
                    <option value="">Select location</option>
                    {availableLocations.map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* ─── CATEGORY-SPECIFIC CUSTOM FIELDS (admin-defined per category) ─── */}
          {selectedCategoryFieldSchema.length > 0 && (
            <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 shadow-sm animate-slide-up" style={{ animationDelay: '75ms' }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700 mb-3">📋 {selectedCategoryLabel} Details</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {selectedCategoryFieldSchema.map((field) => (
                  <div key={field.name} className={field.type === 'textarea' ? 'sm:col-span-2' : undefined}>
                    <label className="mb-1 block text-xs font-medium text-gray-700">
                      {field.label}{field.required && <span className="text-red-500"> *</span>}
                    </label>
                    {field.type === 'select' ? (
                      <select
                        value={customFieldValues[field.name] ?? ''}
                        onChange={(e) => updateCustomField(field.name, e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400"
                      >
                        <option value="">Select {field.label}</option>
                        {(field.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        value={customFieldValues[field.name] ?? ''}
                        onChange={(e) => updateCustomField(field.name, e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
                      />
                    ) : (
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={customFieldValues[field.name] ?? ''}
                        onChange={(e) => updateCustomField(field.name, e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400"
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ─── MOTOR DETAILS SECTION ─── */}
          {isMotorCategory && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm animate-slide-up" style={{ animationDelay: '90ms' }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700 mb-3">🚗 Vehicle Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Make / Brand</label>
                  <input
                    type="text"
                    value={motorDetails.make}
                    onChange={(e) => setMotorDetails({ ...motorDetails, make: e.target.value })}
                    placeholder="e.g. Toyota"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Model</label>
                  <input
                    type="text"
                    value={motorDetails.model}
                    onChange={(e) => setMotorDetails({ ...motorDetails, model: e.target.value })}
                    placeholder="e.g. Camry"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Year</label>
                  <input
                    type="number"
                    value={motorDetails.year}
                    onChange={(e) => setMotorDetails({ ...motorDetails, year: e.target.value })}
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
                    value={motorDetails.mileage}
                    onChange={(e) => setMotorDetails({ ...motorDetails, mileage: e.target.value })}
                    placeholder="e.g. 50000"
                    min="0"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Fuel Type</label>
                  <select
                    value={motorDetails.fuelType}
                    onChange={(e) => setMotorDetails({ ...motorDetails, fuelType: e.target.value })}
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
                    value={motorDetails.transmission}
                    onChange={(e) => setMotorDetails({ ...motorDetails, transmission: e.target.value })}
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
                    value={motorDetails.bodyType}
                    onChange={(e) => setMotorDetails({ ...motorDetails, bodyType: e.target.value })}
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
                    value={motorDetails.engineCC}
                    onChange={(e) => setMotorDetails({ ...motorDetails, engineCC: e.target.value })}
                    placeholder="e.g. 2000"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Colour</label>
                  <input
                    type="text"
                    value={motorDetails.color}
                    onChange={(e) => setMotorDetails({ ...motorDetails, color: e.target.value })}
                    placeholder="e.g. Silver"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Doors</label>
                  <select
                    value={motorDetails.doors}
                    onChange={(e) => setMotorDetails({ ...motorDetails, doors: e.target.value })}
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
            </section>
          )}

          {/* ─── PROPERTY DETAILS SECTION ─── */}
          {isPropertyCategory && (
            <section className="rounded-xl border border-red-200 bg-red-50/50 p-4 shadow-sm animate-slide-up" style={{ animationDelay: '90ms' }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-700 mb-3">🏠 Property Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Property Type</label>
                  <select
                    value={propertyDetails.propertyType}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, propertyType: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
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
                    value={propertyDetails.listingType}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, listingType: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  >
                    <option value="">Select</option>
                    <option>For Rent</option>
                    <option>For Sale</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Bedrooms</label>
                  <select
                    value={propertyDetails.bedrooms}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, bedrooms: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
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
                    value={propertyDetails.bathrooms}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, bathrooms: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
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
                    value={propertyDetails.furnishedStatus}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, furnishedStatus: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
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
                    value={propertyDetails.sizeSqft}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, sizeSqft: e.target.value })}
                    placeholder="e.g. 1200"
                    min="0"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Floor</label>
                  <input
                    type="text"
                    value={propertyDetails.floor}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, floor: e.target.value })}
                    placeholder="e.g. Ground, 3rd"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
              </div>
            </section>
          )}

          {/* ─── JOB DETAILS SECTION ─── */}
          {isJobCategory && (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm animate-slide-up" style={{ animationDelay: '90ms' }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 mb-3">💼 Job Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Employment Type</label>
                  <select
                    value={jobDetails.employmentType}
                    onChange={(e) => setJobDetails({ ...jobDetails, employmentType: e.target.value })}
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
                    value={jobDetails.experienceLevel}
                    onChange={(e) => setJobDetails({ ...jobDetails, experienceLevel: e.target.value })}
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
                    value={jobDetails.salaryMin}
                    onChange={(e) => setJobDetails({ ...jobDetails, salaryMin: e.target.value })}
                    placeholder="e.g. 2000"
                    min="0"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Salary Max</label>
                  <input
                    type="number"
                    value={jobDetails.salaryMax}
                    onChange={(e) => setJobDetails({ ...jobDetails, salaryMax: e.target.value })}
                    placeholder="e.g. 5000"
                    min="0"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Work Location</label>
                  <select
                    value={jobDetails.workLocation}
                    onChange={(e) => setJobDetails({ ...jobDetails, workLocation: e.target.value })}
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
                    value={jobDetails.industry}
                    onChange={(e) => setJobDetails({ ...jobDetails, industry: e.target.value })}
                    placeholder="e.g. Technology, Finance"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-700">Application Deadline</label>
                  <input
                    type="date"
                    value={jobDetails.applicationDeadline}
                    onChange={(e) => setJobDetails({ ...jobDetails, applicationDeadline: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
              </div>
            </section>
          )}

          {/* ─── Product Options (colour, size, etc.) ─── */}
          <section className="rounded-xl border border-purple-200 bg-purple-50/50 p-4 shadow-sm animate-slide-up" style={{ animationDelay: '105ms' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-purple-700">🎨 Product Options</p>
              <button type="button" onClick={addProductOption} className="text-xs text-purple-600 hover:text-purple-800 font-semibold">
                + Add Option
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Add selectable options buyers choose at purchase (e.g. Color, Size, RAM). Values are comma-separated.
            </p>
            {/* Smart suggestion chips based on category */}
            {(() => {
              const selectedCat = categories.flatMap(c => [c, ...(c.children || [])]).find(c => c.id === form.categoryId);
              const suggestions = selectedCat ? getProductOptionSuggestions(selectedCat.slug) : [];
              if (suggestions.length === 0) return null;
              return (
                <div className="mb-3">
                  <p className="text-[10px] font-semibold text-purple-600 mb-1.5 uppercase tracking-wider">Suggested for this category:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => {
                          const exists = productOptions.some(o => o.name.toLowerCase() === s.name.toLowerCase());
                          if (!exists) {
                            setProductOptions(prev => [...prev, { id: Math.random().toString(36).slice(2), name: s.name, values: s.values }]);
                          }
                        }}
                        className="text-[10px] bg-purple-100 text-purple-700 border border-purple-200 rounded-full px-2.5 py-1 font-semibold hover:bg-purple-200 transition-colors"
                      >
                        + {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
            {productOptions.length === 0 && (
              <p className="text-xs text-gray-400 italic">No options added. Click &quot;+ Add Option&quot; or use the suggestions above.</p>
            )}
            <div className="space-y-2">
              {productOptions.map((opt) => (
                <div key={opt.id} className="flex gap-2 items-start">
                  <input
                    type="text"
                    placeholder="Option name (e.g. Color)"
                    value={opt.name}
                    onChange={(e) => updateProductOption(opt.id, 'name', e.target.value)}
                    className="flex-shrink-0 w-32 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                  <input
                    type="text"
                    placeholder="Values (e.g. Red, Blue, Green)"
                    value={opt.values}
                    onChange={(e) => updateProductOption(opt.id, 'values', e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                  <button type="button" onClick={() => removeProductOption(opt.id)} className="text-gray-400 hover:text-red-500 text-lg leading-none mt-0.5">×</button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-green-200 bg-green-50/50 p-4 shadow-sm animate-slide-up" style={{ animationDelay: '110ms' }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-green-700 mb-2">📍 Geolocation Tag</p>
            <p className="text-xs text-gray-500 mb-3">
              Optionally tag this listing with your current GPS coordinates so buyers can find it on a map.
            </p>
            {geoLocation ? (
              <div className="flex items-center gap-3 bg-green-100 rounded-lg px-3 py-2 mb-2">
                <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-green-800">Location tagged</p>
                  <p className="text-[11px] text-green-600 font-mono truncate">
                    {geoLocation.latitude.toFixed(6)}, {geoLocation.longitude.toFixed(6)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setGeoLocation(null)}
                  className="text-xs text-red-500 hover:text-red-700 font-medium"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGetLocation}
                disabled={geoLoading}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {geoLoading ? 'Getting location…' : 'Tag My Location'}
              </button>
            )}
            {geoError && <p className="mt-2 text-xs text-red-600">{geoError}</p>}
          </section>



          <button
            type="submit"
            disabled={submitting || uploadingImages}
            className="w-full rounded-xl bg-red-500 py-3 text-sm font-semibold text-white transition-all hover:bg-red-600 disabled:opacity-50 shadow-sm hover:shadow-md"
          >
            {(() => {
              if (submitting) return isEditMode ? 'Saving…' : 'Posting…';
              if (user?.role !== 'ADMIN' && subscription === null && !isEditMode) return '🔒 Subscribe to Post';
              return isEditMode ? 'Review & Save Changes' : 'Review & Post Listing';
            })()}
          </button>
        </form>

        {/* Confirmation modal */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 animate-scale-in">
              <h2 className="text-base font-bold text-gray-900 mb-1">Review Your Listing</h2>
              <p className="text-sm text-gray-500 mb-3">
                Review the details below before submitting for admin approval.
              </p>

              <dl className="space-y-1.5 text-sm mb-4">
                <div className="flex gap-2">
                  <dt className="font-semibold text-gray-700 w-20 shrink-0">Title:</dt>
                  <dd className="text-gray-600 line-clamp-2">{form.title}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-semibold text-gray-700 w-20 shrink-0">Category:</dt>
                  <dd className="text-gray-600">{selectedCategoryLabel || '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-semibold text-gray-700 w-20 shrink-0">Price:</dt>
                  <dd className="text-gray-600 font-bold text-red-700">
                    {listingCurrency} {parseFloat(form.price || '0').toLocaleString('en-US')}
                    {form.priceUnit === 'KG' && ' / kg'}
                    {form.priceUnit === 'TONNE' && ' / tonne'}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-semibold text-gray-700 w-20 shrink-0">Condition:</dt>
                  <dd className="text-gray-600">{form.condition}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-semibold text-gray-700 w-20 shrink-0">Stock:</dt>
                  <dd className="text-gray-600">{form.stock || '0'} unit{form.stock === '1' ? '' : 's'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-semibold text-gray-700 w-20 shrink-0">Location:</dt>
                  <dd className="text-gray-600">{form.location}, {form.country}</dd>
                </div>
              </dl>

              {/* Photo preview — fitted thumbnails, click any one to zoom in
                  for a closer look before submitting. */}
              {imagePreviews.length > 0 ? (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-gray-700 mb-1.5">
                    Images ({imagePreviews.length})
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {imagePreviews.map((src, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setZoomedReviewImage(src)}
                        className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                        aria-label={`Zoom into image ${i + 1}`}
                      >
                        <Image
                          src={resolveImageUrl(src)}
                          alt={`Listing photo ${i + 1}`}
                          fill
                          unoptimized
                          className="object-cover transition-transform duration-200 group-hover:scale-105"
                          sizes="120px"
                        />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                          <svg className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16zM11 8v6M8 11h6" />
                          </svg>
                        </span>
                        {i === 0 && (
                          <span className="absolute top-1 left-1 bg-red-500 text-white text-[8px] font-bold px-1 py-0.5 rounded">
                            MAIN
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                  No images attached — buyers respond far better to listings with photos.
                </div>
              )}

              {/* Visibility tier selector — the spec's rule is explicit
                  that ORDINARY USERS see this "ONLY at the moment before
                  clicking Post Listing", not earlier in the form. Store
                  owners never see it: their tier is managed once in the
                  Store Dashboard and applies to everything they post. */}
              {storeRentalChecked && !activeStoreRental && !isEditMode && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-gray-700 mb-1.5">Choose visibility</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { id: 'FREE' as const, label: 'Free', price: null, badge: null },
                      { id: 'GOLD' as const, label: 'Gold', price: tierPricing.goldPrice, badge: '🥇' },
                      { id: 'PLATINUM' as const, label: 'Platinum', price: tierPricing.platinumPrice, badge: '💎' },
                    ]).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTier(t.id)}
                        className={`rounded-xl border-2 px-2 py-2.5 text-center transition-colors ${
                          selectedTier === t.id ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <p className="text-sm font-bold text-gray-900">{t.badge} {t.label}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          {t.price != null ? `${tierPricing.currency} ${t.price.toLocaleString('en-US')}` : 'No cost'}
                        </p>
                      </button>
                    ))}
                  </div>
                  {selectedTier !== 'FREE' && (
                    <p className="mt-1.5 text-[11px] text-gray-500">
                      Gold/Platinum listings rank above Free listings sitewide for {tierPricing.durationDays} days once an admin confirms payment — your listing still needs the usual content review either way.
                    </p>
                  )}
                </div>
              )}
              {activeStoreRental && !isEditMode && (
                <div className="mb-3 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 text-xs text-violet-700">
                  <span className="font-semibold">Posting as your store — </span>
                  this listing automatically gets your store&apos;s {activeStoreRental.tier === 'FREE' ? 'Free' : activeStoreRental.tier === 'GOLD' ? 'Gold 🥇' : 'Platinum 💎'} visibility. Manage your store&apos;s package from the <Link href="/dashboard/store-rental" className="underline font-semibold">Store Dashboard</Link>.
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">
                <p className="text-xs text-amber-700">
                  <span className="font-semibold">Admin review required — </span>
                  Your listing will be reviewed before going live.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Submitting…' : isEditMode ? 'Confirm & Save' : 'Confirm & Post'}
                </button>
              </div>
            </div>

            {/* Fullscreen zoom lightbox for a review-modal thumbnail */}
            {zoomedReviewImage && (
              <div
                className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
                onClick={() => setZoomedReviewImage(null)}
              >
                <button
                  type="button"
                  onClick={() => setZoomedReviewImage(null)}
                  aria-label="Close zoomed image"
                  className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div
                  className="relative w-full max-w-2xl aspect-square"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Image
                    src={resolveImageUrl(zoomedReviewImage)}
                    alt="Zoomed listing photo"
                    fill
                    unoptimized
                    className="object-contain"
                    sizes="90vw"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Max-listings-exceeded modal — forwards the seller to upgrade their package */}
        {showMaxListingsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 animate-scale-in">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <h2 className="text-base font-bold text-gray-900 mb-1">Listing Limit Reached</h2>
              <p className="text-sm text-gray-600 mb-4">{maxListingsMessage}</p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowMaxListingsModal(false)}
                  className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => { setShowMaxListingsModal(false); router.push('/profile/subscription'); }}
                  className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
                >
                  Upgrade Plan
                </button>
              </div>
            </div>
          </div>
        )}

        <aside className="space-y-4">
          <section className="rounded-xl border border-white/60 bg-white/95 p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-700 mb-2">Summary</p>
            <div className="space-y-2 text-xs text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Seller</span>
                <span className="font-semibold text-slate-800">{user.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Country</span>
                <span className="font-semibold text-slate-800">{form.country}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Category</span>
                <span className="font-semibold text-slate-800 text-right max-w-[120px] truncate">{selectedCategoryLabel || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Location</span>
                <span className="font-semibold text-slate-800">{form.location || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Photos</span>
                <span className="font-semibold text-slate-800">{pendingImageIds.length}</span>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-white/60 bg-white/95 p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-700 mb-2">Checklist</p>
            <ul className="space-y-1.5 text-xs text-slate-600">
              <li className="flex items-start gap-1.5"><span className={`mt-0.5 w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold ${form.categoryId ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>{form.categoryId ? '✓' : '·'}</span>Choose category</li>
              <li className="flex items-start gap-1.5"><span className={`mt-0.5 w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold ${form.title ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>{form.title ? '✓' : '·'}</span>Add title</li>
              <li className="flex items-start gap-1.5"><span className={`mt-0.5 w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold ${imagePreviews.length > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>{imagePreviews.length > 0 ? '✓' : '·'}</span>Upload photos</li>
              <li className="flex items-start gap-1.5"><span className={`mt-0.5 w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold ${form.price ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>{form.price ? '✓' : '·'}</span>Set price</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default function CreateListingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading…</div>}>
      <CreateListingContent />
    </Suspense>
  );
}