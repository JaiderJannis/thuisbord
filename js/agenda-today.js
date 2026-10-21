'use strict';
/* Agenda vandaag uit alle agenda's van Home Assistant (calendar.*), niet alleen de eerstvolgende afspraak.
   Een ingesloten Google Agenda (iframe) kan de pagina zelf niet uitlezen; staat die agenda ook in Home Assistant (Google Calendar-integratie), dan komt hij hier.
   appState.agendaCalendarsOff = [entity_id's die je liever niet toont] */

let agendaTodayEvents = null;   // null = (nog) niet geladen of geen agenda's: dan geldt de oude weergave
let agendaTodayAt = 0;
let agendaTodayBusy = false;
let agendaPickHtml = '';
const AGENDA_MAX = 8;

const agEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function agendaCalendars() {
    return ((typeof discoveredHaEntities !== 'undefined' ? discoveredHaEntities : []) || []).filter(s => s && /^calendar\./.test(s.entity_id));
}
function agendaOffList() { return Array.isArray(appState && appState.agendaCalendarsOff) ? appState.agendaCalendarsOff : []; }

function agendaDayRange(now) {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setDate(e.getDate() + 1);
    return { start: s.toISOString(), end: e.toISOString() };
}

// Evenementen van de HA-agenda -> weergaveregels (zuivere functie)
function agendaParseEvents(list, now, calName) {
    const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
    const day1 = new Date(day0); day1.setDate(day1.getDate() + 1);
    const out = [];
    (Array.isArray(list) ? list : []).forEach(ev => {
        if (!ev || !ev.start) return;
        const title = String(ev.summary || '').trim() || '(zonder titel)';
        const sDate = ev.start.date || null, sDt = ev.start.dateTime || null;
        let allDay = false, startMs, endMs;
        if (sDate) {
            allDay = true;
            startMs = new Date(sDate + 'T00:00:00').getTime();
            endMs = ev.end && ev.end.date ? new Date(ev.end.date + 'T00:00:00').getTime() : startMs + 86400000;
        } else if (sDt) {
            startMs = Date.parse(sDt); endMs = ev.end && ev.end.dateTime ? Date.parse(ev.end.dateTime) : startMs;
            if (isNaN(startMs)) return;
            if (startMs < day0.getTime()) allDay = true;      // begon al eerder: de hele dag bezig
        } else return;
        if (endMs <= day0.getTime() && !(endMs === startMs && startMs >= day0.getTime())) return;
        if (startMs >= day1.getTime()) return;
        const d = new Date(startMs);
        out.push({
            time: allDay ? 'Hele dag' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
            title, allDay, sort: allDay ? -1 : startMs, past: !allDay && endMs > startMs ? endMs <= now : (!allDay && startMs + 3600000 <= now),
            cal: calName || ''
        });
    });
    return out;
}

// Samenvoegen: dubbele afspraken (zelfde tijd en titel uit twee agenda's) eruit, op tijd sorteren, maximaal AGENDA_MAX (voorbije eerst weg)
function agendaMerge(lists) {
    const seen = new Set(), all = [];
    lists.forEach(l => l.forEach(e => { const k = e.time + '|' + e.title.toLowerCase(); if (!seen.has(k)) { seen.add(k); all.push(e); } }));
    all.sort((a, b) => a.sort - b.sort);
    if (all.length > AGENDA_MAX) {
        const keep = all.filter(e => !e.past);
        return (keep.length >= AGENDA_MAX ? keep : all.filter((e, i) => !e.past || i >= all.length - AGENDA_MAX)).slice(0, AGENDA_MAX);
    }
    return all;
}

async function agendaTodayLoad(force) {
    if (agendaTodayBusy) return;
    const baseUrl = typeof getCleanHaUrl === 'function' ? getCleanHaUrl() : '';
    const token = ((appState && appState.haToken) || '').trim();
    const cals = agendaCalendars().filter(s => !agendaOffList().includes(s.entity_id));
    if (!baseUrl || !token || !cals.length) { agendaTodayEvents = null; agendaRenderPick(); return; }
    if (!force && Date.now() - agendaTodayAt < 5 * 60000) return;
    agendaTodayBusy = true;
    const now = Date.now(), r = agendaDayRange(now);
    try {
        const lists = await Promise.all(cals.map(async s => {
            const res = await fetch(`${baseUrl}/api/calendars/${encodeURIComponent(s.entity_id)}?start=${encodeURIComponent(r.start)}&end=${encodeURIComponent(r.end)}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return agendaParseEvents(await res.json(), now, (s.attributes && s.attributes.friendly_name) || s.entity_id);
        }));
        agendaTodayEvents = agendaMerge(lists);
        agendaTodayAt = Date.now();
    } catch (e) {
        agendaTodayAt = Date.now() - 4 * 60000;     // over een minuutje opnieuw proberen; ondertussen blijft de oude weergave
    } finally { agendaTodayBusy = false; }
    if (typeof renderDisplayAgenda === 'function') renderDisplayAgenda();
    agendaRenderPick();
}

// De regels die de agendakaart toont: live uit HA als dat lukt, anders de eerstvolgende afspraak zoals vroeger
function agendaLiveLines() {
    return agendaTodayEvents !== null ? agendaTodayEvents : ((appState && appState.haTodayEvents) || []);
}

/* ---------- kiezen welke agenda's ---------- */
function agendaRenderPick() {
    const box = document.getElementById('agendaCalendarsBox');
    if (!box) return;
    const cals = agendaCalendars(), off = agendaOffList();
    const canEdit = typeof permAllowed === 'function' && permAllowed('manage_agenda');
    let html = '';
    if (cals.length) {
        html = `<p class="text-[11px] font-bold uppercase tracking-wider text-[#68736d] mb-2">📡 Agenda's uit Home Assistant</p>
            <div class="flex flex-wrap gap-2">${cals.map(s => {
                const on = !off.includes(s.entity_id), nm = (s.attributes && s.attributes.friendly_name) || s.entity_id;
                return `<button type="button" ${canEdit ? `onclick="window.agendaCalToggle('${typeof escJsAttr === 'function' ? escJsAttr(s.entity_id) : agEsc(s.entity_id)}')"` : 'disabled'} aria-pressed="${on}" class="px-3 py-1.5 rounded-full text-xs font-bold border ${on ? 'bg-[#152920] text-white border-[#152920]' : 'bg-white text-[#68736d] border-stone-200'} ${canEdit ? 'cursor-pointer' : 'opacity-70'}">${on ? '✓ ' : ''}${agEsc(nm)}</button>`;
            }).join('')}</div>
            <p class="text-[10.5px] text-[#8a958f] mt-2">Afspraken van vandaag uit de gekozen agenda's staan op het display bij "Agenda vandaag".</p>`;
    }
    box.classList.toggle('hidden', !cals.length);
    if (html !== agendaPickHtml) { agendaPickHtml = html; box.innerHTML = html; }
}

window.agendaCalToggle = function(id) {
    if (!permGuard('manage_agenda')) return;
    const known = agendaCalendars().some(s => s.entity_id === id);
    if (!known) return;
    const off = agendaOffList().slice(), i = off.indexOf(id);
    if (i >= 0) off.splice(i, 1); else off.push(id);
    appState.agendaCalendarsOff = off;
    try { persistStateToFirestore(false); } catch (e) { /* negeren */ }
    agendaTodayAt = 0; agendaPickHtml = '';
    agendaRenderPick();
    agendaTodayLoad(true);
};

// Elke halve minuut kijken of er te vernieuwen valt (agenda's uit HA zijn er pas als de entiteiten geladen zijn)
setInterval(() => { try { agendaTodayLoad(false); } catch (e) { /* negeren */ } }, 30000);
