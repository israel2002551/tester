const CACHE_NAME = 'buysell-shell-2026-09-21-pwa-1';
const APP_SHELL = [
  '/',
  '/?view=shop',
  '/manifest.webmanifest',
  '/brand/png/buysell_icon_green.png',
  '/brand/svg/buysell_icon_transparent.svg',
];

function isCacheable(response) {
  return Boolean(response && response.ok && response.type === 'basic');
}

function isStaticAsset(url) {
  if (url.pathname === '/app.js' || url.pathname === '/config.js' || url.pathname === '/sw.js') return false;
  return url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/brand/')
    || url.pathname.startsWith('/images/')
    || url.pathname === '/manifest.webmanifest'
    || /\.(?:css|js|mjs|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf)$/i.test(url.pathname);
}

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(APP_SHELL.map(async (url) => {
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (isCacheable(response)) await cache.put(url, response.clone());
    } catch (_) {
      // A partially cached shell is still useful, especially while deploying.
    }
  }));
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch (_) {
    return (await caches.match(request))
      || (await caches.match('/?view=shop'))
      || (await caches.match('/'))
      || new Response('<!doctype html><title>BUYSELL Nigeria</title><main><h1>You are offline</h1><p>Please reconnect and try again.</p></main>', {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const refresh = fetch(request).then(async (response) => {
    if (isCacheable(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  if (cached) return cached;
  return (await refresh) || new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name.startsWith('buysell-shell-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (isStaticAsset(url)) event.respondWith(staleWhileRevalidate(request));
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
