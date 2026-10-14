'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';
import { useIntlayer } from 'next-intlayer';

interface AgricultureSubcategory {
  id: string;
  name: string;
  slug: string;
}

type PriceUnit = 'ITEM' | 'KG' | 'TONNE';

interface ProduceItem {
  key: string;
  title: string;
  description: string;
  price: string;
  priceUnit: PriceUnit;
  stock: string;
  location: string;
  subcategoryId: string;
  condition: 'NEW' | 'USED';
  imageIds: string[];
  imagePreviews: string[];
  uploading: boolean;
}

const CURRENCY = 'UGX';
const BULK_MAX_ITEMS = 20;

function newItem(): ProduceItem {
  return {
    key: crypto.randomUUID(),
    title: '',
    description: '',
    price: '',
    priceUnit: 'ITEM',
    stock: '',
    location: '',
    subcategoryId: '',
    condition: 'NEW',
    imageIds: [],
    imagePreviews: [],
    uploading: false,
  };
}

export default function CreateProducePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const t = useIntlayer('create-produce-page');

  const [subcategories, setSubcategories] = useState<AgricultureSubcategory[]>([]);
  const [categoryId, setCategoryId] = useState(''); // top-level Agriculture category id, used when no subcategory chosen
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [items, setItems] = useState<ProduceItem[]>([newItem()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successCount, setSuccessCount] = useState<number | null>(null);

  // Load the Agriculture category + its subcategories once on mount. The
  // subcategory dropdown needs real database category ids (not slugs) to
  // submit — see GET /api/categories/agriculture/subcategories. Fetched
  // independently (not Promise.all) so a subcategories hiccup doesn't
  // block the page: only the top-level category id is actually required
  // to post (the form already defaults to "General Agriculture" when no
  // subcategory is picked), so that's the only failure worth a hard error.
  useEffect(() => {
    let cancelled = false;
    api.get('/categories')
      .then(({ data }) => {
        if (cancelled) return;
        const agCategory = (data as { id: string; slug: string }[]).find((c) => c.slug === 'agriculture');
        if (agCategory) setCategoryId(agCategory.id);
        else setError(String(t.errCatsNotSetUp));
      })
      .catch(() => {
        if (!cancelled) setError(String(t.errLoadFailed));
      });
    api.get('/categories/agriculture/subcategories')
      .then(({ data }) => { if (!cancelled) setSubcategories(data || []); })
      .catch(() => { /* non-fatal — the form still works with just "General Agriculture" */ });
    return () => { cancelled = true; };
  }, [t]);

  const updateItem = useCallback((key: string, patch: Partial<ProduceItem>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }, []);

  const handleImageChange = useCallback(async (key: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    updateItem(key, { uploading: true });
    try {
      const formData = new FormData();
      Array.from(files).slice(0, 5).forEach((f) => formData.append('images', f));
      const { data } = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const ids: string[] = data.imageIds || [];
      const previews: string[] = data.urls || [];
      setItems((prev) => prev.map((it) => (it.key === key
        ? { ...it, imageIds: [...it.imageIds, ...ids], imagePreviews: [...it.imagePreviews, ...previews], uploading: false }
        : it)));
    } catch {
      updateItem(key, { uploading: false });
      setError(String(t.errUploadFailed));
    }
  }, [updateItem]);

  const addItem = () => {
    if (items.length >= BULK_MAX_ITEMS) return;
    setItems((prev) => [...prev, newItem()]);
  };
  const removeItem = (key: string) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev));
  };

  const validate = (): string | null => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const label = mode === 'bulk' ? `${t.productLabel} ${i + 1}` : String(t.yourProductLabel);
      if (!it.title.trim()) return `${label}: ${t.validTitleRequired}`;
      if (!it.description.trim()) return `${label}: ${t.validDescriptionRequired}`;
      if (!it.price || Number(it.price) < 0) return `${label}: ${t.validPriceRequired}`;
      if (!it.stock || Number(it.stock) < 0) return `${label}: ${t.validQuantityRequired}`;
      if (!it.location.trim()) return `${label}: ${t.validLocationRequired}`;
    }
    return null;
  };

  const handleSubmit = async () => {
    setError('');
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    if (!categoryId) { setError(String(t.errCategoriesLoading)); return; }

    setSubmitting(true);
    try {
      if (mode === 'single') {
        const it = items[0];
        await api.post('/listings', {
          title: it.title.trim(),
          description: it.description.trim(),
          price: Number(it.price),
          priceUnit: it.priceUnit,
          currency: CURRENCY,
          condition: it.condition,
          stock: Number(it.stock),
          location: it.location.trim(),
          country: 'UGANDA',
          categoryId: it.subcategoryId || categoryId,
          imageIds: it.imageIds,
        });
        setSuccessCount(1);
      } else {
        const payload = {
          listings: items.map((it) => ({
            title: it.title.trim(),
            description: it.description.trim(),
            price: Number(it.price),
            priceUnit: it.priceUnit,
            currency: CURRENCY,
            condition: it.condition,
            stock: Number(it.stock),
            location: it.location.trim(),
            country: 'UGANDA',
            categoryId: it.subcategoryId || categoryId,
            imageIds: it.imageIds,
          })),
        };
        const { data } = await api.post('/listings/bulk-produce', payload);
        setSuccessCount(data.created ?? items.length);
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || String(t.errSubmitFailed));
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return <div className="max-w-2xl mx-auto px-4 py-10 text-center text-sm text-gray-500">{t.loading}</div>;
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center">
        <div className="text-4xl mb-3" aria-hidden="true">🌾</div>
        <h1 className="text-lg font-bold text-gray-900">{t.loginHeading}</h1>
        <p className="text-sm text-gray-500 mt-1">{t.loginSubtitle}</p>
        <Link href="/auth/login" className="mt-5 inline-block bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors">
          {t.logIn}
        </Link>
      </div>
    );
  }

  if (successCount !== null) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center">
        <div className="text-4xl mb-3" aria-hidden="true">✅</div>
        <h1 className="text-lg font-bold text-gray-900">
          {successCount === 1 ? t.submittedOneTitle : `${successCount} ${t.submittedManyTitle}`}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {successCount === 1 ? t.pendingApprovalOne : t.pendingApprovalMany}
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Link href="/profile/listings" className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors">
            {t.viewMyListings}
          </Link>
          <button
            onClick={() => { setSuccessCount(null); setItems([newItem()]); setMode('single'); }}
            className="border border-gray-300 text-gray-700 text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
          >
            {t.postAnother}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-5 sm:py-8 pb-24">
      <div className="mb-5">
        <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 flex items-center gap-2">
          <span aria-hidden="true">🌾</span> {t.pageHeading}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {t.pageSubtitle}
        </p>
      </div>

      {/* Single vs bulk toggle */}
      <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 mb-5">
        <button
          onClick={() => { setMode('single'); setItems([items[0] ?? newItem()]); }}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${mode === 'single' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-500'}`}
        >
          {t.oneProduct}
        </button>
        <button
          onClick={() => setMode('bulk')}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${mode === 'bulk' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-500'}`}
        >
          {t.multipleProducts}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3">{error}</div>
      )}

      <div className="space-y-4">
        {items.map((it, idx) => (
          <div key={it.key} className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
            {mode === 'bulk' && (
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-gray-700">{t.productLabel} {idx + 1}</span>
                {items.length > 1 && (
                  <button onClick={() => removeItem(it.key)} className="text-xs font-semibold text-red-600 hover:text-red-700">
                    {t.remove}
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t.productName}</label>
                <input
                  type="text"
                  value={it.title}
                  onChange={(e) => updateItem(it.key, { title: e.target.value })}
                  placeholder={String(t.productNamePlaceholder)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t.description}</label>
                <textarea
                  value={it.description}
                  onChange={(e) => updateItem(it.key, { description: e.target.value })}
                  rows={2}
                  placeholder={String(t.descriptionPlaceholder)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t.category}</label>
                <select
                  value={it.subcategoryId}
                  onChange={(e) => updateItem(it.key, { subcategoryId: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">{t.generalAgriculture}</option>
                  {subcategories.map((sc) => (
                    <option key={sc.id} value={sc.id}>{sc.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t.condition}</label>
                <select
                  value={it.condition}
                  onChange={(e) => updateItem(it.key, { condition: e.target.value as 'NEW' | 'USED' })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="NEW">{t.freshNew}</option>
                  <option value="USED">{t.usedEquipment}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t.priceLabel} ({CURRENCY})</label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    min="0"
                    value={it.price}
                    onChange={(e) => updateItem(it.key, { price: e.target.value })}
                    placeholder="0"
                    className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <select
                    value={it.priceUnit}
                    onChange={(e) => updateItem(it.key, { priceUnit: e.target.value as PriceUnit })}
                    title={String(t.priceUnitLabel)}
                    className="shrink-0 rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="ITEM">/ {t.unitPerItem}</option>
                    <option value="KG">/ {t.unitPerKg}</option>
                    <option value="TONNE">/ {t.unitPerTonne}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t.quantityAvailable}</label>
                <input
                  type="number"
                  min="0"
                  value={it.stock}
                  onChange={(e) => updateItem(it.key, { stock: e.target.value })}
                  placeholder={String(t.quantityPlaceholder)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t.locationLabel}</label>
                <input
                  type="text"
                  value={it.location}
                  onChange={(e) => updateItem(it.key, { location: e.target.value })}
                  placeholder={String(t.locationPlaceholder)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t.photosOptional}</label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleImageChange(it.key, e.target.files)}
                  disabled={it.uploading}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                />
                {it.uploading && <p className="text-xs text-gray-400 mt-1">{t.uploading}</p>}
                {it.imagePreviews.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {it.imagePreviews.map((src, i) => (
                      <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden bg-gray-100">
                        <Image src={resolveImageUrl(src)} alt="" fill className="object-cover" sizes="56px" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {mode === 'bulk' && (
        <button
          onClick={addItem}
          disabled={items.length >= BULK_MAX_ITEMS}
          className="mt-3 w-full rounded-xl border-2 border-dashed border-emerald-300 text-emerald-700 text-sm font-semibold py-2.5 hover:bg-emerald-50 transition-colors disabled:opacity-50"
        >
          {t.addAnotherProduct} {items.length >= BULK_MAX_ITEMS ? `(${t.maxReached} ${BULK_MAX_ITEMS})` : ''}
        </button>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="mt-5 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold py-3 transition-colors"
      >
        {submitting ? t.submitting : mode === 'single' ? t.submitForApproval : `${t.submitMultiple} ${items.length} ${t.productsForApproval}`}
      </button>
    </div>
  );
}
