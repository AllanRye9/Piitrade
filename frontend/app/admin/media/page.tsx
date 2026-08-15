'use client';

/**
 * /admin/media — Admin bulk image upload for page sections.
 * Allows admins to upload many images at once to hero, banner,
 * featured, flash, collection and background sections of the site.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { resolveImageUrl } from '@/lib/utils';

type Section = 'hero' | 'banner' | 'featured' | 'flash' | 'collection' | 'background' | 'category' | 'sticky-header' | 'brand-logo' | 'cv-generator';

const SECTIONS: { value: Section; label: string; icon: string; desc: string }[] = [
  { value: 'sticky-header', label: 'Promo Header Banner', icon: '📣', desc: 'Full-width promotional strip (935 × 45 px) displayed as the very first element above the navigation header. Recommended image: 935 × 45 px wide banner.' },
  { value: 'hero', label: 'Hero Slideshow', icon: '🖼️', desc: 'Main rotating banner at the top of the home page' },
  { value: 'background', label: 'Site Background', icon: '🌄', desc: 'Full-page background image shown behind the site content' },
  { value: 'banner', label: 'Promo Banners', icon: '📢', desc: 'Country-market promotion banners' },
  { value: 'featured', label: 'Featured Deal', icon: '⭐', desc: 'Spotlight product / deal section — links straight to the listing purchase page' },
  { value: 'flash', label: 'Flash Deals', icon: '⚡', desc: 'Limited-time flash deal images — links to category group or purchase page' },
  { value: 'collection', label: 'Latest Collections', icon: '🗂️', desc: 'Latest collections grid imagery' },
  { value: 'category', label: 'Category Images', icon: '🏷️', desc: 'Real images for the Featured Categories section — upload 8 images in order: Fine Timepieces, Designer Apparel, Tech Innovations, Bespoke Home, Luxury Vehicles, Fine Jewellery, Art & Collectibles, Premium Services' },
  { value: 'brand-logo', label: 'Site Logo', icon: '🏷️', desc: 'Replaces the "Pi" icon, "Piitrade" name, and "Shop Smart. Shop Trusted." tagline in the header and footer with one unified logo image (the header/footer stays clickable to the homepage). Also replaces the tagline text in the welcome popup — upload 1 image' },
  { value: 'cv-generator', label: 'CV Sample Images', icon: '🗎', desc: 'Example CV images displayed on the CV Generator page — at least 3 shown at a time' },
];

/** Quick-link options by section. These populate the "Recommended destination" dropdown. */
const SECTION_QUICK_LINKS: Record<Section, { label: string; url: string }[]> = {
  'sticky-header': [
    { label: 'Home page', url: '/' },
    { label: 'All listings', url: '/listings' },
    { label: 'Flash Sales', url: '/flash-sales' },
    { label: 'Latest Collections', url: '/latest-collections' },
  ],
  hero: [
    { label: 'Home page', url: '/' },
    { label: 'All listings', url: '/listings' },
    { label: 'Flash Sales', url: '/flash-sales' },
    { label: 'Electronics', url: '/electronics' },
    { label: 'Fashion', url: '/fashion' },
    { label: 'Motors', url: '/motors' },
    { label: 'Furniture', url: '/furniture' },
  ],
  background: [
    { label: 'Home page', url: '/' },
  ],
  banner: [
    { label: 'All listings', url: '/listings' },
    { label: 'Electronics', url: '/electronics' },
    { label: 'Fashion', url: '/fashion' },
    { label: 'Flash Sales', url: '/flash-sales' },
    { label: 'Motors', url: '/motors' },
  ],
  featured: [
    { label: 'Featured Deal page', url: '/listings?placement=FEATURED_DEAL' },
    { label: 'All listings', url: '/listings' },
    { label: 'Electronics', url: '/electronics' },
    { label: 'Fashion', url: '/fashion' },
    { label: '→ Paste a listing URL e.g. /listings/{id}', url: '/listings/' },
  ],
  flash: [
    { label: 'Electronics (category group)', url: '/electronics' },
    { label: 'Fashion (category group)', url: '/fashion' },
    { label: 'Motors (category group)', url: '/motors' },
    { label: 'Furniture (category group)', url: '/furniture' },
    { label: 'All Flash Sales', url: '/flash-sales' },
    { label: 'All listings', url: '/listings' },
    { label: '→ Paste a listing URL e.g. /listings/{id}', url: '/listings/' },
  ],
  collection: [
    { label: 'All listings', url: '/listings' },
    { label: 'Electronics', url: '/electronics' },
    { label: 'Fashion', url: '/fashion' },
    { label: 'Motors', url: '/motors' },
    { label: 'Furniture', url: '/furniture' },
    { label: 'Fine Timepieces', url: '/fashion/watches' },
    { label: 'Art & Collectibles', url: '/listings?q=art' },
  ],
  category: [
    { label: 'Fine Timepieces → /fashion/watches', url: '/fashion/watches' },
    { label: 'Designer Apparel → /fashion', url: '/fashion' },
    { label: 'Tech Innovations → /electronics', url: '/electronics' },
    { label: 'Bespoke Home → /furniture', url: '/furniture' },
    { label: 'Luxury Vehicles → /motors', url: '/motors' },
    { label: 'Fine Jewellery → /fine-jewellery', url: '/fine-jewellery' },
    { label: 'Art & Collectibles → /arts-collectibles', url: '/arts-collectibles' },
    { label: 'Premium Services → /premium-services', url: '/premium-services' },
  ],
  'brand-logo': [
    { label: 'Home page', url: '/' },
  ],
  'cv-generator': [
    { label: 'CV Generator page', url: '/cv-generator' },
    { label: 'CV Builder', url: '/cv-generator/builder' },
    { label: 'Cover Letter Builder', url: '/cv-generator/cover-letter' },
  ],
};

interface SiteMediaItem {
  id: string;
  section: string;
  cdnUrl: string;
  title?: string | null;
  shortDescription?: string | null;
  price?: number | null;
  originalPrice?: number | null;
  currency?: 'AED' | 'UGX' | 'KES' | 'CNY' | 'USD' | null;
  altText: string | null;
  linkUrl: string | null;
  sortOrder: number;
  isActive?: boolean;
}

interface Toast { id: string; message: string; type: 'success' | 'error' | 'info' }

function useLocalToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id]; }
  }, []);
  const show = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    timers.current[id] = setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);
  return { toasts, show, dismiss };
}

export default function AdminMediaPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { toasts, show: showToast, dismiss } = useLocalToast();

  const [activeSection, setActiveSection] = useState<Section>('hero');
  const [media, setMedia] = useState<SiteMediaItem[]>([]);
  const [fetching, setFetching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [altText, setAltText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [previews, setPreviews] = useState<{ file: File; url: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editLinkValue, setEditLinkValue] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [price, setPrice] = useState('');
  const [originalPrice, setOriginalPrice] = useState('');
  const [currency, setCurrency] = useState<'AED' | 'UGX' | 'KES' | 'CNY' | 'USD'>('USD');
  const [editingMetaItem, setEditingMetaItem] = useState<SiteMediaItem | null>(null);

  // Auth guard
  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.replace('/');
  }, [user, loading, router]);

  const fetchMedia = useCallback(async () => {
    try {
      setFetching(true);
      const { data } = await api.get('/admin/media', { params: { section: activeSection } });
      setMedia(data.media || []);
    } catch {
      showToast('Failed to load media', 'error');
    } finally {
      setFetching(false);
    }
  }, [activeSection, showToast]);

  useEffect(() => { fetchMedia(); }, [fetchMedia]);

  // Reset linkUrl and previews when section changes so the form is clean
  useEffect(() => {
    setLinkUrl('');
    setPreviews([]);
    setAltText('');
    setTitle('');
    setShortDescription('');
    setPrice('');
    setOriginalPrice('');
    setCurrency('USD');
    setSelectedIds(new Set());
  }, [activeSection]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newPreviews = Array.from(files).map((f) => ({ file: f, url: URL.createObjectURL(f) }));
    setPreviews((prev) => [...prev, ...newPreviews]);
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePreview = (index: number) => {
    setPreviews((prev) => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleUpload = async () => {
    if (previews.length === 0) return;
    if (!linkUrl.trim()) {
      showToast('Link URL is required — set where clicking this image should go.', 'error');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('section', activeSection);
      if (altText.trim()) formData.append('altText', altText.trim());
      if (linkUrl.trim()) formData.append('linkUrl', linkUrl.trim());
      if (title.trim()) formData.append('title', title.trim());
      if (shortDescription.trim()) formData.append('shortDescription', shortDescription.trim());
      if (price.trim()) formData.append('price', price.trim());
      if (originalPrice.trim()) formData.append('originalPrice', originalPrice.trim());
      if (currency) formData.append('currency', currency);
      for (const p of previews) formData.append('images', p.file);

      const { data } = await api.post('/admin/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      showToast(`Uploaded ${data.uploaded} image${data.uploaded !== 1 ? 's' : ''} to ${activeSection}`, 'success');
      setPreviews([]);
      setAltText('');
      setLinkUrl('');
      setTitle('');
      setShortDescription('');
      setPrice('');
      setOriginalPrice('');
      setCurrency('USD');
      fetchMedia();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Upload failed';
      showToast(msg, 'error');
    } finally {
      setUploading(false);
    }
  };

  const saveLinkUrl = async (item: SiteMediaItem) => {
    setActionLoading(item.id);
    try {
      await api.put(`/admin/media/${item.id}`, { linkUrl: editLinkValue.trim() || null });
      showToast('Link URL saved', 'success');
      setEditingLinkId(null);
      fetchMedia();
    } catch {
      showToast('Failed to save link URL', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleActive = async (item: SiteMediaItem) => {
    setActionLoading(item.id);
    try {
      await api.put(`/admin/media/${item.id}`, { isActive: !item.isActive });
      showToast(`Image ${item.isActive ? 'hidden' : 'activated'}`, 'success');
      fetchMedia();
    } catch {
      showToast('Update failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const deleteMedia = async (id: string) => {
    if (!confirm('Delete this image? This cannot be undone.')) return;
    setActionLoading(id);
    try {
      await api.delete(`/admin/media/${id}`);
      showToast('Image deleted', 'success');
      fetchMedia();
    } catch {
      showToast('Delete failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (media.length === 0) return;
    if (selectedIds.size === media.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(media.map((item) => item.id)));
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected item(s)? This cannot be undone.`)) return;
    setActionLoading('bulk-delete');
    try {
      await api.delete('/admin/media/bulk', { data: { ids } });
      showToast(`Deleted ${ids.length} item(s)`, 'success');
      setSelectedIds(new Set());
      fetchMedia();
    } catch {
      showToast('Bulk delete failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const saveMetadata = async () => {
    if (!editingMetaItem) return;
    setActionLoading(editingMetaItem.id);
    try {
      await api.put(`/admin/media/${editingMetaItem.id}`, {
        title: editingMetaItem.title || null,
        shortDescription: editingMetaItem.shortDescription || null,
        price: editingMetaItem.price ?? null,
        originalPrice: editingMetaItem.originalPrice ?? null,
        currency: editingMetaItem.currency || null,
      });
      showToast('Item details updated', 'success');
      setEditingMetaItem(null);
      fetchMedia();
    } catch {
      showToast('Failed to update item details', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const sectionInfo = SECTIONS.find((s) => s.value === activeSection)!;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast notifications */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-white shadow-lg text-sm font-medium animate-fade-up cursor-pointer ${
              t.type === 'success' ? 'bg-emerald-500' : t.type === 'error' ? 'bg-red-500' : 'bg-sky-500'
            }`}
            onClick={() => dismiss(t.id)}
          >
            <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}</span>
            {t.message}
          </div>
        ))}
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Page header */}
        <div className="mb-4">
          <h1 className="text-3xl font-extrabold text-gray-900">📁 Site Media Manager</h1>
          <p className="mt-1 text-gray-500">
            Upload images in bulk to any section of the home page. Changes go live immediately.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* Section picker sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden sticky top-24">
              <div className="px-4 py-3 bg-gray-900 text-white">
                <p className="text-xs font-semibold uppercase tracking-wider">Page Sections</p>
              </div>
              <nav className="divide-y divide-gray-100">
                {SECTIONS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setActiveSection(s.value)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      activeSection === s.value
                        ? 'bg-sky-50 text-sky-700 font-semibold'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-lg">{s.icon}</span>
                    <div>
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-[11px] text-gray-400 leading-tight">{s.desc}</p>
                    </div>
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Main content */}
          <div className="lg:col-span-3 space-y-6">
            {/* Upload card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-1">
                {sectionInfo.icon} Upload to &quot;{sectionInfo.label}&quot;
              </h2>
              <p className="text-sm text-gray-500 mb-4">{sectionInfo.desc}</p>

              {/* Drop zone */}
              <div
                className="border-2 border-dashed border-sky-200 rounded-xl p-6 flex flex-col items-center justify-center gap-3 bg-sky-50/40 hover:bg-sky-50 hover:border-sky-400 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = e.dataTransfer.files;
                  if (files.length > 0) {
                    const newPreviews = Array.from(files)
                      .filter((f) => f.type.startsWith('image/'))
                      .map((f) => ({ file: f, url: URL.createObjectURL(f) }));
                    setPreviews((prev) => [...prev, ...newPreviews]);
                  }
                }}
              >
                <svg className="w-10 h-10 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <div className="text-center">
                  <p className="text-sm font-semibold text-sky-600">Click to browse or drag &amp; drop</p>
                  <p className="text-xs text-gray-400 mt-0.5">JPEG, PNG, GIF, WEBP · up to 20 MB each · up to 50 files</p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />

              {/* Alt text */}
              <div className="mt-4">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Alt text (optional — applied to all images in this batch)</label>
                <input
                  type="text"
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  placeholder="e.g. Luxury watches hero image"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Title (optional)</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Item title"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Short description (optional)</label>
                  <input
                    type="text"
                    value={shortDescription}
                    onChange={(e) => setShortDescription(e.target.value)}
                    placeholder="One-line description"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Price (optional)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Price before discount (optional)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={originalPrice}
                    onChange={(e) => setOriginalPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as 'AED' | 'UGX' | 'KES' | 'CNY' | 'USD')}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                  >
                    {['USD', 'AED', 'UGX', 'KES', 'CNY'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Link URL — required */}
              <div className="mt-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Link URL <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">(required — where clicking this image goes)</span>
                </label>
                {/* Recommended destination dropdown */}
                <div className="mb-2">
                  <label className="block text-[11px] text-gray-400 mb-1">
                    📌 Recommended destinations for <strong>{sectionInfo.label}</strong> — select to auto-fill:
                  </label>
                  <select
                    className="w-full rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setLinkUrl(e.target.value);
                    }}
                  >
                    <option value="">— Pick a recommended destination —</option>
                    {SECTION_QUICK_LINKS[activeSection].map((opt) => (
                      <option key={opt.url} value={opt.url}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="e.g. /listings/abc123 or /electronics"
                  required
                  className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 ${
                    linkUrl.trim() ? 'border-emerald-300 bg-emerald-50/40' : 'border-red-300 bg-red-50/30'
                  }`}
                />
                {!linkUrl.trim() && (
                  <p className="mt-1 text-[11px] text-red-500">⚠ A destination URL is required before uploading.</p>
                )}
              </div>

              {/* Preview grid */}
              {previews.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-gray-700">{previews.length} file{previews.length !== 1 ? 's' : ''} ready to upload</p>
                    <button type="button" onClick={() => setPreviews([])} className="text-xs text-red-500 hover:text-red-700">Clear all</button>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {previews.map((p, i) => (
                      <div key={p.url} className="relative group aspect-square rounded-lg overflow-hidden bg-gray-100">
                        <Image src={p.url} alt={`Preview ${i + 1}`} fill className="object-cover" unoptimized />
                        <button
                          type="button"
                          onClick={() => removePreview(i)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading || previews.length === 0}
                className="mt-5 w-full py-3 rounded-xl bg-sky-600 text-white font-bold text-sm hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Upload {previews.length > 0 ? `${previews.length} image${previews.length !== 1 ? 's' : ''}` : 'Images'} to {sectionInfo.label}
                  </>
                )}
              </button>
            </div>

            {/* Existing media grid */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-gray-800">
                  Current Images — {sectionInfo.label}
                </h2>
                <div className="flex items-center gap-2">
                  {media.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="text-xs text-gray-600 hover:text-gray-800 font-medium"
                    >
                      {selectedIds.size === media.length ? 'Clear selection' : 'Select all'}
                    </button>
                  )}
                  {selectedIds.size > 0 && (
                    <button
                      type="button"
                      onClick={deleteSelected}
                      disabled={actionLoading === 'bulk-delete'}
                      className="text-xs text-red-600 hover:text-red-700 font-semibold disabled:opacity-50"
                    >
                      Delete selected ({selectedIds.size})
                    </button>
                  )}
                  <button type="button" onClick={fetchMedia} className="text-xs text-sky-600 hover:text-sky-800 font-medium">↻ Refresh</button>
                </div>
              </div>

              {fetching ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="aspect-video bg-gray-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : media.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <p className="text-4xl mb-2">🖼️</p>
                  <p className="text-sm">No images uploaded to this section yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {media.map((item) => (
                    <div key={item.id} className={`relative group rounded-xl overflow-hidden border-2 transition-all ${item.isActive ? 'border-emerald-200' : 'border-gray-200 opacity-60'}`}>
                      <div className="absolute top-1.5 right-1.5 z-20">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelected(item.id)}
                          className="w-4 h-4 rounded accent-sky-500 bg-white/90"
                          aria-label="Select media item"
                        />
                      </div>
                      <div className="aspect-video relative bg-gray-100">
                        <Image
                          src={resolveImageUrl(item.cdnUrl)}
                          alt={item.altText || `${item.section} image`}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                      <div className="p-2 bg-white">
                        <p className="text-[10px] font-semibold text-gray-700 truncate" title={item.title || item.altText || ''}>{item.title || item.altText || '—'}</p>
                        <p className="text-[10px] text-gray-400 truncate" title={item.shortDescription || ''}>{item.shortDescription || '—'}</p>
                        {(item.price != null || item.originalPrice != null) && (
                          <p className="text-[10px] text-gray-500 truncate">
                            {item.originalPrice != null && <span className="line-through mr-1">{item.currency || 'USD'} {Number(item.originalPrice).toLocaleString('en-US')}</span>}
                            {item.price != null && <span className="font-semibold text-emerald-600">{item.currency || 'USD'} {Number(item.price).toLocaleString('en-US')}</span>}
                          </p>
                        )}
                        <p className="text-[10px] text-gray-300">Order: {item.sortOrder}</p>
                        {/* Link URL inline editor */}
                        {editingLinkId === item.id ? (
                          <div className="mt-1 space-y-1">
                            <select
                              className="w-full rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] focus:outline-none"
                              value=""
                              onChange={(e) => { if (e.target.value) setEditLinkValue(e.target.value); }}
                            >
                              <option value="">— Quick link —</option>
                              {SECTION_QUICK_LINKS[activeSection].map((opt) => (
                                <option key={opt.url} value={opt.url}>{opt.label}</option>
                              ))}
                            </select>
                            <div className="flex gap-1">
                              <input
                                type="text"
                                value={editLinkValue}
                                onChange={(e) => setEditLinkValue(e.target.value)}
                                placeholder="/listings/id"
                                className="flex-1 min-w-0 rounded border border-sky-300 px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-sky-400"
                                onKeyDown={(e) => { if (e.key === 'Enter') saveLinkUrl(item); if (e.key === 'Escape') setEditingLinkId(null); }}
                              />
                              <button type="button" onClick={() => saveLinkUrl(item)} disabled={actionLoading === item.id} className="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 shrink-0">✓</button>
                              <button type="button" onClick={() => setEditingLinkId(null)} className="text-[10px] font-bold text-gray-400 hover:text-gray-600 shrink-0">✕</button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setEditingLinkId(item.id); setEditLinkValue(item.linkUrl || ''); }}
                            className={`mt-1 text-[10px] truncate block w-full text-left ${item.linkUrl ? 'text-sky-500 hover:text-sky-700' : 'text-red-400 hover:text-red-600 font-semibold'}`}
                            title={item.linkUrl || 'Set link URL (required)'}
                          >
                            {item.linkUrl ? (
                              <>🔗 <span className="font-mono">{item.linkUrl}</span></>
                            ) : (
                              <>⚠ Set link URL</>
                            )}
                          </button>
                        )}
                      </div>
                      {/* Action overlay */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 rounded-xl">
                        <button
                          type="button"
                          onClick={() => setEditingMetaItem(item)}
                          disabled={actionLoading === item.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white transition-colors w-28"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(item)}
                          disabled={actionLoading === item.id}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors w-28 ${
                            item.isActive
                              ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                              : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                          }`}
                        >
                          {actionLoading === item.id ? '…' : item.isActive ? '🙈 Hide' : '👁 Show'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteMedia(item.id)}
                          disabled={actionLoading === item.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500 hover:bg-red-600 text-white transition-colors w-28"
                        >
                          🗑 Delete
                        </button>
                      </div>
                      {/* Status badge */}
                      <div className={`absolute top-1.5 left-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${item.isActive ? 'bg-emerald-500 text-white' : 'bg-gray-400 text-white'}`}>
                        {item.isActive ? 'LIVE' : 'HIDDEN'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {editingMetaItem && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-bold text-gray-900">Edit item details</h3>
            <p className="mt-1 text-xs text-gray-500 truncate" title={editingMetaItem.id}>
              {editingMetaItem.id}
            </p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Title</label>
                <input
                  type="text"
                  value={editingMetaItem.title || ''}
                  onChange={(e) => setEditingMetaItem((prev) => prev ? { ...prev, title: e.target.value } : prev)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Short description</label>
                <input
                  type="text"
                  value={editingMetaItem.shortDescription || ''}
                  onChange={(e) => setEditingMetaItem((prev) => prev ? { ...prev, shortDescription: e.target.value } : prev)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Price</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editingMetaItem.price ?? ''}
                  onChange={(e) => setEditingMetaItem((prev) => prev ? { ...prev, price: e.target.value ? Number(e.target.value) : null } : prev)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Price before discount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editingMetaItem.originalPrice ?? ''}
                  onChange={(e) => setEditingMetaItem((prev) => prev ? { ...prev, originalPrice: e.target.value ? Number(e.target.value) : null } : prev)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Currency</label>
                <select
                  value={editingMetaItem.currency || 'USD'}
                  onChange={(e) => setEditingMetaItem((prev) => prev ? { ...prev, currency: e.target.value as 'AED' | 'UGX' | 'KES' | 'CNY' | 'USD' } : prev)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                >
                  {['USD', 'AED', 'UGX', 'KES', 'CNY'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingMetaItem(null)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveMetadata}
                disabled={actionLoading === editingMetaItem.id}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
