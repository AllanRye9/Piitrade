import { describe, it, expect } from 'vitest';
import { parseDelimited, parseTranslationText, toCsv, toMarkdown } from '@/lib/i18n/translationFile';

describe('parseDelimited', () => {
  it('handles quotes, doubled quotes, embedded commas and line breaks, CRLF', () => {
    expect(parseDelimited('a,"b,c","d ""q"""\r\n"x\ny",z,\r\n', ',')).toEqual([['a', 'b,c', 'd "q"'], ['x\ny', 'z', '']]);
  });
  it('keeps a last row without a trailing newline and skips fully blank lines', () => {
    expect(parseDelimited('a,b\n\nc,d', ',')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('parseTranslationText — CSV', () => {
  const csv = 'English,lg,sw,ach\nLogin,Yingira,Ingia,\n"Hello, world","Gyebale, ensi",Habari,\nSell,,Uza,Catto\n';
  it('reads the wide layout; blank cells are ignored by default', () => {
    const r = parseTranslationText(csv);
    expect(r.error).toBeUndefined();
    expect(r.format).toBe('csv');
    expect(r.entries).toEqual([
      { key: 'Login', locale: 'lg', value: 'Yingira' },
      { key: 'Login', locale: 'sw', value: 'Ingia' },
      { key: 'Hello, world', locale: 'lg', value: 'Gyebale, ensi' },
      { key: 'Hello, world', locale: 'sw', value: 'Habari' },
      { key: 'Sell', locale: 'sw', value: 'Uza' },
      { key: 'Sell', locale: 'ach', value: 'Catto' },
    ]);
    expect(r.blanks).toBe(3);
  });
  it('blanksRemove turns blank cells into removals', () => {
    const r = parseTranslationText(csv, { blanksRemove: true });
    expect(r.entries.filter((e) => e.value === '')).toHaveLength(3);
  });
  it('accepts language names, a BOM, semicolons (European Excel) and TSV (copied from a sheet)', () => {
    expect(parseTranslationText('﻿key;Luganda;Swahili\nLogin;Yingira;Ingia').entries).toHaveLength(2);
    const tsv = parseTranslationText('English\tsw\nLogin\tIngia\nSell\tUza');
    expect(tsv.format).toBe('tsv');
    expect(tsv.entries).toEqual([{ key: 'Login', locale: 'sw', value: 'Ingia' }, { key: 'Sell', locale: 'sw', value: 'Uza' }]);
  });
  it('reads the long layout (key, locale, value)', () => {
    const r = parseTranslationText('key,locale,value\nLogin,Swahili,Ingia\nLogin,xx,nope\nSell,lg,Tunda');
    expect(r.entries).toEqual([{ key: 'Login', locale: 'sw', value: 'Ingia' }, { key: 'Sell', locale: 'lg', value: 'Tunda' }]);
    expect(r.warnings.join(' ')).toMatch(/unknown language "xx"/);
  });
  it('warns about unknown columns and duplicate rows (later wins); trims and collapses key spacing', () => {
    const r = parseTranslationText('English,sw,notes\n  Log   in ,Ingia,hi\nLog in,Ingia sasa,');
    expect(r.entries).toEqual([{ key: 'Log in', locale: 'sw', value: 'Ingia sasa' }]);
    expect(r.warnings.some((w) => /not a known language/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /appears on rows 2 and 3/.test(w))).toBe(true);
  });
  it('explains what is wrong', () => {
    expect(parseTranslationText('   ').error).toMatch(/empty/);
    expect(parseTranslationText('English,sw').error).toMatch(/header row and at least one/);
    expect(parseTranslationText('English,French\nA,B').error).toMatch(/No language columns/);
    expect(parseTranslationText('English,sw\nA,').error).toMatch(/empty/);
  });
  it('skips over-long values and keys instead of failing the whole file', () => {
    const r = parseTranslationText(`English,sw\n${'k'.repeat(501)},x\nOk,${'v'.repeat(2001)}\nFine,Sawa`);
    expect(r.entries).toEqual([{ key: 'Fine', locale: 'sw', value: 'Sawa' }]);
    expect(r.warnings).toHaveLength(2);
  });
});

describe('parseTranslationText — Markdown', () => {
  it('reads a pipe table, ignoring the divider row, escaped pipes and <br>', () => {
    const md = [
      '| English | sw | lg |', '| --- | :---: | ---: |',
      '| Login | Ingia | Yingira |', '| A \\| B | x \\| y | l1<br>l2 |', '',
    ].join('\n');
    const r = parseTranslationText(md);
    expect(r.format).toBe('markdown');
    expect(r.entries).toEqual([
      { key: 'Login', locale: 'sw', value: 'Ingia' }, { key: 'Login', locale: 'lg', value: 'Yingira' },
      { key: 'A | B', locale: 'sw', value: 'x | y' }, { key: 'A | B', locale: 'lg', value: 'l1\nl2' },
    ]);
  });
});

describe('export → import round trip', () => {
  const rows = [
    { key: 'Login', values: { sw: 'Ingia', lg: 'Yingira' } },
    { key: 'Say "hi", friend', values: { sw: 'Sema "hi", rafiki', lg: '' } },
    { key: 'A | B', values: { sw: 'multi\nline | pipe', lg: 'ŋ “q” ’' } },
  ];
  it('CSV', () => {
    const csv = toCsv(rows, ['sw', 'lg']);
    expect(csv.startsWith('﻿')).toBe(true);
    const r = parseTranslationText(csv);
    const expected = rows.flatMap((row) => (['sw', 'lg'] as const).filter((l) => row.values[l]).map((l) => ({ key: row.key, locale: l, value: row.values[l] })));
    expect(r.entries.sort((a, b) => (a.key + a.locale).localeCompare(b.key + b.locale))).toEqual(expected.sort((a, b) => (a.key + a.locale).localeCompare(b.key + b.locale)));
  });
  it('Markdown', () => {
    const r = parseTranslationText(toMarkdown(rows, ['sw', 'lg']));
    expect(r.error).toBeUndefined();
    expect(r.entries).toContainEqual({ key: 'A | B', locale: 'sw', value: 'multi\nline | pipe' });
    expect(r.entries).toContainEqual({ key: 'Say "hi", friend', locale: 'sw', value: 'Sema "hi", rafiki' });
    expect(r.entries.some((e) => e.key === 'Say "hi", friend' && e.locale === 'lg')).toBe(false); // blank stays blank
  });
});
