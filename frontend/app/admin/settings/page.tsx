'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { resolveImageUrl } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Settings {
  siteName: string;
  maintenanceMode: boolean;
  allowRegistration: boolean;
  defaultCountry: string;
  itemsPerPage: number;
  maxImagesPerListing: number;
  trialDays: number; // free trial period for new ordinary users
}

interface SocialLinks {
  facebook: string;
  instagram: string;
  linkedin: string;
  x: string;
  whatsapp: string;
  youtube: string;
  tiktok: string;
}

interface Deal {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  price?: number;
  originalPrice?: number;
  discount?: number;
  link?: string;
  currency?: string;
  expiresAt?: string | null; // ISO date string or null = unlimited
  /** Countries this deal is visible in. undefined/empty = all countries. */
  countries?: string[];
}

const ALL_COUNTRIES = ['UAE', 'UGANDA', 'KENYA', 'CHINA'] as const;
const COUNTRY_LABELS: Record<string, string> = { UAE: 'UAE', UGANDA: 'Uganda', KENYA: 'Kenya', CHINA: 'China' };

interface SectionCountsResponse {
  target: number;
  countries: readonly string[];
  sections: Record<string, Record<string, number>>;
}

// Metadata for the "Homepage Row Fill Status" panel. `autoFillable: true`
// rows are placement-driven (a listing is explicitly assigned into that
// slot) and can be honestly auto-filled with real, currently-unplaced
// listings. The others reflect organic marketplace inventory (recent items
// in a category, or "everything else") — there is no honest way to pad
// those to 6 without fabricating fake listings, so they are shown as
// status-only with an explanatory note instead of an auto-fill button.
const HOMEPAGE_SECTIONS: { key: string; label: string; autoFillable: boolean }[] = [
  { key: 'FLASH_SALE', label: 'FLASH SALES', autoFillable: true },
  { key: 'LATEST_COLLECTIONS', label: 'Latest Collections', autoFillable: true },
  { key: 'FEATURED_DEAL', label: '✦ FEATURED DEAL', autoFillable: true },
  { key: 'TODAYS_DEALS', label: "Today's Deals", autoFillable: true },
  { key: 'OTHER_COLLECTIONS', label: 'Other Collections', autoFillable: false },
  { key: 'RECENT_MOTORS', label: 'Recent Across Categories · Motors', autoFillable: false },
  { key: 'RECENT_ELECTRONICS', label: 'Recent Across Categories · Electronics', autoFillable: false },
  { key: 'RECENT_PROPERTY', label: 'Recent Across Categories · Property', autoFillable: false },
  { key: 'RECENT_FASHION', label: 'Recent Across Categories · Latest Fashion', autoFillable: false },
];

const DEFAULT_SETTINGS: Settings = {
  siteName: '3R Elite',
  maintenanceMode: false,
  allowRegistration: true,
  defaultCountry: 'UAE',
  itemsPerPage: 20,
  maxImagesPerListing: 10,
  trialDays: 7,
};

const THEME_OPTIONS = [
  { key: 'sky',      label: 'Light Blue',    color: '#0EA5E9' },
  { key: 'white',    label: 'White',         color: '#64748b' },
  { key: 'dark',     label: 'Dark',          color: '#38bdf8' },
  { key: 'emerald',  label: 'Emerald',       color: '#10b981' },
  { key: 'violet',   label: 'Violet',        color: '#7c3aed' },
  { key: 'rose',     label: 'Rose',          color: '#f43f5e' },
  { key: 'amber',    label: 'Amber',         color: '#f59e0b' },
  { key: 'indigo',   label: 'Indigo',        color: '#4f46e5' },
  { key: 'navy',     label: 'Navy Blue',     color: '#1d4ed8' },
  { key: 'ocean',    label: 'Ocean',         color: '#0891b2' },
  { key: 'teal',     label: 'Teal',          color: '#0d9488' },
  { key: 'gold',     label: 'Gold Luxury',   color: '#ca8a04' },
  { key: 'midnight', label: 'Midnight',      color: '#818cf8' },
  { key: 'forest',   label: 'Forest',        color: '#16a34a' },
  { key: 'coral',    label: 'Coral',         color: '#ea580c' },
  { key: 'royal',    label: 'Royal Purple',  color: '#9333ea' },
];

// ─── Toggle Switch ─────────────────────────────────────────────────────────────

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-sky-600' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

// ─── Empty Deal Template ───────────────────────────────────────────────────────

function emptyDeal(): Deal {
  return { id: crypto.randomUUID(), title: '', description: '', imageUrl: '', price: undefined, originalPrice: undefined, discount: undefined, link: '', currency: 'AED', expiresAt: null, countries: undefined };
}

// ─── Logo Page Options ────────────────────────────────────────────────────────
// Only the Exchange widget logo placement is supported.
// The logo appears inline with "3RELITE EXCHANGE · Money Transfer Rates".
const LOGO_PAGE_OPTIONS = [
  { key: 'exchange', label: 'Exchange Widget', icon: '💱' },
];

// ─── Main Page ─────────────────────────────────────────────────────────────────

// ─── Listing Picker Types ──────────────────────────────────────────────────────

interface PickerListing {
  id: string;
  title: string;
  price: number;
  currency: string;
  images: string[];
  productImages?: { cdnUrl: string }[];
  category?: { name: string };
  condition?: string;
  location?: string;
  country?: string;
}

// ─── ListingPickerModal ────────────────────────────────────────────────────────

function ListingPickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (listings: PickerListing[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickerListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // Multi-select: ids of listings the admin has picked. Selections persist
  // across searches so switching search terms doesn't lose earlier picks.
  const [selected, setSelected] = useState<Map<string, PickerListing>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Load recent listings on open
  useEffect(() => { doSearch(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '24', page: '1' });
      if (q.trim()) params.set('search', q.trim());
      const { data } = await api.get(`/admin/listings?${params}`);
      setResults(data.listings || []);
      setSearched(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(v), 380);
  };

  const getThumb = (l: PickerListing) =>
    l.productImages?.[0]?.cdnUrl || l.images?.[0] || null;

  const toggleSelect = (listing: PickerListing) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(listing.id)) {
        next.delete(listing.id);
      } else {
        next.set(listing.id, listing);
      }
      return next;
    });
  };

  const selectedCount = selected.size;

  const handleAddSelected = () => {
    if (selectedCount === 0) return;
    onSelect(Array.from(selected.values()));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-bold text-gray-900">Pick Listings</h3>
            <p className="text-xs text-gray-400 mt-0.5">Search or browse — select one or more listings, then add them as deals</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 hover:bg-red-100 text-gray-500 hover:text-red-500 transition-colors text-base font-bold"
          >
            ×
          </button>
        </div>

        {/* Search bar */}
        <div className="px-5 py-3 border-b border-gray-50">
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
            {loading ? (
              <svg className="w-4 h-4 text-amber-500 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search by title, keyword…"
              className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none"
            />
            {query && (
              <button onClick={() => { setQuery(''); doSearch(''); }} className="text-gray-300 hover:text-gray-500 text-lg leading-none">×</button>
            )}
          </div>
        </div>

        {/* Results grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {!searched && loading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-gray-100 overflow-hidden animate-pulse">
                  <div className="h-28 bg-gray-100" />
                  <div className="p-2.5 space-y-1.5">
                    <div className="h-3 bg-gray-100 rounded w-3/4" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {searched && results.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-400">
              No listings found{query ? ` for "${query}"` : ''}.
            </div>
          )}

          {results.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {results.map((listing) => {
                const thumb = getThumb(listing);
                const isSelected = selected.has(listing.id);
                return (
                  <button
                    key={listing.id}
                    type="button"
                    onClick={() => toggleSelect(listing)}
                    aria-pressed={isSelected}
                    className={`group text-left rounded-xl border transition-all overflow-hidden bg-white ${
                      isSelected ? 'border-amber-500 ring-2 ring-amber-300 shadow-md' : 'border-gray-200 hover:border-amber-400 hover:shadow-md'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="relative h-28 bg-gray-50 overflow-hidden">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resolveImageUrl(thumb)}
                          alt={listing.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-3xl text-gray-200">🛍</div>
                      )}
                      {/* Selection checkbox */}
                      <span
                        className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold border-2 transition-colors ${
                          isSelected ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white/80 border-gray-300 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      {/* Currency badge */}
                      <span className="absolute top-1.5 right-1.5 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                        {listing.currency}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="p-2.5">
                      <p className="text-xs font-semibold text-gray-800 line-clamp-2 leading-snug mb-1 group-hover:text-amber-700 transition-colors">
                        {listing.title}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-black text-amber-600">
                          {Number(listing.price).toLocaleString()} <span className="text-[10px] font-semibold">{listing.currency}</span>
                        </span>
                        {listing.category?.name && (
                          <span className="text-[9px] text-gray-400 bg-gray-50 rounded px-1.5 py-0.5 truncate max-w-[70px]">
                            {listing.category.name}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Selection state footer */}
                    <div className={`px-2.5 pb-2.5 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                      <div className={`w-full text-center text-[10px] font-bold rounded-lg py-1 ${isSelected ? 'bg-amber-600 text-white' : 'bg-amber-500 text-white'}`}>
                        {isSelected ? '✓ Selected' : '+ Select'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer: selection summary + confirm action */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 flex items-center justify-between gap-3">
          {selectedCount > 0 ? (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-amber-700 shrink-0">{selectedCount} selected</span>
                <button
                  type="button"
                  onClick={() => setSelected(new Map())}
                  className="text-xs text-gray-400 hover:text-red-500 underline underline-offset-2 shrink-0"
                >
                  Clear
                </button>
              </div>
              <button
                type="button"
                onClick={handleAddSelected}
                className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
              >
                + Add {selectedCount} as Deal{selectedCount > 1 ? 's' : ''}
              </button>
            </>
          ) : (
            <p className="text-xs text-gray-400 text-center w-full">
              Showing up to 24 listings. Select one or more, then add them as deals. You can edit price, discount & expiry after adding.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminSettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [settings, setSettings] = useState<Settings | null>(DEFAULT_SETTINGS);
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({ facebook: '', instagram: '', linkedin: '', x: '', whatsapp: '', youtube: '', tiktok: '' });
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [headerTheme, setHeaderTheme] = useState('sky');
  const [deals, setDeals] = useState<Deal[]>([]);
  const [fetching, setFetching] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sectionCounts, setSectionCounts] = useState<SectionCountsResponse | null>(null);
  const [sectionCountsError, setSectionCountsError] = useState(false);
  const [autoFilling, setAutoFilling] = useState<string | null>(null); // `${section}:${country}` currently in-flight

  // Logo state
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoPages, setLogoPages] = useState<string[]>(['exchange']);
  const [logoAltText, setLogoAltText] = useState('');
  const [logoSize, setLogoSize] = useState(28);
  const [logoLinkUrl, setLogoLinkUrl] = useState('');
  const [logoDisplayMode, setLogoDisplayMode] = useState<'inline' | 'replace'>('inline');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [savingLogo, setSavingLogo] = useState(false);
  const [deletingLogo, setDeletingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Interview demo video state
  const [interviewVideoUrl, setInterviewVideoUrl] = useState<string | null>(null);
  const [interviewVideoTitle, setInterviewVideoTitle] = useState('');
  const [interviewVideoFile, setInterviewVideoFile] = useState<File | null>(null);
  const [interviewVideoPreview, setInterviewVideoPreview] = useState<string | null>(null);
  const [savingInterviewVideo, setSavingInterviewVideo] = useState(false);
  const [deletingInterviewVideo, setDeletingInterviewVideo] = useState(false);
  const interviewVideoInputRef = useRef<HTMLInputElement>(null);

  // Homepage promo video state ("LIVE NOW / SHOP NOW" video beside the hero slideshow)
  const [promoVideoUrl, setPromoVideoUrl] = useState<string | null>(null);
  const [promoVideoTitle, setPromoVideoTitle] = useState('');
  const [promoVideoFile, setPromoVideoFile] = useState<File | null>(null);
  const [promoVideoPreview, setPromoVideoPreview] = useState<string | null>(null);
  const [savingPromoVideo, setSavingPromoVideo] = useState(false);
  const [deletingPromoVideo, setDeletingPromoVideo] = useState(false);
  const promoVideoInputRef = useRef<HTMLInputElement>(null);

  // Save states
  const [saving, setSaving] = useState(false);
  const [savingSocial, setSavingSocial] = useState(false);
  const [savingWhatsApp, setSavingWhatsApp] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingDeals, setSavingDeals] = useState(false);

  // Status messages
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const flash = useCallback((msg: string, isError = false) => {
    if (isError) setError(msg); else setSuccess(msg);
    setTimeout(() => { setSuccess(''); setError(''); }, 3500);
  }, []);

  // ── Load data ──────────────────────────────────────────────────────────────
  // Track whether we have already fetched to avoid re-fetching on every render.
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
    if (user?.role === 'ADMIN' && !fetchedRef.current) {
      fetchedRef.current = true;
      Promise.allSettled([
        api.get('/admin/settings'),
        api.get('/admin/social-links'),
        api.get('/admin/site-config'),
        api.get('/admin/site-config/deals'),
        api.get('/admin/site-config/logo'),
        api.get('/admin/site-config/interview-video'),
        api.get('/admin/site-config/promo-video'),
        api.get('/admin/section-counts'),
      ])
        .then((results) => {
          const [settingsResult, socialResult, configResult, dealsResult, logoResult, interviewVideoResult, promoVideoResult, sectionCountsResult] = results;

          if (settingsResult.status === 'fulfilled') {
            setSettings((settingsResult.value.data as Settings) || DEFAULT_SETTINGS);
          } else {
            setSettings(DEFAULT_SETTINGS);
          }

          if (socialResult.status === 'fulfilled') {
            const s = socialResult.value.data || {};
            setSocialLinks({ facebook: s.facebook || '', instagram: s.instagram || '', linkedin: s.linkedin || '', x: s.x || '', whatsapp: s.whatsapp || '', youtube: s.youtube || '', tiktok: s.tiktok || '' });
          }

          if (configResult.status === 'fulfilled') {
            setWhatsappNumber(configResult.value.data?.whatsappNumber || '');
            setHeaderTheme(configResult.value.data?.headerTheme || 'sky');
          }

          if (dealsResult.status === 'fulfilled') {
            setDeals(dealsResult.value.data?.deals || []);
          }

          if (logoResult.status === 'fulfilled') {
            setLogoUrl(logoResult.value.data?.logoUrl || null);
            // Exchange is the only supported placement — always ensure it's selected
            const storedPages: string[] = logoResult.value.data?.logoPages || [];
            setLogoPages(storedPages.includes('exchange') ? storedPages : ['exchange']);
            setLogoAltText(logoResult.value.data?.logoAltText || '');
            setLogoSize(logoResult.value.data?.logoSize || 28);
            setLogoLinkUrl(logoResult.value.data?.logoLinkUrl || '');
            setLogoDisplayMode(logoResult.value.data?.logoDisplayMode === 'replace' ? 'replace' : 'inline');
          }

          if (interviewVideoResult.status === 'fulfilled') {
            setInterviewVideoUrl(interviewVideoResult.value.data?.videoUrl || null);
            setInterviewVideoTitle(interviewVideoResult.value.data?.videoTitle || '');
          }

          if (promoVideoResult.status === 'fulfilled') {
            setPromoVideoUrl(promoVideoResult.value.data?.videoUrl || null);
            setPromoVideoTitle(promoVideoResult.value.data?.videoTitle || '');
          }

          if (sectionCountsResult.status === 'fulfilled') {
            const payload = sectionCountsResult.value.data;
            // Validate the shape before trusting it — if the backend route
            // isn't deployed yet, some hosts/proxies return a 200 with an
            // HTML fallback page instead of a proper 404, which would
            // otherwise silently poison this state with the wrong shape.
            if (payload && typeof payload === 'object' && payload.sections && typeof payload.sections === 'object') {
              setSectionCounts(payload);
              setSectionCountsError(false);
            } else {
              setSectionCounts(null);
              setSectionCountsError(true);
            }
          } else {
            setSectionCountsError(true);
          }
        })
        .finally(() => setFetching(false));
    }
  }, [user, loading, router, flash]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const { data } = await api.put('/admin/settings', settings);
      setSettings(data);
      flash('General settings saved.');
    } catch { flash('Failed to save settings.', true); }
    finally { setSaving(false); }
  };

  const handleSaveSocial = async () => {
    setSavingSocial(true);
    try {
      await api.put('/admin/social-links', socialLinks);
      flash('Social links saved.');
    } catch { flash('Failed to save social links.', true); }
    finally { setSavingSocial(false); }
  };

  const handleSaveWhatsApp = async () => {
    setSavingWhatsApp(true);
    try {
      await api.put('/admin/site-config/whatsapp', { whatsappNumber });
      flash('WhatsApp number saved. It will appear on the site immediately.');
    } catch { flash('Failed to save WhatsApp number.', true); }
    finally { setSavingWhatsApp(false); }
  };

  const handleSaveTheme = async () => {
    setSavingTheme(true);
    try {
      await api.put('/admin/site-config/header-theme', { headerTheme });
      flash('Header theme saved. All visitors will see the new theme.');
    } catch { flash('Failed to save theme.', true); }
    finally { setSavingTheme(false); }
  };

  const handleSaveDeals = async () => {
    setSavingDeals(true);
    try {
      await api.put('/admin/site-config/deals', { deals });
      flash('Today\'s Deals saved.');
    } catch { flash('Failed to save Today\'s Deals.', true); }
    finally { setSavingDeals(false); }
  };

  const addDeal = () => setDeals((prev) => [...prev, emptyDeal()]);
  const removeDeal = (id: string) => setDeals((prev) => prev.filter((d) => d.id !== id));
  const updateDeal = (id: string, field: keyof Deal, value: unknown) =>
    setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)));

  const refreshSectionCounts = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/section-counts');
      if (data && typeof data === 'object' && data.sections && typeof data.sections === 'object') {
        setSectionCounts(data);
        setSectionCountsError(false);
      } else {
        setSectionCountsError(true);
      }
    } catch { setSectionCountsError(true); }
  }, []);

  /** Auto-fill a placement-driven row (Flash Sale / Latest Collections / Featured Deal) to 6 for one country. */
  const handleAutoFillPlacement = async (section: string, country: string) => {
    const key = `${section}:${country}`;
    setAutoFilling(key);
    try {
      const { data } = await api.post('/admin/section-counts/auto-fill', { section, country });
      if (data.updated > 0) {
        flash(`Added ${data.updated} listing${data.updated === 1 ? '' : 's'} to ${HOMEPAGE_SECTIONS.find((s) => s.key === section)?.label} for ${COUNTRY_LABELS[country]}.`);
      } else {
        flash(data.message || 'No changes were needed.', data.newCount < 6);
      }
      await refreshSectionCounts();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      flash(msg || 'Auto-fill failed. Please try again.', true);
    } finally {
      setAutoFilling(null);
    }
  };

  /**
   * Auto-fill Today's Deals to 6 for one country by pulling in real,
   * currently-active listings from that country (any category) and adding
   * them as deals — the same conversion already used by "Pick from Listings",
   * just automated. Never fabricates listings.
   */
  const handleAutoFillDeals = async (country: string) => {
    const key = `TODAYS_DEALS:${country}`;
    setAutoFilling(key);
    try {
      const currentCount = sectionCounts?.sections.TODAYS_DEALS?.[country] ?? 0;
      const needed = Math.max(0, 6 - currentCount);
      if (needed === 0) {
        flash('Already has 6 or more deals for this country — no changes made.');
        return;
      }
      const { data } = await api.get(`/admin/listings?limit=${needed + 6}&status=ACTIVE`);
      const existingLinks = new Set(deals.map((d) => d.link));
      const candidates: PickerListing[] = (data.listings || [])
        .filter((l: PickerListing) => l.country === country && !existingLinks.has(`/listings/${l.id}`))
        .slice(0, needed);

      if (candidates.length === 0) {
        flash(`No additional active listings available in ${COUNTRY_LABELS[country]} to auto-fill Today's Deals with.`, true);
        return;
      }

      // Built manually (rather than via addDealFromListing) so the exact
      // merged array can be saved immediately in this same action — setState
      // from addDealFromListing wouldn't be reflected in `deals` yet due to
      // React's async state updates, and calling both would double-add.
      const newDeals = candidates.map((listing) => {
        const thumb = listing.productImages?.[0]?.cdnUrl || listing.images?.[0] || '';
        return {
          id: crypto.randomUUID(),
          title: listing.title,
          description: listing.category?.name ? `${listing.category.name} · ${listing.condition || ''}`.trim().replace(/·\s*$/, '') : '',
          imageUrl: thumb ? resolveImageUrl(thumb) : '',
          price: listing.price,
          currency: listing.currency || 'AED',
          expiresAt: null,
          countries: listing.country ? [listing.country] : undefined,
        } as Deal;
      });
      const merged = [...newDeals, ...deals];
      await api.put('/admin/site-config/deals', { deals: merged });
      setDeals(merged);
      flash(`Added ${candidates.length} deal${candidates.length === 1 ? '' : 's'} for ${COUNTRY_LABELS[country]}.`);
      await refreshSectionCounts();
    } catch {
      flash('Auto-fill failed. Please try again.', true);
    } finally {
      setAutoFilling(null);
    }
  };

  /** Convert one or more picked listings into Deals and prepend them to the list */
  const addDealFromListing = useCallback((listings: PickerListing[]) => {
    if (listings.length === 0) return;
    const newDeals: Deal[] = listings.map((listing) => {
      const thumb = listing.productImages?.[0]?.cdnUrl || listing.images?.[0] || '';
      return {
        id: crypto.randomUUID(),
        title: listing.title,
        description: listing.category?.name ? `${listing.category.name} · ${listing.condition || ''}`.trim().replace(/·\s*$/, '') : '',
        imageUrl: thumb ? resolveImageUrl(thumb) : '',
        price: listing.price,
        originalPrice: undefined,
        discount: undefined,
        link: `/listings/${listing.id}`,
        currency: listing.currency || 'AED',
        expiresAt: null, // unlimited by default
        // Default visibility to the listing's own country (it's real inventory
        // from that market) — the admin can still expand this to more
        // countries using the checkboxes below.
        countries: listing.country ? [listing.country] : undefined,
      };
    });
    setDeals((prev) => [...newDeals, ...prev]);
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  const updateSocial = (key: keyof SocialLinks, value: string) =>
    setSocialLinks((prev) => ({ ...prev, [key]: value }));

  // ── Logo Handlers ──────────────────────────────────────────────────────────

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setLogoPreview(objectUrl);
  };

  const handleSaveLogo = async () => {
    setSavingLogo(true);
    try {
      let uploadedUrl = logoUrl;

      // Upload new file directly to the CDN first if a file was chosen.
      // Uses the dedicated /site-config/logo/upload endpoint (not /media/upload)
      // so this never creates a stray SiteMedia record — a prior version of this
      // reused the hero-image upload path, which caused every logo upload to also
      // silently insert an extra, untitled slide into the homepage Hero Slideshow.
      if (logoFile) {
        const formData = new FormData();
        formData.append('logo', logoFile);
        const { data: uploadData } = await api.post('/admin/site-config/logo/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        uploadedUrl = uploadData.url || uploadedUrl;
        setLogoFile(null);
        if (logoPreview) { URL.revokeObjectURL(logoPreview); setLogoPreview(null); }
      }

      const { data } = await api.put('/admin/site-config/logo', {
        logoUrl: uploadedUrl,
        logoPages,
        logoAltText: logoAltText.trim() || null,
        logoSize,
        logoLinkUrl: logoLinkUrl.trim() || null,
        logoDisplayMode,
      });
      setLogoUrl(data.logoUrl);
      setLogoPages(data.logoPages || []);
      setLogoSize(data.logoSize || 28);
      setLogoLinkUrl(data.logoLinkUrl || '');
      setLogoDisplayMode(data.logoDisplayMode === 'replace' ? 'replace' : 'inline');
      flash(
        logoDisplayMode === 'replace'
          ? 'Logo settings saved. The image will now replace the exchange widget text entirely.'
          : 'Logo settings saved. The logo will now appear next to the exchange widget text.'
      );
    } catch {
      flash('Failed to save logo settings.', true);
    } finally {
      setSavingLogo(false);
    }
  };

  const handleDeleteLogo = async () => {
    if (!confirm('Remove the logo? The site wordmark will be shown instead.')) return;
    setDeletingLogo(true);
    try {
      await api.delete('/admin/site-config/logo');
      setLogoUrl(null);
      setLogoPages([]);
      setLogoAltText('');
      setLogoSize(28);
      setLogoFile(null);
      setLogoPreview(null);
      flash('Logo removed. The default wordmark is now shown.');
    } catch {
      flash('Failed to remove logo.', true);
    } finally {
      setDeletingLogo(false);
    }
  };

  // ── Interview Demo Video Handlers ───────────────────────────────────────────

  const handleInterviewVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setInterviewVideoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setInterviewVideoPreview(objectUrl);
  };

  const handleSaveInterviewVideo = async () => {
    if (!interviewVideoFile) {
      flash('Choose a video file first.', true);
      return;
    }
    setSavingInterviewVideo(true);
    try {
      const formData = new FormData();
      formData.append('video', interviewVideoFile);
      formData.append('title', interviewVideoTitle.trim());
      const { data } = await api.post('/admin/site-config/interview-video', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setInterviewVideoUrl(data.videoUrl);
      setInterviewVideoTitle(data.videoTitle || '');
      setInterviewVideoFile(null);
      if (interviewVideoPreview) { URL.revokeObjectURL(interviewVideoPreview); setInterviewVideoPreview(null); }
      flash('Interview demo video saved. It will now appear on the interview page.');
    } catch {
      flash('Failed to save the interview demo video.', true);
    } finally {
      setSavingInterviewVideo(false);
    }
  };

  const handleDeleteInterviewVideo = async () => {
    if (!confirm('Remove the interview demo video?')) return;
    setDeletingInterviewVideo(true);
    try {
      await api.delete('/admin/site-config/interview-video');
      setInterviewVideoUrl(null);
      setInterviewVideoTitle('');
      setInterviewVideoFile(null);
      setInterviewVideoPreview(null);
      flash('Interview demo video removed.');
    } catch {
      flash('Failed to remove the interview demo video.', true);
    } finally {
      setDeletingInterviewVideo(false);
    }
  };

  // ── Homepage Promo Video Handlers ──────────────────────────────────────────
  const handlePromoVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPromoVideoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPromoVideoPreview(objectUrl);
  };

  const handleSavePromoVideo = async () => {
    if (!promoVideoFile) {
      flash('Choose a video file first.', true);
      return;
    }
    setSavingPromoVideo(true);
    try {
      const formData = new FormData();
      formData.append('video', promoVideoFile);
      formData.append('title', promoVideoTitle.trim());
      const { data } = await api.post('/admin/site-config/promo-video', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPromoVideoUrl(data.videoUrl);
      setPromoVideoTitle(data.videoTitle || '');
      setPromoVideoFile(null);
      if (promoVideoPreview) { URL.revokeObjectURL(promoVideoPreview); setPromoVideoPreview(null); }
      flash('Promo video saved. It will now play in the "Live Now" card beside the homepage slideshow.');
    } catch {
      flash('Failed to save the promo video.', true);
    } finally {
      setSavingPromoVideo(false);
    }
  };

  const handleDeletePromoVideo = async () => {
    if (!confirm('Remove the promo video? The default bundled video will be shown instead.')) return;
    setDeletingPromoVideo(true);
    try {
      await api.delete('/admin/site-config/promo-video');
      setPromoVideoUrl(null);
      setPromoVideoTitle('');
      setPromoVideoFile(null);
      setPromoVideoPreview(null);
      flash('Promo video removed. The default video is now shown.');
    } catch {
      flash('Failed to remove the promo video.', true);
    } finally {
      setDeletingPromoVideo(false);
    }
  };

  const toggleLogoPage = (key: string) => {
    setLogoPages((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading || fetching) return <div className="p-8 text-center">Loading...</div>;
  if (!settings) return <div className="p-8 text-center text-red-500">{error || 'Failed to load settings.'}</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6">
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Settings</h1>
      <p className="text-gray-500 mb-4">Manage your site configuration</p>

      {success && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm font-medium">{success}</div>}
      {error   && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm font-medium">{error}</div>}

      {/* ── WhatsApp Chat-to-Order ───────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <span className="text-2xl">💬</span> WhatsApp – Chat to Order
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          The WhatsApp number users will contact to order. Appears on the homepage and hero cards. Enter in international format, e.g. <code className="bg-gray-100 px-1 rounded">971501234567</code>.
        </p>
        <div className="flex gap-2">
          <input
            type="tel"
            value={whatsappNumber}
            onChange={(e) => setWhatsappNumber(e.target.value)}
            placeholder="971501234567"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          />
          <button
            onClick={handleSaveWhatsApp}
            disabled={savingWhatsApp}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {savingWhatsApp ? 'Saving…' : 'Save'}
          </button>
        </div>
        {whatsappNumber && (
          <a
            href={`https://wa.me/${whatsappNumber.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs text-green-600 hover:underline"
          >
            ↗ Preview: wa.me/{whatsappNumber.replace(/\D/g, '')}
          </a>
        )}
      </div>

      {/* ── Header Theme ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <span className="text-2xl">🎨</span> Header & Banner Theme
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          The selected theme automatically applies to the top banner background for all visitors. No code changes needed.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {THEME_OPTIONS.map((t) => (
            <button
              key={t.key}
              type="button"
              title={t.label}
              onClick={() => setHeaderTheme(t.key)}
              className={`relative w-8 h-8 rounded-full border-4 transition-all focus:outline-none ${
                headerTheme === t.key ? 'border-gray-800 scale-110 shadow-md' : 'border-transparent hover:scale-110 hover:border-gray-300'
              }`}
              style={{ backgroundColor: t.color }}
            >
              {headerTheme === t.key && (
                <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] font-bold">✓</span>
              )}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Selected: <strong>{THEME_OPTIONS.find((t) => t.key === headerTheme)?.label ?? headerTheme}</strong>
        </p>
        <button
          onClick={handleSaveTheme}
          disabled={savingTheme}
          className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors disabled:opacity-50"
        >
          {savingTheme ? 'Saving…' : 'Apply Theme'}
        </button>
      </div>

      {/* ── Today's Deals ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <span className="text-2xl">🔥</span> Today&apos;s Deals
          </h2>
          <div className="flex items-center gap-2">
            {/* Primary: Pick from existing listings */}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              Pick from Listings
            </button>
            {/* Secondary: blank deal */}
            <button
              type="button"
              onClick={addDeal}
              className="bg-amber-100 text-amber-700 hover:bg-amber-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            >
              + Blank Deal
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-1">
          Manage the &quot;Today&apos;s Deals&quot; section shown on the homepage.
        </p>
        <p className="text-xs text-amber-600 font-medium mb-4 flex items-center gap-1">
          <span>💡</span> Click <strong>Pick from Listings</strong> to browse your products and add them as deals in one click — title, image, price and link are filled automatically.
        </p>

        {/* Listing Picker Modal */}
        {pickerOpen && (
          <ListingPickerModal
            onSelect={addDealFromListing}
            onClose={() => setPickerOpen(false)}
          />
        )}

        {deals.length === 0 && (
          <p className="text-sm text-gray-400 italic text-center py-4 border-2 border-dashed border-gray-200 rounded-xl">
            No deals yet. Click &quot;+ Add Deal&quot; to create one.
          </p>
        )}

        <div className="space-y-4">
          {deals.map((deal, idx) => (
            <div key={deal.id} className="border border-gray-200 rounded-xl p-4 relative">
              <button
                type="button"
                onClick={() => removeDeal(deal.id)}
                className="absolute top-3 right-3 text-gray-400 hover:text-red-500 transition-colors text-lg leading-none"
                aria-label="Remove deal"
              >
                ×
              </button>
              <p className="text-xs font-semibold text-gray-500 mb-3">Deal #{idx + 1}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
                  <input type="text" value={deal.title} onChange={(e) => updateDeal(deal.id, 'title', e.target.value)} placeholder="e.g. 50% Off Electronics" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Link URL</label>
                  <input type="text" value={deal.link || ''} onChange={(e) => updateDeal(deal.id, 'link', e.target.value)} placeholder="/listings/abc123 or https://..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                  <input type="text" value={deal.description || ''} onChange={(e) => updateDeal(deal.id, 'description', e.target.value)} placeholder="Short deal description" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Image URL</label>
                  <input type="text" value={deal.imageUrl || ''} onChange={(e) => updateDeal(deal.id, 'imageUrl', e.target.value)} placeholder="https://cdn.../image.jpg" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
                  <select value={deal.currency || 'AED'} onChange={(e) => updateDeal(deal.id, 'currency', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                    {['AED','USD','UGX','KES','CNY'].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Sale Price</label>
                  <input type="number" min={0} value={deal.price ?? ''} onChange={(e) => updateDeal(deal.id, 'price', e.target.value ? Number(e.target.value) : undefined)} placeholder="99" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Original Price</label>
                  <input type="number" min={0} value={deal.originalPrice ?? ''} onChange={(e) => updateDeal(deal.id, 'originalPrice', e.target.value ? Number(e.target.value) : undefined)} placeholder="199" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Discount %</label>
                  <input type="number" min={0} max={100} value={deal.discount ?? ''} onChange={(e) => updateDeal(deal.id, 'discount', e.target.value ? Number(e.target.value) : undefined)} placeholder="50" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>

                {/* ── Country visibility ── */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    Visible In
                    <span className="ml-1 font-normal text-gray-400">(unchecked = all countries)</span>
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {ALL_COUNTRIES.map((c) => {
                      const checked = !!deal.countries?.includes(c);
                      return (
                        <label key={c} className="flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const current = deal.countries || [];
                              const next = e.target.checked
                                ? [...current, c]
                                : current.filter((x) => x !== c);
                              // Empty selection = visible everywhere (undefined), not "visible nowhere"
                              updateDeal(deal.id, 'countries', next.length > 0 ? next : undefined);
                            }}
                            className="rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                          />
                          <span className="text-xs text-gray-700">{COUNTRY_LABELS[c]}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-[10px] text-gray-400">
                    {deal.countries && deal.countries.length > 0
                      ? `Shown only in: ${deal.countries.map((c) => COUNTRY_LABELS[c] || c).join(', ')}`
                      : 'Shown in all countries.'}
                  </p>
                </div>

                {/* ── Expiry ── */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Expiry Date</label>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!deal.expiresAt}
                        onChange={(e) => updateDeal(deal.id, 'expiresAt', e.target.checked ? null : new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))}
                        className="rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                      />
                      <span className="text-xs font-semibold text-amber-600">♾ Never expires (unlimited)</span>
                    </label>
                    {deal.expiresAt && (
                      <input
                        type="date"
                        value={deal.expiresAt.slice(0, 10)}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => updateDeal(deal.id, 'expiresAt', e.target.value || null)}
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    )}
                    {deal.expiresAt && (
                      <span className="text-[10px] text-gray-400 italic">
                        Expires {new Date(deal.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-gray-400">
                    {deal.expiresAt
                      ? 'Deal will be hidden automatically after expiry date.'
                      : 'Deal will remain visible indefinitely until manually removed.'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Always rendered (not gated on deals.length) — by this point the
            initial fetch has already completed (the whole page is gated
            behind `fetching` above), so an empty array here genuinely means
            "no deals" or "admin removed them all", and they must still be
            able to save that state. Previously this button vanished
            entirely once the last deal was removed, making it impossible to
            actually clear the Today's Deals section. */}
        <button onClick={handleSaveDeals} disabled={savingDeals} className="mt-5 bg-amber-500 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50">
          {savingDeals ? 'Saving…' : 'Save Today\'s Deals'}
        </button>
      </div>

      {/* ── Homepage Row Fill Status ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <span className="text-2xl">📊</span> Homepage Row Fill Status
          </h2>
          <button
            type="button"
            onClick={refreshSectionCounts}
            className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1"
          >
            ↻ Refresh
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Each homepage row is meant to show {sectionCounts?.target ?? 6} items per country. Rows below 6 are flagged in red.
        </p>

        {sectionCountsError ? (
          <p className="text-sm text-red-500 text-center py-4">
            Couldn&apos;t load row counts. <button type="button" onClick={refreshSectionCounts} className="underline font-semibold hover:text-red-600">Try again</button>
          </p>
        ) : !sectionCounts || !sectionCounts.sections || typeof sectionCounts.sections !== 'object' ? (
          <p className="text-sm text-gray-400 italic text-center py-4">Loading row counts…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 pr-3 font-semibold text-gray-600">Section</th>
                  {ALL_COUNTRIES.map((c) => (
                    <th key={c} className="text-center py-2 px-2 font-semibold text-gray-600 whitespace-nowrap">{COUNTRY_LABELS[c]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HOMEPAGE_SECTIONS.map((sec) => (
                  <tr key={sec.key} className="border-b border-gray-100 last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-gray-800">{sec.label}</td>
                    {ALL_COUNTRIES.map((country) => {
                      const count = sectionCounts.sections?.[sec.key]?.[country] ?? 0;
                      const short = count < (sectionCounts.target ?? 6);
                      const key = `${sec.key}:${country}`;
                      const isFilling = autoFilling === key;
                      return (
                        <td key={country} className="py-2.5 px-2 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${short ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {short ? '⚠' : '✓'} {count}
                            </span>
                            {short && sec.autoFillable && (
                              <button
                                type="button"
                                disabled={isFilling}
                                onClick={() =>
                                  sec.key === 'TODAYS_DEALS'
                                    ? handleAutoFillDeals(country)
                                    : handleAutoFillPlacement(sec.key, country)
                                }
                                className="text-[10px] font-semibold text-sky-600 hover:text-sky-800 underline disabled:opacity-50"
                              >
                                {isFilling ? 'Filling…' : `Auto-fill to ${sectionCounts.target ?? 6}`}
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
              <strong>FLASH SALES</strong>, <strong>Latest Collections</strong>, <strong>✦ FEATURED DEAL</strong> and{' '}
              <strong>Today&apos;s Deals</strong> can be auto-filled because they pull from real, currently-unfeatured
              active listings. <strong>Other Collections</strong> and the <strong>Recent Across Categories</strong> rows
              reflect organic marketplace inventory — they can&apos;t be auto-filled without inventing fake listings, so
              a persistent shortfall there means that country genuinely needs more real listings in that category.
            </p>
          </div>
        )}
      </div>

      {/* ── General Settings ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">General Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Site Name</label>
            <input type="text" value={settings.siteName} onChange={(e) => update('siteName', e.target.value)} placeholder="Site name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Default Country</label>
            <select value={settings.defaultCountry} onChange={(e) => update('defaultCountry', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
              <option value="UAE">UAE</option>
              <option value="UGANDA">UGANDA</option>
              <option value="KENYA">KENYA</option>
              <option value="CHINA">CHINA</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Feature Settings ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Feature Settings</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Maintenance Mode</p>
              <p className="text-xs text-gray-400">Take the site offline for maintenance</p>
            </div>
            <ToggleSwitch enabled={settings.maintenanceMode} onChange={(v) => update('maintenanceMode', v)} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Allow Registration</p>
              <p className="text-xs text-gray-400">Allow new users to create accounts</p>
            </div>
            <ToggleSwitch enabled={settings.allowRegistration} onChange={(v) => update('allowRegistration', v)} />
          </div>
        </div>
      </div>

      {/* ── Content Settings ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Content Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Items Per Page</label>
            <input type="number" min={1} value={settings.itemsPerPage} onChange={(e) => update('itemsPerPage', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max Images Per Listing</label>
            <input type="number" min={1} value={settings.maxImagesPerListing} onChange={(e) => update('maxImagesPerListing', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Free Trial Period (days)</label>
            <input
              type="number"
              min={0}
              max={365}
              value={settings.trialDays ?? 7}
              onChange={(e) => update('trialDays', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="mt-1 text-xs text-gray-400">
              New ordinary users get this many days free before needing a subscription. Set to 0 to disable the trial.
            </p>
          </div>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="bg-sky-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors disabled:opacity-50 mb-10">
        {saving ? 'Saving...' : 'Save Settings'}
      </button>

      {/* ── Social Media Links ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Social Media Links</h2>
        <p className="text-sm text-gray-500 mb-4">These URLs are shown in the site footer.</p>
        <div className="space-y-3">
          {([
            { key: 'facebook', label: 'Facebook',    placeholder: 'https://facebook.com/yourpage',           icon: '📘' },
            { key: 'instagram', label: 'Instagram',  placeholder: 'https://instagram.com/yourhandle',         icon: '📸' },
            { key: 'linkedin',  label: 'LinkedIn',   placeholder: 'https://linkedin.com/company/yourcompany', icon: '💼' },
            { key: 'x',         label: 'X (Twitter)',placeholder: 'https://x.com/yourhandle',                 icon: '✕'  },
            { key: 'whatsapp',  label: 'WhatsApp Footer Link', placeholder: 'https://wa.me/yournumber',       icon: '💬' },
            { key: 'youtube',   label: 'YouTube',    placeholder: 'https://youtube.com/@yourchannel',         icon: '▶'  },
            { key: 'tiktok',    label: 'TikTok',      placeholder: 'https://tiktok.com/@yourhandle',           icon: '🎵' },
          ] as { key: keyof SocialLinks; label: string; placeholder: string; icon: string }[]).map(({ key, label, placeholder, icon }) => (
            <div key={key} className="flex items-center gap-3">
              <span className="w-7 text-center text-lg shrink-0">{icon}</span>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
                <input type="url" value={socialLinks[key]} onChange={(e) => updateSocial(key, e.target.value)} placeholder={placeholder} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </div>
            </div>
          ))}
        </div>
        <button onClick={handleSaveSocial} disabled={savingSocial} className="mt-5 bg-sky-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors disabled:opacity-50">
          {savingSocial ? 'Saving...' : 'Save Social Links'}
        </button>
      </div>
      {/* ── Logo Management ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6 border border-gray-100">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">💱</span>
          <h2 className="text-lg font-semibold text-gray-900">Exchange Logo</h2>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          Upload a logo to display inline next to the <strong>&ldquo;3RELITE EXCHANGE · Money Transfer Rates&rdquo;</strong> text on the homepage — this is the <em>only</em> place the logo appears.
          Use the size control below to set its display height; use a square or wide PNG/SVG with a transparent background.
        </p>

        {/* Current logo preview */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Current Logo</p>
          {logoUrl ? (
            <div className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 border border-gray-200">
              <div className="relative h-14 w-40 shrink-0 bg-white rounded-lg border border-gray-200 flex items-center justify-center overflow-hidden">
                <Image
                  src={resolveImageUrl(logoUrl)}
                  alt={logoAltText || 'Site logo'}
                  fill
                  className="object-contain p-1"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">{logoAltText || 'No alt text set'}</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{logoUrl}</p>
                <p className="text-xs text-sky-600 mt-1">
                  Shown on: {logoPages.length > 0
                    ? logoPages.map(k => LOGO_PAGE_OPTIONS.find(o => o.key === k)?.label || k).join(', ')
                    : 'No pages selected'}
                </p>
              </div>
              <button
                onClick={handleDeleteLogo}
                disabled={deletingLogo}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {deletingLogo ? 'Removing…' : '🗑 Remove'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 border border-dashed border-gray-300 text-gray-400">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-600 via-sky-500 to-cyan-400 text-white flex items-center justify-center font-black text-sm">3R</div>
              <p className="text-sm">No custom logo uploaded — default wordmark is shown.</p>
            </div>
          )}
        </div>

        {/* New file upload */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Upload New Logo</p>
          <div
            className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-gray-200 hover:border-sky-400 bg-gray-50 hover:bg-sky-50/40 cursor-pointer transition-all group"
            onClick={() => logoInputRef.current?.click()}
          >
            {logoPreview ? (
              <div className="relative h-16 w-48 bg-white rounded-lg border border-gray-200 overflow-hidden">
                <Image src={logoPreview} alt="Logo preview" fill className="object-contain p-1" />
              </div>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-sky-100 group-hover:bg-sky-200 flex items-center justify-center text-2xl mb-2 transition-colors">📁</div>
                <p className="text-sm font-medium text-gray-700">Click to select a logo file</p>
                <p className="text-xs text-gray-400 mt-0.5">PNG, JPG or WebP — max 10 MB</p>
              </>
            )}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
              className="hidden"
              onChange={handleLogoFileChange}
            />
          </div>
          {logoPreview && (
            <button
              type="button"
              onClick={() => { setLogoFile(null); if (logoPreview) URL.revokeObjectURL(logoPreview); setLogoPreview(null); if (logoInputRef.current) logoInputRef.current.value = ''; }}
              className="mt-2 text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              ✕ Remove selected file
            </button>
          )}
        </div>

        {/* Alt text */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Logo Alt Text</label>
          <input
            type="text"
            value={logoAltText}
            onChange={(e) => setLogoAltText(e.target.value)}
            placeholder="e.g. 3R Elite Marketplace"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <p className="mt-1 text-xs text-gray-400">Shown to screen readers and when the image fails to load.</p>
        </div>

        {/* Logo size */}
        <div className="mb-6">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Logo Size <span className="text-gray-400 normal-case font-normal">(display height)</span>
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={16}
              max={96}
              step={1}
              value={logoSize}
              onChange={(e) => setLogoSize(Number(e.target.value))}
              className="flex-1 accent-sky-600"
            />
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="number"
                min={16}
                max={96}
                value={logoSize}
                onChange={(e) => setLogoSize(Math.min(96, Math.max(16, Number(e.target.value) || 28)))}
                className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <span className="text-xs text-gray-400">px</span>
            </div>
          </div>
          {logoUrl && (
            <div className="mt-3 flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-200">
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">Preview</span>
              <div className="relative shrink-0" style={{ width: logoSize, height: logoSize }}>
                <Image
                  src={logoPreview || resolveImageUrl(logoUrl)}
                  alt={logoAltText || 'Logo preview'}
                  fill
                  className="object-contain rounded"
                />
              </div>
            </div>
          )}
        </div>

        {/* Page selector */}
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Show Logo On</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {LOGO_PAGE_OPTIONS.map(({ key, label, icon }) => {
              const active = logoPages.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleLogoPage(key)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                    active
                      ? 'border-sky-500 bg-sky-50 text-sky-700 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-sky-200 hover:bg-sky-50/40'
                  }`}
                >
                  <span className="text-base leading-none">{icon}</span>
                  <span>{label}</span>
                  {active && (
                    <span className="ml-auto text-sky-500 text-xs">✓</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            The logo replaces the default wordmark only on the pages you tick above.
          </p>
        </div>

        {/* Link URL */}
        <div className="mb-6">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Logo Link URL</label>
          <input
            type="url"
            value={logoLinkUrl}
            onChange={(e) => setLogoLinkUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <p className="mt-1 text-xs text-gray-400">
            Optional. If set, visitors are taken here when they click the logo. Leave blank for a non-clickable logo.
          </p>
        </div>

        {/* Display mode */}
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Display Mode</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setLogoDisplayMode('inline')}
              className={`text-left px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                logoDisplayMode === 'inline'
                  ? 'border-sky-500 bg-sky-50 text-sky-700 shadow-sm'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-sky-200 hover:bg-sky-50/40'
              }`}
            >
              Logo + Text
              <p className="text-xs font-normal mt-0.5 opacity-80">Logo shown next to &quot;3RELITE EXCHANGE · Money Transfer Rates&quot;.</p>
            </button>
            <button
              type="button"
              onClick={() => setLogoDisplayMode('replace')}
              className={`text-left px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                logoDisplayMode === 'replace'
                  ? 'border-sky-500 bg-sky-50 text-sky-700 shadow-sm'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-sky-200 hover:bg-sky-50/40'
              }`}
            >
              Image Only
              <p className="text-xs font-normal mt-0.5 opacity-80">Image replaces that text section entirely.</p>
            </button>
          </div>
        </div>

        <button
          onClick={handleSaveLogo}
          disabled={savingLogo || (!logoFile && !logoUrl)}
          className="bg-sky-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {savingLogo ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving…
            </>
          ) : '💾 Save Logo Settings'}
        </button>
      </div>

      {/* ── Interview Demo Video ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6 border border-gray-100">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">🎬</span>
          <h2 className="text-lg font-semibold text-gray-900">Interview Demo Video</h2>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          Upload a short demo video shown on the Interview Preparation page to guide users through the interview simulator.
        </p>

        {/* Current video preview */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Current Video</p>
          {interviewVideoUrl ? (
            <div className="flex flex-col sm:flex-row items-start gap-4 p-4 rounded-xl bg-gray-50 border border-gray-200">
              <div className="relative w-full sm:w-56 shrink-0 aspect-video bg-black rounded-lg border border-gray-200 overflow-hidden">
                <video src={resolveImageUrl(interviewVideoUrl)} controls className="w-full h-full object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">{interviewVideoTitle || 'No title set'}</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{interviewVideoUrl}</p>
              </div>
              <button
                onClick={handleDeleteInterviewVideo}
                disabled={deletingInterviewVideo}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {deletingInterviewVideo ? 'Removing…' : '🗑 Remove'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 border border-dashed border-gray-300 text-gray-400">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-rose-500 to-red-600 text-white flex items-center justify-center text-xl">🎬</div>
              <p className="text-sm">No demo video uploaded — the interview page will not show a video section.</p>
            </div>
          )}
        </div>

        {/* New file upload */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Upload New Video</p>
          <div
            className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-gray-200 hover:border-sky-400 bg-gray-50 hover:bg-sky-50/40 cursor-pointer transition-all group"
            onClick={() => interviewVideoInputRef.current?.click()}
          >
            {interviewVideoPreview ? (
              <div className="relative w-full sm:w-56 aspect-video bg-black rounded-lg border border-gray-200 overflow-hidden">
                <video src={interviewVideoPreview} controls className="w-full h-full object-contain" />
              </div>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-sky-100 group-hover:bg-sky-200 flex items-center justify-center text-2xl mb-2 transition-colors">📁</div>
                <p className="text-sm font-medium text-gray-700">Click to select a video file</p>
                <p className="text-xs text-gray-400 mt-0.5">MP4, WEBM, MOV or AVI — max 200 MB</p>
              </>
            )}
            <input
              ref={interviewVideoInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
              className="hidden"
              onChange={handleInterviewVideoFileChange}
            />
          </div>
          {interviewVideoPreview && (
            <button
              type="button"
              onClick={() => { setInterviewVideoFile(null); if (interviewVideoPreview) URL.revokeObjectURL(interviewVideoPreview); setInterviewVideoPreview(null); if (interviewVideoInputRef.current) interviewVideoInputRef.current.value = ''; }}
              className="mt-2 text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              ✕ Remove selected file
            </button>
          )}
        </div>

        {/* Title */}
        <div className="mb-6">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Video Title</label>
          <input
            type="text"
            value={interviewVideoTitle}
            onChange={(e) => setInterviewVideoTitle(e.target.value)}
            placeholder="e.g. How the Interview Simulator Works"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <p className="mt-1 text-xs text-gray-400">Shown as a caption above the video on the interview page.</p>
        </div>

        <button
          onClick={handleSaveInterviewVideo}
          disabled={savingInterviewVideo || !interviewVideoFile}
          className="bg-sky-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {savingInterviewVideo ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Uploading…
            </>
          ) : '💾 Save Demo Video'}
        </button>
      </div>

      {/* ── Homepage Promo Video ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6 border border-gray-100">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">📺</span>
          <h2 className="text-lg font-semibold text-gray-900">Homepage Promo Video</h2>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          Upload the video shown in the &ldquo;LIVE NOW&rdquo; / &ldquo;SHOP NOW&rdquo; card beside the homepage hero slideshow. Until a video is uploaded here, the default bundled video is shown.
        </p>

        {/* Current video preview */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Current Video</p>
          {promoVideoUrl ? (
            <div className="flex flex-col sm:flex-row items-start gap-4 p-4 rounded-xl bg-gray-50 border border-gray-200">
              <div className="relative w-full sm:w-56 shrink-0 aspect-video bg-black rounded-lg border border-gray-200 overflow-hidden">
                <video src={resolveImageUrl(promoVideoUrl)} controls className="w-full h-full object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">{promoVideoTitle || 'No title set'}</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{promoVideoUrl}</p>
              </div>
              <button
                onClick={handleDeletePromoVideo}
                disabled={deletingPromoVideo}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {deletingPromoVideo ? 'Removing…' : '🗑 Remove'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 border border-dashed border-gray-300 text-gray-400">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-elite-navy to-sky-700 text-white flex items-center justify-center text-xl">📺</div>
              <p className="text-sm">No custom promo video uploaded — the default bundled video is shown.</p>
            </div>
          )}
        </div>

        {/* New file upload */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Upload New Video</p>
          <div
            className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-gray-200 hover:border-sky-400 bg-gray-50 hover:bg-sky-50/40 cursor-pointer transition-all group"
            onClick={() => promoVideoInputRef.current?.click()}
          >
            {promoVideoPreview ? (
              <div className="relative w-full sm:w-56 aspect-video bg-black rounded-lg border border-gray-200 overflow-hidden">
                <video src={promoVideoPreview} controls className="w-full h-full object-contain" />
              </div>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-sky-100 group-hover:bg-sky-200 flex items-center justify-center text-2xl mb-2 transition-colors">📁</div>
                <p className="text-sm font-medium text-gray-700">Click to select a video file</p>
                <p className="text-xs text-gray-400 mt-0.5">MP4, WEBM, MOV or AVI — max 200 MB</p>
              </>
            )}
            <input
              ref={promoVideoInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
              className="hidden"
              onChange={handlePromoVideoFileChange}
            />
          </div>
          {promoVideoPreview && (
            <button
              type="button"
              onClick={() => { setPromoVideoFile(null); if (promoVideoPreview) URL.revokeObjectURL(promoVideoPreview); setPromoVideoPreview(null); if (promoVideoInputRef.current) promoVideoInputRef.current.value = ''; }}
              className="mt-2 text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              ✕ Remove selected file
            </button>
          )}
        </div>

        {/* Title (internal label only, not shown on the site) */}
        <div className="mb-6">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Internal Label</label>
          <input
            type="text"
            value={promoVideoTitle}
            onChange={(e) => setPromoVideoTitle(e.target.value)}
            placeholder="e.g. August livestream teaser"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <p className="mt-1 text-xs text-gray-400">For your reference only — not displayed on the homepage.</p>
        </div>

        <button
          onClick={handleSavePromoVideo}
          disabled={savingPromoVideo || !promoVideoFile}
          className="bg-sky-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {savingPromoVideo ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Uploading…
            </>
          ) : '💾 Save Promo Video'}
        </button>
      </div>

    </div>
  );
}