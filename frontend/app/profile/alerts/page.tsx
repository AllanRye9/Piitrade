'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useTr } from '@/lib/i18n/useTr';
import { useCategoryTree } from '@/hooks/useCategoryTree';
import CategoryPicker from '@/components/ui/CategoryPicker';
import { ListPageSkeleton } from '@/components/ui/PageSkeleton';
import { ALERT_EVENT } from '@/components/alerts/AlertListener';
import { isSoundEnabled, playAlertSound, setSoundEnabled, unlockAudio } from '@/lib/alertSound';
import {
  ALERT_PRESETS, EMPTY_FORM, NOTIFICATIONS_CHANGED_EVENT, describeAlert, formToParams, formatUgxInput, hasCriteria, mergeFeed, paramsToForm, presetToForm, safeAlertHref,
  type AlertEvent, type AlertFeedItem, type AlertForm,
} from '@/lib/alerts';
import { toListingsHref, type SavedSearchRow } from '@/lib/savedSearch';
import type { Category } from '@/lib/types';

interface Preview { count: number; samples: { id: string; title: string; price: number; currency: string }[] }
const errMsg = (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export default function AlertsPage() {
  const tr = useTr();
  const { user, loading: authLoading } = useAuth();
  const { tree } = useCategoryTree();

  const [rows, setRows] = useState<SavedSearchRow[] | null>(null);
  const [max, setMax] = useState(20);
  const [feed, setFeed] = useState<AlertFeedItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [feedPage, setFeedPage] = useState(1);
  const [feedPages, setFeedPages] = useState(1);

  const [form, setForm] = useState<AlertForm>(EMPTY_FORM);
  const [name, setName] = useState('');
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySound, setNotifySound] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [soundTest, setSoundTest] = useState<'idle' | 'played' | 'blocked'>('idle');
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setSoundOn(isSoundEnabled()); }, []);

  // slug <-> id <-> name lookups over the public category tree (parents and subcategories)
  const { byId, bySlug } = useMemo(() => {
    const byId = new Map<string, Category>(); const bySlug = new Map<string, Category>();
    for (const p of tree ?? []) for (const c of [p, ...(p.children ?? [])]) { byId.set(c.id, c); bySlug.set(c.slug, c); }
    return { byId, bySlug };
  }, [tree]);
  const pickerValue = form.categorySlug ? bySlug.get(form.categorySlug)?.id ?? '' : '';

  const loadRows = useCallback(async () => {
    try {
      const { data } = await api.get('/saved-searches');
      setRows(data.searches ?? []);
      if (typeof data.max === 'number') setMax(data.max);
    } catch { setRows((r) => r ?? []); }
  }, []);

  const loadFeed = useCallback(async (page = 1, append = false) => {
    try {
      const { data } = await api.get('/alerts/feed', { params: { page, limit: 15 } });
      setFeed((f) => (append ? [...f, ...(data.items as AlertFeedItem[]).filter((i) => !f.some((x) => x.id === i.id))] : data.items));
      setUnread(data.unread ?? 0); setFeedPage(data.page ?? page); setFeedPages(data.pages ?? 1);
    } catch { /* leave what we have */ }
  }, []);

  useEffect(() => { if (user) { void loadRows(); void loadFeed(); } }, [user, loadRows, loadFeed]);

  // A new alert arrives while this page is open: show it at the top right away.
  useEffect(() => {
    const onAlert = (ev: Event) => {
      const e = (ev as CustomEvent<AlertEvent | undefined>).detail;
      if (!e || typeof e.id !== 'string') return; // only a real alert has a payload
      setFeed((f) => mergeFeed(f, [e]));
      setUnread((n) => n + 1);
      void loadRows();
    };
    window.addEventListener(ALERT_EVENT, onAlert);
    return () => window.removeEventListener(ALERT_EVENT, onAlert);
  }, [loadRows]);

  // Live "how many listings match right now" preview while the form is filled in.
  useEffect(() => {
    if (!hasCriteria(form)) { setPreview(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.post('/alerts/preview', { params: formToParams(form) });
        if (!cancelled) setPreview({ count: data.count, samples: data.samples ?? [] });
      } catch { if (!cancelled) setPreview(null); }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form]);

  const set = <K extends keyof AlertForm>(k: K, v: AlertForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const reset = () => { setForm(EMPTY_FORM); setName(''); setNotifyEmail(true); setNotifySound(true); setEditingId(null); };

  const submit = async () => {
    if (!hasCriteria(form)) { setNotice({ text: tr('Pick a category or add a keyword, price or location first.'), error: true }); return; }
    setSaving(true); setNotice(null);
    try {
      const params = formToParams(form);
      if (editingId) {
        await api.patch(`/saved-searches/${editingId}`, { params, notifyEmail, notifySound, ...(name.trim() ? { name: name.trim() } : {}) });
        setNotice({ text: tr('Alert updated.'), error: false });
      } else {
        const { data } = await api.post('/saved-searches', { params, notifyEmail, notifySound, ...(name.trim() ? { name: name.trim() } : {}) });
        setNotice({ text: data?.duplicate ? tr('You already have this alert.') : tr('Alert created. We will notify you the moment a match is posted.'), error: false });
      }
      reset();
      await loadRows();
    } catch (e) {
      setNotice({ text: errMsg(e, tr('Could not save the alert')), error: true });
    } finally { setSaving(false); }
  };

  const edit = (row: SavedSearchRow) => {
    setEditingId(row.id); setForm(paramsToForm(row.params)); setName(row.name);
    setNotifyEmail(row.notifyEmail); setNotifySound(row.notifySound); setNotice(null);
    formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  const patchRow = async (row: SavedSearchRow, patch: Partial<Pick<SavedSearchRow, 'notify' | 'notifyEmail' | 'notifySound'>>) => {
    setRows((rs) => rs && rs.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    try { await api.patch(`/saved-searches/${row.id}`, patch); } catch { void loadRows(); }
  };
  const remove = async (row: SavedSearchRow) => {
    if (!window.confirm(tr('Delete this alert?'))) return;
    setRows((rs) => rs && rs.filter((r) => r.id !== row.id));
    if (editingId === row.id) reset();
    try { await api.delete(`/saved-searches/${row.id}`); } catch { void loadRows(); }
  };
  const markAllRead = async () => {
    setFeed((f) => f.map((i) => ({ ...i, isRead: true }))); setUnread(0);
    try { await api.post('/alerts/feed/read', {}); window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT)); } catch { void loadFeed(); }
  };
  const openFeedItem = (item: AlertFeedItem) => {
    if (!item.isRead) {
      setFeed((f) => f.map((i) => (i.id === item.id ? { ...i, isRead: true } : i))); setUnread((n) => Math.max(0, n - 1));
      api.post('/alerts/feed/read', { ids: [item.id] }).then(() => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT))).catch(() => undefined);
    }
  };
  const toggleSound = (on: boolean) => { setSoundEnabled(on); setSoundOn(on); if (on) unlockAudio(); };
  const testSound = async () => { unlockAudio(); setSoundTest((await playAlertSound()) ? 'played' : 'blocked'); };

  if (authLoading) return <ListPageSkeleton rows={3} />;
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 text-center">
        <h1 className="text-2xl font-extrabold text-gray-900">🔔 {tr('Listing alerts')}</h1>
        <p className="mt-2 text-sm text-gray-600">{tr('Sign in to get an alert the moment something you want is posted.')}</p>
        <Link href="/login" className="mt-4 inline-flex rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700">{tr('Sign in')}</Link>
      </main>
    );
  }

  const categoryName = (slug?: string) => (slug ? bySlug.get(slug)?.name : undefined);
  const atLimit = (rows?.length ?? 0) >= max && !editingId;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 sm:text-3xl">🔔 {tr('Listing alerts')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            {tr('Tell us what you are looking for. The moment a matching listing is posted you get a notification here, an e-mail, and a sound if Piitrade is open.')}
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2 font-medium text-gray-700">
            <input type="checkbox" checked={soundOn} onChange={(e) => toggleSound(e.target.checked)} aria-label={tr('Play a sound for new alerts in this browser')} />
            🔊 {tr('Sound on this device')}
          </label>
          <button type="button" onClick={testSound} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50">{tr('Test')}</button>
          {soundTest === 'played' && <span role="status" className="text-xs text-green-600">✓ {tr('Played')}</span>}
          {soundTest === 'blocked' && <span role="status" className="text-xs text-amber-600">{tr('Your browser is blocking sound. Click anywhere on the page, then test again.')}</span>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* ── create / edit ───────────────────────────────────────────── */}
          <section ref={formRef} aria-label={editingId ? tr('Edit alert') : tr('New alert')} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900">{editingId ? tr('Edit alert') : tr('New alert')}</h2>
            {!editingId && (
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label={tr('Quick start')}>
                {ALERT_PRESETS.map((p) => (
                  <button key={p.label} type="button" onClick={() => { setForm(presetToForm(p)); setName(''); setNotice(null); }}
                    className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100">
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className="mb-1 block text-xs font-semibold text-gray-600">{tr('Category')}</span>
                <CategoryPicker categories={(tree ?? []) as Category[]} value={pickerValue} onChange={(id) => set('categorySlug', byId.get(id)?.slug ?? '')} />
              </div>
              <label className="text-xs font-semibold text-gray-600">{tr('Keyword (optional)')}
                <input value={form.q} onChange={(e) => set('q', e.target.value)} placeholder="e.g. Tecno, Hilux, 2 bedroom" className="input-premium mt-1 w-full text-sm font-normal" />
              </label>
              <label className="text-xs font-semibold text-gray-600">{tr('Location (optional)')}
                <input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Kampala, Wakiso" className="input-premium mt-1 w-full text-sm font-normal" />
              </label>
              <label className="text-xs font-semibold text-gray-600">{tr('Minimum price (UGX)')}
                <input inputMode="numeric" value={form.priceMin} onChange={(e) => set('priceMin', formatUgxInput(e.target.value))} placeholder="0" className="input-premium mt-1 w-full text-sm font-normal" aria-label={tr('Minimum price in UGX')} />
              </label>
              <label className="text-xs font-semibold text-gray-600">{tr('Maximum price (UGX)')}
                <input inputMode="numeric" value={form.priceMax} onChange={(e) => set('priceMax', formatUgxInput(e.target.value))} placeholder="e.g. 5,000,000" className="input-premium mt-1 w-full text-sm font-normal" aria-label={tr('Maximum price in UGX')} />
              </label>
              <label className="text-xs font-semibold text-gray-600">{tr('Condition')}
                <select value={form.condition} onChange={(e) => set('condition', e.target.value as AlertForm['condition'])} className="input-premium mt-1 w-full text-sm font-normal">
                  <option value="">{tr('Any')}</option><option value="NEW">{tr('New')}</option><option value="USED">{tr('Used')}</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-gray-600">{tr('Alert name (optional)')}
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={tr('We name it for you')} className="input-premium mt-1 w-full text-sm font-normal" />
              </label>
              <div className="flex flex-wrap gap-x-5 gap-y-1 sm:col-span-2">
                <label className="flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={form.withPhotos} onChange={(e) => set('withPhotos', e.target.checked)} /> 📷 {tr('Only with photos')}</label>
                <label className="flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={form.verifiedOnly} onChange={(e) => set('verifiedOnly', e.target.checked)} /> 🛡️ {tr('Only verified sellers')}</label>
              </div>
            </div>

            <fieldset className="mt-3 rounded-xl bg-gray-50 p-3">
              <legend className="px-1 text-xs font-bold uppercase tracking-wider text-gray-500">{tr('Tell me by')}</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <span className="text-sm text-gray-700">🔔 {tr('Notification here (always)')}</span>
                <label className="flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} /> ✉️ {tr('E-mail')}</label>
                <label className="flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={notifySound} onChange={(e) => setNotifySound(e.target.checked)} /> 🔊 {tr('Sound')}</label>
              </div>
            </fieldset>

            <p className="mt-3 min-h-[1.25rem] text-sm text-gray-600" aria-live="polite">
              {preview && (preview.count > 0
                ? <>📊 <strong>{preview.count.toLocaleString('en-US')}</strong> {tr(preview.count === 1 ? 'listing matches right now' : 'listings match right now')}{preview.samples[0] ? ` — ${tr('latest')}: ${preview.samples[0].title}` : ''}</>
                : <>{tr('Nothing matches yet. That is fine: we will alert you as soon as something is posted.')}</>)}
            </p>

            {notice && <p role="status" className={`mt-2 rounded-lg border px-3 py-2 text-sm ${notice.error ? 'border-red-100 bg-red-50 text-red-700' : 'border-green-100 bg-green-50 text-green-700'}`}>{notice.text}</p>}
            {atLimit && <p className="mt-2 text-sm text-amber-700">{tr('You have reached the limit of')} {max} {tr('alerts. Delete one to add another.')}</p>}

            <div className="mt-3 flex gap-2">
              <button type="button" onClick={submit} disabled={saving || atLimit} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">
                {saving ? tr('Saving…') : editingId ? tr('Save changes') : tr('Create alert')}
              </button>
              {(editingId || hasCriteria(form)) && <button type="button" onClick={reset} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">{editingId ? tr('Cancel') : tr('Clear')}</button>}
            </div>
          </section>

          {/* ── my alerts ───────────────────────────────────────────────── */}
          <section aria-label={tr('Your alerts')}>
            <h2 className="mb-2 flex items-center justify-between text-lg font-bold text-gray-900">
              <span>{tr('Your alerts')}</span>
              <span className="text-xs font-medium text-gray-400">{rows?.length ?? 0} / {max}</span>
            </h2>
            {rows === null ? <ListPageSkeleton rows={2} /> : rows.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">{tr('No alerts yet. Pick a quick start above or fill in the form.')}</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li key={row.id} className={`rounded-2xl border bg-white p-3 shadow-sm ${row.notify ? 'border-gray-200' : 'border-gray-200 opacity-70'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-gray-900">{row.name}</p>
                        <p className="text-xs text-gray-500">{describeAlert(row.params, categoryName(row.params.category))}</p>
                        <p className="mt-0.5 text-[11px] text-gray-400">
                          {row.lastAlertAt ? `${tr('Last alert')}: ${timeAgo(row.lastAlertAt)}` : tr('No alerts sent yet')}
                          {row.newCount > 0 && <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 font-bold text-red-700">{row.newCount} {tr('new')}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Link href={toListingsHref(row.params)} onClick={() => { api.patch(`/saved-searches/${row.id}`, { seen: true }).catch(() => undefined); }} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50">{tr('View matches')}</Link>
                        <button type="button" onClick={() => edit(row)} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50" aria-label={`${tr('Edit')} ${row.name}`}>{tr('Edit')}</button>
                        <button type="button" onClick={() => remove(row)} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50" aria-label={`${tr('Delete')} ${row.name}`}>{tr('Delete')}</button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 pt-2 text-xs text-gray-700">
                      <label className="flex items-center gap-1.5 font-semibold"><input type="checkbox" checked={row.notify} onChange={(e) => patchRow(row, { notify: e.target.checked })} aria-label={`${tr('Alerts on')}: ${row.name}`} /> {tr('Alerts on')}</label>
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={row.notifyEmail} disabled={!row.notify} onChange={(e) => patchRow(row, { notifyEmail: e.target.checked })} aria-label={`${tr('E-mail')}: ${row.name}`} /> ✉️ {tr('E-mail')}</label>
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={row.notifySound} disabled={!row.notify} onChange={(e) => patchRow(row, { notifySound: e.target.checked })} aria-label={`${tr('Sound')}: ${row.name}`} /> 🔊 {tr('Sound')}</label>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── alert feed ────────────────────────────────────────────────── */}
        <section aria-label={tr('Alert feed')} className="lg:sticky lg:top-24 lg:self-start">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">{tr('Matches found for you')} {unread > 0 && <span className="ml-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white" aria-label={`${unread} ${tr('unread')}`}>{unread}</span>}</h2>
            {unread > 0 && <button type="button" onClick={markAllRead} className="text-xs font-semibold text-red-600 hover:underline">{tr('Mark all read')}</button>}
          </div>
          {feed.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">🎯 {tr('Matches appear here the moment they are posted.')}</p>
          ) : (
            <ul className="space-y-2">
              {feed.map((item) => (
                <li key={item.id}>
                  <Link href={safeAlertHref(item.href)} onClick={() => openFeedItem(item)} className={`flex items-start gap-3 rounded-2xl border p-3 transition-colors hover:border-red-300 ${item.isRead ? 'border-gray-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
                    {item.image
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={item.image} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                      : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white text-2xl" aria-hidden="true">🎯</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-900">{item.title.replace(/^New match:\s*/, '')}</span>
                      <span className="block text-xs text-gray-600 line-clamp-2">{item.message}</span>
                      <span className="mt-0.5 block text-[11px] text-gray-400">{timeAgo(item.createdAt)}</span>
                    </span>
                    {!item.isRead && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-red-600" aria-label={tr('Unread')} />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {feedPage < feedPages && (
            <button type="button" onClick={() => loadFeed(feedPage + 1, true)} className="mt-3 w-full rounded-lg border border-gray-200 bg-white py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">{tr('Load older')}</button>
          )}
        </section>
      </div>
    </main>
  );
}
