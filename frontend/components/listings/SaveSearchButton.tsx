'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useTr } from '@/lib/i18n/useTr';
import { paramsFromSearch } from '@/lib/savedSearch';

type State = 'idle' | 'saving' | 'saved' | 'duplicate' | 'full' | 'error';

/** "Alert me" chip for the browse filter bar: stores the current filters as an alert (instant profile, e-mail and sound notifications). */
export function SaveSearchButton() {
  const tr = useTr();
  const sp = useSearchParams();
  const { user } = useAuth();
  const [state, setState] = useState<State>('idle');
  const [msg, setMsg] = useState('');
  const timer = useRef<number | null>(null);

  const params = paramsFromSearch((k) => sp?.get(k));
  const key = JSON.stringify(params);
  const hasFilters = Object.keys(params).length > 0;

  // A different search is a new thing to save.
  useEffect(() => { setState('idle'); setMsg(''); }, [key]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  if (!hasFilters) return null;

  const save = async () => {
    if (!user) return;
    setState('saving');
    try {
      const { data } = await api.post('/saved-searches', { params });
      setState(data?.duplicate ? 'duplicate' : 'saved');
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { error?: string; message?: string } } };
      const m = err.response?.data?.error || err.response?.data?.message || '';
      if (err.response?.status === 404) setMsg(tr('Saved searches are not available yet.'));
      else setMsg(m);
      setState(err.response?.status === 400 && /up to/i.test(m) ? 'full' : 'error');
    }
  };

  if (!user) {
    return (
      <Link href={`/auth/login?redirect=${encodeURIComponent(`/listings?${sp?.toString() ?? ''}`)}`}
        className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-gray-300 bg-white px-3 text-xs font-bold text-gray-600 hover:border-red-300 hover:text-red-600">
        🔔 {tr('Sign in to get alerts')}
      </Link>
    );
  }

  if (state === 'saved' || state === 'duplicate') {
    return (
      <Link href="/profile/alerts" className="animate-pop inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700" role="status">
        ✓ {state === 'saved' ? tr('Saved — we will alert you') : tr('Already saved')}
      </Link>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={save} disabled={state === 'saving'}
        className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-60">
        🔔 {state === 'saving' ? tr('Saving…') : tr('Alert me')}
      </button>
      {(state === 'error' || state === 'full') && (
        <span className="max-w-[12rem] truncate text-[11px] text-red-600" role="alert">
          {msg || tr('Could not save. Try again.')}
          {state === 'full' && <> <Link href="/profile/alerts" className="underline">{tr('Manage')}</Link></>}
        </span>
      )}
    </span>
  );
}
