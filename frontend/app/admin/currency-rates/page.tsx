'use client';

/**
 * /admin/currency-rates
 *
 * Manages the exchange rates shown in the live 3relite Exchange widget.
 * All world currencies are available to select. Rates are expressed as
 * units of that currency per 1 USD.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RateRow {
  code: string;
  country: string;
  label: string;
  rate: string;
}

// ── Complete world currency list ──────────────────────────────────────────────
// Grouped by region for easier browsing in the search/filter UI.
// flag: Unicode emoji flag
// spread: typical exchange spread % shown in the live widget

const ALL_CURRENCIES = [
  // ── Middle East & Gulf ────────────────────────────────────────────────────
  { code: 'AED', flag: '🇦🇪', country: 'United Arab Emirates', label: 'Emirati Dirham',        region: 'Middle East & Gulf' },
  { code: 'SAR', flag: '🇸🇦', country: 'Saudi Arabia',         label: 'Saudi Riyal',            region: 'Middle East & Gulf' },
  { code: 'QAR', flag: '🇶🇦', country: 'Qatar',                label: 'Qatari Riyal',           region: 'Middle East & Gulf' },
  { code: 'KWD', flag: '🇰🇼', country: 'Kuwait',               label: 'Kuwaiti Dinar',          region: 'Middle East & Gulf' },
  { code: 'BHD', flag: '🇧🇭', country: 'Bahrain',              label: 'Bahraini Dinar',         region: 'Middle East & Gulf' },
  { code: 'OMR', flag: '🇴🇲', country: 'Oman',                 label: 'Omani Rial',             region: 'Middle East & Gulf' },
  { code: 'JOD', flag: '🇯🇴', country: 'Jordan',               label: 'Jordanian Dinar',        region: 'Middle East & Gulf' },
  { code: 'ILS', flag: '🇮🇱', country: 'Israel',               label: 'Israeli New Shekel',     region: 'Middle East & Gulf' },
  { code: 'EGP', flag: '🇪🇬', country: 'Egypt',                label: 'Egyptian Pound',         region: 'Middle East & Gulf' },
  { code: 'TRY', flag: '🇹🇷', country: 'Turkey',               label: 'Turkish Lira',           region: 'Middle East & Gulf' },
  { code: 'LBP', flag: '🇱🇧', country: 'Lebanon',              label: 'Lebanese Pound',         region: 'Middle East & Gulf' },
  { code: 'IQD', flag: '🇮🇶', country: 'Iraq',                 label: 'Iraqi Dinar',            region: 'Middle East & Gulf' },
  { code: 'IRR', flag: '🇮🇷', country: 'Iran',                 label: 'Iranian Rial',           region: 'Middle East & Gulf' },

  // ── East Africa ───────────────────────────────────────────────────────────
  { code: 'UGX', flag: '🇺🇬', country: 'Uganda',               label: 'Ugandan Shilling',       region: 'East Africa' },
  { code: 'KES', flag: '🇰🇪', country: 'Kenya',                label: 'Kenyan Shilling',        region: 'East Africa' },
  { code: 'TZS', flag: '🇹🇿', country: 'Tanzania',             label: 'Tanzanian Shilling',     region: 'East Africa' },
  { code: 'ETB', flag: '🇪🇹', country: 'Ethiopia',             label: 'Ethiopian Birr',         region: 'East Africa' },
  { code: 'RWF', flag: '🇷🇼', country: 'Rwanda',               label: 'Rwandan Franc',          region: 'East Africa' },
  { code: 'BIF', flag: '🇧🇮', country: 'Burundi',              label: 'Burundian Franc',        region: 'East Africa' },
  { code: 'DJF', flag: '🇩🇯', country: 'Djibouti',             label: 'Djiboutian Franc',       region: 'East Africa' },
  { code: 'ERN', flag: '🇪🇷', country: 'Eritrea',              label: 'Eritrean Nakfa',         region: 'East Africa' },
  { code: 'SOS', flag: '🇸🇴', country: 'Somalia',              label: 'Somali Shilling',        region: 'East Africa' },

  // ── West & Central Africa ─────────────────────────────────────────────────
  { code: 'NGN', flag: '🇳🇬', country: 'Nigeria',              label: 'Nigerian Naira',         region: 'West & Central Africa' },
  { code: 'GHS', flag: '🇬🇭', country: 'Ghana',                label: 'Ghanaian Cedi',          region: 'West & Central Africa' },
  { code: 'XOF', flag: '🌍',  country: 'West Africa (UEMOA)', label: 'West African CFA Franc', region: 'West & Central Africa' },
  { code: 'XAF', flag: '🌍',  country: 'Central Africa (CEMAC)', label: 'Central African CFA Franc', region: 'West & Central Africa' },
  { code: 'XOF', flag: '🇧🇫', country: 'Burkina Faso',         label: 'West African CFA Franc', region: 'West & Central Africa' },
  { code: 'XOF', flag: '🇲🇱', country: 'Mali',                 label: 'West African CFA Franc', region: 'West & Central Africa' },
  { code: 'XAF', flag: '🇬🇦', country: 'Gabon',                label: 'Central African CFA Franc', region: 'West & Central Africa' },
  { code: 'XAF', flag: '🇨🇲', country: 'Cameroon',             label: 'Central African CFA Franc', region: 'West & Central Africa' },
  { code: 'GMD', flag: '🇬🇲', country: 'Gambia',               label: 'Gambian Dalasi',         region: 'West & Central Africa' },
  { code: 'SLL', flag: '🇸🇱', country: 'Sierra Leone',         label: 'Sierra Leonean Leone',   region: 'West & Central Africa' },
  { code: 'LRD', flag: '🇱🇷', country: 'Liberia',              label: 'Liberian Dollar',        region: 'West & Central Africa' },
  { code: 'CVE', flag: '🇨🇻', country: 'Cape Verde',           label: 'Cape Verdean Escudo',    region: 'West & Central Africa' },

  // ── Southern Africa ───────────────────────────────────────────────────────
  { code: 'ZAR', flag: '🇿🇦', country: 'South Africa',         label: 'South African Rand',     region: 'Southern Africa' },
  { code: 'ZMW', flag: '🇿🇲', country: 'Zambia',               label: 'Zambian Kwacha',         region: 'Southern Africa' },
  { code: 'ZWL', flag: '🇿🇼', country: 'Zimbabwe',             label: 'Zimbabwean Dollar',      region: 'Southern Africa' },
  { code: 'MWK', flag: '🇲🇼', country: 'Malawi',               label: 'Malawian Kwacha',        region: 'Southern Africa' },
  { code: 'MZN', flag: '🇲🇿', country: 'Mozambique',           label: 'Mozambican Metical',     region: 'Southern Africa' },
  { code: 'BWP', flag: '🇧🇼', country: 'Botswana',             label: 'Botswana Pula',          region: 'Southern Africa' },
  { code: 'NAD', flag: '🇳🇦', country: 'Namibia',              label: 'Namibian Dollar',        region: 'Southern Africa' },
  { code: 'SZL', flag: '🇸🇿', country: 'Eswatini',             label: 'Swazi Lilangeni',        region: 'Southern Africa' },
  { code: 'LSL', flag: '🇱🇸', country: 'Lesotho',              label: 'Lesotho Loti',           region: 'Southern Africa' },
  { code: 'MGA', flag: '🇲🇬', country: 'Madagascar',           label: 'Malagasy Ariary',        region: 'Southern Africa' },
  { code: 'SCR', flag: '🇸🇨', country: 'Seychelles',           label: 'Seychellois Rupee',      region: 'Southern Africa' },
  { code: 'MUR', flag: '🇲🇺', country: 'Mauritius',            label: 'Mauritian Rupee',        region: 'Southern Africa' },

  // ── North Africa ──────────────────────────────────────────────────────────
  { code: 'MAD', flag: '🇲🇦', country: 'Morocco',              label: 'Moroccan Dirham',        region: 'North Africa' },
  { code: 'TND', flag: '🇹🇳', country: 'Tunisia',              label: 'Tunisian Dinar',         region: 'North Africa' },
  { code: 'DZD', flag: '🇩🇿', country: 'Algeria',              label: 'Algerian Dinar',         region: 'North Africa' },
  { code: 'LYD', flag: '🇱🇾', country: 'Libya',                label: 'Libyan Dinar',           region: 'North Africa' },
  { code: 'SDG', flag: '🇸🇩', country: 'Sudan',                label: 'Sudanese Pound',         region: 'North Africa' },

  // ── South & Southeast Asia ────────────────────────────────────────────────
  { code: 'CNY', flag: '🇨🇳', country: 'China',                label: 'Chinese Yuan',           region: 'Asia Pacific' },
  { code: 'INR', flag: '🇮🇳', country: 'India',                label: 'Indian Rupee',           region: 'Asia Pacific' },
  { code: 'PKR', flag: '🇵🇰', country: 'Pakistan',             label: 'Pakistani Rupee',        region: 'Asia Pacific' },
  { code: 'BDT', flag: '🇧🇩', country: 'Bangladesh',           label: 'Bangladeshi Taka',       region: 'Asia Pacific' },
  { code: 'NPR', flag: '🇳🇵', country: 'Nepal',                label: 'Nepalese Rupee',         region: 'Asia Pacific' },
  { code: 'LKR', flag: '🇱🇰', country: 'Sri Lanka',            label: 'Sri Lankan Rupee',       region: 'Asia Pacific' },
  { code: 'MVR', flag: '🇲🇻', country: 'Maldives',             label: 'Maldivian Rufiyaa',      region: 'Asia Pacific' },
  { code: 'JPY', flag: '🇯🇵', country: 'Japan',                label: 'Japanese Yen',           region: 'Asia Pacific' },
  { code: 'KRW', flag: '🇰🇷', country: 'South Korea',          label: 'South Korean Won',       region: 'Asia Pacific' },
  { code: 'SGD', flag: '🇸🇬', country: 'Singapore',            label: 'Singapore Dollar',       region: 'Asia Pacific' },
  { code: 'MYR', flag: '🇲🇾', country: 'Malaysia',             label: 'Malaysian Ringgit',      region: 'Asia Pacific' },
  { code: 'THB', flag: '🇹🇭', country: 'Thailand',             label: 'Thai Baht',              region: 'Asia Pacific' },
  { code: 'IDR', flag: '🇮🇩', country: 'Indonesia',            label: 'Indonesian Rupiah',      region: 'Asia Pacific' },
  { code: 'PHP', flag: '🇵🇭', country: 'Philippines',          label: 'Philippine Peso',        region: 'Asia Pacific' },
  { code: 'VND', flag: '🇻🇳', country: 'Vietnam',              label: 'Vietnamese Dong',        region: 'Asia Pacific' },
  { code: 'MMK', flag: '🇲🇲', country: 'Myanmar',              label: 'Myanmar Kyat',           region: 'Asia Pacific' },
  { code: 'KHR', flag: '🇰🇭', country: 'Cambodia',             label: 'Cambodian Riel',         region: 'Asia Pacific' },
  { code: 'LAK', flag: '🇱🇦', country: 'Laos',                 label: 'Lao Kip',                region: 'Asia Pacific' },
  { code: 'HKD', flag: '🇭🇰', country: 'Hong Kong',            label: 'Hong Kong Dollar',       region: 'Asia Pacific' },
  { code: 'TWD', flag: '🇹🇼', country: 'Taiwan',               label: 'New Taiwan Dollar',      region: 'Asia Pacific' },
  { code: 'AUD', flag: '🇦🇺', country: 'Australia',            label: 'Australian Dollar',      region: 'Asia Pacific' },
  { code: 'NZD', flag: '🇳🇿', country: 'New Zealand',          label: 'New Zealand Dollar',     region: 'Asia Pacific' },
  { code: 'FJD', flag: '🇫🇯', country: 'Fiji',                 label: 'Fijian Dollar',          region: 'Asia Pacific' },

  // ── Europe ────────────────────────────────────────────────────────────────
  { code: 'EUR', flag: '🇪🇺', country: 'Eurozone',             label: 'Euro',                   region: 'Europe' },
  { code: 'GBP', flag: '🇬🇧', country: 'United Kingdom',       label: 'British Pound Sterling', region: 'Europe' },
  { code: 'CHF', flag: '🇨🇭', country: 'Switzerland',          label: 'Swiss Franc',            region: 'Europe' },
  { code: 'SEK', flag: '🇸🇪', country: 'Sweden',               label: 'Swedish Krona',          region: 'Europe' },
  { code: 'NOK', flag: '🇳🇴', country: 'Norway',               label: 'Norwegian Krone',        region: 'Europe' },
  { code: 'DKK', flag: '🇩🇰', country: 'Denmark',              label: 'Danish Krone',           region: 'Europe' },
  { code: 'PLN', flag: '🇵🇱', country: 'Poland',               label: 'Polish Zloty',           region: 'Europe' },
  { code: 'CZK', flag: '🇨🇿', country: 'Czech Republic',       label: 'Czech Koruna',           region: 'Europe' },
  { code: 'HUF', flag: '🇭🇺', country: 'Hungary',              label: 'Hungarian Forint',       region: 'Europe' },
  { code: 'RON', flag: '🇷🇴', country: 'Romania',              label: 'Romanian Leu',           region: 'Europe' },
  { code: 'BGN', flag: '🇧🇬', country: 'Bulgaria',             label: 'Bulgarian Lev',          region: 'Europe' },
  { code: 'HRK', flag: '🇭🇷', country: 'Croatia',              label: 'Croatian Kuna',          region: 'Europe' },
  { code: 'RSD', flag: '🇷🇸', country: 'Serbia',               label: 'Serbian Dinar',          region: 'Europe' },
  { code: 'UAH', flag: '🇺🇦', country: 'Ukraine',              label: 'Ukrainian Hryvnia',      region: 'Europe' },
  { code: 'RUB', flag: '🇷🇺', country: 'Russia',               label: 'Russian Ruble',          region: 'Europe' },
  { code: 'ISK', flag: '🇮🇸', country: 'Iceland',              label: 'Icelandic Krona',        region: 'Europe' },

  // ── Americas ──────────────────────────────────────────────────────────────
  { code: 'USD', flag: '🇺🇸', country: 'United States',        label: 'US Dollar',              region: 'Americas' },
  { code: 'CAD', flag: '🇨🇦', country: 'Canada',               label: 'Canadian Dollar',        region: 'Americas' },
  { code: 'MXN', flag: '🇲🇽', country: 'Mexico',               label: 'Mexican Peso',           region: 'Americas' },
  { code: 'BRL', flag: '🇧🇷', country: 'Brazil',               label: 'Brazilian Real',         region: 'Americas' },
  { code: 'ARS', flag: '🇦🇷', country: 'Argentina',            label: 'Argentine Peso',         region: 'Americas' },
  { code: 'CLP', flag: '🇨🇱', country: 'Chile',                label: 'Chilean Peso',           region: 'Americas' },
  { code: 'COP', flag: '🇨🇴', country: 'Colombia',             label: 'Colombian Peso',         region: 'Americas' },
  { code: 'PEN', flag: '🇵🇪', country: 'Peru',                 label: 'Peruvian Sol',           region: 'Americas' },
  { code: 'UYU', flag: '🇺🇾', country: 'Uruguay',              label: 'Uruguayan Peso',         region: 'Americas' },
  { code: 'PYG', flag: '🇵🇾', country: 'Paraguay',             label: 'Paraguayan Guarani',     region: 'Americas' },
  { code: 'BOB', flag: '🇧🇴', country: 'Bolivia',              label: 'Bolivian Boliviano',     region: 'Americas' },
  { code: 'VES', flag: '🇻🇪', country: 'Venezuela',            label: 'Venezuelan Bolivar',     region: 'Americas' },
  { code: 'GTQ', flag: '🇬🇹', country: 'Guatemala',            label: 'Guatemalan Quetzal',     region: 'Americas' },
  { code: 'HNL', flag: '🇭🇳', country: 'Honduras',             label: 'Honduran Lempira',       region: 'Americas' },
  { code: 'NIO', flag: '🇳🇮', country: 'Nicaragua',            label: 'Nicaraguan Córdoba',     region: 'Americas' },
  { code: 'CRC', flag: '🇨🇷', country: 'Costa Rica',           label: 'Costa Rican Colón',      region: 'Americas' },
  { code: 'DOP', flag: '🇩🇴', country: 'Dominican Republic',   label: 'Dominican Peso',         region: 'Americas' },
  { code: 'JMD', flag: '🇯🇲', country: 'Jamaica',              label: 'Jamaican Dollar',        region: 'Americas' },
  { code: 'TTD', flag: '🇹🇹', country: 'Trinidad & Tobago',    label: 'Trinidad & Tobago Dollar', region: 'Americas' },
] as const;

// type CurrencyCode = typeof ALL_CURRENCIES[number]['code'];

const CURRENCY_MAP = Object.fromEntries(
  ALL_CURRENCIES.map((c) => [c.code, c])
) as Record<string, typeof ALL_CURRENCIES[number]>;

const REGIONS = [...new Set(ALL_CURRENCIES.map((c) => c.region))];

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyRow(): RateRow {
  return { code: '', country: '', label: '', rate: '' };
}

function isRowValid(row: RateRow): boolean {
  return (
    row.code.trim() !== '' &&
    !isNaN(parseFloat(row.rate)) &&
    parseFloat(row.rate) > 0
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CurrencyPicker({
  value,
  onChange,
  usedCodes,
}: {
  value: string;
  onChange: (code: string) => void;
  usedCodes: Set<string>;
}) {
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const close = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return ALL_CURRENCIES.filter((c) => {
      if (region && c.region !== region) return false;
      if (!q) return true;
      return (
        c.code.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q)
      );
    });
  }, [search, region]);

  const selected = value ? CURRENCY_MAP[value] : null;

  return (
    <div className="relative w-full" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white hover:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400 transition-colors text-left"
      >
        {selected ? (
          <>
            <span style={{ fontSize: '1.2rem', lineHeight: 1, flexShrink: 0 }}>{selected.flag}</span>
            <span className="font-bold">{selected.code}</span>
            <span className="text-gray-500 truncate text-xs">— {selected.label}</span>
          </>
        ) : (
          <span className="text-gray-400">— select currency —</span>
        )}
        <svg className="w-3 h-3 ml-auto shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden">
          {/* Search + region filter */}
          <div className="p-2 border-b border-gray-100 space-y-1.5">
            <input
              autoFocus
              type="text"
              placeholder="Search currency, country…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white"
            >
              <option value="">All regions</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Results list */}
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-gray-400">No currencies match your search.</p>
            ) : (
              filtered.map((c) => {
                const alreadyUsed = usedCodes.has(c.code) && c.code !== value;
                return (
                  <button
                    key={c.code}
                    type="button"
                    disabled={alreadyUsed}
                    onClick={() => { onChange(c.code); setOpen(false); setSearch(''); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors
                      ${c.code === value ? 'bg-sky-50 text-sky-700 font-semibold' : ''}
                      ${alreadyUsed ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'}
                    `}
                  >
                    <span style={{ fontSize: '1.2rem', lineHeight: 1, flexShrink: 0 }}>{c.flag}</span>
                    <div className="min-w-0">
                      <span className="font-bold">{c.code}</span>
                      <span className="text-gray-500 text-xs ml-1.5 truncate">{c.label}</span>
                      <div className="text-[10px] text-gray-400 truncate">{c.country}</div>
                    </div>
                    {alreadyUsed && (
                      <span className="ml-auto text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">added</span>
                    )}
                    {c.code === value && (
                      <svg className="w-4 h-4 ml-auto text-sky-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CurrencyRatesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [rows, setRows]               = useState<RateRow[]>([]);
  const [saving, setSaving]           = useState(false);
  const [fetching, setFetching]       = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');
  const [toast, setToast]             = useState<{ msg: string; ok: boolean } | null>(null);
  const [quickSearch, setQuickSearch] = useState('');

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'ADMIN')) {
      router.replace('/admin/auth/login');
    }
  }, [user, authLoading, router]);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchRates = useCallback(async () => {
    setFetching(true);
    try {
      const { data } = await api.get('/currency-rates');
      if (Array.isArray(data.rates)) {
        setRows(
          data.rates.map((r: { code: string; country: string; label?: string; rate: number }) => ({
            code:    r.code,
            country: r.country,
            label:   r.label ?? '',
            rate:    String(r.rate),
          })),
        );
        setLastUpdated(data.updatedAt ?? '');
      }
    } catch {
      showToast('Failed to load rates — showing defaults', false);
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { fetchRates(); }, [fetchRates]);

  // Row handlers
  const updateCode = (idx: number, code: string) => {
    setRows((prev) => {
      const next = [...prev];
      const meta = CURRENCY_MAP[code];
      next[idx] = {
        ...next[idx],
        code,
        country: meta?.country ?? next[idx].country,
        label:   meta?.label   ?? next[idx].label,
      };
      return next;
    });
  };

  const updateField = (idx: number, field: 'country' | 'label' | 'rate', value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const removeRow = (idx: number) =>
    setRows((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    const valid = rows.filter(isRowValid);
    if (valid.length === 0) {
      showToast('Add at least one valid rate before saving', false);
      return;
    }
    setSaving(true);
    try {
      // Rates are entered by the admin as "1 AED = X of that currency".
      // We save base:'AED' so the widget knows the unit and does not need
      // to infer or convert — no hardcoded USD/AED factor required.
      await api.put('/currency-rates', {
        base: 'AED',
        rates: valid.map((r) => ({
          code:    r.code.trim().toUpperCase(),
          country: r.country.trim() || r.code.trim(),
          label:   r.label.trim() || undefined,
          rate:    parseFloat(parseFloat(r.rate).toFixed(2)),
        })),
      });
      showToast(`✓ Saved ${valid.length} rate${valid.length !== 1 ? 's' : ''} — live on site`, true);
      await fetchRates();
    } catch {
      showToast('Save failed — please try again', false);
    } finally {
      setSaving(false);
    }
  };

  // Quick-add from the browse panel
  const quickAdd = (code: string) => {
    const already = rows.some((r) => r.code === code);
    if (already) {
      showToast(`${code} is already in the list`, false);
      return;
    }
    const meta = CURRENCY_MAP[code];
    setRows((prev) => [
      ...prev,
      { code, country: meta?.country ?? '', label: meta?.label ?? '', rate: '' },
    ]);
  };

  const usedCodes = useMemo(() => new Set(rows.map((r) => r.code)), [rows]);

  // Filtered quick-browse currencies
  const browseCurrencies = useMemo(() => {
    const q = quickSearch.toLowerCase();
    if (!q) return ALL_CURRENCIES as unknown as typeof ALL_CURRENCIES[number][];
    return ALL_CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.region.toLowerCase().includes(q),
    ) as unknown as typeof ALL_CURRENCIES[number][];
  }, [quickSearch]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold text-white transition-all ${toast.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Page header */}
      <div className="mb-6 flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-2xl shadow-md shrink-0">
          💱
        </div>
        <div>
          <h1 className="text-2xl font-black text-gray-900">Exchange Rates</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Configure every currency shown in the <strong>3relite Exchange</strong> widget.
            All {ALL_CURRENCIES.length} world currencies are available. Rates are <strong>per 1 AED</strong> (UAE Dirham — the platform base currency).
          </p>
          {lastUpdated && (
            <p className="text-xs text-gray-400 mt-1">Last saved: {new Date(lastUpdated).toLocaleString()}</p>
          )}
        </div>
      </div>

      {/* Info callout */}
      <div className="mb-5 bg-sky-50 border border-sky-200 rounded-xl p-4 flex gap-3">
        <span className="text-lg shrink-0 mt-0.5">ℹ️</span>
        <div className="text-sm text-sky-800 space-y-1">
          <p><strong>How it works:</strong> Save here and the homepage exchange widget updates immediately — no redeploy needed.</p>
          <p><strong>Example:</strong> 1 AED = 1 020 UGX → enter <code className="bg-sky-100 px-1 rounded">1020</code> for UGX.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── LEFT: Active rates editor ─────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
              <h2 className="font-bold text-gray-800 text-sm">
                Active Rates
                <span className="ml-2 text-xs font-normal text-gray-400">({rows.filter(isRowValid).length} valid)</span>
              </h2>
              <button
                onClick={addRow}
                className="flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700 px-3 py-1.5 rounded-lg border border-sky-200 hover:bg-sky-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                Add Row
              </button>
            </div>

            {fetching ? (
              <div className="p-10 text-center">
                <div className="w-8 h-8 border-4 border-sky-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-sm text-gray-400">Loading rates…</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {rows.length === 0 && (
                  <p className="px-5 py-8 text-center text-sm text-gray-400">
                    No rates yet. Add from the currency browser →
                  </p>
                )}

                {rows.map((row, idx) => {
                  const invalid = row.code !== '' && !isRowValid(row);
                  const meta = row.code ? CURRENCY_MAP[row.code] : null;
                  return (
                    <div
                      key={idx}
                      className={`px-4 py-3 space-y-2 ${invalid ? 'bg-red-50/40' : 'hover:bg-gray-50/60'}`}
                    >
                      {/* Row: currency picker + rate */}
                      <div className="flex gap-2 items-start">
                        {/* Currency picker */}
                        <div className="flex-1 min-w-0">
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 block">Currency</label>
                          <CurrencyPicker
                            value={row.code}
                            onChange={(code) => updateCode(idx, code)}
                            usedCodes={usedCodes}
                          />
                        </div>

                        {/* Rate per 1 USD */}
                        <div className="w-32 shrink-0">
                          <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 block">Rate / AED</label>
                          <input
                            type="number"
                            value={row.rate}
                            onChange={(e) => updateField(idx, 'rate', e.target.value)}
                            placeholder={meta ? `e.g. ${meta.code === 'KWD' ? '0.307' : meta.code === 'JPY' ? '149.5' : '3750'}` : 'e.g. 3750'}
                            min="0.0001"
                            step="any"
                            className={`w-full text-sm font-mono font-bold border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 ${
                              row.rate && (isNaN(parseFloat(row.rate)) || parseFloat(row.rate) <= 0)
                                ? 'border-red-300 bg-red-50 focus:ring-red-400'
                                : 'border-gray-200 focus:ring-sky-400'
                            }`}
                          />
                        </div>

                        {/* Remove */}
                        <button
                          onClick={() => removeRow(idx)}
                          aria-label={`Remove ${row.code || 'row'}`}
                          className="mt-5 p-1.5 text-gray-300 hover:text-red-500 transition-colors rounded"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>

                      {/* Country / label (auto-filled, editable) */}
                      {row.code && (
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 block">Country</label>
                            <input
                              type="text"
                              value={row.country}
                              onChange={(e) => updateField(idx, 'country', e.target.value)}
                              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-400"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 block">Label</label>
                            <input
                              type="text"
                              value={row.label}
                              onChange={(e) => updateField(idx, 'label', e.target.value)}
                              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-400"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center justify-between gap-4">
            <button
              onClick={addRow}
              className="flex items-center gap-1.5 text-sm text-sky-600 font-semibold hover:text-sky-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Add empty row
            </button>
            <button
              onClick={handleSave}
              disabled={saving || fetching}
              className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg hover:shadow-xl transition-all active:scale-95"
            >
              {saving ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
              ) : (
                <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg> Save &amp; Go Live</>
              )}
            </button>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
            <span className="text-lg shrink-0">💡</span>
            <p className="text-xs text-amber-800">
              <strong>Tip:</strong> After saving, open the homepage — the exchange widget reflects your updated rates immediately. The digit animation is cosmetic only; the actual displayed value is exactly what you enter here.
            </p>
          </div>
        </div>

        {/* ── RIGHT: World currency browser ─────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden sticky top-4">
            <div className="px-4 py-3 bg-gradient-to-r from-indigo-600 to-sky-600 text-white">
              <h2 className="font-bold text-sm">All World Currencies</h2>
              <p className="text-[11px] text-white/75 mt-0.5">{ALL_CURRENCIES.length} currencies · click to add</p>
            </div>

            <div className="p-2 border-b border-gray-100">
              <input
                type="text"
                placeholder="Search code, country, currency name…"
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
            </div>

            <div className="max-h-[calc(100vh-260px)] overflow-y-auto divide-y divide-gray-50">
              {(() => {
                // Group by region
                const grouped: Record<string, typeof browseCurrencies> = {};
                for (const c of browseCurrencies) {
                  if (!grouped[c.region]) grouped[c.region] = [];
                  grouped[c.region].push(c);
                }
                return Object.entries(grouped).map(([reg, currencies]) => (
                  <div key={reg}>
                    <div className="px-3 py-1.5 bg-gray-50/80 text-[9px] font-black uppercase tracking-widest text-gray-400 sticky top-0 z-10">
                      {reg}
                    </div>
                    {currencies.map((c) => {
                      const added = usedCodes.has(c.code);
                      return (
                        <button
                          key={c.code}
                          type="button"
                          onClick={() => !added && quickAdd(c.code)}
                          disabled={added}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors
                            ${added ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:bg-sky-50 hover:text-sky-700'}
                          `}
                        >
                          <span style={{ fontSize: '1.1rem', lineHeight: 1, flexShrink: 0, minWidth: '1.3rem' }}>{c.flag}</span>
                          <div className="min-w-0 flex-1">
                            <span className="font-bold text-gray-800">{c.code}</span>
                            <span className="text-gray-400 ml-1.5 truncate">{c.label}</span>
                          </div>
                          {added ? (
                            <span className="shrink-0 text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">✓ Added</span>
                          ) : (
                            <span className="shrink-0 text-[9px] text-sky-500 font-semibold opacity-0 group-hover:opacity-100">+ Add</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ));
              })()}
              {browseCurrencies.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-gray-400">No currencies match your search.</p>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
