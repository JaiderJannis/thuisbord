'use strict';
/* Meldingen op het wanddisplay. Alles wordt telkens opnieuw berekend uit de live gegevens (niets wordt opgeslagen),
   behalve "apparaat is klaar": die houdt in het geheugen bij wanneer een apparaat stopte en blijft 90 min zichtbaar.
   Instellingen per gezin: appState.notifSettings = { appliances, cars, robots, waste, connection } (true/false). */

const NOTIF_CATEGORIES = [
    { key: 'appliances', label: '🧺 Apparaat is klaar', hint: 'Wasmachine, droger, vaatwasser… (enkel apparaten met een gekoppelde entiteit)' },
    { key: 'cars',       label: '🚗 Auto',              hint: 'Portier open, lage bandendruk, batterij bijna leeg' },
    { key: 'robots',     label: '🤖 Robots',            hint: 'Storing, stofbak vol, onderhoud bijna nodig' },
    { key: 'robotsActive', label: '🤖 Robot is bezig',  hint: 'Toont zolang een robotmaaier of -stofzuiger aan het werk is (verdwijnt vanzelf)' },
    { key: 'climate',    label: '❄️ Airco aan',         hint: 'Toont zolang een airco aan staat, met de stand en gewenste temperatuur' },
    { key: 'waste',      label: '♻️ Afvalophaling',     hint: 'Vandaag of morgen is er ophaling' },
    { key: 'music',      label: '🎵 Muziek',            hint: 'Toont wat er nu speelt, als rollende tekst (Music Assistant)' },
    { key: 'connection', label: '📡 Verbinding',        hint: 'Geen live verbinding met Home Assistant' }
];
const NOTIF_DONE_VISIBLE_MS = 90 * 60 * 1000;
const NOTIF_MIN_RUN_MS = 5 * 60 * 1000;
const NOTIF_TIRE_WARN_BAR = 1.9;
const NOTIF_CAR_BATTERY_WARN = 20;
const NOTIF_PAGE_LOADED_MS = Date.now();

const notifRunning = new Map();      // apparaat-id -> starttijd (ms) terwijl het draait
let notifDoneEvents = [];            // { key, icon, text, until }
const notifDismissed = new Set();    // sleutels die de gebruiker wegklikte (tot de situatie verdwijnt)
let notifSettingsHtmlCache = '';
let notifBarHtmlCache = '';

// Standaard niet weg te klikken: zaken die je niet mag missen. Per gezin aan te passen (notifSettings.sticky).
const NOTIF_STICKY_DEFAULT = { connection: true, cars: true, robotsActive: true, climate: true };
function notifCatOf(key) {
    const k = String(key || '');
    if (k.startsWith('done_')) return 'appliances';
    if (k.startsWith('car_')) return 'cars';
    if (k.startsWith('robact_')) return 'robotsActive';
    if (k.startsWith('clim_')) return 'climate';
    if (k.startsWith('rob_')) return 'robots';
    if (k.startsWith('waste_')) return 'waste';
    if (k.startsWith('music_')) return 'music';
    if (k === 'ha_offline') return 'connection';
    return '';
}
function notifSticky(cat) {
    const s = (appState && appState.notifSettings && appState.notifSettings.sticky) || {};
    return cat in s ? !!s[cat] : !!NOTIF_STICKY_DEFAULT[cat];
}
// Waarheen een melding je brengt als je erop tikt: { view, filter?, tab? } of null als er niets te openen valt
function notifTarget(key) {
    const cat = notifCatOf(key);
    const t = { cars: { view: 'cars' }, robots: { view: 'robots' }, robotsActive: { view: 'robots' },
        climate: { view: 'shutters', filter: 'climate' }, music: { view: 'music' }, waste: { view: 'calendar' },
        connection: { view: 'admin', tab: 'ha_entiteiten' } }[cat];
    if (!t) return null;
    if (typeof permViewAllowed === 'function' && currentRole && !permViewAllowed(t.view)) return null;
    if (t.view === 'admin' && typeof permAdminTabAllowed === 'function' && !permAdminTabAllowed(t.tab)) return null;
    return t;
}
window.notificationGo = function(key) {
    const t = notifTarget(key);
    if (!t) return;
    switchView(t.view);
    if (t.filter && typeof window.setRoomsFilter === 'function') window.setRoomsFilter(t.filter);
    if (t.tab && typeof switchAdminTab === 'function') switchAdminTab(t.tab);
};

function notifEnabled(cat) {
    const s = (appState && appState.notifSettings) || {};
    return s[cat] !== false;
}

function notifTrackAppliances(now) {
    (appState.appliances || []).forEach(app => {
        if (!app.entityId) return; // zonder echte meting geen betrouwbare "klaar"-melding
        const running = !!app.active && Number(app.watts) > 0;
        const since = notifRunning.get(app.id);
        if (running && since === undefined) {
            notifRunning.set(app.id, now);
        } else if (!running && since !== undefined) {
            notifRunning.delete(app.id);
            if (now - since >= NOTIF_MIN_RUN_MS) {
                const key = `done_${app.id}`;
                notifDismissed.delete(key);
                notifDoneEvents = notifDoneEvents.filter(e => e.key !== key);
                notifDoneEvents.push({ key, icon: app.icon || '🔌', text: `${app.name} is klaar`, until: now + NOTIF_DONE_VISIBLE_MS });
            }
        }
    });
    notifDoneEvents = notifDoneEvents.filter(e => e.until > now);
}

function notifCarItems(map) {
    const out = [];
    if (typeof carDoorStates !== 'function') return out;
    const doorNames = { df: 'bestuurder voor', pf: 'passagier voor', dr: 'bestuurder achter', pr: 'passagier achter' };
    (appState.cars || []).forEach(car => {
        const e = car.entities || {};
        const name = car.name || 'Auto';
        const open = ['df', 'pf', 'dr', 'pr'].filter(p => e['door_open_' + p] && carDoorStates(car, map, p).open === true);
        if (open.length) out.push({ key: `car_${car.id}_door`, icon: '🚪', level: 'warn', text: `${name}: portier open (${open.map(p => doorNames[p]).join(', ')})` });

        const low = ['df', 'pf', 'dr', 'pr'].map(p => ({ p, bar: e['tp_' + p] ? carTirePressure(haStateObj(map, e['tp_' + p])) : null }))
            .filter(x => x.bar !== null && x.bar < NOTIF_TIRE_WARN_BAR);
        if (low.length) out.push({ key: `car_${car.id}_tire`, icon: '🛞', level: 'bad',
            text: `${name}: bandendruk laag (${low.map(x => `${doorNames[x.p]} ${x.bar.toLocaleString('nl-BE', { maximumFractionDigits: 1 })} bar`).join(', ')})` });

        if (e.battery) {
            const pct = haNumber(haStateObj(map, e.battery));
            const charge = typeof carChargeInfo === 'function' ? carChargeInfo(haStateObj(map, e.charge_status), haStateObj(map, e.status)) : { charging: false };
            if (pct !== null && pct < NOTIF_CAR_BATTERY_WARN && !charge.charging) {
                out.push({ key: `car_${car.id}_battery`, icon: '🔋', level: 'warn', text: `${name}: batterij ${Math.round(pct)}%, niet aan het laden` });
            }
        }
    });
    return out;
}

function notifRobotItems(map) {
    const out = [];
    (appState.robots || []).forEach(rob => {
        const name = rob.name || 'Robot';
        if (String(rob.state || '').toLowerCase() === 'error') {
            out.push({ key: `rob_${rob.id}_error`, icon: '🤖', level: 'bad', text: `${name}: storing, controleer de robot` });
        }
        (rob.extras || []).forEach(ex => {
            const st = haStateObj(map, ex.entityId);
            if (!haIsUsable(st)) return;
            const fv = haFriendlyValue(st, ex.label);
            const label = String(ex.label || '');
            const isBin = /stofbak|\bbin\b|dust|vuil|container|afval/i.test(label);
            const isWater = /water|tank|reservoir/i.test(label);
            const pct = (fv.kind === 'number' && fv.unit === '%') ? fv.value : null;
            if (isBin && ((pct !== null && pct >= 90) || fv.kind === 'warn' || fv.kind === 'bad')) {
                out.push({ key: `rob_${rob.id}_${ex.id}`, icon: ex.icon || '🗑️', level: 'warn', text: `${name}: ${label.toLowerCase()} is vol` });
            } else if (isWater && pct !== null && pct <= 10) {
                out.push({ key: `rob_${rob.id}_${ex.id}`, icon: ex.icon || '💧', level: 'warn', text: `${name}: ${label.toLowerCase()} bijna leeg` });
            }
        });
        (rob.tasks || []).forEach(t => {
            if (Number(t.maxHours) > 0 && Number(t.usedHours) / Number(t.maxHours) >= 0.9) {
                out.push({ key: `rob_${rob.id}_task_${t.id}`, icon: '🛠️', level: 'info', text: `${name}: ${String(t.name || 'onderhoud').toLowerCase()} bijna aan de beurt` });
            }
        });
    });
    return out;
}

function notifWasteItems() {
    const out = [];
    (appState.liveWasteItems || []).forEach(item => {
        const d = Number(item.daysUntil);
        if (item.daysUntil === null || item.daysUntil === undefined || isNaN(d)) return;
        const label = item.short || item.label || 'Afval';
        if (d === 0) out.push({ key: `waste_${label}_0`, icon: '♻️', level: 'warn', text: `Vandaag wordt ${label} opgehaald` });
        else if (d === 1) out.push({ key: `waste_${label}_1`, icon: '♻️', level: 'info', text: `Morgen wordt ${label} opgehaald: buiten zetten` });
    });
    return out;
}

// Robot die nu aan het werk is: verdwijnt vanzelf zodra hij stopt
function notifRobotActiveItems() {
    const out = [];
    const txt = { cleaning: 'is aan het schoonmaken', mowing: 'is aan het maaien', returning: 'keert terug naar het dock' };
    (appState.robots || []).forEach(rob => {
        const st = String(rob.state || '').toLowerCase();
        if (!txt[st]) return;
        out.push({ key: `robact_${rob.id}`, icon: rob.icon || '🤖', level: 'info', text: `${rob.name || 'Robot'} ${txt[st]}` });
    });
    return out;
}

// Airco die aan staat (stand niet "uit")
function notifClimateItems() {
    const out = [];
    const label = { cool: 'koelen', heat: 'verwarmen', heat_cool: 'automatisch', auto: 'automatisch', dry: 'drogen', fan_only: 'ventilator' };
    (appState.climates || []).forEach((cl, i) => {
        const mode = String(cl.hvacMode || 'off').toLowerCase();
        if (mode === 'off' || mode === 'unavailable') return;
        const t = Number(cl.targetTemp);
        const temp = isFinite(t) && cl.targetTemp !== undefined && cl.targetTemp !== null && cl.targetTemp !== '' ? ` op ${t.toLocaleString('nl-BE', { maximumFractionDigits: 1 })}°` : '';
        out.push({ key: `clim_${cl.id || i}`, icon: '❄️', level: 'info', text: `${cl.name || 'Airco'}: ${label[mode] || mode}${temp}` });
    });
    return out;
}

function notifMusicItems(map) {
    const out = [];
    if (typeof musicPlayersToShow !== 'function') return out;
    if (typeof permAllowed === 'function' && currentRole && !permAllowed('view_music')) return out;
    musicPlayersToShow().players.forEach(pl => {
        const st = haStateObj(map, pl.entityId);
        if (!st || String(st.state).toLowerCase() !== 'playing') return;
        const a = st.attributes || {};
        const title = String(a.media_title || '').trim();
        if (!title) return;
        const artist = String(a.media_artist || '').trim();
        out.push({ key: `music_${pl.entityId}_${title}`, icon: '🎵', level: 'music', marquee: true,
            text: `${pl.name || 'Speler'}: ${title}${artist ? ' · ' + artist : ''}` });
    });
    return out;
}

function computeNotifications(now = Date.now()) {
    const items = [];
    const map = haStatesMap();
    if (notifEnabled('appliances')) {
        notifTrackAppliances(now);
        notifDoneEvents.forEach(e => items.push({ key: e.key, icon: e.icon, level: 'info', text: e.text }));
    }
    if (notifEnabled('cars')) items.push(...notifCarItems(map));
    if (notifEnabled('robots')) items.push(...notifRobotItems(map));
    if (notifEnabled('robotsActive')) items.push(...notifRobotActiveItems());
    if (notifEnabled('climate')) items.push(...notifClimateItems());
    if (notifEnabled('waste')) items.push(...notifWasteItems());
    if (notifEnabled('music')) items.push(...notifMusicItems(map));
    if (notifEnabled('connection') && appState.haUrl && appState.haToken && !haWsConnected && now - NOTIF_PAGE_LOADED_MS > 20000) {
        items.push({ key: 'ha_offline', icon: '📡', level: 'bad', text: 'Geen live verbinding met Home Assistant' });
    }
    // weggeklikte meldingen die niet meer van toepassing zijn weer "vrijgeven"
    const activeKeys = new Set(items.map(i => i.key));
    Array.from(notifDismissed).forEach(k => { if (!activeKeys.has(k)) notifDismissed.delete(k); });
    const rank = { bad: 0, warn: 1, info: 2, music: 3 };
    return items.sort((a, b) => rank[a.level] - rank[b.level]);
}

function renderNotifications() {
    const bar = document.getElementById('notificationsBar');
    if (!bar) return;
    const visible = computeNotifications().filter(i => !notifDismissed.has(i.key));
    if (typeof pushNotifyNew === 'function') pushNotifyNew(visible);
    if (typeof renderPushSwitcher === 'function') renderPushSwitcher();
    if (!visible.length) {
        bar.classList.add('hidden');
        bar.classList.remove('flex');
        if (notifBarHtmlCache !== '') { bar.innerHTML = ''; notifBarHtmlCache = ''; }
        renderNotifSettings();
        return;
    }
    const style = {
        bad:  'bg-red-50 border-red-200 text-red-800',
        warn: 'bg-amber-50 border-amber-200 text-amber-900',
        info: 'bg-[#eef6f1] border-[#cfe5d8] text-[#1c643f]',
        music: 'bg-[#f1eefb] border-[#d9d0f0] text-[#4b3a85]'
    };
    const html = visible.map(i => {
        const close = notifSticky(notifCatOf(i.key)) ? '<span class="w-1.5 shrink-0"></span>' : `<button onclick="window.dismissNotification('${haEscape(i.key).replace(/'/g, '&#39;')}')" aria-label="Melding sluiten" class="w-5 h-5 rounded-full hover:bg-black/10 cursor-pointer leading-none shrink-0">✕</button>`;
        if (i.marquee) {
            // Rollende tekst naar links; de tekst staat twee keer achter elkaar voor een naadloze lus
            const secs = Math.max(10, Math.round(i.text.length * 0.32));
            const t = `<span class="notif-marquee-item">${haEscape(i.text)}</span>`;
            const go = notifTarget(i.key);
            const ga = go ? ` onclick="window.notificationGo('${haEscape(i.key).replace(/'/g, '&#39;')}')" role="link" tabindex="0" onkeydown="if(event.key==='Enter')window.notificationGo('${haEscape(i.key).replace(/'/g, '&#39;')}')" title="Open"` : '';
            return `<div class="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full border text-xs font-bold w-full sm:w-auto sm:max-w-[26rem] ${style[i.level]} ${go ? 'notif-link' : ''}" role="status" aria-label="${haEscape(i.text)}">
                <span class="shrink-0"${ga}>${haEscape(i.icon)}</span>
                <span class="notif-marquee flex-1 min-w-0" aria-hidden="true"${ga}><span class="notif-marquee-track" style="animation-duration:${secs}s">${t}${t}</span></span>${close}</div>`;
        }
        const go = notifTarget(i.key);
        const ka = go ? `onclick="window.notificationGo('${haEscape(i.key).replace(/'/g, '&#39;')}')" title="Open" aria-label="${haEscape(i.text)}: openen"` : 'disabled';
        return `<div class="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full border text-xs font-bold ${style[i.level]} ${go ? 'notif-link' : ''}" role="status">
            <button type="button" ${ka} class="flex items-center gap-2 text-left ${go ? 'cursor-pointer' : 'cursor-default'}"><span>${haEscape(i.icon)}</span><span>${haEscape(i.text)}</span>${go ? '<span class="opacity-60">›</span>' : ''}</button>${close}</div>`;
    }).join('');
    bar.classList.remove('hidden');
    bar.classList.add('flex');
    // Alleen herschrijven bij een wijziging, anders start de rollende tekst steeds opnieuw
    if (html !== notifBarHtmlCache) { notifBarHtmlCache = html; bar.innerHTML = html; }
    renderNotifSettings();
}

window.dismissNotification = function(key) {
    if (notifSticky(notifCatOf(key))) return;
    notifDismissed.add(key);
    renderNotifications();
};

/* ---------- instellingen (adminpaneel, tabblad Weergave) ---------- */
function renderNotifSettings() {
    const box = document.getElementById('notifSettingsBox');
    if (!box) return;
    const html = NOTIF_CATEGORIES.map(c => `
        <label class="flex items-start gap-3 p-3 rounded-2xl bg-[#f6f8f5] border border-stone-200/80 cursor-pointer">
            <input type="checkbox" ${notifEnabled(c.key) ? 'checked' : ''} onchange="window.setNotifSetting('${c.key}', this.checked)" class="mt-0.5 w-4 h-4 accent-[#152920]">
            <span class="flex-1"><span class="block text-sm font-bold text-[#1c2520]">${c.label}</span><span class="block text-[11px] text-[#68736d]">${c.hint}</span></span>
            <span class="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-[#38443d]" onclick="event.stopPropagation()" title="Aan: de melding heeft een ✕. Uit: ze verdwijnt pas als het niet meer actief is.">
                <input type="checkbox" ${notifSticky(c.key) ? '' : 'checked'} onchange="window.setNotifSticky('${c.key}', !this.checked)" class="w-4 h-4 accent-[#152920]">Wegklikbaar
            </span>
        </label>`).join('');
    if (html === notifSettingsHtmlCache) return;
    notifSettingsHtmlCache = html;
    box.innerHTML = html;
}

window.setNotifSetting = function(key, on) {
    if (!appState.notifSettings) appState.notifSettings = {};
    appState.notifSettings[key] = !!on;
    persistStateToFirestore(false);
    renderNotifications();
};

window.setNotifSticky = function(key, sticky) {
    if (!appState.notifSettings) appState.notifSettings = {};
    if (!appState.notifSettings.sticky) appState.notifSettings.sticky = {};
    appState.notifSettings.sticky[key] = !!sticky;
    persistStateToFirestore(false);
    renderNotifications();
};
