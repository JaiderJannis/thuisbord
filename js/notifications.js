'use strict';
/* Meldingen op het wanddisplay. Alles wordt telkens opnieuw berekend uit de live gegevens (niets wordt opgeslagen),
   behalve "apparaat is klaar": die houdt in het geheugen bij wanneer een apparaat stopte en blijft 90 min zichtbaar.
   Instellingen per gezin: appState.notifSettings = { appliances, cars, robots, waste, connection } (true/false). */

const NOTIF_CATEGORIES = [
    { key: 'appliances', label: '🧺 Apparaat is klaar', hint: 'Wasmachine, droger, vaatwasser… (enkel apparaten met een gekoppelde entiteit)' },
    { key: 'cars',       label: '🚗 Auto',              hint: 'Portier open, lage bandendruk, batterij bijna leeg' },
    { key: 'robots',     label: '🤖 Robots',            hint: 'Storing, stofbak vol, onderhoud bijna nodig' },
    { key: 'waste',      label: '♻️ Afvalophaling',     hint: 'Vandaag of morgen is er ophaling' },
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

function computeNotifications(now = Date.now()) {
    const items = [];
    const map = haStatesMap();
    if (notifEnabled('appliances')) {
        notifTrackAppliances(now);
        notifDoneEvents.forEach(e => items.push({ key: e.key, icon: e.icon, level: 'info', text: e.text }));
    }
    if (notifEnabled('cars')) items.push(...notifCarItems(map));
    if (notifEnabled('robots')) items.push(...notifRobotItems(map));
    if (notifEnabled('waste')) items.push(...notifWasteItems());
    if (notifEnabled('connection') && appState.haUrl && appState.haToken && !haWsConnected && now - NOTIF_PAGE_LOADED_MS > 20000) {
        items.push({ key: 'ha_offline', icon: '📡', level: 'bad', text: 'Geen live verbinding met Home Assistant' });
    }
    // weggeklikte meldingen die niet meer van toepassing zijn weer "vrijgeven"
    const activeKeys = new Set(items.map(i => i.key));
    Array.from(notifDismissed).forEach(k => { if (!activeKeys.has(k)) notifDismissed.delete(k); });
    const rank = { bad: 0, warn: 1, info: 2 };
    return items.sort((a, b) => rank[a.level] - rank[b.level]);
}

function renderNotifications() {
    const bar = document.getElementById('notificationsBar');
    if (!bar) return;
    const visible = computeNotifications().filter(i => !notifDismissed.has(i.key));
    if (!visible.length) {
        bar.classList.add('hidden');
        bar.classList.remove('flex');
        bar.innerHTML = '';
        renderNotifSettings();
        return;
    }
    const style = {
        bad:  'bg-red-50 border-red-200 text-red-800',
        warn: 'bg-amber-50 border-amber-200 text-amber-900',
        info: 'bg-[#eef6f1] border-[#cfe5d8] text-[#1c643f]'
    };
    bar.classList.remove('hidden');
    bar.classList.add('flex');
    bar.innerHTML = visible.map(i => `
        <div class="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full border text-xs font-bold ${style[i.level]}" role="status">
            <span>${haEscape(i.icon)}</span><span>${haEscape(i.text)}</span>
            <button onclick="window.dismissNotification('${haEscape(i.key).replace(/'/g, '&#39;')}')" aria-label="Melding sluiten" class="w-5 h-5 rounded-full hover:bg-black/10 cursor-pointer leading-none">✕</button>
        </div>`).join('');
    renderNotifSettings();
}

window.dismissNotification = function(key) {
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
            <span><span class="block text-sm font-bold text-[#1c2520]">${c.label}</span><span class="block text-[11px] text-[#68736d]">${c.hint}</span></span>
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
