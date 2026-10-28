import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/lib/i18n/useTr', () => ({ useTr: () => (s: string) => s }));
import SearchCategorySelect from '@/components/layout/SearchCategorySelect';

const opts = [{ value: '', label: 'All Categories' }, ...Array.from({ length: 14 }, (_, i) => ({ value: `c${i}`, label: `Cat ${i}`, icon: '📦', count: i + 1 }))];
afterEach(cleanup);

describe('SearchCategorySelect', () => {
  it('shows "All" and opens a short list with a "Show all" control', () => {
    const onChange = vi.fn();
    render(<SearchCategorySelect value="" options={opts} onChange={onChange} />);
    expect(screen.getByRole('button', { name: /Search in category/ }).textContent).toContain('All');
    fireEvent.click(screen.getByRole('button', { name: /Search in category/ }));
    expect(screen.getAllByRole('option').length).toBe(1 + 8);
    fireEvent.click(screen.getByText(/Show all 14 categories/));
    expect(screen.getAllByRole('option').length).toBe(1 + 14);
  });
  it('filters, selects and closes', () => {
    const onChange = vi.fn();
    render(<SearchCategorySelect value="" options={opts} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Search in category/ }));
    fireEvent.change(screen.getByLabelText('Find a category'), { target: { value: 'cat 12' } });
    fireEvent.click(screen.getByText('Cat 12'));
    expect(onChange).toHaveBeenCalledWith('c12');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('keeps a selected category that is outside the short list visible', () => {
    render(<SearchCategorySelect value="c12" options={opts} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Search in category/ }));
    expect(screen.getAllByText('Cat 12').length).toBeGreaterThan(0);
  });
});
