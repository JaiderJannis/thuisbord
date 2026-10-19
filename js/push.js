'use strict';
/* Echte meldingen van de browser (Notification API) voor dezelfde meldingen als op het display
   (apparaat klaar, auto, robots, afval, verbinding). Per apparaat in te schakelen via het menu.
   Beperking: dit werkt zolang de app open staat (ook op de achtergrond). Zonder open app komt er niets, want daar is een push-server voor nodig.
   Muziek wordt nooit als melding gestuurd. Op iPhone werkt het enkel als de app aan het beginscherm is toegevoegd. */

const PUSH_KEY = 'thuisbord_push';
const pushSeen = new Set();
let pushBaselined = false;
let pushHtmlCache = '';

function pushSupported() {
    return typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function';
}

function pushWanted() {
    try { return localStorage.getItem(PUSH_KEY) === 'on'; } catch (e) { return false; }
}

function pushActive() {
    return pushSupported() && pushWanted() && Notification.permission === 'granted';
}

function pushRegisterWorker() {
    try {
        if (typeof navigator !== 'undefined' && navigator.serviceWorker && /^(https:|http:\/\/localhost)/.test(String(location.href))) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
    } catch (e) { /* geen service worker: val terug op gewone meldingen */ }
}

async function pushShow(title, body, tag) {
    const options = { body, tag, icon: 'icon-192.png', badge: 'icon-192.png', renotify: false };
    try {
        if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg && reg.showNotification) { await reg.showNotification(title, options); return true; }
        }
    } catch (e) { /* probeer de gewone manier */ }
    try { new Notification(title, options); return true; } catch (e) { return false; }
}

// Aangeroepen met de zichtbare meldingen van het display; stuurt alleen echt nieuwe door.
function pushNotifyNew(visible) {
    const items = (visible || []).filter(i => i && i.level !== 'music' && !i.marquee);
    const keys = new Set(items.map(i => i.key));
    // meldingen die verdwenen zijn mogen later opnieuw een melding geven
    Array.from(pushSeen).forEach(k => { if (!keys.has(k)) pushSeen.delete(k); });
    const fresh = items.filter(i => !pushSeen.has(i.key));
    fresh.forEach(i => pushSeen.add(i.key));
    if (!pushBaselined) { pushBaselined = true; return []; } // bij het openen niet alles in één keer melden
    if (!pushActive() || !fresh.length) return [];
    const house = (appState && appState.householdName) ? ` · ${appState.householdName}` : '';
    fresh.forEach(i => pushShow(`Thuisbord${house}`, `${i.icon} ${i.text}`, i.key));
    return fresh;
}

window.togglePush = async function() {
    if (!pushSupported()) { showToast("Deze browser ondersteunt geen meldingen."); return; }
    if (pushWanted() && Notification.permission === 'granted') {
        try { localStorage.setItem(PUSH_KEY, 'off'); } catch (e) { /* negeren */ }
        renderPushSwitcher();
        return;
    }
    let perm = Notification.permission;
    if (perm === 'default') {
        try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; }
    }
    if (perm === 'granted') {
        try { localStorage.setItem(PUSH_KEY, 'on'); } catch (e) { /* negeren */ }
        pushRegisterWorker();
        pushShow('Thuisbord', '🔔 Meldingen staan aan op dit apparaat.', 'push_test');
    } else {
        showToast("Meldingen zijn geblokkeerd. Sta ze toe in de instellingen van je browser voor deze site.");
    }
    renderPushSwitcher();
};

function renderPushSwitcher() {
    const box = document.getElementById('pushSwitcher');
    if (!box) return;
    let label, sub, on = false, disabled = false;
    if (!pushSupported()) {
        label = 'Niet beschikbaar'; sub = 'Deze browser kan geen meldingen tonen. Op iPhone: voeg de app eerst toe aan het beginscherm.'; disabled = true;
    } else if (Notification.permission === 'denied') {
        label = 'Geblokkeerd'; sub = 'Sta meldingen toe in de browserinstellingen voor deze site.'; disabled = true;
    } else if (pushActive()) {
        label = 'Aan'; sub = 'Je krijgt een melding op dit apparaat zolang de app open staat.'; on = true;
    } else {
        label = 'Uit'; sub = 'Tik om meldingen op dit apparaat te ontvangen.';
    }
    const html = `
        <p class="text-[11px] font-bold uppercase tracking-wider text-[#a3b8ae] px-1 mb-2">Meldingen</p>
        <button type="button" ${disabled ? 'disabled' : 'onclick="togglePush()"'} aria-pressed="${on}"
            class="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl border border-white/10 text-left transition ${on ? 'bg-[#34d399]/15 text-white' : 'bg-white/5 text-white'} ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-white/10'}">
            <span class="min-w-0"><span class="block text-xs font-bold">🔔 Meldingen op dit apparaat</span><span class="block text-[10.5px] text-[#a3b8ae] leading-snug">${sub}</span></span>
            <span class="shrink-0 text-[11px] font-extrabold px-2.5 py-1 rounded-full ${on ? 'bg-[#34d399] text-[#0d2a1c]' : 'bg-white/15 text-white'}">${label}</span>
        </button>`;
    if (html === pushHtmlCache) return;
    pushHtmlCache = html;
    box.innerHTML = html;
}

try { if (pushActive()) pushRegisterWorker(); } catch (e) { /* negeren */ }
if (typeof document !== 'undefined') {
    document.addEventListener && document.addEventListener('DOMContentLoaded', renderPushSwitcher);
}
