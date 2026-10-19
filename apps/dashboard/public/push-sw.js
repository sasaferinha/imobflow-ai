/* Push-only worker: no fetch interception, cache, offline pages or customer content. */
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

async function bindingIsCurrent(bindingId, requireBusinessHours = false) {
  if (typeof bindingId !== 'string' || !bindingId || bindingId.length > 100) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(new URL('/api/notifications/push', self.location.origin).href, {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal, redirect: 'error',
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.configured === true && data.schedulerConfigured === true && Array.isArray(data.bindingIds) && data.bindingIds.includes(bindingId)
      && (!requireBusinessHours || data.businessHoursOpen === true && Number.isFinite(data.activeUntil) && Date.now() < data.activeUntil);
  } catch { return false; }
  finally { clearTimeout(timeout); }
}

self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || typeof payload.bindingId !== 'string' || !Number.isFinite(payload.expiresAt) || Date.now() >= payload.expiresAt) return;
  event.waitUntil((async () => {
    // Recheck after the network round-trip: stale delivery never crosses closing time.
    if (!await bindingIsCurrent(payload.bindingId, true) || Date.now() >= payload.expiresAt) return;
    // Payload title/body/url are intentionally ignored, including any customer text.
    await self.registration.showNotification('ImobFlow · aviso de atendimento', {
      body: 'Há atendimento aguardando conferência. Abra Conversas para verificar.',
      icon: '/brand/imobflow-mark-v1.png', badge: '/brand/imobflow-mark-v1.png',
      // Replace the previous reminder, but alert again on the server's next cadence.
      tag: 'imobflow-attendance', renotify: true, data: { bindingId: payload.bindingId },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    if (!await bindingIsCurrent(event.notification.data?.bindingId)) return;
    const target = new URL('/painel#conversations', self.location.origin);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const current = new URL(client.url);
      if (current.origin === target.origin && current.pathname === '/painel') { const navigated = await client.navigate(target.href); await (navigated || client).focus(); return; }
    }
    await self.clients.openWindow(target.href);
  })());
});
