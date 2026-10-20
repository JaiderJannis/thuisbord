'use strict';
/* Tijdlijn van vandaag: wat er in huis gebeurde (deuren, personen, robots, wasserij, beweging, alarmen, optioneel lichten).
   De gebeurtenissen komen uit het logboek van Home Assistant (logbook/get_events); er wordt niets zelf opgeslagen.
   appState.timeline = { cats: { people, doors, motion, robots, laundry, alerts, lights, switches, climate } } */

const TL_CATS = [
    ['people',   '👤', 'Personen',        true],
    ['doors',    '🚪', 'Deuren & ramen',  true],
    ['motion',   '🏃', 'Beweging',        true],
    ['robots',   '🤖', 'Robots',          true],
    ['laundry',  '🧺', 'Wasserij',        true],
    ['alerts',   '🚨', 'Alarmen',         true],
    ['lights',   '💡', 'Lichten',         false],
    ['switches', '🔌', 'Schakelaars',     false],
    ['climate',  '🌡️', 'Airco',          false]
];
const TL_DAYS = ['Vandaag', 'Gisteren', 'Eergisteren'];
const tl = { day: 0, filter: 'all', events: [], loading: false, error: '', loadedKey: '', loadedAt: 0, edit: false, timer: null };
let tlHtmlCache = '';

function ensureTimeline() {
    if (!appState.timeline || typeof appState.timeline !== 'object') appState.timeline = {};
    const t = appState.timeline;
    if (!t.cats || typeof t.cats !== 'object') t.cats = {};
    TL_CATS.forEach(([k, , , def]) => { if (typeof t.cats[k] !== 'boolean') t.cats[k] = def; });
    return t;
}
const tlEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- welke entiteiten tellen mee ---------- */
function tlCatOf(id, attrs) {
    const d = String(id).split('.')[0], dc = (attrs && attrs.device_class) || '';
    if (d === 'person') return 'people';
    if (d === 'lock') return 'doors';
    if (d === 'binary_sensor') {
        if (['door', 'window', 'garage_door', 'opening'].includes(dc)) return 'doors';
        if (['motion', 'occupancy', 'presence', 'moving'].includes(dc)) return 'motion';
        if (['smoke', 'gas', 'carbon_monoxide', 'moisture', 'safety', 'tamper', 'problem'].includes(dc)) return 'alerts';
        return '';
    }
    if (d === 'cover') return ['garage', 'gate', 'door'].includes(dc) ? 'doors' : '';
    if (d === 'vacuum' || d === 'lawn_mower') return 'robots';
    if (d === 'light') return 'lights';
    if (d === 'switch') return 'switches';
    if (d === 'climate') return 'climate';
    if (d === 'alarm_control_panel') return 'alerts';
    return '';
}
function tlLaundryIds() {
    const out = [];
    ((appState.laundry && appState.laundry.devices) || []).forEach(dv => { const s = dv && dv.entities && dv.entities.state; if (s) out.push(s); });
    return out;
}
// Alle entiteiten die in de tijdlijn horen, met hun categorie
function tlEntities() {
    const cfg = ensureTimeline().cats, map = {};
    ((typeof discoveredHaEntities !== 'undefined' ? discoveredHaEntities : []) || []).forEach(s => {
        if (!s || !s.entity_id) return;
        const c = tlCatOf(s.entity_id, s.attributes);
        if (c && cfg[c]) map[s.entity_id] = c;
    });
    if (cfg.laundry) tlLaundryIds().forEach(id => { map[id] = 'laundry'; });
    return map;
}

/* ---------- gebeurtenis omzetten naar een zin ---------- */
function tlWhenMs(w) {
    if (typeof w === 'number') return w < 1e12 ? w * 1000 : w;
    const n = Date.parse(w);
    return isNaN(n) ? 0 : n;
}
// Geeft { icon, text, level } of null als de gebeurtenis niet interessant is
function tlDescribe(ev, cat, name) {
    const st = String(ev.state == null ? '' : ev.state).toLowerCase();
    const id = String(ev.entity_id || '');
    const dom = id.split('.')[0];
    const n = name;
    if (st === 'unavailable' || st === 'unknown' || st === '') return null;
    if (cat === 'people') {
        if (st === 'home') return { icon: '🏠', text: `${n} is thuisgekomen`, level: 'good' };
        if (st === 'not_home') return { icon: '👋', text: `${n} is vertrokken`, level: 'neutral' };
        return { icon: '📍', text: `${n} is bij ${ev.state}`, level: 'neutral' };
    }
    if (cat === 'doors') {
        if (dom === 'lock') return st === 'locked' ? { icon: '🔒', text: `${n} vergrendeld`, level: 'good' } : st === 'unlocked' ? { icon: '🔓', text: `${n} ontgrendeld`, level: 'warn' } : st === 'jammed' ? { icon: '⚠️', text: `${n} zit vast`, level: 'bad' } : null;
        if (st === 'on' || st === 'open' || st === 'opening') return { icon: '🚪', text: `${n} geopend`, level: 'neutral' };
        if (st === 'off' || st === 'closed' || st === 'closing') return { icon: '✅', text: `${n} gesloten`, level: 'neutral' };
        return null;
    }
    if (cat === 'motion') return st === 'on' ? { icon: '🏃', text: `Beweging bij ${n}`, level: 'neutral' } : null;
    if (cat === 'alerts') {
        if (st === 'on' || st === 'triggered') return { icon: '🚨', text: `${n}: alarm`, level: 'bad' };
        if (st === 'off') return { icon: '✅', text: `${n}: weer in orde`, level: 'good' };
        if (/^armed/.test(st)) return { icon: '🛡️', text: `${n} ingeschakeld`, level: 'good' };
        if (st === 'disarmed') return { icon: '🛡️', text: `${n} uitgeschakeld`, level: 'neutral' };
        return null;
    }
    if (cat === 'robots') {
        const m = { cleaning: ['🧹', 'begon met schoonmaken', 'neutral'], mowing: ['🌱', 'begon met maaien', 'neutral'], docked: ['🔋', 'staat weer in het dock', 'good'],
            returning: ['🏠', 'keert terug naar het dock', 'neutral'], paused: ['⏸️', 'is gepauzeerd', 'warn'], error: ['⚠️', 'heeft een storing', 'bad'], idle: null };
        const r = m[st];
        return r ? { icon: r[0], text: `${n} ${r[1]}`, level: r[2] } : null;
    }
    if (cat === 'laundry') {
        if (/^(run|running|wash|washing|spin|rinse|drying|dry|cycle|active|on)$/.test(st)) return { icon: '🫧', text: `${n} is gestart`, level: 'neutral' };
        if (/^(stop|stopped|finish|finished|complete|completed|ready|idle|off)$/.test(st)) return { icon: '✅', text: `${n} is klaar`, level: 'good' };
        if (/pause/.test(st)) return { icon: '⏸️', text: `${n} gepauzeerd`, level: 'warn' };
        return null;
    }
    if (cat === 'lights' || cat === 'switches') return st === 'on' ? { icon: cat === 'lights' ? '💡' : '🔌', text: `${n} aan`, level: 'neutral' } : st === 'off' ? { icon: '⚫', text: `${n} uit`, level: 'neutral' } : null;
    if (cat === 'climate') {
        const m = { heat: 'verwarmt', cool: 'koelt', off: 'uit', auto: 'op automatisch', dry: 'droogt', fan_only: 'ventileert' };
        return m[st] ? { icon: '🌡️', text: `${n} ${m[st]}`, level: 'neutral' } : null;
    }
    return null;
}

// sensor.gang_beweging -> Gang beweging
function tlPretty(id) { const t = String(id).split('.')[1] || String(id); const w = t.replace(/_/g, ' ').trim(); return w.charAt(0).toUpperCase() + w.slice(1); }

function tlBuild(rawEvents, catMap, nameOf) {
    const out = [];
    (rawEvents || []).forEach(ev => {
        const cat = catMap[ev.entity_id];
        if (!cat || !ev.entity_id) return;
        const name = ev.name || (nameOf && nameOf(ev.entity_id)) || tlPretty(ev.entity_id);
        const d = tlDescribe(ev, cat, name);
        const t = tlWhenMs(ev.when);
        if (d && t) out.push({ t, cat, id: ev.entity_id, icon: d.icon, text: d.text, level: d.level });
    });
    out.sort((a, b) => b.t - a.t);
    // dubbele opeenvolgende meldingen van dezelfde entiteit met dezelfde tekst samenvoegen
    return out.filter((e, i) => !(out[i + 1] && out[i + 1].id === e.id && out[i + 1].text === e.text));
}

/* ---------- ophalen ---------- */
function tlRange(dayOffset) {
    const s = new Date(); s.setHours(0, 0, 0, 0); s.setDate(s.getDate() - dayOffset);
    const e = new Date(s); e.setDate(e.getDate() + 1);
    return { start: s, end: dayOffset === 0 ? new Date() : e };
}
async function tlLoad(force) {
    if (tl.loading) return;
    const ids = Object.keys(tlEntities());
    const key = tl.day + '|' + ids.length + '|' + JSON.stringify(ensureTimeline().cats);
    if (!force && key === tl.loadedKey && Date.now() - tl.loadedAt < 60000) return;
    if (!ids.length) { tl.events = []; tl.error = ''; tl.loadedKey = key; tl.loadedAt = Date.now(); tlRender(true); return; }
    if (typeof mlibWs !== 'function') { tl.error = 'Home Assistant is niet beschikbaar.'; tlRender(true); return; }
    tl.loading = true; tlRender(true);
    try {
        const r = tlRange(tl.day);
        const list = await mlibWs({ type: 'logbook/get_events', start_time: r.start.toISOString(), end_time: r.end.toISOString(), entity_ids: ids.slice(0, 400) }, 25000);
        const map = tlEntities();
        const sm = typeof haStatesMap === 'function' ? haStatesMap() : null;
        const nameOf = (id) => { const s = sm && haStateObj(sm, id); return s && s.attributes && s.attributes.friendly_name; };
        tl.events = tlBuild(Array.isArray(list) ? list : [], map, nameOf);
        tl.error = '';
        tl.loadedKey = key; tl.loadedAt = Date.now();
    } catch (e) {
        tl.error = (e && e.message) || 'Tijdlijn kon niet geladen worden.';
    } finally { tl.loading = false; }
    tlRender(true);
}

/* ---------- weergave ---------- */
const TL_LEVEL = { good: 'bg-[#e8f2ec] text-[#197447]', warn: 'bg-[#fdf3d8] text-[#8a5a00]', bad: 'bg-[#fbe3df] text-[#b42318]', neutral: 'bg-stone-100 text-stone-600' };
function tlTimeStr(t) { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

function tlRender(force) {
    const container = document.getElementById('timelineContainer');
    const view = document.getElementById('viewTimeline');
    if (!container || (view && view.classList.contains('hidden'))) return;
    const cfg = ensureTimeline();
    const canEdit = typeof permAllowed === 'function' && permAllowed('edit_timeline');
    const evs = tl.events.filter(e => tl.filter === 'all' || e.cat === tl.filter);
    const enabled = TL_CATS.filter(c => cfg.cats[c[0]]);
    const chips = [['all', '✨', 'Alles']].concat(enabled.map(c => [c[0], c[1], c[2]])).map(([k, ic, lb]) =>
        `<button type="button" onclick="window.timelineFilter('${k}')" class="px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer ${tl.filter === k ? 'bg-[#152920] text-white' : 'bg-white border border-stone-200 text-[#38443d] hover:bg-[#f4f7f4]'}">${ic} ${lb}</button>`).join('');
    const days = TL_DAYS.map((l, i) => `<button type="button" onclick="window.timelineDay(${i})" class="px-3.5 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer ${tl.day === i ? 'bg-[#152920] text-white' : 'bg-stone-100 text-[#38443d] hover:bg-stone-200'}">${l}</button>`).join('');

    let list;
    if (tl.loading && !tl.events.length) list = '<p class="text-sm text-[#68736d] py-8 text-center">Tijdlijn laden…</p>';
    else if (tl.error) list = `<div class="py-8 text-center"><p class="text-sm font-bold text-red-700">${tlEsc(tl.error)}</p><button type="button" onclick="window.timelineReload()" class="mt-3 px-4 py-2 rounded-xl bg-[#152920] text-white text-xs font-bold cursor-pointer">Opnieuw proberen</button></div>`;
    else if (!evs.length) list = `<p class="text-sm text-[#68736d] py-8 text-center">${(typeof discoveredHaEntities !== 'undefined' && discoveredHaEntities.length) ? 'Nog niets gebeurd in deze selectie.' : 'Koppel eerst Home Assistant bij Beheer.'}</p>`;
    else {
        let lastHour = '';
        list = '<ol class="relative">' + evs.map(e => {
            const hour = tlTimeStr(e.t).slice(0, 2);
            const head = hour !== lastHour ? `<li class="pt-3 pb-1 pl-14 text-[11px] font-extrabold uppercase tracking-wider text-[#8a958f]">${hour}:00</li>` : '';
            lastHour = hour;
            return head + `<li class="flex items-center gap-3 py-1.5"><span class="w-11 text-right text-xs font-bold tabular-nums text-[#68736d] shrink-0">${tlTimeStr(e.t)}</span>
                <span class="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0 ${TL_LEVEL[e.level] || TL_LEVEL.neutral}">${e.icon}</span>
                <span class="text-sm font-semibold text-[#1c2520] min-w-0">${tlEsc(e.text)}</span></li>`;
        }).join('') + '</ol>';
    }
    const edit = tl.edit && canEdit ? `<div class="bg-white rounded-[22px] p-5 shadow-sm border-2 border-[#19975c]/40 space-y-3">
        <p class="text-sm font-extrabold text-[#1c2520]">Wat hoort in de tijdlijn?</p>
        <div class="flex flex-wrap gap-2">${TL_CATS.map(c => `<label class="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f6f8f5] border border-stone-200 text-sm cursor-pointer"><input type="checkbox" ${cfg.cats[c[0]] ? 'checked' : ''} onchange="window.timelineSetCat('${c[0]}',this.checked)" class="accent-[#152920]"> ${c[1]} ${c[2]}</label>`).join('')}</div>
        <p class="text-[11px] text-[#8a958f]">Lichten en schakelaars zijn standaard uit omdat ze veel meldingen geven.</p></div>` : '';
    const html = `${edit}
        <div class="bg-white rounded-[26px] p-5 sm:p-6 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3"><div class="flex gap-2">${days}</div>
                <div class="flex items-center gap-2">${tl.loading ? '<span class="text-xs text-[#68736d]">Vernieuwen…</span>' : ''}<button type="button" onclick="window.timelineReload()" class="px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-xs font-bold cursor-pointer">↻ Vernieuwen</button></div></div>
            <div class="flex flex-wrap gap-2">${chips}</div>
            ${list}
        </div>`;
    if (!force && html === tlHtmlCache) return;
    tlHtmlCache = html;
    container.innerHTML = html;
    const eb = document.getElementById('timelineEditBtn'); if (eb) eb.classList.toggle('hidden', !canEdit);
}

function renderTimelineView() { tlRender(false); }
function timelineViewActive(on) {
    if (tl.timer) { clearInterval(tl.timer); tl.timer = null; }
    if (on) { tlHtmlCache = ''; tlLoad(true); tl.timer = setInterval(() => { if (!document.hidden) tlLoad(true); }, 60000); }
}

window.timelineDay = function(i) { tl.day = i; tl.events = []; tl.error = ''; tlHtmlCache = ''; tlLoad(true); };
window.timelineFilter = function(k) { tl.filter = k; tlRender(true); };
window.timelineReload = function() { tlLoad(true); };
window.timelineToggleEdit = function() { if (!permGuard('edit_timeline')) return; tl.edit = !tl.edit; tlRender(true); };
window.timelineSetCat = function(k, on) {
    if (!permGuard('edit_timeline')) return;
    const cfg = ensureTimeline();
    if (!TL_CATS.some(c => c[0] === k)) return;
    cfg.cats[k] = !!on;
    if (!on && tl.filter === k) tl.filter = 'all';
    try { persistStateToFirestore(false); } catch (e) { /* negeren */ }
    tl.loadedKey = ''; tlLoad(true);
};
