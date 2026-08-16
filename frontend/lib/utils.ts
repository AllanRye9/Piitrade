import { clsx, type ClassValue } from 'clsx';
import type { Currency } from '@/lib/types';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Resolves a backend image URL that may contain a localhost origin.
 * In production the backend stores absolute URLs using API_BASE_URL.
 * If that env var was not set, the stored URL will contain "localhost"
 * which is unreachable from the browser. We rewrite those URLs to use
 * the public NEXT_PUBLIC_API_URL instead.
 */
export function resolveImageUrl(url: string): string {
  if (!url) return '';
  const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.startsWith('http://localhost:') || url.startsWith('https://localhost:')) {
    const slashIdx = url.indexOf('/', url.indexOf('://') + 3);
    if (slashIdx === -1) return url;
    const pathPart = url.substring(slashIdx);
    return apiBase ? `${apiBase}${pathPart}` : pathPart;
  }
  // Rewrite relative API/upload paths to use the backend base URL
  if ((url.startsWith('/api/') || url.startsWith('/uploads/')) && apiBase) {
    return `${apiBase}${url}`;
  }
  // Rewrite any other relative path into an absolute backend URL.
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const normalized = url.startsWith('/') ? url : `/${url}`;
    return apiBase ? `${apiBase}${normalized}` : normalized;
  }
  return url;
}

export function formatCurrency(amount: number, currency: 'AED' | 'UGX' | 'KES' | 'CNY' | 'USD'): string {
  if (currency === 'AED') {
    return `AED ${amount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (currency === 'KES') {
    return `KES ${amount.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
  }
  if (currency === 'CNY') {
    return `¥ ${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (currency === 'USD') {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `UGX ${amount.toLocaleString('en-UG', { maximumFractionDigits: 2 })}`;
}

const USD_RATES: Record<Currency, number> = {
  USD: 1,
  AED: 3.67,
  UGX: 3700,
  KES: 130,
  CNY: 7.2,
};

function round2(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function convertToUSD(amount: number, currency: Currency): number {
  const rate = USD_RATES[currency] ?? 1;
  return currency === 'USD' ? amount : round2(amount / rate);
}

// Country-aware price ranges for filters (Motors, Property, etc.)
// Values are in the local currency of each country.
export interface PriceRange { label: string; min: string; max: string; }

export function getCountryPriceRanges(country: string): PriceRange[] {
  switch (country) {
    case 'UAE':
      return [
        { label: 'Any Price',     min: '',       max: ''       },
        { label: 'Under AED 20k', min: '',       max: '20000'  },
        { label: 'AED 20k-55k',   min: '20000',  max: '55000'  },
        { label: 'AED 55k-110k',  min: '55000',  max: '110000' },
        { label: 'AED 110k-220k', min: '110000', max: '220000' },
        { label: 'Over AED 220k', min: '220000', max: ''       },
      ];
    case 'KENYA':
      return [
        { label: 'Any Price',       min: '',        max: ''        },
        { label: 'Under KES 650k',  min: '',        max: '650000'  },
        { label: 'KES 650k-2M',     min: '650000',  max: '2000000' },
        { label: 'KES 2M-4M',       min: '2000000', max: '4000000' },
        { label: 'KES 4M-8M',       min: '4000000', max: '8000000' },
        { label: 'Over KES 8M',     min: '8000000', max: ''        },
      ];
    case 'CHINA':
      return [
        { label: 'Any Price',  min: '',       max: ''       },
        { label: 'Under 36k',  min: '',       max: '36000'  },
        { label: '36k-108k',   min: '36000',  max: '108000' },
        { label: '108k-216k',  min: '108000', max: '216000' },
        { label: '216k-432k',  min: '216000', max: '432000' },
        { label: 'Over 432k',  min: '432000', max: ''       },
      ];
    case 'UGANDA':
    default:
      return [
        { label: 'Any Price',      min: '',           max: ''          },
        { label: 'Under UGX 18M',  min: '',           max: '18000000'  },
        { label: 'UGX 18M-55M',    min: '18000000',   max: '55000000'  },
        { label: 'UGX 55M-110M',   min: '55000000',   max: '110000000' },
        { label: 'UGX 110M-220M',  min: '110000000',  max: '220000000' },
        { label: 'Over UGX 220M',  min: '220000000',  max: ''          },
      ];
  }
}

export function convertCurrency(amount: number, from: Currency, to: Currency): number {
  if (from === to) return amount;
  const inUSD = convertToUSD(amount, from);
  if (to === 'USD') return inUSD;
  const rate = USD_RATES[to] ?? 1;
  return round2(inUSD * rate);
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function timeAgo(date: string | Date): string {
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(date);
}

export const UAE_LOCATIONS = [
  'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah',
  'Fujairah', 'Umm Al Quwain', 'Al Ain',
];

export const UGANDA_LOCATIONS = [
  'Kampala', 'Jinja', 'Gulu', 'Mbarara', 'Masaka',
  'Entebbe', 'Lira', 'Mbale', 'Mukono', 'Soroti',
];

export const KENYA_LOCATIONS = [
  'Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret',
  'Nyeri', 'Meru', 'Malindi', 'Thika', 'Machakos',
];

export const CHINA_LOCATIONS = [
  'Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu',
  'Hangzhou', 'Wuhan', 'Xian', 'Nanjing', 'Tianjin',
];

export function getLocations(country: 'UAE' | 'UGANDA' | 'KENYA' | 'CHINA'): string[] {
  if (country === 'UAE') return UAE_LOCATIONS;
  if (country === 'UGANDA') return UGANDA_LOCATIONS;
  if (country === 'KENYA') return KENYA_LOCATIONS;
  return CHINA_LOCATIONS;
}

export function getCurrency(country: 'UAE' | 'UGANDA' | 'KENYA' | 'CHINA'): 'AED' | 'UGX' | 'KES' | 'CNY' {
  if (country === 'UAE') return 'AED';
  if (country === 'UGANDA') return 'UGX';
  if (country === 'KENYA') return 'KES';
  return 'CNY';
}
