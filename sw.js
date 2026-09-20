self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Push payloads are created by more than one notification source.  Keep every
// BUYSELL-internal destination on the active site origin, including payloads
// from an older notification worker that used the misspelled "markerplace"
// hostname.  This preserves the route/query/hash while never allowing a stale
// absolute URL to send the user to the wrong site.
const BUYSELL_NOTIFICATION_HOSTS = new Set([
  'buysell-marketplace.com',
  'www.buysell-marketplace.com',
  'buysell-markerplace.com',
  'www.buysell-markerplace.com',
]);

function resolveNotificationUrl(rawUrl) {
  const fallback = new URL('/?view=shop', self.location.origin);
  try {
    const candidate = new URL(rawUrl || fallback.href, self.location.origin);
    if (candidate.origin === self.location.origin) return candidate.href;

    if (BUYSELL_NOTIFICATION_HOSTS.has(candidate.hostname.toLowerCase())) {
      return new URL(`${candidate.pathname}${candidate.search}${candidate.hash}`, self.location.origin).href;
    }
  } catch {
    // Use the marketplace fallback for malformed notification payloads.
  }
  return fallback.href;
}

self.addEventListener('push', (event) => {
  let payload = {
    source: 'buysell-web-push',
    title: 'BUYSELL Nigeria',
    body: 'You have a new marketplace update.',
    url: '/?view=shop',
  };

  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    payload.body = event.data ? event.data.text() : payload.body;
  }

  if (payload.source !== 'buysell-web-push') {
    return;
  }

  const title = payload.title || 'BUYSELL Nigeria';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/brand/png/buysell_icon_green.png',
    image: payload.image,
    badge: payload.badge || '/brand/png/buysell_icon_green.png',
    tag: payload.tag || `buysell-${Date.now()}`,
    renotify: payload.renotify !== false,
    requireInteraction: payload.requireInteraction === true,
    timestamp: payload.timestamp || Date.now(),
    vibrate: payload.vibrate || [120, 80, 120],
    data: {
      url: resolveNotificationUrl(payload.url),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = resolveNotificationUrl(event.notification?.data?.url);

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client && new URL(client.url).origin === new URL(targetUrl).origin) {
        await client.navigate(targetUrl);
        return client.focus();
      }
    }

    return clients.openWindow(targetUrl);
  })());
});
