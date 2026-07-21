self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

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
    icon: payload.icon || '/favicon.ico',
    image: payload.image,
    badge: payload.badge || '/favicon.ico',
    tag: payload.tag,
    data: {
      url: payload.url || '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification?.data?.url || '/', self.location.origin).href;

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
