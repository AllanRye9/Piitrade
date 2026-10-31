import { api } from '@/lib/api';

/** Browser-side helpers for Web Push. The service worker itself lives in /public/sw.js. */

export function isPushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** iPhones/iPads only allow web push for sites added to the Home Screen (iOS 16.4+). */
export function needsHomeScreenInstall(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isIos && !standalone;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

/** This browser's current push subscription, if any (does not prompt). */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await registration();
  return reg.pushManager.getSubscription();
}

async function sendToServer(sub: PushSubscription): Promise<void> {
  await api.post('/push/subscribe', { subscription: sub.toJSON(), userAgent: navigator.userAgent });
}

/** Re-sends an existing subscription to the server (idempotent) so a device the server forgot is restored. */
export async function resyncSubscription(): Promise<void> {
  const sub = await getCurrentSubscription();
  if (sub && Notification.permission === 'granted') await sendToServer(sub);
}

export type EnableResult = 'enabled' | 'denied' | 'dismissed';

/** Asks permission (must be called from a click), subscribes this browser and registers it with the server. */
export async function enablePush(publicKey: string): Promise<EnableResult> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'dismissed';
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  }
  await sendToServer(sub);
  return 'enabled';
}

export async function disablePush(): Promise<void> {
  const sub = await getCurrentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api.post('/push/unsubscribe', { endpoint }).catch(() => { /* server copy is pruned on the next failed push */ });
}

/**
 * How to re-allow notifications once the browser has blocked them. A page can never undo a block itself
 * (browsers deliberately forbid it), so the best a site can do is show the exact steps for this browser.
 */
export function unblockSteps(): { browser: string; steps: string[] } {
  if (typeof navigator === 'undefined') return { browser: 'your browser', steps: [] };
  const ua = navigator.userAgent;
  const iosLike = /iPad|iPhone|iPod/.test(ua);
  if (iosLike) {
    return { browser: 'iPhone / iPad', steps: ['Open Settings → Notifications.', 'Find Piitrade (the Home Screen app) in the list.', 'Turn on Allow Notifications.'] };
  }
  if (/Firefox\//.test(ua)) {
    return { browser: 'Firefox', steps: ['Click the padlock (or the tune icon) at the left of the address bar.', 'Open Connection secure → More information → Permissions, or choose Permissions.', 'Next to Send notifications remove the block (clear Use default / choose Allow).', 'Come back here — this page updates by itself.'] };
  }
  if (/Edg\//.test(ua)) {
    return { browser: 'Microsoft Edge', steps: ['Click the padlock at the left of the address bar.', 'Choose Permissions for this site.', 'Set Notifications to Allow.', 'Come back here — this page updates by itself.'] };
  }
  if (/Android/.test(ua)) {
    return { browser: 'Chrome on Android', steps: ['Tap the padlock (or the tune icon) at the left of the address bar.', 'Tap Permissions → Notifications.', 'Choose Allow.', 'Come back here — this page updates by itself.'] };
  }
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) {
    return { browser: 'Safari', steps: ['Open Safari → Settings → Websites → Notifications.', 'Find this site in the list.', 'Set it to Allow.', 'Come back here — this page updates by itself.'] };
  }
  return { browser: 'Chrome', steps: ['Click the padlock (or the tune icon) at the left of the address bar.', 'Open Site settings.', 'Set Notifications to Allow.', 'Come back here — this page updates by itself.'] };
}
