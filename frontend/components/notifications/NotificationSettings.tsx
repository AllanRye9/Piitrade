'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/momo';
import { useTr } from '@/lib/i18n/useTr';
import {
  disablePush,
  enablePush,
  getCurrentSubscription,
  isPushSupported,
  needsHomeScreenInstall,
  resyncSubscription,
} from '@/lib/push';

interface AlertSettings {
  push: { available: boolean; publicKey: string | null; devices: number };
  whatsapp: { available: boolean; verified: boolean; number: string | null; pendingVerification: boolean };
  notifyMessages: boolean;
}

type Permission = NotificationPermission | 'unsupported';
type Notice = { kind: 'ok' | 'error'; text: string } | null;

/**
 * Alert settings card for /notifications: browser push on this device, chat-message alerts on/off, and
 * WhatsApp alerts (number verified with a one-time code). Renders nothing until the server has push or
 * WhatsApp configured, so the site is unchanged until then.
 */
export function NotificationSettings() {
  const tr = useTr();
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [permission, setPermission] = useState<Permission>('default');
  const [thisDevice, setThisDevice] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  const refreshSettings = useCallback(async () => {
    const { data } = await api.get<AlertSettings>('/push/settings');
    setSettings(data);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await refreshSettings();
        if (cancelled) return;
        if (data.whatsapp.pendingVerification) setCodeSent(true);
        if (!isPushSupported()) { setPermission('unsupported'); return; }
        setPermission(Notification.permission);
        const sub = await getCurrentSubscription();
        if (cancelled) return;
        setThisDevice(Boolean(sub) && Notification.permission === 'granted');
        // Keep the server's copy of this device current (e.g. after a data wipe on the server side).
        if (sub && Notification.permission === 'granted' && data.push.available) {
          resyncSubscription().catch(() => { /* best effort */ });
        }
      } catch {
        /* settings are optional; stay hidden if the API is unreachable */
      }
    })();
    return () => { cancelled = true; };
  }, [refreshSettings]);

  const run = async (key: string, fn: () => Promise<void>, failure: string) => {
    setBusy(key);
    setNotice(null);
    try { await fn(); } catch (err) { setNotice({ kind: 'error', text: apiErrorMessage(err, failure) }); } finally { setBusy(null); }
  };

  if (!settings || (!settings.push.available && !settings.whatsapp.available)) return null;

  const onEnablePush = () => run('push', async () => {
    if (!settings.push.publicKey) throw new Error('missing key');
    const result = await enablePush(settings.push.publicKey);
    setPermission(Notification.permission);
    if (result === 'enabled') {
      setThisDevice(true);
      await refreshSettings();
      setNotice({ kind: 'ok', text: tr('Browser alerts are on for this device.') });
    } else if (result === 'denied') {
      setNotice({ kind: 'error', text: tr('Notifications are blocked. Allow them for this site in your browser settings, then try again.') });
    }
  }, tr('Could not turn on browser alerts. Please try again.'));

  const onDisablePush = () => run('push', async () => {
    await disablePush();
    setThisDevice(false);
    await refreshSettings();
  }, tr('Could not turn off browser alerts.'));

  const onTestPush = () => run('test', async () => {
    const { data } = await api.post<{ sent: number }>('/push/test');
    setNotice(data.sent > 0
      ? { kind: 'ok', text: tr('Test sent. It should appear in a moment.') }
      : { kind: 'error', text: tr('The test could not be delivered. Try turning alerts off and on again.') });
  }, tr('Could not send a test.'));

  const onToggleMessages = () => run('messages', async () => {
    const next = !settings.notifyMessages;
    await api.put('/push/settings', { notifyMessages: next });
    setSettings({ ...settings, notifyMessages: next });
  }, tr('Could not save that setting.'));

  const onSendCode = () => run('code', async () => {
    await api.post('/push/whatsapp/send-code', { phone });
    setCodeSent(true);
    setCode('');
    setNotice({ kind: 'ok', text: tr('We sent a 6-digit code to your WhatsApp.') });
  }, tr('Could not send the code.'));

  const onVerify = () => run('verify', async () => {
    await api.post('/push/whatsapp/verify', { code: code.trim() });
    setCodeSent(false);
    setCode('');
    setPhone('');
    await refreshSettings();
    setNotice({ kind: 'ok', text: tr('WhatsApp alerts are on.') });
  }, tr('That code did not work.'));

  const onDisableWhatsApp = () => run('wa-off', async () => {
    await api.delete('/push/whatsapp');
    setCodeSent(false);
    await refreshSettings();
  }, tr('Could not turn off WhatsApp alerts.'));

  const channelsOn = (settings.push.devices > 0) || settings.whatsapp.verified;
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50';
  const primary = `${btn} bg-red-600 text-white hover:bg-red-700`;
  const subtle = `${btn} border border-gray-200 text-gray-700 hover:bg-gray-50`;

  return (
    <section aria-label={tr('Alert settings')} className="mb-4 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm">
      <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
        <span aria-hidden>🔔</span>{tr('Get alerts outside the website')}
      </h2>
      <p className="text-xs text-gray-500 mt-0.5">{tr('Know right away when someone messages you or makes an offer.')}</p>

      {notice && (
        <p role="status" className={`mt-2 text-xs rounded-lg px-2.5 py-1.5 ${notice.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {notice.text}
        </p>
      )}

      {settings.push.available && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800">{tr('Browser notifications')}</p>
            <p className="text-xs text-gray-500">
              {permission === 'unsupported'
                ? (needsHomeScreenInstall()
                  ? tr('On iPhone, add Piitrade to your Home Screen first, then open it from there to turn this on.')
                  : tr('This browser does not support notifications.'))
                : permission === 'denied'
                  ? tr('Blocked in your browser settings for this site.')
                  : thisDevice
                    ? tr('On for this device.')
                    : tr('Off for this device.')}
            </p>
          </div>
          {permission !== 'unsupported' && (
            <div className="flex gap-2">
              {thisDevice ? (
                <>
                  <button type="button" onClick={onTestPush} disabled={busy !== null} className={subtle}>{tr('Send test')}</button>
                  <button type="button" onClick={onDisablePush} disabled={busy !== null} className={subtle}>{tr('Turn off')}</button>
                </>
              ) : (
                <button type="button" onClick={onEnablePush} disabled={busy !== null || permission === 'denied'} className={primary}>
                  {busy === 'push' ? tr('Please wait…') : tr('Turn on')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {settings.whatsapp.available && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">WhatsApp</p>
              <p className="text-xs text-gray-500">
                {settings.whatsapp.verified
                  ? `${tr('On for')} ${settings.whatsapp.number ?? ''}`
                  : tr('Get offers and replies on WhatsApp. We confirm your number with a code first.')}
              </p>
            </div>
            {settings.whatsapp.verified && (
              <button type="button" onClick={onDisableWhatsApp} disabled={busy !== null} className={subtle}>{tr('Turn off')}</button>
            )}
          </div>

          {!settings.whatsapp.verified && !codeSent && (
            <div className="mt-2 flex gap-2">
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={tr('WhatsApp number, e.g. 0772 123456')}
                aria-label={tr('WhatsApp number')}
                className="flex-1 min-w-0 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
              />
              <button type="button" onClick={onSendCode} disabled={busy !== null || phone.trim().length < 7} className={primary}>
                {busy === 'code' ? tr('Sending…') : tr('Send code')}
              </button>
            </div>
          )}

          {!settings.whatsapp.verified && codeSent && (
            <div className="mt-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  aria-label={tr('6-digit code')}
                  className="w-32 rounded-lg border border-gray-200 px-3 py-1.5 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-red-200"
                />
                <button type="button" onClick={onVerify} disabled={busy !== null || code.length !== 6} className={primary}>
                  {busy === 'verify' ? tr('Checking…') : tr('Confirm')}
                </button>
                <button type="button" onClick={() => { setCodeSent(false); setCode(''); }} disabled={busy !== null} className={subtle}>
                  {tr('Change number')}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-gray-400">{tr('The code is valid for 10 minutes.')}</p>
            </div>
          )}
        </div>
      )}

      {channelsOn && (
        <label className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3 cursor-pointer">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-gray-800">{tr('New chat messages')}</span>
            <span className="block text-xs text-gray-500">{tr('Offers and other updates are always sent. Turn this off to silence chat messages.')}</span>
          </span>
          <input
            type="checkbox"
            checked={settings.notifyMessages}
            onChange={onToggleMessages}
            disabled={busy !== null}
            className="h-4 w-4 accent-red-600"
          />
        </label>
      )}
    </section>
  );
}
