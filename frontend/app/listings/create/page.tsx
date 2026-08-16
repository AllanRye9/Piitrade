'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useCountry } from '@/context/CountryContext';
import { api } from '@/lib/api';
import { Category, Country, SellerPackage, SellerSubscription } from '@/lib/types';
import { getCurrency, getLocations } from '@/lib/utils';
import CategoryPicker from '@/components/ui/CategoryPicker';
import {
  saveListingDraft,
  loadListingDraft,
  clearListingDraft,
  isDraftMeaningful,
  type ListingDraftData,
} from '@/lib/listingDraft';

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
    : `${pkg.price.toLocaleString()} ${pkg.currency}`;
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
    condition: 'USED',
    country: selectedCountry,
    location: '',
    categoryId: '',
    stock: '',
  });
  const [geoLocation, setGeoLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');
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
    setForm((prev) => (prev.country === selectedCountry ? prev : { ...prev, country: selectedCountry, location: '' }));
  }, [selectedCountry]);

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
  const isMotorCategory = (() => {
    if (!form.categoryId) return false;
    for (const cat of categories) {
      if (cat.id === form.categoryId && MOTOR_SLUGS.has(cat.slug)) return true;
      if (cat.children) {
        for (const child of cat.children) {
          if (child.id === form.categoryId && MOTOR_SLUGS.has(child.slug)) return true;
        }
      }
    }
    return false;
  })();

  // Check if selected category is property-related
  const isPropertyCategory = (() => {
    if (!form.categoryId) return false;
    for (const cat of categories) {
      if (cat.id === form.categoryId && PROPERTY_SLUGS.has(cat.slug)) return true;
      if (cat.children) {
        for (const child of cat.children) {
          if (child.id === form.categoryId && PROPERTY_SLUGS.has(child.slug)) return true;
        }
      }
    }
    return false;
  })();

  // Check if selected category is jobs-related
  const isJobCategory = (() => {
    if (!form.categoryId) return false;
    for (const cat of categories) {
      if (cat.id === form.categoryId && JOBS_SLUGS.has(cat.slug)) return true;
      if (cat.children) {
        for (const child of cat.children) {
          if (child.id === form.categoryId && JOBS_SLUGS.has(child.slug)) return true;
        }
      }
    }
    return false;
  })();

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
    if (uploadedCount > 0) setUploadedCount((prev) => prev - 1);
  };

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
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-elite-navy via-sky-600 to-sky-400 text-white shadow-xl">
          <div className="px-5 py-5 sm:px-6 sm:py-6">
            <p className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/90">
              Seller Access
            </p>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Post products after you sign in</h1>
            <p className="mt-3 max-w-2xl text-sm text-white/85 sm:text-base">
              Sign in or create an account to publish products, attach images, and place each item in its correct category for UAE and Uganda buyers.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/auth/login?redirect=/listings/create"
                className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-elite-navy transition-colors hover:bg-sky-50"
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
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-violet-700 via-purple-600 to-sky-600 text-white shadow-xl">
          <div className="px-5 py-5 sm:px-6 sm:py-6">
            <p className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/90">
              🏪 Seller Access Required
            </p>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Register a Store to Post Listings</h1>
            <p className="mt-3 max-w-2xl text-sm text-white/85 sm:text-base">
              Posting listings requires a registered store on 3R Elite. Register your store — it only takes a minute. Your account type is currently <span className="font-bold bg-white/20 px-1.5 py-0.5 rounded">{user.role}</span>.
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
            <div className="mb-5 p-4 bg-sky-50 border border-sky-200 rounded-xl text-left">
              <p className="text-sm font-bold text-sky-800 mb-1">🚀 Unlock more listings</p>
              <p className="text-xs text-sky-700 mb-2">
                Upgrade your plan to post more listings and reach more buyers. Choose from:
              </p>
              {packages.length > 0 ? (
                <ul className="text-xs text-sky-700 space-y-0.5 mb-3">
                  {packages.map((pkg) => (
                    <li key={pkg.id}>
                      {pkg.isFree ? '✅' : pkg.durationDays === 365 ? '⭐' : '💳'}{' '}
                      <span className="font-semibold">{pkgTierLabel(pkg)}</span> — {pkgPriceLabel(pkg)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-sky-500 italic mb-3">Loading plans…</p>
              )}
              <p className="text-[10px] text-sky-500">Redirecting to subscription plans in a moment…</p>
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
                className="px-4 py-2 text-sm font-semibold bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors"
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
      <section className="relative overflow-hidden rounded-xl bg-gradient-to-r from-elite-navy to-sky-600 px-4 py-3 text-white shadow-md">
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
        <div id="package-picker" className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 animate-fade-in">
          <p className="text-sm font-bold text-sky-800 mb-1">📦 Choose a posting plan</p>
          <p className="text-xs text-sky-600 mb-4">
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
                      ? 'border-sky-500 bg-white shadow-md'
                      : 'border-gray-200 bg-white hover:border-sky-300'
                  }`}
                >
                  {pkg.isFree && (
                    <span className="absolute right-2 top-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">FREE</span>
                  )}
                  {!pkg.isFree && pkg.durationDays >= 360 && (
                    <span className="absolute right-2 top-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">BEST VALUE</span>
                  )}
                  <span className="text-xs font-bold text-gray-900 mb-1">{pkgTierLabel(pkg)}</span>
                  <span className="text-lg font-extrabold text-sky-700">{pkgPriceLabel(pkg)}</span>
                  {pkg.description && (
                    <span className="mt-1 text-[11px] text-gray-500 leading-tight">{pkg.description}</span>
                  )}
                  {isSelected && (
                    <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600">
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
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
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
              className="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-60 transition-colors"
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
          <section className="rounded-xl border border-white/60 bg-white/95 p-4 shadow-sm animate-slide-up">
            {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700 mb-3">Product details</p>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. iPhone 15 Pro Max 256GB"
                  maxLength={100}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Description *</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={4}
                  placeholder="Describe brand, model, condition, warranty, accessories, and any details a buyer should know."
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
              </div>
            </div>
          </section>

          <section
            id="category-pricing-section"
            className="relative z-20 overflow-visible rounded-xl border border-white/60 bg-white/95 p-4 shadow-sm animate-slide-up scroll-mt-24"
            style={{ animationDelay: '60ms' }}
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700 mb-3">Category &amp; pricing</p>

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
                  <p className="mt-1.5 text-xs font-medium text-sky-700">Listed under: {selectedCategoryLabel}</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Country <span className="text-red-500">*</span></label>
                  <select
                    value={form.country}
                    onChange={(e) => {
                      const nextCountry = e.target.value as Country;
                      setCountry(nextCountry);
                      setForm({ ...form, country: nextCountry, location: '' });
                    }}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-400"
                    required
                  >
                    <option value="UAE">🇦🇪 UAE</option>
                    <option value="UGANDA">🇺🇬 Uganda</option>
                    <option value="KENYA">🇰🇪 Kenya</option>
                    <option value="CHINA">🇨🇳 China</option>
                  </select>
                  <p className="mt-1 text-[11px] text-sky-600 font-medium">
                    Currency: <span className="font-bold">{listingCurrency}</span> — listings will only appear to buyers in this country.
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
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
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
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                  <p className="mt-1 text-[11px] text-gray-500">Number of units available for this listing.</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Condition *</label>
                  <select
                    value={form.condition}
                    onChange={(e) => setForm({ ...form, condition: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-400"
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
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-400"
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
            <section className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 shadow-sm animate-slide-up" style={{ animationDelay: '90ms' }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700 mb-3">🏠 Property Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Property Type</label>
                  <select
                    value={propertyDetails.propertyType}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, propertyType: e.target.value })}
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
                    value={propertyDetails.listingType}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, listingType: e.target.value })}
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
                    value={propertyDetails.bedrooms}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, bedrooms: e.target.value })}
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
                    value={propertyDetails.bathrooms}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, bathrooms: e.target.value })}
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
                    value={propertyDetails.furnishedStatus}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, furnishedStatus: e.target.value })}
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
                    value={propertyDetails.sizeSqft}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, sizeSqft: e.target.value })}
                    placeholder="e.g. 1200"
                    min="0"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Floor</label>
                  <input
                    type="text"
                    value={propertyDetails.floor}
                    onChange={(e) => setPropertyDetails({ ...propertyDetails, floor: e.target.value })}
                    placeholder="e.g. Ground, 3rd"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
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

          <section className="rounded-xl border border-white/60 bg-white/95 p-4 shadow-sm animate-slide-up" style={{ animationDelay: '120ms' }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700 mb-3">Photos</p>

            {uploadedCount > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <p className="text-xs text-amber-700">
                  <span className="font-semibold">{uploadedCount} image{uploadedCount !== 1 ? 's' : ''}</span> pending admin review — uploaded to secure storage, will appear on listing once approved.
                </p>
              </div>
            )}

            {imagePreviews.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {imagePreviews.map((src, i) => (
                  <div key={i} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200">
                    <Image
                      src={src}
                      alt={`Preview ${i + 1}`}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                    <div
                      role="status"
                      aria-label="Image pending approval"
                      className="absolute bottom-0 left-0 right-0 bg-amber-500/80 text-white text-[8px] font-bold text-center py-0.5"
                    >
                      PENDING
                    </div>
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white opacity-80 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                      aria-label="Remove image"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              role="button"
              tabIndex={0}
              className="rounded-xl border-2 border-dashed border-gray-300 p-4 text-center transition-colors hover:border-sky-400 cursor-pointer"
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

          <button
            type="submit"
            disabled={submitting || uploadingImages}
            className="w-full rounded-xl bg-sky-500 py-3 text-sm font-semibold text-white transition-all hover:bg-sky-600 disabled:opacity-50 shadow-sm hover:shadow-md"
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
                  <dd className="text-gray-600 font-bold text-sky-700">
                    {listingCurrency} {parseFloat(form.price || '0').toLocaleString()}
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
                <div className="flex gap-2">
                  <dt className="font-semibold text-gray-700 w-20 shrink-0">Images:</dt>
                  <dd className="text-gray-600">{pendingImageIds.length} attached</dd>
                </div>
              </dl>

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
                  className="flex-1 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Submitting…' : isEditMode ? 'Confirm & Save' : 'Confirm & Post'}
                </button>
              </div>
            </div>
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
                  className="flex-1 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold transition-colors"
                >
                  Upgrade Plan
                </button>
              </div>
            </div>
          </div>
        )}

        <aside className="space-y-4">
          <section className="rounded-xl border border-white/60 bg-white/95 p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700 mb-2">Summary</p>
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
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700 mb-2">Checklist</p>
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