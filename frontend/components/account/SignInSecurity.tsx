'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { setAuthSession } from '@/lib/authStorage';
import { scheduleProactiveRefresh } from '@/lib/sessionRefreshScheduler';
import { useAuth } from '@/context/AuthContext';
import { T } from '@/components/ui/T';
import { useTr } from '@/lib/i18n/useTr';

const MIN_PW = 8;

function errMsg(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string; errors?: { msg?: string }[] } } };
  return e?.response?.data?.message || e?.response?.data?.errors?.[0]?.msg || fallback;
}

/** "Sign-in & security": the email you sign in with, an optional username, and change password. */
export function SignInSecurity() {
  const { user, updateUser } = useAuth();
  const tr = useTr();

  // ── Username ──
  const [username, setUsername] = useState(user?.username ?? '');
  const [unPassword, setUnPassword] = useState('');
  const [unState, setUnState] = useState<{ kind: 'idle' | 'checking' | 'ok' | 'bad'; text?: string }>({ kind: 'idle' });
  const [unSaving, setUnSaving] = useState(false);
  const [unMsg, setUnMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const checkRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setUsername(user?.username ?? ''); }, [user?.username]);

  useEffect(() => {
    if (checkRef.current) clearTimeout(checkRef.current);
    const u = username.trim().toLowerCase();
    if (!u || u === (user?.username ?? '')) { setUnState({ kind: 'idle' }); return; }
    setUnState({ kind: 'checking' });
    checkRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/users/username-available', { params: { u } });
        setUnState(data.available ? { kind: 'ok', text: tr('Available') } : { kind: 'bad', text: data.reason || tr('Not available') });
      } catch { setUnState({ kind: 'idle' }); }
    }, 400);
    return () => { if (checkRef.current) clearTimeout(checkRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, user?.username]);

  const saveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnMsg(null);
    setUnSaving(true);
    try {
      const { data } = await api.put('/users/me/username', { username, password: unPassword });
      updateUser({ username: data.username });
      setUnPassword('');
      setUnMsg({ ok: true, text: data.message || tr('Username saved.') });
    } catch (err) {
      setUnMsg({ ok: false, text: errMsg(err, tr('Could not save your username. Please try again.')) });
    } finally { setUnSaving(false); }
  };

  // ── Password ──
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const strength = (() => {
    let s = 0;
    if (next.length >= MIN_PW) s++;
    if (next.length >= 12) s++;
    if (/[a-z]/.test(next) && /[A-Z]/.test(next)) s++;
    if (/\d/.test(next) && /[^A-Za-z0-9]/.test(next)) s++;
    return s;
  })();
  const strengthLabel = ['', tr('Weak'), tr('Fair'), tr('Good'), tr('Strong')][next ? Math.max(1, strength) : 0];

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (next.length < MIN_PW) { setPwMsg({ ok: false, text: tr('The new password must be at least 8 characters.') }); return; }
    if (next !== again) { setPwMsg({ ok: false, text: tr('The two new passwords do not match.') }); return; }
    if (next === cur) { setPwMsg({ ok: false, text: tr('Choose a password different from your current one.') }); return; }
    setPwSaving(true);
    try {
      const { data } = await api.put('/users/me/password', { currentPassword: cur, newPassword: next });
      if (data.accessToken) { setAuthSession(data.accessToken); scheduleProactiveRefresh(data.accessToken); }
      setCur(''); setNext(''); setAgain('');
      setPwMsg({ ok: true, text: data.message || tr('Password updated.') });
    } catch (err) {
      setPwMsg({ ok: false, text: errMsg(err, tr('Could not change your password. Please try again.')) });
    } finally { setPwSaving(false); }
  };

  if (!user) return null;
  const input = 'input-premium w-full text-sm';
  const label = 'mb-1 block text-xs font-semibold text-gray-700';

  return (
    <section id="sign-in-security" className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm sm:p-4">
      <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-gray-900">
        <span aria-hidden="true">🔐</span> <T>Sign-in &amp; security</T>
      </h2>

      <div className="mb-4 rounded-xl bg-gray-50 p-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500"><T>Your sign-in email</T></p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900 break-all">
          {user.email}
          {user.isVerified && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">✓ <T>Verified</T></span>}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          <T>Use this email — or your username below — together with your password to sign in.</T>
        </p>
      </div>

      <form onSubmit={saveUsername} className="mb-5 space-y-2.5" autoComplete="off">
        <p className="text-sm font-bold text-gray-900"><T>Username</T> <span className="font-normal text-gray-500">(<T>optional</T>)</span></p>
        <div>
          <label htmlFor="sec-username" className={label}><T>Choose a username</T></label>
          <input id="sec-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. ann.mugisha" maxLength={30} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={input} />
          <p className={`mt-1 text-xs ${unState.kind === 'ok' ? 'text-emerald-600' : unState.kind === 'bad' ? 'text-red-600' : 'text-gray-500'}`} aria-live="polite">
            {unState.kind === 'checking' ? tr('Checking…') : unState.text ?? tr('3–30 letters, numbers, dots, dashes or underscores.')}
          </p>
        </div>
        {username.trim().toLowerCase() !== (user.username ?? '') && username.trim() !== '' && (
          <div>
            <label htmlFor="sec-un-pw" className={label}><T>Current password (to confirm)</T></label>
            <input id="sec-un-pw" type="password" value={unPassword} onChange={(e) => setUnPassword(e.target.value)} autoComplete="current-password" className={input} />
          </div>
        )}
        {unMsg && <p role="status" className={`text-xs font-medium ${unMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{unMsg.text}</p>}
        <button type="submit" disabled={unSaving || !username.trim() || username.trim().toLowerCase() === (user.username ?? '') || !unPassword || unState.kind === 'bad'}
          className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300">
          {unSaving ? tr('Saving…') : user.username ? tr('Change username') : tr('Save username')}
        </button>
      </form>

      <form onSubmit={savePassword} className="space-y-2.5 border-t border-gray-100 pt-4" autoComplete="off">
        <p className="text-sm font-bold text-gray-900"><T>Change password</T></p>
        <div>
          <label htmlFor="sec-cur" className={label}><T>Current password</T></label>
          <input id="sec-cur" type={show ? 'text' : 'password'} value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required className={input} />
        </div>
        <div>
          <label htmlFor="sec-new" className={label}><T>New password</T></label>
          <input id="sec-new" type={show ? 'text' : 'password'} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={MIN_PW} maxLength={128} className={input} />
          {next && (
            <div className="mt-1.5" aria-live="polite">
              <div className="flex gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={`h-1 flex-1 rounded-full ${strength >= i ? (strength <= 1 ? 'bg-red-500' : strength === 2 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-gray-200'}`} />
                ))}
              </div>
              <p className="mt-0.5 text-[11px] text-gray-500">{strengthLabel}</p>
            </div>
          )}
        </div>
        <div>
          <label htmlFor="sec-again" className={label}><T>Confirm new password</T></label>
          <input id="sec-again" type={show ? 'text' : 'password'} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required className={input} />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> <T>Show passwords</T>
        </label>
        <p className="text-xs text-gray-500"><T>Changing your password signs you out on your other devices.</T></p>
        {pwMsg && <p role="status" className={`text-xs font-medium ${pwMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{pwMsg.text}</p>}
        <button type="submit" disabled={pwSaving || !cur || !next || !again}
          className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300">
          {pwSaving ? tr('Updating…') : tr('Update password')}
        </button>
      </form>
    </section>
  );
}
