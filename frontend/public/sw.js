/*
 * Piitrade service worker — Web Push only (no offline caching, so it can never serve stale pages).
 * Receives the JSON built by the backend (utils/webPush.ts): { title, body, url, tag }.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Only same-site relative paths are ever opened from a notification.
function safePath(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/notifications';
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Piitrade';

  event.waitUntil((async () => {
    // Someone looking at the site right now already sees the alert in the app; don't interrupt them.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.some((w) => w.visibilityState === 'visible' && w.focused)) return;

    // `renotify` is only legal together with a tag (otherwise showNotification throws a TypeError).
    const tag = typeof data.tag === 'string' && data.tag ? data.tag : undefined;
    await self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/icon.svg',
      tag,
      renotify: Boolean(tag),
      data: { url: safePath(data.url) },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin !== self.location.origin) continue;
      try {
        if ('navigate' in w) await w.navigate(target);
        await w.focus();
        return;
      } catch (e) { /* fall through to opening a new window */ }
    }
    await self.clients.openWindow(target);
  })());
});
