import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/lib/i18n/useTr', () => ({ useTr: () => (s: string) => s }));
import DistrictSelect from '@/components/listings/DistrictSelect';
import { MobileStepNav } from '@/components/listings/PostingStepper';
import { UGANDA_LOCATION_OPTIONS, UGANDA_DISTRICTS } from '@/lib/ugandaDistricts';
afterEach(cleanup);

describe('Uganda districts', () => {
  it('covers every district, no duplicates, big towns first', () => {
    expect(UGANDA_DISTRICTS.length).toBeGreaterThan(130);
    expect(new Set(UGANDA_LOCATION_OPTIONS).size).toBe(UGANDA_LOCATION_OPTIONS.length);
    expect(UGANDA_LOCATION_OPTIONS[0]).toBe('Kampala');
    for (const d of ['Kotido', 'Kisoro', 'Namayingo', 'Obongi']) expect(UGANDA_LOCATION_OPTIONS).toContain(d);
  });
});

describe('DistrictSelect', () => {
  it('searches and selects', () => {
    const onChange = vi.fn();
    render(<DistrictSelect value="" onChange={onChange} options={UGANDA_LOCATION_OPTIONS} />);
    const box = screen.getByRole('combobox');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'kiso' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Kisoro', 'Wakiso']);
    fireEvent.mouseDown(screen.getByText('Kisoro'));
    expect(onChange).toHaveBeenCalledWith('Kisoro');
  });
  it('says so when nothing matches', () => {
    render(<DistrictSelect value="" onChange={() => {}} options={['Gulu']} />);
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matching district')).toBeTruthy();
  });
});

describe('MobileStepNav', () => {
  it('blocks Continue until the phase is complete', () => {
    const onNext = vi.fn();
    const { rerender } = render(<MobileStepNav step={0} total={4} canContinue={false} hint="Add a photo" onBack={() => {}} onNext={onNext} />);
    const btn = screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText('Add a photo')).toBeTruthy();
    rerender(<MobileStepNav step={0} total={4} canContinue hint="" onBack={() => {}} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(onNext).toHaveBeenCalled();
  });
  it('has no Continue on the last step but has Back', () => {
    render(<MobileStepNav step={3} total={4} canContinue={false} hint="" onBack={() => {}} onNext={() => {}} />);
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Back/ })).toBeTruthy();
  });
});
