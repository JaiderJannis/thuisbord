'use strict';
/* Gastmodus: een schermvullend, beperkt scherm voor visite of oppas (wifi met QR-code, een paar lampen en scènes,
   huisregels, noodnummers). Instellen op de pagina "Gastmodus"; starten met één knop; afsluiten met een pincode.
   Let op: dit is een weergave-vergrendeling op dit toestel, geen beveiliging van het account.
   appState.guest = { welcome, wifiName, wifiPass, wifiSecurity, rules[], contact, lights[ids], scenes[ids], pin } */

const GUEST_FLAG = 'thuisbord_guest';
let guestEdit = false;
let guestAskingExit = false;
let guestPinError = '';
let guestOverlayCache = '';
let guestSetupCache = '';
let guestClockTimer = null;

function ensureGuest() {
    const g = (appState.guest && typeof appState.guest === 'object') ? appState.guest : (appState.guest = {});
    if (typeof g.welcome !== 'string') g.welcome = 'Welkom! Maak het je gemakkelijk.';
    if (typeof g.wifiName !== 'string') g.wifiName = '';
    if (typeof g.wifiPass !== 'string') g.wifiPass = '';
    if (!['WPA', 'nopass'].includes(g.wifiSecurity)) g.wifiSecurity = 'WPA';
    if (!Array.isArray(g.rules)) g.rules = [];
    if (typeof g.contact !== 'string') g.contact = '';
    if (!Array.isArray(g.lights)) g.lights = [];
    if (!Array.isArray(g.scenes)) g.scenes = [];
    if (typeof g.pin !== 'string') g.pin = '';
    return g;
}
const gEsc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function guestSave(now) { try { persistStateToFirestore(!!now); } catch (e) { /* negeren */ } }
function guestIsActive() { try { return localStorage.getItem(GUEST_FLAG) === '1'; } catch (e) { return false; } }
function guestSetActive(on) { try { if (on) localStorage.setItem(GUEST_FLAG, '1'); else localStorage.removeItem(GUEST_FLAG); } catch (e) { /* negeren */ } }

// Tekst voor de wifi-QR-code (formaat dat telefoons herkennen). Tekens \ ; , : " worden geëscaped.
function guestWifiString(g) {
    const esc = (v) => String(v).replace(/([\;,:"])/g, '\\$1');
    if (!g || !g.wifiName) return '';
    return g.wifiSecurity === 'nopass' || !g.wifiPass ? `WIFI:T:nopass;S:${esc(g.wifiName)};;` : `WIFI:T:WPA;S:${esc(g.wifiName)};P:${esc(g.wifiPass)};;`;
}
function guestQrSvg(text) {
    if (!text || typeof qrcode !== 'function') return '';
    try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch (e) { return ''; }
}

/* ---------- het gastenscherm ---------- */
function guestLightList() {
    const g = ensureGuest();
    return (appState.roomLights || []).map((lt, i) => ({ lt, i })).filter(x => g.lights.includes(x.lt.id));
}
function guestSceneList() {
    const g = ensureGuest();
    return (appState.scenes || []).filter(s => g.scenes.includes(s.id));
}

function renderGuestOverlay() {
    const box = document.getElementById('guestOverlay');
    if (!box) return;
    const active = !!currentRole && guestIsActive();
    if (!active) {
        if (!box.classList.contains('hidden')) { box.classList.add('hidden'); box.classList.remove('flex'); }
        guestOverlayCache = ''; guestAskingExit = false;
        if (guestClockTimer) { clearInterval(guestClockTimer); guestClockTimer = null; }
        return;
    }
    box.classList.remove('hidden'); box.classList.add('flex');
    if (!guestClockTimer) guestClockTimer = setInterval(() => renderGuestOverlay(), 20000);
    const ae = document.activeElement;
    if (ae && box.contains && box.contains(ae) && ae.tagName === 'INPUT') return;

    const g = ensureGuest();
    const now = new Date();
    const time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const date = new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
    const wifi = guestWifiString(g), qr = guestQrSvg(wifi);
    const lights = guestLightList(), scenes = guestSceneList();
    const house = (appState && appState.householdName) || '';

    const wifiCard = g.wifiName ? `
        <section class="guest-card">
            <h3 class="guest-h">📶 Wifi</h3>
            <div class="flex flex-wrap items-center gap-5">
                ${qr ? `<div class="bg-white rounded-2xl p-2.5 w-40 h-40 shrink-0">${qr}</div>` : ''}
                <div class="min-w-0">
                    <p class="text-[11px] uppercase tracking-wider text-[#a3b8ae] font-bold">Netwerk</p>
                    <p class="text-2xl font-extrabold break-all">${gEsc(g.wifiName)}</p>
                    ${g.wifiSecurity === 'nopass' || !g.wifiPass ? '<p class="text-sm text-[#a3b8ae] mt-2">Geen wachtwoord nodig</p>' : `
                    <p class="text-[11px] uppercase tracking-wider text-[#a3b8ae] font-bold mt-3">Wachtwoord</p>
                    <p class="text-2xl font-extrabold font-mono break-all">${gEsc(g.wifiPass)}</p>`}
                    ${qr ? '<p class="text-xs text-[#a3b8ae] mt-3">Scan de code met je camera om te verbinden.</p>' : ''}
                </div>
            </div>
        </section>` : '';
    const lightsCard = (lights.length || scenes.length) ? `
        <section class="guest-card">
            <h3 class="guest-h">💡 Licht & sfeer</h3>
            ${scenes.length ? `<div class="flex flex-wrap gap-2 mb-3">${scenes.map(s => `<button type="button" onclick="window.runScene('${escJsAttr(s.id)}')" class="px-4 py-2.5 rounded-2xl bg-white/15 hover:bg-white/25 font-bold text-sm cursor-pointer">${gEsc(s.icon || '🎬')} ${gEsc(s.name || 'Scène')}</button>`).join('')}</div>` : ''}
            ${lights.length ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${lights.map(({ lt, i }) => `
                <button type="button" onclick="window.toggleSingleRoomLight(${i})" aria-pressed="${lt.state === 'on'}" class="rounded-2xl px-3.5 py-3 text-left cursor-pointer transition ${lt.state === 'on' ? 'bg-[#fbbf24] text-[#3d2a00]' : 'bg-white/10 hover:bg-white/20 text-white'}">
                    <span class="block text-lg leading-none">💡</span><span class="block text-sm font-extrabold mt-1">${gEsc(lt.name || 'Lamp')}</span><span class="block text-[11px] opacity-80">${gEsc(lt.room || '')} · ${lt.state === 'on' ? 'aan' : 'uit'}</span>
                </button>`).join('')}</div>` : ''}
        </section>` : '';
    const rulesCard = g.rules.filter(r => String(r).trim()).length ? `
        <section class="guest-card">
            <h3 class="guest-h">📋 Goed om te weten</h3>
            <ul class="space-y-1.5 text-[15px]">${g.rules.filter(r => String(r).trim()).map(r => `<li class="flex gap-2"><span class="text-[#34d399]">•</span><span>${gEsc(r)}</span></li>`).join('')}</ul>
        </section>` : '';
    const contactCard = String(g.contact).trim() ? `
        <section class="guest-card">
            <h3 class="guest-h">☎️ Contact & noodnummers</h3>
            <p class="text-[15px] whitespace-pre-line">${gEsc(g.contact)}</p>
        </section>` : '';

    const exitBlock = guestAskingExit && g.pin ? `
        <div class="flex items-center gap-2">
            <input id="guestPinInput" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="Pincode" onkeydown="if(event.key==='Enter')window.guestTryExit()" class="w-32 px-3 py-2 rounded-xl bg-white/10 text-white placeholder-white/40 border border-white/20 text-sm">
            <button type="button" onclick="window.guestTryExit()" class="px-4 py-2 rounded-xl bg-[#34d399] text-[#0d2a1c] font-extrabold text-sm cursor-pointer">OK</button>
            <button type="button" onclick="window.guestCancelExit()" class="px-3 py-2 rounded-xl bg-white/10 text-sm cursor-pointer">Annuleer</button>
            ${guestPinError ? `<span class="text-xs text-red-300 font-bold">${gEsc(guestPinError)}</span>` : ''}
        </div>` : `<button type="button" onclick="window.guestAskExit()" class="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-bold cursor-pointer">🔒 Gastmodus verlaten</button>`;

    const html = `
        <div class="w-full max-w-5xl mx-auto px-5 py-6 sm:py-9 space-y-5">
            <header class="flex flex-wrap items-end justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-sm text-[#a3b8ae] font-bold">${gEsc(house)}</p>
                    <h1 class="text-3xl sm:text-4xl font-extrabold leading-tight">${gEsc(g.welcome)}</h1>
                </div>
                <div class="text-right"><p class="text-4xl font-extrabold tabular-nums">${time}</p><p class="text-sm text-[#a3b8ae] capitalize">${gEsc(date)}</p></div>
            </header>
            <div class="grid gap-5 md:grid-cols-2">${wifiCard}${lightsCard}${rulesCard}${contactCard}</div>
            ${(wifiCard || lightsCard || rulesCard || contactCard) ? '' : '<p class="text-[#a3b8ae]">De beheerder heeft hier nog niets ingesteld.</p>'}
            <footer class="pt-2 flex justify-end">${exitBlock}</footer>
        </div>`;
    if (html === guestOverlayCache) return;
    guestOverlayCache = html;
    box.innerHTML = html;
    if (guestAskingExit && g.pin) { const pi = document.getElementById('guestPinInput'); if (pi && pi.focus) pi.focus(); }
}

window.guestStart = function() {
    if (!permGuard('view_guest')) return;
    guestSetActive(true); guestAskingExit = false; guestPinError = ''; guestOverlayCache = '';
    renderGuestOverlay();
};
window.guestAskExit = function() {
    const g = ensureGuest();
    if (!g.pin) { window.guestExit(); return; }
    guestAskingExit = true; guestPinError = ''; guestOverlayCache = ''; renderGuestOverlay();
};
window.guestCancelExit = function() { guestAskingExit = false; guestPinError = ''; guestOverlayCache = ''; renderGuestOverlay(); };
window.guestTryExit = function() {
    const g = ensureGuest();
    const v = (document.getElementById('guestPinInput') || {}).value || '';
    if (!g.pin || String(v) === g.pin) { window.guestExit(); return; }
    guestPinError = 'Onjuiste pincode'; guestOverlayCache = ''; renderGuestOverlay();
};
window.guestExit = function() {
    guestSetActive(false); guestAskingExit = false; guestPinError = ''; guestOverlayCache = '';
    renderGuestOverlay();
    if (typeof switchView === 'function') switchView('display');
};

/* ---------- instelpagina ---------- */
function guestCanEdit() { return typeof permAllowed === 'function' && permAllowed('edit_guest'); }

function renderGuestView() {
    const container = document.getElementById('guestContainer');
    const view = document.getElementById('viewGuest');
    if (!container || (view && view.classList.contains('hidden'))) return;
    const ae = document.activeElement;
    if (ae && container.contains && container.contains(ae) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return;
    const g = ensureGuest();
    const editable = guestCanEdit();
    const start = `
        <div class="bg-white rounded-[26px] p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div class="max-w-xl"><h3 class="text-lg font-extrabold text-[#1c2520]">Gastmodus starten</h3>
            <p class="text-sm text-[#68736d]">Het scherm toont alleen wifi, een paar lampen en scènes, de huisregels en contactgegevens. ${g.pin ? 'Afsluiten kan alleen met de pincode.' : 'Tip: stel een pincode in zodat gasten het scherm niet kunnen afsluiten.'}</p></div>
            <button type="button" onclick="window.guestStart()" class="px-6 py-3 rounded-2xl bg-[#152920] hover:bg-[#233f31] text-white font-extrabold cursor-pointer">▶ Start gastmodus</button>
        </div>`;
    if (!editable) { const h = start; if (h !== guestSetupCache) { guestSetupCache = h; container.innerHTML = h; } return; }

    const inp = 'w-full px-3 py-2 rounded-xl border border-stone-200 text-sm';
    const lights = (appState.roomLights || []);
    const scenes = (appState.scenes || []);
    const html = start + `
        <div class="bg-white rounded-[26px] p-6 shadow-sm space-y-5">
            <h3 class="text-lg font-extrabold text-[#1c2520]">Instellen voor gasten</h3>
            <label class="block"><span class="text-xs font-bold text-[#68736d]">Welkomstzin</span>
                <input type="text" value="${gEsc(g.welcome)}" maxlength="80" onchange="window.guestSet('welcome',this.value)" class="${inp}"></label>
            <div class="grid gap-3 sm:grid-cols-3">
                <label class="block"><span class="text-xs font-bold text-[#68736d]">Wifi-naam</span><input type="text" value="${gEsc(g.wifiName)}" maxlength="40" onchange="window.guestSet('wifiName',this.value)" class="${inp}"></label>
                <label class="block"><span class="text-xs font-bold text-[#68736d]">Wifi-wachtwoord</span><input type="text" value="${gEsc(g.wifiPass)}" maxlength="64" onchange="window.guestSet('wifiPass',this.value)" class="${inp}"></label>
                <label class="block"><span class="text-xs font-bold text-[#68736d]">Beveiliging</span><select onchange="window.guestSet('wifiSecurity',this.value)" class="${inp}"><option value="WPA" ${g.wifiSecurity === 'WPA' ? 'selected' : ''}>Met wachtwoord</option><option value="nopass" ${g.wifiSecurity === 'nopass' ? 'selected' : ''}>Zonder wachtwoord</option></select></label>
            </div>
            <div>
                <p class="text-xs font-bold text-[#68736d] mb-2">Huisregels en tips (één per regel)</p>
                <textarea rows="4" onchange="window.guestSetRules(this.value)" placeholder="Schoenen uit bij de voordeur&#10;Rookvrij huis" class="${inp}">${gEsc(g.rules.join('\n'))}</textarea>
            </div>
            <label class="block"><span class="text-xs font-bold text-[#68736d]">Contact en noodnummers</span>
                <textarea rows="3" onchange="window.guestSet('contact',this.value)" placeholder="Mama: 0470 00 00 00&#10;Noodgevallen: 112" class="${inp}">${gEsc(g.contact)}</textarea></label>
            <div>
                <p class="text-xs font-bold text-[#68736d] mb-2">Lampen die gasten mogen bedienen</p>
                ${lights.length ? `<div class="flex flex-wrap gap-2">${lights.map(lt => `<label class="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f6f8f5] border border-stone-200 text-sm cursor-pointer"><input type="checkbox" ${g.lights.includes(lt.id) ? 'checked' : ''} onchange="window.guestToggleList('lights','${escJsAttr(lt.id)}',this.checked)" class="accent-[#152920]"> ${gEsc(lt.name || 'Lamp')} <span class="text-[11px] text-[#68736d]">${gEsc(lt.room || '')}</span></label>`).join('')}</div>` : '<p class="text-xs text-[#68736d] italic">Nog geen lampen ingesteld.</p>'}
            </div>
            <div>
                <p class="text-xs font-bold text-[#68736d] mb-2">Scènes die gasten mogen starten</p>
                ${scenes.length ? `<div class="flex flex-wrap gap-2">${scenes.map(s => `<label class="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f6f8f5] border border-stone-200 text-sm cursor-pointer"><input type="checkbox" ${g.scenes.includes(s.id) ? 'checked' : ''} onchange="window.guestToggleList('scenes','${escJsAttr(s.id)}',this.checked)" class="accent-[#152920]"> ${gEsc(s.icon || '🎬')} ${gEsc(s.name || 'Scène')}</label>`).join('')}</div>` : '<p class="text-xs text-[#68736d] italic">Nog geen scènes gemaakt.</p>'}
            </div>
            <label class="block max-w-xs"><span class="text-xs font-bold text-[#68736d]">Pincode om af te sluiten (4 tot 8 cijfers, leeg = geen)</span>
                <input type="text" inputmode="numeric" maxlength="8" value="${gEsc(g.pin)}" onchange="window.guestSetPin(this.value)" class="${inp}"></label>
            <p class="text-[11px] text-[#8a958f]">De pincode vergrendelt alleen het scherm op dit toestel. Wie ingelogd is, blijft ingelogd; gebruik dit dus op een bord of tablet, niet als beveiliging.</p>
        </div>`;
    if (html === guestSetupCache) return;
    guestSetupCache = html;
    container.innerHTML = html;
}

const guestRerender = () => { guestSetupCache = ''; guestOverlayCache = ''; renderGuestView(); renderGuestOverlay(); guestSave(false); };
window.guestSet = function(k, v) {
    if (!permGuard('edit_guest')) return;
    const g = ensureGuest();
    if (!['welcome', 'wifiName', 'wifiPass', 'wifiSecurity', 'contact'].includes(k)) return;
    g[k] = String(v).slice(0, k === 'contact' ? 400 : 120).trim();
    if (k === 'welcome' && !g.welcome) g.welcome = 'Welkom!';
    if (k === 'wifiSecurity' && !['WPA', 'nopass'].includes(g.wifiSecurity)) g.wifiSecurity = 'WPA';
    guestRerender();
};
window.guestSetRules = function(v) {
    if (!permGuard('edit_guest')) return;
    ensureGuest().rules = String(v).split(/\r?\n/).map(s => s.trim().slice(0, 140)).filter(Boolean).slice(0, 12);
    guestRerender();
};
window.guestToggleList = function(listKey, id, on) {
    if (!permGuard('edit_guest') || !['lights', 'scenes'].includes(listKey)) return;
    const g = ensureGuest(); const l = g[listKey].filter(x => x !== id);
    if (on) l.push(id);
    g[listKey] = l; guestRerender();
};
window.guestSetPin = function(v) {
    if (!permGuard('edit_guest')) return;
    const p = String(v).trim();
    if (p && !/^\d{4,8}$/.test(p)) { showToast('Een pincode bestaat uit 4 tot 8 cijfers.'); guestRerender(); return; }
    ensureGuest().pin = p; guestRerender();
};

function guestSetupReset() { guestSetupCache = ''; }
