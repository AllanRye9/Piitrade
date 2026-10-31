import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('@/lib/i18n/useTr', () => ({ useTr: () => (s: string) => s }));
vi.mock('@/context/CountryContext', () => ({ useCountry: () => ({ country: 'UGANDA' }) }));
vi.mock('@/hooks/useCategoryTree', () => ({ useCategoryTree: () => ({ tree: [] }) }));
vi.mock('@/hooks/useCategoryCounts', () => ({ useCategoryCounts: () => ({ counts: {} }) }));
vi.mock('@/hooks/useCategoryLayout', () => ({ useCategoryLayout: () => ({ rank: {}, hidden: new Set() }) }));
vi.mock('@/components/ui/LogoSpinner', () => ({ LogoSpinner: () => null }));
vi.mock('@/components/listings/LocationPicker', () => ({ LocationField: () => null }));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn().mockResolvedValue({ data: {} }) } }));

import HeaderSearch from '@/components/layout/HeaderSearch';
afterEach(cleanup);

describe('HeaderSearch mobile suggestions', () => {
  it('has an explicit Close control that dismisses the dropdown', () => {
    render(<HeaderSearch variant="mobile" scrolled={false} />);
    fireEvent.focus(screen.getByRole('combobox'));
    const close = screen.getByRole('button', { name: 'Close search suggestions' });
    fireEvent.click(close);
    expect(screen.queryByRole('button', { name: 'Close search suggestions' })).toBeNull();
  });
});
