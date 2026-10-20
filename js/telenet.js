'use strict';
/* Telenet (internetverbruik) uit de Home Assistant-integratie van Telenet.
   De entiteiten worden automatisch gevonden (naam of id bevat "telenet"); wat de integratie precies aanbiedt verschilt, dus
   het verbruik en de limiet worden herkend aan naam, eenheid en attributen en kunnen handmatig gekozen worden.
   appState.telenet = { usage: 'sensor.x', limit: 'sensor.y', days: 'sensor.z', hidden: [ids], extra: [ids] } (alles optioneel) */

let telenetEdit = false;
let telenetHtmlCache = '';

function ensureTelenet() {
    if (!appState.telenet || typeof appState.telenet !== 'object') appState.telenet = {};
    const t = appState.telenet;
    ['usage', 'limit', 'days'].forEach(k => { if (typeof t[k] !== 'string') t[k] = ''; });
    ['hidden', 'extra'].forEach(k => { if (!Array.isArray(t[k])) t[k] = []; });
    return t;
}
const tnEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tnNum = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };

// Naar gigabyte; zonder eenheid gaan we uit van GB
function telenetToGb(value, unit) {
    const n = tnNum(value);
    if (n === null) return null;
    const u = String(unit || '').trim().toLowerCase();
    if (u === 'tb' || u === 'tib') return n * 1024;
    if (u === 'mb' || u === 'mib') return n / 1024;
    if (u === 'kb' || u === 'kib') return n / 1048576;
    if (u === 'b' || u === 'bytes') return n / 1073741824;
    return n;
}

// Alle entiteiten van de Telenet-integratie
function telenetEntities() {
    const cfg = ensureTelenet();
    const all = ((typeof discoveredHaEntities !== 'undefined' ? discoveredHaEntities : []) || []).filter(s => s && s.entity_id);
    const hit = (s) => /telenet/i.test(s.entity_id) || /telenet/i.test((s.attributes && s.attributes.friendly_name) || '');
    const ids = new Set(all.filter(hit).map(s => s.entity_id));
    cfg.extra.forEach(id => ids.add(id));
    ['usage', 'limit', 'days'].forEach(k => { if (cfg[k]) ids.add(cfg[k]); });
    cfg.hidden.forEach(id => { if (![cfg.usage, cfg.limit, cfg.days].includes(id)) ids.delete(id); });
    const byId = new Map(all.map(s => [s.entity_id, s]));
    return Array.from(ids).map(id => byId.get(id)).filter(Boolean);
}

function telenetRole(s) {
    const text = (s.entity_id + ' ' + ((s.attributes && s.attributes.friendly_name) || '')).toLowerCase();
    const unit = String((s.attributes && s.attributes.unit_of_measurement) || '').toLowerCase();
    if (/limit|allowance|quota|fup|maximum|\bmax\b|toegestaan|inbegrepen|included|cap\b/.test(text)) return 'limit';
    if (/days|dagen|remaining|resterend|reset|period|periode|einde|\bend\b|until|tot\b/.test(text) && !/usage|verbruik/.test(text)) return 'days';
    if (/speed|snelheid|mbps|mbit/.test(text) || /mbit|mbps/.test(unit)) return 'speed';
    if (/usage|used|verbruik|total|totaal|download|upload|data|volume/.test(text) || ['gb', 'mb', 'tb', 'gib', 'mib'].includes(unit)) return 'usage';
    return 'other';
}

// Zuivere functie: { usage, limit, daysLeft, pct, tiles, hero }
function telenetAnalyze(ents, pick) {
    pick = pick || {};
    const byId = new Map((ents || []).map(s => [s.entity_id, s]));
    const roles = new Map((ents || []).map(s => [s.entity_id, telenetRole(s)]));
    const usable = (s) => s && s.state !== 'unavailable' && s.state !== 'unknown' && s.state !== '';
    const pickOr = (key, role, prefer) => {
        if (pick[key] && byId.get(pick[key])) return byId.get(pick[key]);
        const cands = (ents || []).filter(s => roles.get(s.entity_id) === role && usable(s) && tnNum(s.state) !== null);
        if (!cands.length) return null;
        if (prefer) { const p = cands.find(s => prefer.test(s.entity_id + ' ' + ((s.attributes && s.attributes.friendly_name) || ''))); if (p) return p; }
        return cands.slice().sort((a, b) => telenetToGb(b.state, b.attributes && b.attributes.unit_of_measurement) - telenetToGb(a.state, a.attributes && a.attributes.unit_of_measurement))[0];
    };
    const u = pickOr('usage', 'usage', /total|totaal|used|verbruik/i);
    let l = pickOr('limit', 'limit');
    const usage = u && usable(u) ? telenetToGb(u.state, u.attributes && u.attributes.unit_of_measurement) : null;
    let limit = l && usable(l) ? telenetToGb(l.state, l.attributes && l.attributes.unit_of_measurement) : null;
    if (limit === null && u && u.attributes) {        // sommige integraties geven de limiet als attribuut
        const k = Object.keys(u.attributes).find(x => /limit|allowance|quota|fup|max|included/i.test(x) && tnNum(u.attributes[x]) !== null);
        if (k) limit = telenetToGb(u.attributes[k], u.attributes.unit_of_measurement);
    }
    const d = pickOr('days', 'days');
    let daysLeft = null;
    if (d && usable(d)) {
        const n = tnNum(d.state);
        if (n !== null && String((d.attributes && d.attributes.device_class) || '') !== 'timestamp' && n >= 0 && n < 400) daysLeft = Math.round(n);
        else { const t = Date.parse(d.state); if (!isNaN(t)) daysLeft = Math.max(0, Math.ceil((t - Date.now()) / 86400000)); }
    }
    const pct = usage !== null && limit > 0 ? (usage / limit) * 100 : null;
    const perDay = limit > 0 && usage !== null && daysLeft > 0 ? Math.max(0, (limit - usage) / daysLeft) : null;
    const shown = new Set([u && u.entity_id, l && l.entity_id, d && d.entity_id].filter(Boolean));
    const tiles = (ents || []).filter(s => !shown.has(s.entity_id));
    return { usage, limit, daysLeft, pct, perDay, hero: u || null, tiles, ids: { usage: u && u.entity_id, limit: l && l.entity_id, days: d && d.entity_id } };
}

/* ---------- weergave ---------- */
const tnGb = (n) => n >= 1000 ? (n / 1024).toLocaleString('nl-BE', { maximumFractionDigits: 2 }) + ' TB' : n.toLocaleString('nl-BE', { maximumFractionDigits: n < 10 ? 2 : 0 }) + ' GB';

function renderTelenetView() {
    const box = document.getElementById('telenetContainer'), view = document.getElementById('viewTelenet');
    const canEdit = typeof permAllowed === 'function' && permAllowed('edit_telenet');
    const badge = document.getElementById('menuTelenetBadge');
    const ents = telenetEntities();
    const a = telenetAnalyze(ents, ensureTelenet());
    if (badge) badge.textContent = a.pct !== null && a.pct >= 90 ? `${Math.round(a.pct)}%` : '';
    const eb = document.getElementById('telenetEditBtn'); if (eb) eb.classList.toggle('hidden', !canEdit);
    if (!box || (view && view.classList.contains('hidden'))) return;
    const ae = document.activeElement;
    if (telenetEdit && ae && box.contains && box.contains(ae) && ae.tagName === 'INPUT') return;
    const map = typeof haStatesMap === 'function' ? haStatesMap() : null;

    let html = telenetEdit && canEdit ? telenetEditHtml(ents, a) : '';
    if (!ents.length) {
        html += `<div class="bg-white rounded-[26px] p-8 text-center shadow-sm"><p class="text-5xl mb-3">📶</p><h3 class="text-lg font-extrabold text-[#1c2520]">Geen Telenet-entiteiten gevonden</h3>
            <p class="text-sm text-[#68736d] mt-1 max-w-md mx-auto">${(typeof discoveredHaEntities !== 'undefined' && discoveredHaEntities.length) ? 'Er is niets gevonden met "telenet" in de naam. Kies zelf entiteiten met ⚙️ Instellen.' : 'Koppel eerst Home Assistant bij Beheer.'}</p></div>`;
    } else {
        if (a.usage !== null) {
            const hasLimit = a.limit > 0, pct = a.pct;
            const color = pct === null ? '#2a78d6' : pct >= 100 ? '#c0392b' : pct >= 85 ? '#eda100' : '#19975c';
            html += `<section class="bg-white rounded-[26px] p-6 shadow-sm space-y-3">
                <div class="flex flex-wrap items-end justify-between gap-2"><div><p class="text-[11px] font-bold uppercase tracking-wider text-[#68736d]">Internetverbruik</p>
                    <p class="text-3xl font-extrabold text-[#1c2520]">${tnGb(a.usage)}${hasLimit ? ` <span class="text-base font-bold text-[#68736d]">van ${tnGb(a.limit)}</span>` : ''}</p></div>
                    ${pct !== null ? `<span class="text-2xl font-extrabold" style="color:${color}">${Math.round(pct)}%</span>` : ''}</div>
                ${pct !== null ? `<div class="h-3 rounded-full bg-stone-200 overflow-hidden" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><div class="h-full" style="width:${Math.min(100, pct)}%;background:${color}"></div></div>` : ''}
                <div class="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[#38443d]">
                    ${a.daysLeft !== null ? `<span>📅 Nog <b>${a.daysLeft}</b> ${a.daysLeft === 1 ? 'dag' : 'dagen'} in deze periode</span>` : ''}
                    ${a.perDay !== null ? `<span>⚖️ Je kunt nog ongeveer <b>${tnGb(a.perDay)}</b> per dag gebruiken</span>` : ''}
                    ${pct !== null && pct >= 100 ? '<span class="font-bold text-[#c0392b]">Je limiet is bereikt: de snelheid kan verlaagd worden.</span>' : ''}
                </div></section>`;
        }
        if (a.tiles.length) {
            html += `<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">${a.tiles.map(s => {
                const nm = (s.attributes && s.attributes.friendly_name) || s.entity_id;
                const fv = typeof haFriendlyValue === 'function' ? haFriendlyValue(map ? haStateObj(map, s.entity_id) : s, nm) : { text: s.state };
                return `<div class="bg-white rounded-2xl p-4 shadow-sm"><p class="text-[11px] font-bold uppercase tracking-wider text-[#68736d] truncate" title="${tnEsc(nm)}">${tnEsc(nm.replace(/^telenet\s*/i, ''))}</p><p class="text-lg font-extrabold text-[#1c2520] mt-1 break-words">${tnEsc(fv.text)}</p></div>`;
            }).join('')}</div>`;
        }
        if (a.usage === null) html += '<p class="text-xs text-[#68736d]">Geen verbruik herkend. Kies met ⚙️ Instellen welke entiteit het verbruik is.</p>';
    }
    if (html === telenetHtmlCache) return;
    telenetHtmlCache = html; box.innerHTML = html;
}

function telenetEditHtml(ents, a) {
    const cfg = ensureTelenet();
    const inp = 'w-full px-3 py-2 rounded-xl border border-stone-200 text-xs font-mono';
    const field = (k, label, hint) => `<label class="block"><span class="text-xs font-bold text-[#68736d]">${label}</span><input type="text" list="haEntitiesDatalist" value="${tnEsc(cfg[k])}" placeholder="${tnEsc(a.ids[k] || 'automatisch')}" onchange="window.telenetSetPick('${k}',this.value)" class="${inp}"><span class="text-[10px] text-[#8a958f]">${hint}</span></label>`;
    return `<div class="bg-white rounded-[22px] p-5 shadow-sm border-2 border-[#19975c]/40 space-y-3">
        <div class="flex items-center justify-between gap-3"><p class="text-sm font-extrabold text-[#1c2520]">Telenet instellen</p><button type="button" onclick="window.telenetToggleEdit()" class="px-4 py-2 rounded-xl bg-[#152920] text-white text-xs font-bold cursor-pointer">✓ Klaar</button></div>
        <p class="text-xs text-[#68736d]">Alles wordt automatisch herkend. Klopt iets niet, kies dan zelf de entiteiten. Leeg laten = automatisch.</p>
        <div class="grid gap-3 md:grid-cols-3">${field('usage', 'Verbruik', 'Hoeveel data je al gebruikte')}${field('limit', 'Limiet', 'Je volume of fair-use-grens')}${field('days', 'Dagen / einde periode', 'Aantal dagen of einddatum')}</div>
        <div><p class="text-xs font-bold text-[#68736d] mb-2">Getoonde entiteiten (${ents.length})</p><div class="flex flex-wrap gap-2">${ents.map(s => `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f6f8f5] border border-stone-200 text-[11px] font-bold">${tnEsc((s.attributes && s.attributes.friendly_name) || s.entity_id)}<button type="button" title="Verbergen" aria-label="Verbergen" onclick="window.telenetHide('${escJsAttr(s.entity_id)}')" class="cursor-pointer text-[#68736d] hover:text-red-600">✕</button></span>`).join('')}</div></div>
        <label class="block max-w-md"><span class="text-xs font-bold text-[#68736d]">Extra entiteit toevoegen</span><input type="text" list="haEntitiesDatalist" placeholder="sensor.…" onchange="window.telenetAddExtra(this.value);this.value=''" class="${inp}"></label>
    </div>`;
}

/* ---------- melding ---------- */
function telenetNotifItems() {
    const ents = telenetEntities();
    if (!ents.length) return [];
    const a = telenetAnalyze(ents, ensureTelenet());
    if (a.pct === null || a.pct < 90) return [];
    const over = a.pct >= 100;
    return [{ key: 'net_usage', icon: over ? '🚫' : '📶', anim: 'ni-wiggle', level: over ? 'bad' : 'warn',
        text: over ? `Internetlimiet bereikt (${tnGb(a.usage)} van ${tnGb(a.limit)})` : `Internetverbruik: ${Math.round(a.pct)}% van je limiet${a.daysLeft !== null ? `, nog ${a.daysLeft} dagen` : ''}` }];
}

/* ---------- bewerken ---------- */
const tnSave = () => { telenetHtmlCache = ''; renderTelenetView(); try { persistStateToFirestore(false); } catch (e) { /* negeren */ } };
const tnValid = (id) => typeof id === 'string' && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(id.trim());
window.telenetToggleEdit = function() { if (!permGuard('edit_telenet')) return; telenetEdit = !telenetEdit; telenetHtmlCache = ''; renderTelenetView(); };
window.telenetSetPick = function(k, v) {
    if (!permGuard('edit_telenet') || !['usage', 'limit', 'days'].includes(k)) return;
    const id = String(v).trim();
    if (id && !tnValid(id)) { showToast('Dat is geen geldige entiteit (bv. sensor.telenet_verbruik).'); return; }
    ensureTelenet()[k] = id; tnSave();
};
window.telenetAddExtra = function(v) {
    if (!permGuard('edit_telenet')) return;
    const id = String(v).trim(); if (!tnValid(id)) return;
    const c = ensureTelenet(); if (!c.extra.includes(id)) c.extra.push(id);
    c.hidden = c.hidden.filter(x => x !== id); tnSave();
};
window.telenetHide = function(id) {
    if (!permGuard('edit_telenet') || !tnValid(id)) return;
    const c = ensureTelenet();
    c.extra = c.extra.filter(x => x !== id);
    if (!c.hidden.includes(id)) c.hidden.push(id);
    ['usage', 'limit', 'days'].forEach(k => { if (c[k] === id) c[k] = ''; });
    tnSave();
};
