import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

let mockLocale = 'lg';
let mockPath = '/';
vi.mock('next-intlayer', () => ({ useLocale: () => ({ locale: mockLocale }) }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPath }));

import { registerOverrides, lookup, translate, getOverridesVersion } from '@/lib/i18n/ui';
import { DomTranslator } from '@/components/i18n/DomTranslator';
import { useTr } from '@/lib/i18n/useTr';

const raf = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

describe('admin overrides in the translate() lookup', () => {
  it('override beats the built-in translation, which beats English; English is never overridden', () => {
    expect(translate('sw', 'Login')).toBe('Ingia'); // built-in
    registerOverrides('sw', { Login: 'Karibu ingia', 'Totally new text': 'Maandishi mapya' });
    expect(translate('sw', 'Login')).toBe('Karibu ingia');
    expect(translate('sw', 'Totally new text')).toBe('Maandishi mapya');
    expect(translate('sw', 'No such string anywhere')).toBe('No such string anywhere');
    expect(lookup('sw', 'No such string anywhere')).toBeUndefined();
    registerOverrides('en', { Login: 'x' });
    expect(translate('en', 'Login')).toBe('Login');
    registerOverrides('sw', {}); // clean up for other tests
  });
  it('registering identical content does not bump the version (no pointless re-renders)', () => {
    registerOverrides('lg', { A: 'a' });
    const v = getOverridesVersion();
    registerOverrides('lg', { A: 'a' });
    expect(getOverridesVersion()).toBe(v);
    registerOverrides('lg', { A: 'b' });
    expect(getOverridesVersion()).toBe(v + 1);
    registerOverrides('lg', {});
  });
  it('useTr picks up new overrides', () => {
    function Probe() { const tr = useTr(); return <span data-testid="p">{tr('Brand new')}</span>; }
    registerOverrides('lg', {});
    const { getByTestId, rerender } = render(<Probe />);
    expect(getByTestId('p').textContent).toBe('Brand new');
    registerOverrides('lg', { 'Brand new': 'Kipya' });
    rerender(<Probe />);
    expect(getByTestId('p').textContent).toBe('Kipya');
    registerOverrides('lg', {});
  });
});

describe('DomTranslator (text that is not wrapped in tr())', () => {
  beforeEach(() => { mockLocale = 'lg'; mockPath = '/'; registerOverrides('lg', { 'Plain site text': 'Ebigambo by’omukutu', 'Search here': 'Noonya wano', 'Close menu': 'Ggala' }); });
  afterEach(() => { cleanup(); registerOverrides('lg', {}); });

  it('translates exact matches in text and placeholder/aria-label, leaves everything else, and restores on unmount', async () => {
    const { container, unmount } = render(
      <div>
        <p id="a">  Plain site text </p>
        <p id="b">Plain site text and more</p>
        <input id="c" placeholder="Search here" />
        <button id="d" aria-label="Close menu">x</button>
        <p id="e" translate="no">Plain site text</p>
        <p id="f"><span className="notranslate">Plain site text</span></p>
        <textarea id="g" defaultValue="Plain site text" />
        <p id="h">UGX 50,000</p>
        <DomTranslator />
      </div>,
    );
    await raf();
    expect(container.querySelector('#a')!.textContent).toBe('  Ebigambo by’omukutu ');
    expect(container.querySelector('#b')!.textContent).toBe('Plain site text and more');
    expect(container.querySelector('#c')!.getAttribute('placeholder')).toBe('Noonya wano');
    expect(container.querySelector('#d')!.getAttribute('aria-label')).toBe('Ggala');
    expect(container.querySelector('#e')!.textContent).toBe('Plain site text');
    expect(container.querySelector('#f')!.textContent).toBe('Plain site text');
    expect((container.querySelector('#g') as HTMLTextAreaElement).value).toBe('Plain site text');
    expect(container.querySelector('#h')!.textContent).toBe('UGX 50,000');
    unmount();
    // originals back (nodes are detached on unmount, so verify through a fresh render below)
  });

  it('picks up content added later, and restores the English text when the effect is torn down', async () => {
    function App({ show }: { show: boolean }) { return <div id="root">{show && <p id="late">Plain site text</p>}<DomTranslator /></div>; }
    const { container, rerender } = render(<App show={false} />);
    await raf();
    rerender(<App show />);
    await raf();
    const late = container.querySelector('#late')!;
    expect(late.textContent).toBe('Ebigambo by’omukutu');
    mockLocale = 'en';
    rerender(<App show />); // language switched back to English
    await raf();
    expect(container.querySelector('#late')!.textContent).toBe('Plain site text');
  });

  it('does nothing in English or under /admin', async () => {
    mockLocale = 'en';
    const en = render(<div><p id="x">Plain site text</p><DomTranslator /></div>);
    await raf();
    expect(en.container.querySelector('#x')!.textContent).toBe('Plain site text');
    en.unmount();
    mockLocale = 'lg'; mockPath = '/admin/translations';
    const ad = render(<div><p id="y">Plain site text</p><DomTranslator /></div>);
    await raf();
    expect(ad.container.querySelector('#y')!.textContent).toBe('Plain site text');
  });
});
