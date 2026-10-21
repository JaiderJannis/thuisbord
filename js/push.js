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

/* ---------- Pushserver (meldingen ook als de app dicht is) ---------- */
function pushServerCfg() {
    const c = (typeof appState !== 'undefined' && appState && appState.pushServer) || {};
    const url = String(c.url || '').trim().replace(/\/+$/, '');
    return /^https:\/\//i.test(url) && c.key ? { url, key: String(c.key) } : null;
}
const pushB64 = (b) => { const p = '='.repeat((4 - b.length % 4) % 4), r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };
async function pushServerSubscribe() {
    const c = pushServerCfg();
    if (!c || !navigator.serviceWorker || typeof PushManager === 'undefined') return 'geen';
    try {
        await pushRegisterWorker();
        const reg = await navigator.serviceWorker.ready;
        const vap = await (await fetch(c.url + '/vapid')).json();
        let sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushB64(vap.publicKey) });
        const r = await fetch(c.url + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Key': c.key }, body: JSON.stringify({ subscription: sub.toJSON(), household: (appState && appState.householdName) || '' }) });
        if (r.ok) { try { localStorage.setItem('pushSrvLast', JSON.stringify({ url: c.url, key: c.key, household: (appState && appState.householdName) || '' })); } catch (e) { /* negeren */ } }
        return r.ok ? 'ok' : (r.status === 401 ? 'sleutel' : 'fout');
    } catch (e) { return 'fout'; }
}

// Dit toestel hoort bij één gezin tegelijk. Logt iemand van een ander gezin in (of heeft dat gezin een andere/geen pushserver),
// dan wordt het toestel afgemeld bij de vorige server, zodat het geen meldingen van een ander gezin blijft krijgen.
function pushReconcilePlan(saved, household, cfg) {
    if (!saved) return cfg ? 'subscribe' : 'none';
    const same = saved.household === household && cfg && cfg.url === saved.url;
    if (same) return 'none';
    return cfg ? 'switch' : 'unsub';
}
let pushReconKey = '';
async function pushServerReconcile() {
    try {
        const hh = (appState && appState.householdName) || '';
        if (!hh) return;
        const cfg = pushServerCfg(), key = hh + '|' + (cfg ? cfg.url : '');
        if (key === pushReconKey) return;
        pushReconKey = key;
        let saved = null; try { saved = JSON.parse(localStorage.getItem('pushSrvLast') || 'null'); } catch (e) { saved = null; }
        const plan = pushReconcilePlan(saved, hh, cfg);
        if (plan === 'unsub' || plan === 'switch') {
            try {
                const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
                const sub = reg && await reg.pushManager.getSubscription();
                if (sub && saved) await fetch(saved.url + '/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Key': saved.key }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
            } catch (e) { /* negeren */ }
            try { localStorage.removeItem('pushSrvLast'); } catch (e) { /* negeren */ }
        }
        if ((plan === 'switch' || plan === 'subscribe') && pushActive()) pushServerSubscribe();
    } catch (e) { /* negeren */ }
}
async function pushServerUnsubscribe() {
    const c = pushServerCfg();
    try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && await reg.pushManager.getSubscription();
        if (!sub) return;
        if (c) fetch(c.url + '/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Key': c.key }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe();
    } catch (e) { /* negeren */ }
}
window.pushSaveServer = function() {
    if (typeof currentRole !== 'undefined' && currentRole !== 'manager' && currentRole !== 'admin') return;
    const u = (document.getElementById('pushSrvUrl') || {}).value || '', k = (document.getElementById('pushSrvKey') || {}).value || '';
    appState.pushServer = { url: u.trim(), key: k.trim() };
    try { persistStateToFirestore(true); } catch (e) { /* negeren */ }
    pushHtmlCache = ''; renderPushSwitcher();
    showToast(pushServerCfg() ? 'Pushserver opgeslagen. Zet meldingen aan op elk toestel.' : 'Pushserver gewist (of onvolledig).');
};
window.pushServerTest = async function() {
    const c = pushServerCfg(); if (!c) { showToast('Vul eerst adres en sleutel in.'); return; }
    try {
        const r = await fetch(c.url + '/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Key': c.key }, body: JSON.stringify({ title: 'Thuisbord', body: '✅ Testmelding van je pushserver', tag: 'srv_test', household: (appState && appState.householdName) || '' }) });
        const j = await r.json();
        showToast(r.ok ? `Testmelding verstuurd naar ${j.sent} toestel(len).` : 'Server weigert: ' + (j.error || r.status));
    } catch (e) { showToast('Pushserver niet bereikbaar. Controleer het adres en of Tailscale Funnel/Serve aan staat.'); }
};

window.togglePush = async function() {
    if (!pushSupported()) { showToast("Deze browser ondersteunt geen meldingen."); return; }
    if (pushWanted() && Notification.permission === 'granted') {
        try { localStorage.setItem(PUSH_KEY, 'off'); } catch (e) { /* negeren */ }
        pushServerUnsubscribe();
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
        const srv = pushServerCfg() ? await pushServerSubscribe() : 'geen';
        if (srv === 'sleutel') showToast('Pushserver: sleutel klopt niet.');
        else if (srv === 'fout') showToast('Pushserver niet bereikbaar. Meldingen werken nu alleen zolang de app open staat.');
        pushShow('Thuisbord', srv === 'ok' ? '🔔 Meldingen staan aan, ook als de app dicht is.' : '🔔 Meldingen staan aan op dit apparaat.', 'push_test');
    } else {
        showToast("Meldingen zijn geblokkeerd. Sta ze toe in de instellingen van je browser voor deze site.");
    }
    renderPushSwitcher();
};

function renderPushSwitcher() {
    const box = document.getElementById('pushSwitcher');
    if (!box) return;
    pushServerReconcile();
    let label, sub, on = false, disabled = false;
    if (!pushSupported()) {
        label = 'Niet beschikbaar'; sub = 'Deze browser kan geen meldingen tonen. Op iPhone: voeg de app eerst toe aan het beginscherm.'; disabled = true;
    } else if (Notification.permission === 'denied') {
        label = 'Geblokkeerd'; sub = 'Sta meldingen toe in de browserinstellingen voor deze site.'; disabled = true;
    } else if (pushActive()) {
        label = 'Aan'; sub = pushServerCfg() ? 'Je krijgt meldingen op dit apparaat, ook als de app dicht is (pushserver).' : 'Je krijgt een melding op dit apparaat zolang de app open staat.'; on = true;
    } else {
        label = 'Uit'; sub = 'Tik om meldingen op dit apparaat te ontvangen.';
    }
    const mgr = typeof currentRole !== 'undefined' && (currentRole === 'manager' || currentRole === 'admin');
    const cfg = (appState && appState.pushServer) || {};
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const srvForm = mgr ? `
        <details class="mt-2 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5">
            <summary class="text-[11px] font-bold text-[#a3b8ae] cursor-pointer">Pushserver (meldingen met dichte app)</summary>
            <div class="space-y-2 mt-2">
                <input id="pushSrvUrl" type="url" placeholder="https://pushserver.jouw-tailnet.ts.net" value="${esc(cfg.url)}" class="w-full px-3 py-2 rounded-xl bg-white/10 text-white text-xs placeholder-white/40 border border-white/10">
                <input id="pushSrvKey" type="password" autocomplete="off" placeholder="SHARED_KEY uit je .env" value="${esc(cfg.key)}" class="w-full px-3 py-2 rounded-xl bg-white/10 text-white text-xs placeholder-white/40 border border-white/10">
                <div class="flex gap-2"><button type="button" onclick="pushSaveServer()" class="flex-1 py-2 rounded-xl bg-[#34d399] text-[#0d2a1c] text-xs font-extrabold cursor-pointer">Opslaan</button>
                <button type="button" onclick="pushServerTest()" class="flex-1 py-2 rounded-xl bg-white/15 text-white text-xs font-bold cursor-pointer">Testmelding</button></div>
                <label class="flex items-start gap-2 text-[11px] text-white/90 cursor-pointer"><input type="checkbox" ${appState && appState.pushRain === false ? '' : 'checked'} onchange="pushSetRain(this.checked)" class="mt-0.5"> <span>🌧️ Melding als er regen verwacht wordt op mijn locatie (ook met gesloten app)</span></label>
                <button type="button" onclick="pushRulesSend()" class="w-full py-2 rounded-xl bg-white/15 text-white text-xs font-bold cursor-pointer">📤 Meldingsregels maken en naar de server sturen</button>
                <p class="text-[10px] text-[#a3b8ae] leading-snug">Maakt uit je bord regels voor: toestel klaar (wasmachine, droger, vaatwasser), autoportier open, bandendruk en batterij laag, robot klaar of storing, stofbak vol, water leeg, afvalophaling en internetlimiet. Ook Home Assistant langer dan 5 minuten weg meldt de server zelf. Alleen wat bij Meldingen aanstaat. Wordt ook vanzelf ververst als je de app opent.</p>
            </div>
        </details>` : '';
    const html = `
        <p class="text-[11px] font-bold uppercase tracking-wider text-[#a3b8ae] px-1 mb-2">Meldingen</p>
        <button type="button" ${disabled ? 'disabled' : 'onclick="togglePush()"'} aria-pressed="${on}"
            class="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl border border-white/10 text-left transition ${on ? 'bg-[#34d399]/15 text-white' : 'bg-white/5 text-white'} ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-white/10'}">
            <span class="min-w-0"><span class="block text-xs font-bold">🔔 Meldingen op dit apparaat</span><span class="block text-[10.5px] text-[#a3b8ae] leading-snug">${sub}</span></span>
            <span class="shrink-0 text-[11px] font-extrabold px-2.5 py-1 rounded-full ${on ? 'bg-[#34d399] text-[#0d2a1c]' : 'bg-white/15 text-white'}">${label}</span>
        </button>${srvForm}`;
    if (html === pushHtmlCache) return;
    pushHtmlCache = html;
    box.innerHTML = html;
}

try { if (pushActive()) pushRegisterWorker(); } catch (e) { /* negeren */ }
if (typeof document !== 'undefined') {
    document.addEventListener && document.addEventListener('DOMContentLoaded', renderPushSwitcher);
}
