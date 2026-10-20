'use strict';
/* Wanddisplay-indeling: blokken verplaatsen, groter/kleiner maken, verbergen, extra widgets en extra schermen.
   appState.displayLayout = { screens:[{id,name}], rotateSec, blocks:[{id,type,screen,span,height,order,title?,text?}] }
   Zonder opgeslagen indeling blijft het display precies zoals het was (4 kolommen op scherm 1).
   Rechten: manage_display (bewerken). Iedereen ziet de indeling; de schermwissel is voor iedereen. */

const DL_BUILTIN = {
    energy: { label: 'Stroom in huis', icon: '⚡', domId: 'dispBlk_energy' },
    today:  { label: 'Vandaag (kosten)', icon: '💶', domId: 'dispBlk_today' },
    price:  { label: 'Stroomprijs', icon: '📈', domId: 'dispBlk_price' },
    agenda: { label: 'Agenda, taken & afval', icon: '📅', domId: 'dispBlk_agenda' }
};
const DL_WIDGETS = {
    clock:   { label: 'Grote klok', icon: '🕒' },
    weather: { label: 'Weer', icon: '🌦️' },
    music:   { label: 'Muziek nu', icon: '🎵' },
    scenes:  { label: 'Scènes', icon: '🎬' },
    lights:  { label: 'Lampen aan', icon: '💡' },
    robots:  { label: 'Robots', icon: '🤖' },
    climate: { label: 'Airco\'s', icon: '❄️' },
    note:    { label: 'Notitie', icon: '📝' }
};
const DL_SPANS = [3, 4, 6, 8, 12];
const DL_SPAN_LABEL = { 3: '¼', 4: '⅓', 6: '½', 8: '⅔', 12: 'Vol' };
const DL_HEIGHTS = ['auto', 'm', 'l', 'xl'];
const DL_HEIGHT_PX = { auto: '', m: '340px', l: '480px', xl: '640px' };
const DL_HEIGHT_LABEL = { auto: 'Auto', m: 'M', l: 'L', xl: 'XL' };

let dlEdit = false;
let dlScreen = '';
let dlSnapshot = null;
let dlSaveTimer = null;
let dlRotateTimer = null;
const dlHtml = new Map();   // blok-id -> laatste inhoud (alleen herschrijven bij wijziging)

function dlDefault() {
    return {
        screens: [{ id: 's1', name: 'Overzicht' }], rotateSec: 0,
        blocks: ['energy', 'today', 'price', 'agenda'].map((t, i) => ({ id: t, type: t, screen: 's1', span: 3, height: 'auto', order: i }))
    };
}
// Zorgt dat de opgeslagen indeling klopt: schermen bestaan, alle ingebouwde blokken zijn aanwezig
function dlLayout() {
    let L = appState.displayLayout;
    if (!L || typeof L !== 'object') L = appState.displayLayout = dlDefault();
    if (!Array.isArray(L.screens) || !L.screens.length) L.screens = [{ id: 's1', name: 'Overzicht' }];
    if (!Array.isArray(L.blocks)) L.blocks = [];
    L.blocks = L.blocks.filter(b => b && b.id && (DL_BUILTIN[b.type] || DL_WIDGETS[b.type]));
    Object.keys(DL_BUILTIN).forEach(t => {
        if (!L.blocks.some(b => b.id === t)) L.blocks.push({ id: t, type: t, screen: L.screens[0].id, span: 3, height: 'auto', order: L.blocks.length, hidden: true });
    });
    const sids = new Set(L.screens.map(s => s.id));
    L.blocks.forEach(b => { if (!sids.has(b.screen)) b.screen = L.screens[0].id; if (!DL_SPANS.includes(Number(b.span))) b.span = 3; b.span = Number(b.span); if (!DL_HEIGHTS.includes(b.height)) b.height = 'auto'; });
    L.rotateSec = Number(L.rotateSec) || 0;
    if (!sids.has(dlScreen)) dlScreen = L.screens[0].id;
    return L;
}
const dlSorted = (L) => L.blocks.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
function dlEsc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function dlSave(now) {
    clearTimeout(dlSaveTimer);
    const go = () => { try { persistStateToFirestore(false); } catch (e) { /* negeren */ } };
    if (now) go(); else dlSaveTimer = setTimeout(go, 700);
}
const dlCan = () => typeof permAllowed === 'function' && permAllowed('manage_display');

/* ---------- inhoud van de extra widgets ---------- */
const dlCard = (inner, extra = '') => `<div class="flex flex-col gap-3 h-full ${extra}">${inner}</div>`;
const dlHead = (icon, title, go) => `<div class="flex items-center justify-between"><span class="text-xs font-bold uppercase tracking-wider text-[#68736d]">${icon} ${title}</span>${go ? `<button type="button" onclick="switchView('${go}')" class="text-[11px] font-bold text-[#197447] hover:underline cursor-pointer">Open ›</button>` : ''}</div>`;

function dlWidgetHtml(b) {
    try {
        if (b.type === 'clock') {
            const d = new Date();
            return dlCard(`<div class="my-auto text-center"><p class="text-6xl font-extrabold tracking-tight text-[#1c2520] tabular-nums">${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</p>
                <p class="text-lg text-[#5a655e] mt-1 capitalize">${d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>`);
        }
        if (b.type === 'weather') {
            const w = typeof weatherData !== 'undefined' ? weatherData : null;
            if (!w || !w.cur) return dlCard(dlHead('🌦️', 'Weer', 'weather') + '<p class="text-sm text-[#68736d] my-auto">Het weer is nog niet geladen.</p>');
            const info = weatherCodeInfo(w.cur.code, w.cur.isDay !== false);
            const days = (w.daily || []).slice(1, 5).map(d => {
                const i = weatherCodeInfo(d.code, true);
                const wd = new Date(d.date).toLocaleDateString('nl-BE', { weekday: 'short' });
                return '<div class="text-center"><p class="text-[11px] font-bold text-[#68736d]">' + wd + '</p><p class="text-xl">' + i.icon + '</p><p class="text-[11px] font-bold">' + Math.round(d.max) + '°</p></div>';
            }).join('');
            return dlCard(dlHead('🌦️', 'Weer', 'weather') + `<div class="flex items-center gap-4"><span class="text-5xl">${info.icon}</span><div><p class="text-4xl font-extrabold text-[#1c2520]">${Math.round(w.cur.temp)}°</p><p class="text-sm text-[#55605a]">${dlEsc(info.text)}</p></div></div>
                <div class="grid grid-cols-4 gap-2 mt-auto">${days}</div>`);
        }
        if (b.type === 'music') {
            const map = haStatesMap();
            const pl = musicPlayersToShow().players.map(p => ({ p, st: haStateObj(map, p.entityId) })).filter(x => musicStateKind(x.st) === 'playing');
            if (!pl.length) return dlCard(dlHead('🎵', 'Muziek', 'music') + '<p class="text-sm text-[#68736d] my-auto text-center">Er speelt niets.</p>');
            return dlCard(dlHead('🎵', 'Muziek', 'music') + pl.slice(0, 3).map(({ p, st }) => {
                const art = musicArtUrl(st);
                return `<div class="flex items-center gap-3"><div class="w-16 h-16 rounded-2xl bg-[#e8f2ec] overflow-hidden shrink-0 flex items-center justify-center text-2xl">${art ? `<img src="${dlEsc(art)}" alt="" class="w-full h-full object-cover" onerror="this.remove()">` : '🎵'}</div>
                    <div class="min-w-0"><p class="text-sm font-extrabold text-[#1c2520] truncate"><span class="eq"><i></i><i></i><i></i><i></i></span> ${dlEsc(musicAttr(st, 'media_title') || 'Onbekend')}</p><p class="text-xs text-[#68736d] truncate">${dlEsc(musicAttr(st, 'media_artist'))}</p><p class="text-[11px] text-[#8a958f] truncate">${dlEsc(p.name)}</p></div></div>`;
            }).join(''));
        }
        if (b.type === 'scenes') {
            const list = (appState.scenes || []);
            const canRun = permAllowed('control_scenes');
            return dlCard(dlHead('🎬', 'Scènes', 'scenes') + (list.length ? `<div class="flex flex-wrap gap-2">${list.map(sc => `<button type="button" ${canRun ? '' : 'disabled'} onclick="window.runScene('${dlEsc(sc.id)}')" class="scene-chip" style="--c:${dlEsc(sc.color || '#19975c')}"><span>${dlEsc(sc.icon || '🎬')}</span><span>${dlEsc(sc.name)}</span></button>`).join('')}</div>` : '<p class="text-sm text-[#68736d]">Nog geen scènes.</p>'));
        }
        if (b.type === 'lights') {
            const on = (appState.roomLights || []).filter(l => l.state === 'on' || l.isOn === true);
            return dlCard(dlHead('💡', 'Lampen', 'shutters') + `<p class="text-3xl font-extrabold text-[#1c2520]">${on.length}<span class="text-sm font-semibold text-[#68736d]"> aan</span></p>
                <div class="flex flex-wrap gap-1.5">${on.slice(0, 10).map(l => `<span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#fdf3d4] text-[#7a5a10]">💡 ${dlEsc(l.name)}</span>`).join('') || '<span class="text-sm text-[#68736d]">Alle lampen zijn uit.</span>'}</div>`);
        }
        if (b.type === 'robots') {
            const txt = { cleaning: 'schoonmaken', mowing: 'maaien', returning: 'terug naar dock', docked: 'in het dock', paused: 'gepauzeerd', error: 'storing' };
            return dlCard(dlHead('🤖', 'Robots', 'robots') + ((appState.robots || []).map(r => `<div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#f6f8f5]"><span class="text-sm font-bold text-[#1c2520] truncate">${dlEsc(r.icon || '🤖')} ${dlEsc(r.name)}</span><span class="text-[11px] font-bold ${r.state === 'error' ? 'text-red-700' : 'text-[#197447]'}">${dlEsc(txt[String(r.state)] || r.state || 'Gereed')}</span></div>`).join('') || '<p class="text-sm text-[#68736d]">Geen robots.</p>'));
        }
        if (b.type === 'climate') {
            const lab = { off: 'Uit', cool: 'Koelen', heat: 'Verwarmen', heat_cool: 'Auto', auto: 'Auto', dry: 'Drogen', fan_only: 'Ventilator' };
            return dlCard(dlHead('❄️', 'Airco\'s', 'shutters') + ((appState.climates || []).map(c => `<div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#f6f8f5]"><span class="text-sm font-bold text-[#1c2520] truncate">${dlEsc(c.name)}</span><span class="text-[11px] font-bold ${String(c.hvacMode || 'off') === 'off' ? 'text-[#68736d]' : 'text-[#0369a1]'}">${lab[c.hvacMode || 'off'] || c.hvacMode}${String(c.hvacMode || 'off') !== 'off' && c.targetTemp ? ` · ${c.targetTemp}°` : ''}</span></div>`).join('') || '<p class="text-sm text-[#68736d]">Geen airco\'s.</p>'));
        }
        if (b.type === 'note') {
            if (dlEdit) return dlCard(`<input type="text" value="${dlEsc(b.title || '')}" placeholder="Titel" onchange="window.dlSetNote('${b.id}','title',this.value)" class="px-3 py-2 rounded-xl border border-stone-200 text-sm font-bold">
                <textarea rows="4" placeholder="Tekst (bv. wifi-code, regels, boodschappen)" onchange="window.dlSetNote('${b.id}','text',this.value)" class="px-3 py-2 rounded-xl border border-stone-200 text-sm flex-1">${dlEsc(b.text || '')}</textarea>`);
            return dlCard(`${b.title ? `<p class="text-lg font-extrabold text-[#1c2520]">${dlEsc(b.title)}</p>` : ''}<p class="text-sm text-[#38443d] whitespace-pre-line">${dlEsc(b.text || '')}</p>`);
        }
    } catch (e) { return '<p class="text-xs text-[#68736d]">Kon dit blok niet tonen.</p>'; }
    return '';
}

/* ---------- toepassen op het scherm ---------- */
function dlBlockEl(b, main) {
    if (DL_BUILTIN[b.type]) return document.getElementById(DL_BUILTIN[b.type].domId);
    let el = document.getElementById('dispW_' + b.id);
    if (!el) {
        el = document.createElement('div');
        el.id = 'dispW_' + b.id;
        el.className = 'dblock dwidget bg-white rounded-[26px] p-6 shadow-sm flex flex-col';
        if (main && main.appendChild) main.appendChild(el);
    }
    return el;
}

function renderDisplayLayout() {
    const main = document.getElementById('displayMain');
    if (!main) return;
    const L = dlLayout();
    const canEdit = dlCan();
    if (!canEdit && dlEdit) dlEdit = false;
    const cur = dlScreen;
    const live = new Set();
    dlSorted(L).forEach((b, i) => {
        live.add(b.id);
        const el = dlBlockEl(b, main);
        if (!el) return;
        el.classList.add('dblock', 'relative');
        el.style.order = String(i);
        el.style.setProperty('--sp', String(b.span));
        el.style.setProperty('--mh', DL_HEIGHT_PX[b.height] || '');
        el.setAttribute('data-wide', b.span >= 6 ? '1' : '0');
        const show = b.screen === cur && (!b.hidden || dlEdit);
        el.classList.toggle('hidden', !show);
        el.classList.toggle('dl-dim', !!b.hidden);
        el.classList.toggle('dl-editing', dlEdit);
        if (!DL_BUILTIN[b.type]) {
            const html = dlWidgetHtml(b);
            const key = b.id + '|' + html;
            if (dlHtml.get(b.id) !== key) {
                // niet herschrijven terwijl iemand in de notitie typt
                const ae = document.activeElement;
                if (!(ae && el.contains && el.contains(ae) && ['INPUT', 'TEXTAREA'].includes(ae.tagName))) { el.innerHTML = html; dlHtml.set(b.id, key); }
            }
        }
        dlRenderToolbar(el, b, L);
    });
    // verwijderde widgets opruimen
    if (main.children) Array.from(main.children).forEach(c => { if (c.id && c.id.startsWith('dispW_') && !live.has(c.id.slice(6))) c.remove(); });
    renderDisplayBars(L, canEdit);
    dlRotateSetup();
}

// Werkbalkje op elk blok in bewerkmodus
function dlRenderToolbar(el, b, L) {
    const old = el.querySelector ? el.querySelector(':scope > .dl-bar') : null;
    if (!dlEdit) { if (old) old.remove(); return; }
    const meta = DL_BUILTIN[b.type] || DL_WIDGETS[b.type];
    const btn = (label, title, act, extra = '') => `<button type="button" title="${title}" aria-label="${title}" onclick="event.stopPropagation();${act}" class="dl-btn ${extra}">${label}</button>`;
    const html = `<span class="dl-title">${meta.icon} ${dlEsc(meta.label)}</span>
        ${btn('◀', 'Eerder', `window.dlMove('${b.id}',-1)`)}${btn('▶', 'Later', `window.dlMove('${b.id}',1)`)}
        ${btn('↔ ' + DL_SPAN_LABEL[b.span], 'Breedte aanpassen', `window.dlSize('${b.id}')`)}
        ${btn('↕ ' + DL_HEIGHT_LABEL[b.height], 'Hoogte aanpassen', `window.dlHeight('${b.id}')`)}
        ${L.screens.length > 1 ? `<select title="Naar ander scherm" onclick="event.stopPropagation()" onchange="window.dlToScreen('${b.id}',this.value)" class="dl-sel">${L.screens.map(s => `<option value="${s.id}" ${s.id === b.screen ? 'selected' : ''}>${dlEsc(s.name)}</option>`).join('')}</select>` : ''}
        ${btn(b.hidden ? '🙈' : '👁', b.hidden ? 'Tonen' : 'Verbergen', `window.dlToggleHidden('${b.id}')`, b.hidden ? 'dl-on' : '')}
        ${DL_BUILTIN[b.type] ? '' : btn('🗑', 'Verwijderen', `window.dlRemove('${b.id}')`, 'dl-del')}`;
    if (old) { if (old.getAttribute('data-h') !== html) { old.innerHTML = html; old.setAttribute('data-h', html); } return; }
    if (!el.insertAdjacentHTML) return;
    el.insertAdjacentHTML('afterbegin', `<div class="dl-bar" data-h="${dlEsc(html)}">${html}</div>`);
}

function renderDisplayBars(L, canEdit) {
    const bar = document.getElementById('displayScreensBar');
    if (!bar) return;
    const multi = L.screens.length > 1;
    let html = '';
    if (dlEdit) {
        html = `<div class="dl-panel">
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs font-extrabold text-[#152920]">✏️ Indeling bewerken</span>
                ${L.screens.map(s => `<span class="inline-flex items-center rounded-full ${s.id === dlScreen ? 'bg-[#152920] text-white' : 'bg-white border border-stone-200 text-[#38443d]'} text-xs font-bold">
                    <button type="button" onclick="window.dlGoScreen('${s.id}')" class="pl-3 pr-1.5 py-1.5 cursor-pointer">${dlEsc(s.name)}</button>
                    <button type="button" title="Naam wijzigen" onclick="window.dlRenameScreen('${s.id}')" class="px-1 py-1.5 cursor-pointer opacity-70 hover:opacity-100">✎</button>
                    ${multi ? `<button type="button" title="Scherm verwijderen" onclick="window.dlRemoveScreen('${s.id}')" class="pr-2.5 pl-0.5 py-1.5 cursor-pointer opacity-70 hover:opacity-100">✕</button>` : '<span class="pr-1.5"></span>'}</span>`).join('')}
                <button type="button" onclick="window.dlAddScreen()" class="px-3 py-1.5 rounded-full bg-white border border-dashed border-stone-300 text-xs font-bold cursor-pointer hover:bg-stone-50">+ Scherm</button>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <select id="dlAddType" class="px-2.5 py-2 rounded-xl border border-stone-200 bg-white text-xs font-bold">${Object.entries(DL_WIDGETS).map(([k, w]) => `<option value="${k}">${w.icon} ${w.label}</option>`).join('')}</select>
                <button type="button" onclick="window.dlAddWidget()" class="px-3 py-2 rounded-xl bg-[#19975c] text-white text-xs font-extrabold cursor-pointer">+ Widget</button>
                ${multi ? `<label class="flex items-center gap-1.5 text-xs font-bold text-[#38443d]">Automatisch wisselen
                    <select onchange="window.dlSetRotate(this.value)" class="px-2 py-1.5 rounded-xl border border-stone-200 bg-white text-xs font-bold">${[[0, 'Uit'], [10, '10 s'], [20, '20 s'], [30, '30 s'], [60, '1 min']].map(([v, l]) => `<option value="${v}" ${L.rotateSec === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
                <span class="flex-1"></span>
                <button type="button" onclick="window.dlReset()" class="px-3 py-2 rounded-xl bg-white border border-stone-200 text-xs font-bold cursor-pointer hover:bg-stone-50">Standaard herstellen</button>
                <button type="button" onclick="window.dlCancel()" class="px-3 py-2 rounded-xl bg-white border border-stone-200 text-xs font-bold cursor-pointer hover:bg-stone-50">Annuleren</button>
                <button type="button" onclick="window.dlDone()" class="px-4 py-2 rounded-xl bg-[#152920] text-white text-xs font-extrabold cursor-pointer">✓ Klaar</button>
            </div></div>`;
    } else if (multi) {
        html = `<div class="flex flex-wrap items-center gap-1.5 mb-1">${L.screens.map(s => `<button type="button" onclick="window.dlGoScreen('${s.id}',true)" class="px-3.5 py-1.5 rounded-full text-xs font-extrabold cursor-pointer ${s.id === dlScreen ? 'bg-[#152920] text-white' : 'bg-white/80 border border-stone-200 text-[#38443d] hover:bg-white'}">${dlEsc(s.name)}</button>`).join('')}</div>`;
    }
    if (bar._h === html) return;
    bar._h = html;
    bar.innerHTML = html;
    bar.classList.toggle('hidden', !html);
}

/* ---------- bewerken ---------- */
const dlRerender = () => { dlHtml.clear(); renderDisplayLayout(); dlSave(false); };
window.dlStartEdit = function() {
    if (!permGuard('manage_display')) return;
    dlSnapshot = JSON.stringify(dlLayout());
    dlEdit = true; renderDisplayLayout();
};
window.dlDone = function() { dlEdit = false; dlSnapshot = null; dlHtml.clear(); renderDisplayLayout(); dlSave(true); showToast('Indeling opgeslagen.'); };
window.dlCancel = function() {
    if (dlSnapshot) appState.displayLayout = JSON.parse(dlSnapshot);
    dlEdit = false; dlSnapshot = null; dlHtml.clear(); renderDisplayLayout();
};
window.dlReset = function() { if (!permGuard('manage_display')) return; appState.displayLayout = dlDefault(); dlScreen = 's1'; dlRerender(); };
window.dlGoScreen = function(id, manual) {
    if (!dlLayout().screens.some(s => s.id === id)) return;
    dlScreen = id; try { localStorage.setItem('thuisbord_screen', id); } catch (e) { /* negeren */ }
    dlHtml.clear(); renderDisplayLayout();
    if (manual) dlRotateSetup(true);
};
function dlBlock(id) { return dlLayout().blocks.find(b => b.id === id); }
window.dlMove = function(id, dir) {
    if (!permGuard('manage_display')) return;
    const L = dlLayout();
    const same = dlSorted(L).filter(b => b.screen === dlBlock(id).screen);
    const i = same.findIndex(b => b.id === id), j = i + dir;
    if (j < 0 || j >= same.length) return;
    const a = same[i], b = same[j];
    const all = dlSorted(L); const ia = all.indexOf(a), ib = all.indexOf(b);
    all[ia] = b; all[ib] = a;
    all.forEach((x, k) => { x.order = k; });
    dlRerender();
};
window.dlSize = function(id) { if (!permGuard('manage_display')) return; const b = dlBlock(id); if (!b) return; b.span = DL_SPANS[(DL_SPANS.indexOf(b.span) + 1) % DL_SPANS.length]; dlRerender(); };
window.dlHeight = function(id) { if (!permGuard('manage_display')) return; const b = dlBlock(id); if (!b) return; b.height = DL_HEIGHTS[(DL_HEIGHTS.indexOf(b.height) + 1) % DL_HEIGHTS.length]; dlRerender(); };
window.dlToggleHidden = function(id) { if (!permGuard('manage_display')) return; const b = dlBlock(id); if (!b) return; b.hidden = !b.hidden; dlRerender(); };
window.dlToScreen = function(id, sid) { if (!permGuard('manage_display')) return; const b = dlBlock(id); if (!b || !dlLayout().screens.some(s => s.id === sid)) return; b.screen = sid; dlRerender(); };
window.dlRemove = function(id) {
    if (!permGuard('manage_display')) return;
    const L = dlLayout(); const b = dlBlock(id);
    if (!b || DL_BUILTIN[b.type]) return;
    L.blocks = L.blocks.filter(x => x.id !== id); dlRerender();
};
window.dlAddWidget = function() {
    if (!permGuard('manage_display')) return;
    const sel = document.getElementById('dlAddType');
    const type = (sel && sel.value) || 'clock';
    if (!DL_WIDGETS[type]) return;
    const L = dlLayout();
    L.blocks.push({ id: 'w_' + Date.now().toString(36) + Math.floor(Math.random() * 99), type, screen: dlScreen, span: type === 'clock' ? 6 : 4, height: 'auto', order: L.blocks.length, title: type === 'note' ? 'Notitie' : '', text: '' });
    dlRerender();
};
window.dlSetNote = function(id, field, value) { if (!permGuard('manage_display')) return; const b = dlBlock(id); if (!b || !['title', 'text'].includes(field)) return; b[field] = String(value).slice(0, 600); dlSave(false); };
window.dlAddScreen = function() {
    if (!permGuard('manage_display')) return;
    const L = dlLayout();
    if (L.screens.length >= 6) { showToast('Maximaal 6 schermen.'); return; }
    const id = 's' + Date.now().toString(36);
    L.screens.push({ id, name: `Scherm ${L.screens.length + 1}` });
    dlScreen = id; dlRerender();
};
window.dlRenameScreen = function(id) {
    if (!permGuard('manage_display')) return;
    const s = dlLayout().screens.find(x => x.id === id); if (!s) return;
    const n = (typeof prompt === 'function' ? prompt('Naam van dit scherm:', s.name) : null);
    if (n && n.trim()) { s.name = n.trim().slice(0, 24); dlRerender(); }
};
window.dlRemoveScreen = function(id) {
    if (!permGuard('manage_display')) return;
    const L = dlLayout();
    if (L.screens.length < 2) return;
    const first = L.screens.find(s => s.id !== id);
    L.blocks.forEach(b => { if (b.screen === id) b.screen = first.id; });
    L.screens = L.screens.filter(s => s.id !== id);
    if (dlScreen === id) dlScreen = first.id;
    dlRerender();
};
window.dlSetRotate = function(v) { if (!permGuard('manage_display')) return; dlLayout().rotateSec = Number(v) || 0; dlRerender(); };

/* ---------- schermwissel: automatisch en met vegen ---------- */
function dlRotateSetup(reset) {
    const L = dlLayout();
    const want = !dlEdit && L.screens.length > 1 && L.rotateSec > 0 && window.currentViewName === 'display';
    if (dlRotateTimer && !want) { clearInterval(dlRotateTimer); dlRotateTimer = null; }
    if (want && (!dlRotateTimer || reset)) {
        clearInterval(dlRotateTimer);
        dlRotateTimer = setInterval(() => {
            const l = dlLayout();
            if (window.currentViewName !== 'display' || dlEdit || l.screens.length < 2) return;
            const i = l.screens.findIndex(s => s.id === dlScreen);
            window.dlGoScreen(l.screens[(i + 1) % l.screens.length].id);
        }, L.rotateSec * 1000);
    }
}
(function swipeInit() {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    let x0 = null, y0 = 0;
    document.addEventListener('touchstart', (e) => {
        const main = document.getElementById('displayMain');
        x0 = (main && main.contains && main.contains(e.target) && e.touches && e.touches[0]) ? e.touches[0].clientX : null;
        y0 = e.touches && e.touches[0] ? e.touches[0].clientY : 0;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
        if (x0 === null || dlEdit || !e.changedTouches || !e.changedTouches[0]) return;
        const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
        x0 = null;
        const t = e.target;
        if (t && t.closest && t.closest('input,select,textarea,.no-swipe')) return;
        if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        const l = dlLayout(); if (l.screens.length < 2) return;
        const i = l.screens.findIndex(s => s.id === dlScreen);
        window.dlGoScreen(l.screens[(i + (dx < 0 ? 1 : l.screens.length - 1)) % l.screens.length].id, true);
    }, { passive: true });
})();
try { const sv = localStorage.getItem('thuisbord_screen'); if (sv) dlScreen = sv; } catch (e) { /* negeren */ }
setInterval(() => { try { if (window.currentViewName === 'display') renderDisplayLayout(); } catch (e) { /* negeren */ } }, 20000);
