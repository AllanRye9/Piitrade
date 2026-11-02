'use client';

/**
 * /admin/translations — translate the whole site from a file or pasted text.
 *
 *   1. Download a template (CSV or Markdown) listing every English string, with the current translations filled in.
 *   2. Fill in the language columns, then upload the file or paste the text. A preview shows exactly what changes.
 *   3. Apply. Saved translations override the built-in ones and are live within about a minute.
 *
 * Server side: backend/src/routes/adminTranslations.ts. File parsing: lib/i18n/translationFile.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/utils';
import { UI } from '@/lib/i18n/ui';
import { CATALOG } from '@/lib/i18n/catalog.generated';
import { TRANSLATABLE_LOCALES } from '@/lib/i18n/locales';
import { parseTranslationText, toCsv, toMarkdown, type ParseResult } from '@/lib/i18n/translationFile';

type Overrides = Record<string, Record<string, string>>;
const CHUNK = 500;
const fmt = (n: number) => n.toLocaleString();
const LOCALE_NAME = Object.fromEntries(TRANSLATABLE_LOCALES.map((l) => [l.code, l.name])) as Record<string, string>;
const CODES: string[] = TRANSLATABLE_LOCALES.map((l) => l.code);

export default function AdminTranslationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [overrides, setOverrides] = useState<Overrides>({});
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'ADMIN')) router.replace('/admin/auth/login');
  }, [user, authLoading, router]);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ translations: Overrides }>('/admin/translations');
      setOverrides(data.translations ?? {});
      setLoadError('');
    } catch (err) {
      setLoadError(getApiErrorMessage(err, 'Could not load translations'));
    }
  }, []);
  useEffect(() => { if (user?.role === 'ADMIN') load(); }, [user, load]);

  // Every English string: the ones found in the site's code, the built-in ones, and anything an admin added.
  const catalog = useMemo(() => {
    const set = new Set<string>(CATALOG);
    Object.keys(UI).forEach((k) => set.add(k));
    Object.values(overrides).forEach((m) => Object.keys(m).forEach((k) => set.add(k)));
    return [...set].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  }, [overrides]);

  /** What visitors currently see for this string: saved override, else built-in, else nothing (English). */
  const current = useCallback((key: string, locale: string): string =>
    overrides[locale]?.[key] ?? (UI[key] as Record<string, string> | undefined)?.[locale] ?? '', [overrides]);

  const stats = useMemo(() => TRANSLATABLE_LOCALES.map((l) => {
    let done = 0;
    for (const k of catalog) if (current(k, l.code)) done++;
    return { ...l, done, total: catalog.length, custom: Object.keys(overrides[l.code] ?? {}).length };
  }), [catalog, current, overrides]);

  // ── Download ──────────────────────────────────────────────────────────────
  const [dlLocales, setDlLocales] = useState<string[]>(CODES);
  const [dlScope, setDlScope] = useState<'all' | 'missing'>('all');
  const [dlFormat, setDlFormat] = useState<'csv' | 'md'>('csv');

  const download = () => {
    if (!dlLocales.length) return setMessage({ ok: false, text: 'Choose at least one language.' });
    const rows = catalog
      .filter((k) => dlScope === 'all' || dlLocales.some((l) => !current(k, l)))
      .map((key) => ({ key, values: Object.fromEntries(dlLocales.map((l) => [l, current(key, l)])) }));
    const body = dlFormat === 'csv' ? toCsv(rows, dlLocales) : toMarkdown(rows, dlLocales);
    const blob = new Blob([body], { type: dlFormat === 'csv' ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `piitrade-translations-${new Date().toISOString().slice(0, 10)}.${dlFormat}`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setMessage({ ok: true, text: `Downloaded ${fmt(rows.length)} strings. Fill in the language columns, then upload the file below.` });
  };

  // ── Upload / paste ────────────────────────────────────────────────────────
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [blanksRemove, setBlanksRemove] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [applying, setApplying] = useState<{ done: number; total: number } | null>(null);

  const onFile = async (f: File | null) => {
    setParsed(null); setMessage(null);
    if (!f) { setFileName(''); return; }
    if (f.size > 20 * 1024 * 1024) return setMessage({ ok: false, text: 'That file is too large (limit 20 MB).' });
    setFileName(f.name);
    setText(await f.text());
  };

  const check = () => { setMessage(null); setParsed(parseTranslationText(text, { blanksRemove })); };

  /** Only what would actually change: new or different from what visitors see now (or a removal of a saved override). */
  const plan = useMemo(() => {
    if (!parsed || parsed.error) return null;
    const changes: { key: string; locale: string; value: string; before: string; kind: 'new' | 'changed' | 'removed' }[] = [];
    let same = 0;
    for (const e of parsed.entries) {
      const before = current(e.key, e.locale);
      if (e.value === '') {
        if (overrides[e.locale]?.[e.key] !== undefined) changes.push({ ...e, before, kind: 'removed' });
        else same++;
      } else if (e.value === before && overrides[e.locale]?.[e.key] !== undefined) same++;
      else if (e.value === before) same++; // already what the built-in translation says: nothing to store
      else changes.push({ ...e, before, kind: before ? 'changed' : 'new' });
    }
    const byLocale: Record<string, number> = {};
    changes.forEach((c) => { byLocale[c.locale] = (byLocale[c.locale] ?? 0) + 1; });
    const unknown = changes.filter((c) => !catalog.includes(c.key)).length;
    return { changes, same, byLocale, unknown };
  }, [parsed, current, overrides, catalog]);

  const apply = async () => {
    if (!plan?.changes.length) return;
    setMessage(null);
    let saved = 0, removed = 0, rejected = 0;
    try {
      setApplying({ done: 0, total: plan.changes.length });
      for (let i = 0; i < plan.changes.length; i += CHUNK) {
        const slice = plan.changes.slice(i, i + CHUNK).map(({ key, locale, value }) => ({ key, locale, value }));
        const { data } = await api.put<{ saved: number; removed: number; rejected: number }>('/admin/translations/bulk', { entries: slice });
        saved += data.saved; removed += data.removed; rejected += data.rejected;
        setApplying({ done: Math.min(i + CHUNK, plan.changes.length), total: plan.changes.length });
      }
      setMessage({ ok: true, text: `Saved ${fmt(saved)} translations${removed ? `, removed ${fmt(removed)}` : ''}${rejected ? `, ${fmt(rejected)} rejected` : ''}. Visitors see them within about a minute.` });
      setText(''); setFileName(''); setParsed(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) {
      setMessage({ ok: false, text: `${getApiErrorMessage(err, 'Saving failed')}${saved ? ` (${fmt(saved)} were saved before the error; upload again to finish.)` : ''}` });
      await load();
    } finally {
      setApplying(null);
    }
  };

  // ── Editor ────────────────────────────────────────────────────────────────
  const [edLocale, setEdLocale] = useState<string>(CODES[0]);
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter((k) => (!q || k.toLowerCase().includes(q) || current(k, edLocale).toLowerCase().includes(q)) && (!onlyMissing || !current(k, edLocale)))
      .slice(0, 100);
  }, [catalog, query, onlyMissing, edLocale, current]);

  const saveRow = async (key: string) => {
    const draftKey = `${edLocale}\u0000${key}`;
    const value = (drafts[draftKey] ?? current(key, edLocale)).trim();
    if (value === current(key, edLocale)) return;
    try {
      await api.put('/admin/translations/bulk', { entries: [{ key, locale: edLocale, value }] });
      setOverrides((o) => {
        const m = { ...(o[edLocale] ?? {}) };
        if (value) m[key] = value; else delete m[key];
        return { ...o, [edLocale]: m };
      });
      setDrafts((d) => { const n = { ...d }; delete n[draftKey]; return n; });
      setSavedKey(draftKey);
      setTimeout(() => setSavedKey((s) => (s === draftKey ? '' : s)), 1500);
    } catch (err) {
      setMessage({ ok: false, text: getApiErrorMessage(err, 'Could not save that translation') });
    }
  };

  // ── Reset ─────────────────────────────────────────────────────────────────
  const [resetLocale, setResetLocale] = useState<string>(CODES[0]);
  const [resetText, setResetText] = useState('');
  const reset = async () => {
    try {
      const { data } = await api.delete<{ removed: number }>('/admin/translations', { params: { locale: resetLocale, confirm: 'RESET' } });
      setMessage({ ok: true, text: `Removed ${fmt(data.removed)} custom ${LOCALE_NAME[resetLocale]} translations. The built-in ones apply again.` });
      setResetText('');
      await load();
    } catch (err) {
      setMessage({ ok: false, text: getApiErrorMessage(err, 'Could not reset') });
    }
  };

  if (authLoading || !user || user.role !== 'ADMIN') return null;

  const box = 'mb-6 rounded-xl bg-white p-4 shadow-sm sm:p-6';
  const btn = 'rounded-lg px-5 py-2 text-sm font-medium transition-colors disabled:opacity-50';
  const primary = `${btn} bg-red-600 text-white hover:bg-red-700`;
  const secondary = `${btn} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Translations</h1>
      <p className="mb-6 text-sm text-gray-500">
        Translate the whole site from a spreadsheet, a Markdown table, or pasted text. Saved translations replace the built-in ones; any text without a
        translation stays in English. Names, prices and listing text are never changed.
      </p>

      {message && (
        <div role="status" className={`mb-5 rounded-lg border px-4 py-3 text-sm ${message.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{message.text}</div>
      )}
      {loadError && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>}

      <section className={box}>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Progress</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {stats.map((s) => {
            const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
            return (
              <div key={s.code} className="rounded-lg border border-gray-100 p-3">
                <div className="flex items-baseline justify-between"><span className="text-sm font-semibold text-gray-800">{s.name}</span><span className="text-xs tabular-nums text-gray-500">{pct}%</span></div>
                <div className="my-2 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-green-500" style={{ width: `${pct}%` }} /></div>
                <p className="text-xs text-gray-500">{fmt(s.done)} of {fmt(s.total)} translated · {fmt(s.custom)} saved by admins</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className={box}>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">1 · Download a template</h2>
        <p className="mb-4 text-sm text-gray-500">One row per English string, one column per language, with today&apos;s translations filled in. Empty cells are the ones still missing.</p>
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-gray-700">
          <div className="flex items-center gap-3">
            {TRANSLATABLE_LOCALES.map((l) => (
              <label key={l.code} className="flex items-center gap-1.5">
                <input type="checkbox" checked={dlLocales.includes(l.code)} onChange={(e) => setDlLocales((cur) => (e.target.checked ? [...cur, l.code] : cur.filter((c) => c !== l.code)))} className="rounded border-gray-300" />
                {l.name}
              </label>
            ))}
          </div>
          <select value={dlScope} onChange={(e) => setDlScope(e.target.value as 'all' | 'missing')} className="rounded-lg border border-gray-300 px-3 py-1.5" aria-label="Which strings">
            <option value="all">All strings ({fmt(catalog.length)})</option>
            <option value="missing">Only strings missing a translation</option>
          </select>
          <select value={dlFormat} onChange={(e) => setDlFormat(e.target.value as 'csv' | 'md')} className="rounded-lg border border-gray-300 px-3 py-1.5" aria-label="File format">
            <option value="csv">CSV (Excel / Google Sheets)</option>
            <option value="md">Markdown (.md table)</option>
          </select>
        </div>
        <button onClick={download} className={primary}>Download template</button>
      </section>

      <section className={box}>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">2 · Upload or paste translations</h2>
        <p className="mb-4 text-sm text-gray-500">
          Accepts .csv, .tsv, .md (pipe table) or text copied straight from a spreadsheet. First column: the English text exactly as in the template. Other columns: <code>lg</code>, <code>sw</code>, <code>ach</code> (or Luganda, Swahili, Acoli).
          You can also add English text that is not in the template — it is applied wherever that exact text appears.
        </p>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.md,.markdown,.txt,text/csv,text/plain,text/markdown" onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="mb-3 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200" />
        <textarea value={text} onChange={(e) => { setText(e.target.value); setParsed(null); setFileName(''); }} rows={8} spellCheck={false}
          placeholder={'…or paste here, for example:\nEnglish,lg,sw\nLogin,Yingira,Ingia\nSell,Tunda,Uza'}
          className="mb-3 w-full rounded-lg border border-gray-300 p-3 font-mono text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-red-500" />
        <label className="mb-4 flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={blanksRemove} onChange={(e) => { setBlanksRemove(e.target.checked); setParsed(null); }} className="rounded border-gray-300" />
          An empty cell removes my saved translation (otherwise empty cells are ignored)
        </label>
        <button onClick={check} disabled={!text.trim() || !!applying} className={secondary}>Check {fileName ? `“${fileName}”` : 'text'}</button>

        {parsed?.error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{parsed.error}</div>}

        {parsed && !parsed.error && plan && (
          <div className="mt-5">
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              Read as <strong>{parsed.format === 'markdown' ? 'a Markdown table' : parsed.format.toUpperCase()}</strong>: {fmt(parsed.entries.length)} translations ·{' '}
              <strong>{fmt(plan.changes.length)} will change</strong>, {fmt(plan.same)} already match
              {Object.keys(plan.byLocale).length > 0 && <> ({Object.entries(plan.byLocale).map(([l, n]) => `${LOCALE_NAME[l] ?? l}: ${fmt(n)}`).join(', ')})</>}
              {plan.unknown > 0 && <> · {fmt(plan.unknown)} are new English strings not in the template</>}
              {parsed.blanks > 0 && !blanksRemove && <> · {fmt(parsed.blanks)} empty cells ignored</>}
            </div>
            {parsed.warnings.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 py-3 pl-8 pr-4 text-xs text-amber-800">
                {parsed.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
                {parsed.warnings.length > 8 && <li>…and {parsed.warnings.length - 8} more</li>}
              </ul>
            )}
            {plan.changes.length > 0 ? (
              <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-gray-100">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-left text-gray-500"><tr><th className="px-3 py-2">English</th><th className="px-3 py-2">Language</th><th className="px-3 py-2">Now</th><th className="px-3 py-2">After</th></tr></thead>
                  <tbody>
                    {plan.changes.slice(0, 100).map((c, i) => (
                      <tr key={i} className="border-t border-gray-50 align-top text-gray-700">
                        <td className="max-w-[16rem] px-3 py-1.5 break-words">{c.key}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{LOCALE_NAME[c.locale] ?? c.locale}</td>
                        <td className="max-w-[14rem] px-3 py-1.5 break-words text-gray-400">{c.before || '—'}</td>
                        <td className="max-w-[16rem] px-3 py-1.5 break-words font-medium text-gray-900">{c.kind === 'removed' ? <span className="text-red-600">remove saved translation</span> : c.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plan.changes.length > 100 && <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">Showing the first 100 of {fmt(plan.changes.length)} changes.</p>}
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-600">Nothing to change — everything in this file is already live.</p>
            )}
            {plan.changes.length > 0 && (
              <button onClick={apply} disabled={!!applying} className={`${primary} mt-4`}>
                {applying ? `Saving… ${fmt(applying.done)} / ${fmt(applying.total)}` : `Save ${fmt(plan.changes.length)} translations`}
              </button>
            )}
          </div>
        )}
      </section>

      <section className={box}>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">3 · Edit one by one</h2>
        <p className="mb-4 text-sm text-gray-500">Fix a single string. Press Enter or click away to save; clear the box to go back to the built-in translation.</p>
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <select value={edLocale} onChange={(e) => setEdLocale(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5" aria-label="Language">
            {TRANSLATABLE_LOCALES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search English or translation…" className="min-w-[14rem] flex-1 rounded-lg border border-gray-300 px-3 py-1.5" />
          <label className="flex items-center gap-1.5 text-gray-600"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} className="rounded border-gray-300" />Only missing</label>
        </div>
        <div className="divide-y divide-gray-50 rounded-lg border border-gray-100">
          {rows.length === 0 && <p className="p-4 text-sm text-gray-500">No strings match.</p>}
          {rows.map((k) => {
            const dk = `${edLocale}\u0000${k}`;
            const saved = overrides[edLocale]?.[k] !== undefined;
            return (
              <div key={k} className="grid grid-cols-1 gap-1 p-2 sm:grid-cols-2 sm:gap-3">
                <p className="self-center break-words text-sm text-gray-700">{k}</p>
                <div className="flex items-center gap-2">
                  <input
                    value={drafts[dk] ?? current(k, edLocale)}
                    onChange={(e) => setDrafts((d) => ({ ...d, [dk]: e.target.value }))}
                    onBlur={() => saveRow(k)}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    placeholder="(English)"
                    maxLength={2000}
                    className={`w-full rounded-lg border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${saved ? 'border-green-300 bg-green-50/40' : 'border-gray-300'}`}
                  />
                  <span className="w-4 text-xs text-green-600" aria-live="polite">{savedKey === dk ? '✓' : ''}</span>
                </div>
              </div>
            );
          })}
        </div>
        {rows.length === 100 && <p className="mt-2 text-xs text-gray-500">Showing the first 100 matches — narrow the search to see others.</p>}
      </section>

      <section className={box}>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Reset a language</h2>
        <p className="mb-3 text-sm text-gray-500">Removes every translation saved here for one language, so the built-in ones apply again. Download a template first if you may want them back.</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select value={resetLocale} onChange={(e) => setResetLocale(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5" aria-label="Language to reset">
            {TRANSLATABLE_LOCALES.map((l) => <option key={l.code} value={l.code}>{l.name} ({fmt(Object.keys(overrides[l.code] ?? {}).length)} saved)</option>)}
          </select>
          <input value={resetText} onChange={(e) => setResetText(e.target.value)} placeholder="Type RESET" autoComplete="off" className="w-36 rounded-lg border border-red-300 px-3 py-1.5" />
          <button onClick={reset} disabled={resetText !== 'RESET' || !Object.keys(overrides[resetLocale] ?? {}).length} className={primary}>Reset</button>
        </div>
      </section>
    </div>
  );
}
