// The site's service worker (registered by BaseLayout.astro). It caches
// nothing and handles no page requests: every page still comes from the
// network, so the installed app never shows a stale schedule. It makes the
// site installable, and shows push notifications (lib/push.ts sends them).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Only pages on this site open from a notification.
function sitePath(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

// Set by the pages (components/InstallApp.astro) on an Android phone with the
// site installed as an app: the phone already shows the app's logo beside the
// notification, so it isn't repeated as a picture. Elsewhere (Firefox, Edge, Samsung Internet, a tab
// with nothing installed) the browser's own icon takes that spot, so it is.
// The flag holds when a page last saw the app installed; it lapses after 30
// days without one (the app may have been removed since), and the logo is back.
const INSTALLED_FLAG = '/__dwb/installed-app';
const INSTALLED_FLAG_DAYS = 30;
function appInstalled() {
  return caches
    .match(INSTALLED_FLAG)
    .then((r) => (r ? r.text() : ''))
    .then((seen) => Number(seen) > Date.now() - INSTALLED_FLAG_DAYS * 864e5)
    .catch(() => false);
}

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    appInstalled()
      .then((installed) =>
        self.registration.showNotification(message.title || 'Dance with B', {
          body: message.body || '',
          ...(installed ? {} : { icon: '/icon-192.png' }),
          badge: '/notification-badge.png',
          tag: message.tag,
          data: { url: sitePath(message.url), id: message.id },
        })
      )
      .then(() => report('shown', message.id))
  );
});

// Tells the site a notification was shown or tapped: only the send's id, so it
// can count them (nothing about this device or person). A failed report is dropped.
function report(action, id) {
  if (typeof id !== 'string') return Promise.resolve();
  return fetch('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id }),
    keepalive: true,
  }).catch(() => {});
}

// Tapping it opens its page: the window already showing that page, if there
// is one, or a new one. A page the dancer has open (maybe half-way through a
// form) is never navigated away.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(sitePath(data.url), self.location.origin).href;
  const show = self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const already = windows.find((w) => w.url === target);
    if (already) return already.focus();
    return self.clients.openWindow(target);
  });
  event.waitUntil(Promise.all([show, report('opened', data.id)]));
});

function platform() {
  const ua = self.navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : 'other';
}

// The push service renewed this phone's address: tell the site the new one.
self.addEventListener('pushsubscriptionchange', (event) => {
  const options = event.oldSubscription && event.oldSubscription.options;
  if (!options) return;
  event.waitUntil(
    self.registration.pushManager.subscribe(options).then((subscription) =>
      fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', subscription: subscription.toJSON(), platform: platform() }),
      })
    )
  );
});
