import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

let mockCounts: Record<string, number> | null = null;
let mockSearch = '';
const push = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams(mockSearch) }));
vi.mock('@/lib/i18n/useTr', () => ({ useTr: () => (s: string) => s }));
vi.mock('@/context/CountryContext', () => ({ useCountry: () => ({ country: 'UGANDA', locations: [] }) }));
vi.mock('@/hooks/useCategoryCounts', () => ({ useCategoryCounts: () => ({ counts: mockCounts, total: 9, loading: false }) }));

import { FilterSidebar } from '@/components/listings/FilterSidebar';

const cats: any[] = [
  { id: '1', name: 'Motors', slug: 'motors', icon: '🚗', children: [
    { id: '11', name: 'Used Cars', slug: 'used-cars' },
    { id: '12', name: 'Boda Boda & Delivery Bikes', slug: 'boda-boda-bikes' },
    { id: '13', name: 'Tyres & Wheels', slug: 'tyres-wheels' },
  ] },
  { id: '2', name: 'Property', slug: 'property', icon: '🏠', children: [] },
  { id: '3', name: 'Jobs', slug: 'jobs', icon: '💼', children: [{ id: '31', name: 'Casual & Daily Labour', slug: 'casual-labour' }] },
];
const optionValues = (el: HTMLElement) => Array.from(el.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);

beforeEach(() => { push.mockClear(); mockSearch = ''; mockCounts = { motors: 3, 'used-cars': 2, 'boda-boda-bikes': 1 }; });
afterEach(() => cleanup());

describe('FilterSidebar category cascade', () => {
  it('buyer gating: hides parents with no live listings, keeps jobs', () => {
    render(<FilterSidebar categories={cats} />);
    const parent = screen.getAllByLabelText('Category')[0] as HTMLElement;
    expect(optionValues(parent)).toEqual(['', 'motors', 'jobs']);
  });
  it('shows everything while counts are unknown (fail open)', () => {
    mockCounts = null;
    render(<FilterSidebar categories={cats} />);
    expect(optionValues(screen.getAllByLabelText('Category')[0] as HTMLElement)).toEqual(['', 'motors', 'property', 'jobs']);
  });
  it('no subcategory select until a parent is chosen', () => {
    render(<FilterSidebar categories={cats} />);
    expect(screen.queryByLabelText('Subcategory')).toBeNull();
  });
  it('with a parent chosen: only live children, most populated first, parent value = all', () => {
    mockSearch = 'category=motors';
    render(<FilterSidebar categories={cats} />);
    const sub = screen.getByLabelText('Subcategory') as HTMLSelectElement;
    expect(optionValues(sub)).toEqual(['', 'used-cars', 'boda-boda-bikes']); // tyres-wheels (0) hidden
    fireEvent.change(sub, { target: { value: 'boda-boda-bikes' } });
    expect(push.mock.calls[0][0]).toContain('category=boda-boda-bikes');
    fireEvent.change(sub, { target: { value: '' } });
    expect(push.mock.calls[1][0]).toContain('category=motors');
  });
  it('a child in the URL selects its parent and child; an empty selected child stays visible', () => {
    mockSearch = 'category=tyres-wheels';
    render(<FilterSidebar categories={cats} />);
    expect((screen.getAllByLabelText('Category')[0] as HTMLSelectElement).value).toBe('motors');
    const sub = screen.getByLabelText('Subcategory') as HTMLSelectElement;
    expect(sub.value).toBe('tyres-wheels');
  });
  it('changing parent replaces the subcategory; chip clears the filter', () => {
    mockSearch = 'category=boda-boda-bikes&page=3';
    render(<FilterSidebar categories={cats} />);
    fireEvent.change(screen.getAllByLabelText('Category')[0], { target: { value: 'jobs' } });
    expect(push.mock.calls[0][0]).toContain('category=jobs');
    expect(push.mock.calls[0][0]).toContain('page=1');
    fireEvent.click(screen.getByRole('button', { name: /Clear category filter/ }));
    expect(push.mock.calls[1][0]).not.toContain('category=');
  });
});
