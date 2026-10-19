/* Minimale service worker: nodig zodat meldingen ook op telefoon (Android/iOS-app op het beginscherm) getoond kunnen worden.
   Er wordt niets gecachet; de app blijft altijd live. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', e => {
    e.notification.close();
    e.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (all.length) { try { await all[0].focus(); return; } catch (err) { /* val terug op openen */ } }
        await self.clients.openWindow('./');
    })());
});
