'use client';

import { useEffect, useRef, useState} from 'react';
import Image from 'next/image';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';
import { useSiteConfig } from '@/context/SiteConfigContext';
import { useCountry } from '@/context/CountryContext';
import type { Country } from '@/lib/types';

/* ─── Types ────────────────────────────────────────────────────────────────── */

interface Stats {
  totalVisitors: number;
  dailyVisitors: number;
  totalCountries: number;
}

interface BackendRate {
  code: string;
  country: string;
  rate: number;
}

interface CountryRow {
  isoCode: string;
  name: string;
  code: string;
  rate: number;
}

/* ─── Static fallback data ─────────────────────────────────────────────────── */

const CURRENCY_META: Record<string, { isoCode: string; name: string }> = {
  // Original 4-country core
  AED: { isoCode: 'AE', name: 'UAE'          },
  UGX: { isoCode: 'UG', name: 'Uganda'       },
  KES: { isoCode: 'KE', name: 'Kenya'        },
  CNY: { isoCode: 'CN', name: 'China'        },
  // Global
  USD: { isoCode: 'US', name: 'USA'          },
  EUR: { isoCode: 'EU', name: 'Euro'         },
  GBP: { isoCode: 'GB', name: 'UK'           },
  INR: { isoCode: 'IN', name: 'India'        },
  NPR: { isoCode: 'NP', name: 'Nepal'        },
  BDT: { isoCode: 'BD', name: 'Bangladesh'   },
  PKR: { isoCode: 'PK', name: 'Pakistan'     },
  LKR: { isoCode: 'LK', name: 'Sri Lanka'    },
  // Africa
  ZAR: { isoCode: 'ZA', name: 'S. Africa'   },
  NGN: { isoCode: 'NG', name: 'Nigeria'      },
  GHS: { isoCode: 'GH', name: 'Ghana'        },
  TZS: { isoCode: 'TZ', name: 'Tanzania'     },
  ETB: { isoCode: 'ET', name: 'Ethiopia'     },
  RWF: { isoCode: 'RW', name: 'Rwanda'       },
  EGP: { isoCode: 'EG', name: 'Egypt'        },  // ← was missing
  MAD: { isoCode: 'MA', name: 'Morocco'      },
  DZD: { isoCode: 'DZ', name: 'Algeria'      },
  TND: { isoCode: 'TN', name: 'Tunisia'      },
  LYD: { isoCode: 'LY', name: 'Libya'        },
  SDG: { isoCode: 'SD', name: 'Sudan'        },
  ZMW: { isoCode: 'ZM', name: 'Zambia'       },
  ZWL: { isoCode: 'ZW', name: 'Zimbabwe'     },
  MWK: { isoCode: 'MW', name: 'Malawi'       },
  MZN: { isoCode: 'MZ', name: 'Mozambique'   },
  BWP: { isoCode: 'BW', name: 'Botswana'     },
  NAD: { isoCode: 'NA', name: 'Namibia'      },
  SZL: { isoCode: 'SZ', name: 'Eswatini'     },
  LSL: { isoCode: 'LS', name: 'Lesotho'      },
  MGA: { isoCode: 'MG', name: 'Madagascar'   },
  SCR: { isoCode: 'SC', name: 'Seychelles'   },
  MUR: { isoCode: 'MU', name: 'Mauritius'    },
  BIF: { isoCode: 'BI', name: 'Burundi'      },
  DJF: { isoCode: 'DJ', name: 'Djibouti'     },
  ERN: { isoCode: 'ER', name: 'Eritrea'      },
  SOS: { isoCode: 'SO', name: 'Somalia'      },
  AOA: { isoCode: 'AO', name: 'Angola'       },
  CDF: { isoCode: 'CD', name: 'DR Congo'     },
  XOF: { isoCode: 'SN', name: 'W.Africa'    },
  XAF: { isoCode: 'CM', name: 'C.Africa'    },
  GMD: { isoCode: 'GM', name: 'Gambia'       },
  SLL: { isoCode: 'SL', name: 'S. Leone'    },
  LRD: { isoCode: 'LR', name: 'Liberia'      },
  CVE: { isoCode: 'CV', name: 'Cape Verde'   },
  // Middle East
  SAR: { isoCode: 'SA', name: 'S. Arabia'   },
  QAR: { isoCode: 'QA', name: 'Qatar'        },
  KWD: { isoCode: 'KW', name: 'Kuwait'       },
  BHD: { isoCode: 'BH', name: 'Bahrain'      },
  OMR: { isoCode: 'OM', name: 'Oman'         },
  JOD: { isoCode: 'JO', name: 'Jordan'       },
  ILS: { isoCode: 'IL', name: 'Israel'       },
  IQD: { isoCode: 'IQ', name: 'Iraq'         },
  IRR: { isoCode: 'IR', name: 'Iran'         },
  LBP: { isoCode: 'LB', name: 'Lebanon'      },
  TRY: { isoCode: 'TR', name: 'Turkey'       },
  // Asia Pacific
  JPY: { isoCode: 'JP', name: 'Japan'        },
  KRW: { isoCode: 'KR', name: 'S. Korea'    },
  SGD: { isoCode: 'SG', name: 'Singapore'    },
  MYR: { isoCode: 'MY', name: 'Malaysia'     },
  THB: { isoCode: 'TH', name: 'Thailand'     },
  IDR: { isoCode: 'ID', name: 'Indonesia'    },
  PHP: { isoCode: 'PH', name: 'Philippines'  },
  VND: { isoCode: 'VN', name: 'Vietnam'      },
  MMK: { isoCode: 'MM', name: 'Myanmar'      },
  KHR: { isoCode: 'KH', name: 'Cambodia'     },
  LAK: { isoCode: 'LA', name: 'Laos'         },
  HKD: { isoCode: 'HK', name: 'Hong Kong'    },
  TWD: { isoCode: 'TW', name: 'Taiwan'       },
  AUD: { isoCode: 'AU', name: 'Australia'    },
  NZD: { isoCode: 'NZ', name: 'N. Zealand'  },
  MVR: { isoCode: 'MV', name: 'Maldives'     },
  // Europe
  CHF: { isoCode: 'CH', name: 'Switzerland'  },
  SEK: { isoCode: 'SE', name: 'Sweden'       },
  NOK: { isoCode: 'NO', name: 'Norway'       },
  DKK: { isoCode: 'DK', name: 'Denmark'      },
  PLN: { isoCode: 'PL', name: 'Poland'       },
  CZK: { isoCode: 'CZ', name: 'Czechia'      },
  HUF: { isoCode: 'HU', name: 'Hungary'      },
  RON: { isoCode: 'RO', name: 'Romania'      },
  BGN: { isoCode: 'BG', name: 'Bulgaria'     },
  UAH: { isoCode: 'UA', name: 'Ukraine'      },
  RUB: { isoCode: 'RU', name: 'Russia'       },
  // Americas
  CAD: { isoCode: 'CA', name: 'Canada'       },
  MXN: { isoCode: 'MX', name: 'Mexico'       },
  BRL: { isoCode: 'BR', name: 'Brazil'       },
  ARS: { isoCode: 'AR', name: 'Argentina'    },
  CLP: { isoCode: 'CL', name: 'Chile'        },
  COP: { isoCode: 'CO', name: 'Colombia'     },
  PEN: { isoCode: 'PE', name: 'Peru'         },
};

/**
 * Supplemental country-name → ISO lookup for currencies shared by
 * multiple countries (XOF, XAF) and any name the backend may send.
 */
const COUNTRY_ISO_BY_NAME: Record<string, string> = {
  // XOF countries
  'Burkina Faso':  'BF',
  'Mali':          'ML',
  'Senegal':       'SN',
  'Togo':          'TG',
  'Benin':         'BJ',
  'Niger':         'NE',
  'Ivory Coast':   'CI',
  'Côte d\'Ivoire':'CI',
  // XAF countries
  'Gabon':         'GA',
  'Cameroon':      'CM',
  'Chad':          'TD',
  'Congo':         'CG',
  // Middle East
  'Egypt':         'EG',
  'Morocco':       'MA',
  'Jordan':        'JO',
  'Israel':        'IL',
  'Iraq':          'IQ',
  'Iran':          'IR',
  'Lebanon':       'LB',
  'Libya':         'LY',
  'Algeria':       'DZ',
  'Tunisia':       'TN',
  'Sudan':         'SD',
  'Turkey':        'TR',
  // Gulf
  'UAE':           'AE',
  'United Arab Emirates': 'AE',
  'Saudi Arabia':  'SA',
  'Qatar':         'QA',
  'Kuwait':        'KW',
  'Bahrain':       'BH',
  'Oman':          'OM',
  // Africa misc
  'South Africa':  'ZA',
  'Nigeria':       'NG',
  'Ghana':         'GH',
  'Tanzania':      'TZ',
  'Ethiopia':      'ET',
  'Rwanda':        'RW',
  'Uganda':        'UG',
  'Kenya':         'KE',
  'Zambia':        'ZM',
  'Zimbabwe':      'ZW',
  'Angola':        'AO',
  'Mozambique':    'MZ',
  'Botswana':      'BW',
  'Namibia':       'NA',
  'Burundi':       'BI',
  'Djibouti':      'DJ',
  'Eritrea':       'ER',
  'Somalia':       'SO',
  'Seychelles':    'SC',
  'Mauritius':     'MU',
  'Madagascar':    'MG',
  'Lesotho':       'LS',
  'Eswatini':      'SZ',
  // Asia
  'China':         'CN',
  'India':         'IN',
  'Pakistan':      'PK',
  'Bangladesh':    'BD',
  'Nepal':         'NP',
  'Sri Lanka':     'LK',
  'Japan':         'JP',
  'South Korea':   'KR',
  'Singapore':     'SG',
  'Malaysia':      'MY',
  'Thailand':      'TH',
  'Indonesia':     'ID',
  'Philippines':   'PH',
  'Vietnam':       'VN',
  'Myanmar':       'MM',
  // Americas
  'USA':           'US',
  'Canada':        'CA',
  'Mexico':        'MX',
  'Brazil':        'BR',
  'Argentina':     'AR',
  'Chile':         'CL',
  'Colombia':      'CO',
  'Peru':          'PE',
  // Europe
  'UK':            'GB',
  'Euro':          'EU',
  'Eurozone':      'EU',
  'Switzerland':   'CH',
  'Sweden':        'SE',
  'Norway':        'NO',
  'Denmark':       'DK',
  'Poland':        'PL',
  'Russia':        'RU',
  'Ukraine':       'UA',
};

// ── Base currency is AED. All rates below are: 1 AED = X of that currency ──
// Exchange rate source: approximate mid-market rates (AED ≈ 0.2723 USD)
const ALL_ROWS: CountryRow[] = [
  // Core piitrade countries always shown
  { isoCode: 'AE', name: 'UAE',        code: 'AED', rate: 1.00     },
  { isoCode: 'UG', name: 'Uganda',     code: 'UGX', rate: 1021.00  },
  { isoCode: 'KE', name: 'Kenya',      code: 'KES', rate: 35.41    },
  { isoCode: 'CN', name: 'China',      code: 'CNY', rate: 1.97     },
  // Global
  { isoCode: 'US', name: 'USA',        code: 'USD', rate: 0.27     },
  { isoCode: 'GB', name: 'UK',         code: 'GBP', rate: 0.21     },
  { isoCode: 'EU', name: 'Euro',       code: 'EUR', rate: 0.25     },
  { isoCode: 'IN', name: 'India',      code: 'INR', rate: 22.73    },
  { isoCode: 'PK', name: 'Pakistan',   code: 'PKR', rate: 75.69    },
  { isoCode: 'BD', name: 'Bangladesh', code: 'BDT', rate: 29.87    },
  { isoCode: 'NP', name: 'Nepal',      code: 'NPR', rate: 36.15    },
  { isoCode: 'LK', name: 'Sri Lanka',  code: 'LKR', rate: 82.30    },
  // Africa — includes Egypt
  { isoCode: 'EG', name: 'Egypt',      code: 'EGP', rate: 13.35    },
  { isoCode: 'NG', name: 'Nigeria',    code: 'NGN', rate: 422.16   },
  { isoCode: 'GH', name: 'Ghana',      code: 'GHS', rate: 3.59     },
  { isoCode: 'ZA', name: 'S. Africa', code: 'ZAR', rate: 5.07     },
  { isoCode: 'TZ', name: 'Tanzania',   code: 'TZS', rate: 718.88   },
  { isoCode: 'ET', name: 'Ethiopia',   code: 'ETB', rate: 15.65    },
  { isoCode: 'RW', name: 'Rwanda',     code: 'RWF', rate: 364.97   },
  { isoCode: 'MA', name: 'Morocco',    code: 'MAD', rate: 2.73     },
  { isoCode: 'DZ', name: 'Algeria',    code: 'DZD', rate: 36.78    },
  { isoCode: 'TN', name: 'Tunisia',    code: 'TND', rate: 0.84     },
  { isoCode: 'SD', name: 'Sudan',      code: 'SDG', rate: 163.20   },
  { isoCode: 'ZM', name: 'Zambia',     code: 'ZMW', rate: 7.32     },
  { isoCode: 'SN', name: 'W. Africa', code: 'XOF', rate: 163.80   },
  { isoCode: 'CM', name: 'C. Africa', code: 'XAF', rate: 163.80   },
  { isoCode: 'BI', name: 'Burundi',    code: 'BIF', rate: 965.40   },
  { isoCode: 'DJ', name: 'Djibouti',   code: 'DJF', rate: 48.30    },
  { isoCode: 'SO', name: 'Somalia',    code: 'SOS', rate: 154.35   },
  // Gulf
  { isoCode: 'SA', name: 'S. Arabia', code: 'SAR', rate: 1.02     },
  { isoCode: 'QA', name: 'Qatar',      code: 'QAR', rate: 0.99     },
  { isoCode: 'KW', name: 'Kuwait',     code: 'KWD', rate: 0.083    },
  { isoCode: 'BH', name: 'Bahrain',    code: 'BHD', rate: 0.102    },
  { isoCode: 'OM', name: 'Oman',       code: 'OMR', rate: 0.105    },
  { isoCode: 'JO', name: 'Jordan',     code: 'JOD', rate: 0.192    },
  { isoCode: 'TR', name: 'Turkey',     code: 'TRY', rate: 8.74     },
  { isoCode: 'EG', name: 'Egypt',      code: 'EGP', rate: 13.35    },
  // Asia Pacific
  { isoCode: 'JP', name: 'Japan',      code: 'JPY', rate: 40.65    },
  { isoCode: 'KR', name: 'S. Korea',  code: 'KRW', rate: 362.50   },
  { isoCode: 'SG', name: 'Singapore',  code: 'SGD', rate: 0.367    },
  { isoCode: 'MY', name: 'Malaysia',   code: 'MYR', rate: 1.28     },
  { isoCode: 'TH', name: 'Thailand',   code: 'THB', rate: 9.62     },
  { isoCode: 'ID', name: 'Indonesia',  code: 'IDR', rate: 4321.00  },
  { isoCode: 'PH', name: 'Philippines',code: 'PHP', rate: 15.83    },
  { isoCode: 'VN', name: 'Vietnam',    code: 'VND', rate: 6820.00  },
  { isoCode: 'AU', name: 'Australia',  code: 'AUD', rate: 0.415    },
  { isoCode: 'NZ', name: 'N. Zealand',code: 'NZD', rate: 0.452    },
  // Europe
  { isoCode: 'CH', name: 'Switzerland',code: 'CHF', rate: 0.245    },
  { isoCode: 'SE', name: 'Sweden',     code: 'SEK', rate: 2.86     },
  { isoCode: 'NO', name: 'Norway',     code: 'NOK', rate: 2.88     },
  { isoCode: 'DK', name: 'Denmark',    code: 'DKK', rate: 1.87     },
  { isoCode: 'PL', name: 'Poland',     code: 'PLN', rate: 1.09     },
  { isoCode: 'RU', name: 'Russia',     code: 'RUB', rate: 24.90    },
  { isoCode: 'UA', name: 'Ukraine',    code: 'UAH', rate: 10.65    },
  // Americas
  { isoCode: 'CA', name: 'Canada',     code: 'CAD', rate: 0.373    },
  { isoCode: 'MX', name: 'Mexico',     code: 'MXN', rate: 4.69     },
  { isoCode: 'BR', name: 'Brazil',     code: 'BRL', rate: 1.41     },
  { isoCode: 'AR', name: 'Argentina',  code: 'ARS', rate: 282.50   },
  { isoCode: 'CL', name: 'Chile',      code: 'CLP', rate: 257.00   },
  { isoCode: 'CO', name: 'Colombia',   code: 'COP', rate: 1086.00  },
  { isoCode: 'PE', name: 'Peru',       code: 'PEN', rate: 1.02     },
];

const COUNTRY_TO_ISO: Record<Country, string> = {
  UAE: 'AE', UGANDA: 'UG', KENYA: 'KE', CHINA: 'CN',
};

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Format an exchange rate to a maximum of 2 decimal places.
 * Whole numbers are shown without decimals; fractions are shown with up to 2 d.p.
 */
function formatRate(rate: number): string {
  if (!Number.isFinite(rate)) return '—';
  // Clamp to 2 decimal places maximum
  return Number(rate.toFixed(2)).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

/**
 * Unique key for a row. Currency `code` alone is NOT a safe unique key once
 * multiple countries share one currency (Burkina Faso & Mali both use XOF;
 * Gabon & Cameroon both use XAF) — using code alone would make selecting one
 * country incorrectly highlight/display a different country that shares its
 * code. Combining code + name guarantees uniqueness across the dataset.
 */
function rowKey(row: CountryRow): string {
  return `${row.code}::${row.name}`;
}

/** Fisher-Yates shuffle — returns a new shuffled array, does not mutate input. */
function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* ─── Animated count-up hook ───────────────────────────────────────────────── */

function useCountUp(target: number, duration = 1400): number {
  const [count, setCount] = useState(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (target === 0) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(ease * target));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return count;
}

/* ─── LogoLink ─────────────────────────────────────────────────────────────── */

/** Wraps the exchange logo in a clickable link when the admin has configured
 * one (SiteConfig.logoLinkUrl); otherwise renders a non-interactive div so
 * the logo still displays normally with no dead click target. */
function LogoLink({
  href, className, style, children,
}: {
  href?: string | null; className: string; style: React.CSSProperties; children: React.ReactNode;
}) {
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        style={style}
        aria-label="PIITRADE EXCHANGE"
      >
        {children}
      </a>
    );
  }
  return <div className={className} style={style}>{children}</div>;
}

/* ─── StatCard ─────────────────────────────────────────────────────────────── */

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const animated = useCountUp(visible ? value : 0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`flex flex-col items-center justify-center px-1 py-1.5 rounded-lg bg-white border border-gray-100 shadow-sm text-center transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <p className={`text-xs font-extrabold tabular-nums ${accent}`}>{formatNumber(animated)}</p>
      <p className="text-[7px] font-semibold text-gray-400 mt-px uppercase tracking-wide leading-tight">{label}</p>
    </div>
  );
}

/* ─── RateRow ──────────────────────────────────────────────────────────────── */

function RateRow({
  row, isSelected, flash, onClick,
}: {
  row: CountryRow; isSelected: boolean; flash: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-1.5 px-1.5 py-[3px] rounded text-left transition-colors cursor-pointer ${
        isSelected
          ? 'bg-sky-50 border border-sky-300 ring-1 ring-sky-200'
          : 'hover:bg-gray-50 border border-transparent'
      } ${flash ? 'flash-row' : ''}`}
    >
      <div className="rounded overflow-hidden ring-1 ring-black/10 shrink-0">
        <FlagIcon code={row.isoCode} size={16} />
      </div>
      <span className={`flex-1 min-w-0 truncate text-[10px] font-semibold ${isSelected ? 'text-sky-700' : 'text-gray-700'}`}>
        {row.name}
      </span>
      <span className="text-[8px] font-mono text-gray-400 shrink-0">{row.code}</span>
      <span className={`text-[10px] font-bold tabular-nums shrink-0 ml-1 ${isSelected ? 'text-sky-700' : 'text-gray-800'}`}>
        {formatRate(row.rate)}
      </span>
    </button>
  );
}

/* ─── Search Popup ─────────────────────────────────────────────────────────── */

function SearchPopup({
  allRows,
  onClose,
  onSelect,
}: {
  allRows: CountryRow[];
  onClose: () => void;
  onSelect: (row: CountryRow) => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const results = q.length === 0
    ? allRows
    : allRows.filter(
        (r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)
      );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-[320px] overflow-hidden animate-fade-up">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
          <span className="text-sm font-bold text-gray-800">Search Currency / Country</span>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 hover:bg-red-100 text-gray-500 hover:text-red-500 transition-colors text-sm font-black leading-none"
            aria-label="Close search"
          >
            ×
          </button>
        </div>
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Kenya, KES, UAE…"
              className="flex-1 bg-transparent text-xs text-gray-800 placeholder-gray-400 outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-gray-300 hover:text-gray-500 text-sm leading-none">×</button>
            )}
          </div>
        </div>
        <div className="max-h-[260px] overflow-y-auto px-3 pb-3">
          {results.length === 0 ? (
            <div className="py-6 text-center text-xs text-gray-400">No currencies match &quot;{query}&quot;</div>
          ) : (
            <div className="space-y-0.5">
              {results.map((row) => (
                <button
                  key={rowKey(row)}
                  onClick={() => { onSelect(row); onClose(); }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-sky-50 transition-colors text-left group"
                >
                  <div className="rounded overflow-hidden ring-1 ring-black/10 shrink-0">
                    <FlagIcon code={row.isoCode} size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate group-hover:text-sky-700">{row.name}</p>
                    <p className="text-[9px] text-gray-400 font-mono">{row.code}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-black text-sky-600 tabular-nums">{formatRate(row.rate)}</p>
                    <p className="text-[8px] text-gray-400">per 1 AED</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main SiteAnalytics component ─────────────────────────────────────────── */

export default function SiteAnalytics() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [allRows, setAllRows] = useState<CountryRow[]>(ALL_ROWS);
  const [visibleRows, setVisibleRows] = useState<CountryRow[]>(() => shuffle(ALL_ROWS).slice(0, 6));
  const [selectedKey, setSelectedKey] = useState<string>(rowKey(ALL_ROWS[0]));
  const [flashKey, setFlashKey]     = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // Logo uploaded from admin Settings → Logo Management → Exchange Page.
  // Sourced from the public site-config endpoint (via SiteConfigContext) so
  // it's visible to every visitor, not just admins.
  const { logoUrl, logoPages, logoAltText, logoSize, logoLinkUrl, logoDisplayMode } = useSiteConfig();
  const exchangeLogo = logoPages?.includes('exchange') ? logoUrl : null;
  const { country } = useCountry();

  useEffect(() => {
    const isoCountry = COUNTRY_TO_ISO[country];
    api.get('/stats/public', { params: isoCountry ? { country: isoCountry } : undefined })
      .then(({ data }) => { if (data) setStats(data); })
      .catch(() => {});
  }, [country]);

  useEffect(() => {
    api.get('/currency-rates')
      .then(({ data }: { data: { base?: string; rates?: BackendRate[] } }) => {
        if (!data?.rates?.length) return;

        const storedBase = (data.base || 'USD').toUpperCase();

        let built: CountryRow[];

        if (storedBase === 'AED') {
          // Rates are already expressed as 1 AED = X — use directly, no conversion.
          built = data.rates.map((r) => {
            const meta    = CURRENCY_META[r.code] ?? { isoCode: r.code.slice(0, 2), name: r.country };
            const isoCode = COUNTRY_ISO_BY_NAME[r.country] ?? meta.isoCode;
            return {
              isoCode,
              name: r.country || meta.name,
              code: r.code,
              rate: parseFloat(Number(r.rate).toFixed(2)),
            };
          });
        } else {
          // Legacy data stored as 1 USD = X — convert to 1 AED = X.
          // Look for the AED entry in the data to get a precise factor;
          // fall back to the fixed peg (AED is pegged to USD at 3.6725).
          const aedEntry  = data.rates.find((r) => r.code === 'AED');
          const aedPerUsd = aedEntry ? aedEntry.rate : 3.6725; // 1 USD = X AED
          // 1 AED = (1/aedPerUsd) USD  →  1 AED = rateInUsd / aedPerUsd = r.rate / aedPerUsd
          built = data.rates
            .filter((r) => r.code !== 'AED') // don't show AED vs itself
            .map((r) => {
              const meta    = CURRENCY_META[r.code] ?? { isoCode: r.code.slice(0, 2), name: r.country };
              const isoCode = COUNTRY_ISO_BY_NAME[r.country] ?? meta.isoCode;
              const ratePerAed = parseFloat((r.rate / aedPerUsd).toFixed(2));
              return { isoCode, name: r.country || meta.name, code: r.code, rate: ratePerAed };
            });
        }

        if (built.length > 0) {
          setAllRows(built);
          setVisibleRows(shuffle(built).slice(0, 6));
          setSelectedKey(rowKey(built[0]));
        }
      })
      .catch(() => { /* keep static fallback on network failure */ });
  }, []);

  /* Rotate the visible 6 rows: once whenever allRows changes (e.g. the live
     fetch above resolves with real data), and periodically thereafter, so
     every currency gets equal visibility over time. */
  useEffect(() => {
    setVisibleRows(shuffle(allRows).slice(0, 6));
    const ROTATE_INTERVAL_MS = 25_000;
    const timer = setInterval(() => {
      setVisibleRows(shuffle(allRows).slice(0, 6));
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [allRows]);

  /* MAX 6 displayed rows — 3 left, 3 right */
  const displayRows = (() => {
    const sixRows = visibleRows;
    const inSet = sixRows.some((r) => rowKey(r) === selectedKey);
    if (!inSet) {
      const sel = allRows.find((r) => rowKey(r) === selectedKey);
      if (sel) return [sel, ...sixRows.slice(0, 5)];
    }
    return sixRows;
  })();

  const leftRows  = displayRows.slice(0, 3);
  const rightRows = displayRows.slice(3, 6);
  const selected  = allRows.find((r) => rowKey(r) === selectedKey) ?? displayRows[0];

  /* Auto-cycle every 4 s */
  useEffect(() => {
    const keys = displayRows.map((r) => rowKey(r));
    const timer = setInterval(() => {
      setSelectedKey((prev) => {
        const idx  = keys.indexOf(prev);
        const next = keys[(idx + 1) % keys.length];
        setFlashKey(next);
        setTimeout(() => setFlashKey(null), 300);
        return next;
      });
    }, 4000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayRows.map((r) => rowKey(r)).join(',')]);

  const handleSelect = (row: CountryRow) => {
    setSelectedKey(rowKey(row));
    setFlashKey(rowKey(row));
    setTimeout(() => setFlashKey(null), 300);
  };

  return (
    <section className="mt-1 px-1 animate-fade-up" aria-label="Site statistics and transfer rates">
      <div className="flex gap-1.5 items-stretch">

        {/* ── Stat cards ── */}
        <div className="flex flex-col gap-1 w-16 shrink-0">
          {stats ? (
            <>
              <StatCard label="Total Visitors"   value={stats.totalVisitors}  accent="text-sky-600" />
              <StatCard label="Today's Visitors" value={stats.dailyVisitors}  accent="text-emerald-600" />
              <StatCard label="Countries"        value={stats.totalCountries} accent="text-violet-600" />
            </>
          ) : (
            ['Total Visitors', "Today's Visitors", 'Countries'].map((label) => (
              <div key={label} className="flex flex-col items-center justify-center px-1 py-1.5 rounded-lg bg-white border border-gray-100 shadow-sm text-center flex-1">
                <div className="h-3 w-8 bg-gray-100 rounded animate-pulse mb-px" />
                <p className="text-[7px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
              </div>
            ))
          )}
        </div>

        {/* ── Exchange widget ── */}
        <div className="flex-1 min-w-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

          {/* ── Header bar — white background ── */}
          <div className="bg-white border-b border-gray-200 px-2 py-[5px] flex items-center flex-nowrap justify-between gap-1">
            {/*
              Logo + "PIITRADE EXCHANGE · Money Transfer Rates" — locked group.
              flex-nowrap + explicit order-* on every child guarantees the logo
              always renders immediately to the LEFT of the text, regardless of
              screen width, RTL context, or any parent flex override. This is
              the ONLY place in the entire app that reads the admin-uploaded
              site logo — see SiteConfigContext / useSiteConfig().
            */}
            <div className="flex items-center flex-nowrap gap-1.5 min-w-0">
              {exchangeLogo && logoDisplayMode === 'replace' ? (
                // "Replace" mode — the image stands in for the entire
                // "PIITRADE EXCHANGE · Money Transfer Rates" text section.
                <LogoLink href={logoLinkUrl} className="relative shrink-0 order-1" style={{ width: logoSize * 3, height: logoSize }}>
                  <Image
                    src={resolveImageUrl(exchangeLogo)}
                    alt={logoAltText || 'PIITRADE EXCHANGE · Money Transfer Rates'}
                    fill
                    className="object-contain rounded"
                    sizes={`${logoSize * 3}px`}
                    priority
                  />
                </LogoLink>
              ) : (
                <>
                  {exchangeLogo && (
                    <LogoLink href={logoLinkUrl} className="relative shrink-0 order-1" style={{ width: logoSize, height: logoSize }}>
                      <Image
                        src={resolveImageUrl(exchangeLogo)}
                        alt={logoAltText || 'piitrade exchange logo'}
                        fill
                        className="object-contain rounded"
                        sizes={`${logoSize}px`}
                        priority
                      />
                    </LogoLink>
                  )}
                  <span className="order-2 text-[9px] font-black tracking-widest uppercase text-sky-600 whitespace-nowrap">PIITRADE EXCHANGE</span>
                  <span className="order-3 text-[7px] text-gray-500 uppercase tracking-wide whitespace-nowrap">· Money Transfer Rates</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Live rate — AED is the base currency */}
              <span className="text-[8px] text-gray-500 font-mono whitespace-nowrap">1 AED =</span>
              <span className="text-[10px] font-black text-sky-600 tabular-nums whitespace-nowrap">{formatRate(selected.rate)} {selected.code}</span>

              {/* ── Animated Find button ── */}
              <button
                onClick={() => setSearchOpen(true)}
                className="find-btn ml-0.5 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-white transition-all"
                aria-label="Search currency"
              >
                <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <span className="text-[8px] font-black leading-none tracking-wide">FIND</span>
              </button>
            </div>
          </div>

          {/* Body: left 3 | center | right 3 */}
          <div className="flex items-stretch divide-x divide-gray-100" style={{ minHeight: '88px' }}>

            {/* Left — 3 rows */}
            <div className="flex flex-col justify-center gap-px p-1 flex-1 min-w-0">
              {leftRows.map((row) => (
                <RateRow
                  key={rowKey(row)}
                  row={row}
                  isSelected={rowKey(row) === selectedKey}
                  flash={flashKey === rowKey(row)}
                  onClick={() => handleSelect(row)}
                />
              ))}
            </div>

            {/* Center — selected country */}
            <div className="flex flex-col items-center justify-center px-2 py-1 shrink-0 w-[100px] bg-gradient-to-b from-sky-50 to-white">
              <div className="rounded-md overflow-hidden shadow ring-2 ring-sky-200 mb-1 transition-all duration-300" key={rowKey(selected)}>
                <FlagIcon code={selected.isoCode} size={32} />
              </div>
              <p className="text-[9px] font-black text-gray-800 leading-none text-center">{selected.name}</p>
              <p className="text-[7px] text-gray-400 font-mono mb-1">{selected.code}</p>
              <p className="text-sm font-black text-sky-700 tabular-nums leading-none">{formatRate(selected.rate)}</p>
              <p className="text-[7px] text-gray-400 text-center leading-tight mt-px">per 1 AED</p>
            </div>

            {/* Right — 3 rows */}
            <div className="flex flex-col justify-center gap-px p-1 flex-1 min-w-0">
              {rightRows.map((row) => (
                <RateRow
                  key={rowKey(row)}
                  row={row}
                  isSelected={rowKey(row) === selectedKey}
                  flash={flashKey === rowKey(row)}
                  onClick={() => handleSelect(row)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {searchOpen && (
        <SearchPopup
          allRows={allRows}
          onClose={() => setSearchOpen(false)}
          onSelect={handleSelect}
        />
      )}

      <style jsx global>{`
        /* ── Flash-row highlight ── */
        .flash-row {
          animation: rowFlash 0.28s ease-out;
        }
        @keyframes rowFlash {
          0%   { background-color: #e0f2fe; }
          100% { background-color: transparent; }
        }

        /* ── FIND button — pulsing glow animation ── */
        .find-btn {
          background: linear-gradient(135deg, #0ea5e9, #6366f1);
          box-shadow: 0 0 0 0 rgba(14, 165, 233, 0.7);
          animation: findPulse 2s ease-in-out infinite;
          position: relative;
          overflow: hidden;
        }
        .find-btn::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent);
          transform: translateX(-100%);
          animation: findShimmer 2.4s ease-in-out infinite;
        }
        .find-btn:hover {
          animation: none;
          background: linear-gradient(135deg, #0284c7, #4f46e5);
          box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.35);
          transform: scale(1.05);
        }
        @keyframes findPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(14, 165, 233, 0.6); }
          50%       { box-shadow: 0 0 0 4px rgba(14, 165, 233, 0); }
        }
        @keyframes findShimmer {
          0%   { transform: translateX(-100%); }
          60%, 100% { transform: translateX(100%); }
        }
      `}</style>
    </section>
  );
}
