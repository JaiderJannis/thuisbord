'use strict';
/* Muziekbibliotheek: Spotify, afspeellijsten en wachtrij, per speler.
   - Bladeren: via media_player/browse_media (werkt met Music Assistant en met de Spotify-integratie van Home Assistant).
   - Zoeken en wachtrij: via Music Assistant (music_assistant.search / get_queue). Spotify werkt daar als bron in.
   Home Assistant-antwoorden komen binnen via een eigen korte WebSocket, los van de live-verbinding. */

const mlib = { entity: '', tab: 'browse', stack: [], node: null, loading: false, error: '', query: '', results: null, queue: null, items: [] };
const ML_SEARCH_TYPES = [['playlists', 'Afspeellijsten', '📃'], ['albums', 'Albums', '💿'], ['tracks', 'Nummers', '🎵'], ['artists', 'Artiesten', '🎤'], ['radio', 'Radio', '📻']];
const ML_TYPE_OF = { playlists: 'playlist', albums: 'album', tracks: 'track', artists: 'artist', radio: 'radio' };
let mlibEntryId = null;

// Eén opdracht naar Home Assistant over een tijdelijke WebSocket; geeft het resultaat terug of gooit een leesbare fout.
function mlibWs(payload, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const base = typeof getCleanHaUrl === 'function' ? getCleanHaUrl() : '';
        const token = String(appState.haToken || '').trim();
        if (!base || !token) { reject(new Error('Geen verbinding met Home Assistant ingesteld.')); return; }
        let ws, done = false;
        const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { ws && ws.close(); } catch (e) { /* negeren */ } fn(v); };
        const timer = setTimeout(() => finish(reject, new Error('Home Assistant antwoordt niet (time-out).')), timeoutMs);
        try { ws = new WebSocket(base.replace(/^http/i, 'ws') + '/api/websocket'); } catch (e) { finish(reject, new Error('Kan geen verbinding maken met Home Assistant.')); return; }
        ws.onerror = () => finish(reject, new Error('Verbinding met Home Assistant mislukt.'));
        ws.onmessage = (ev) => {
            let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
            else if (m.type === 'auth_invalid') finish(reject, new Error('Home Assistant weigerde de toegangstoken.'));
            else if (m.type === 'auth_ok') ws.send(JSON.stringify(Object.assign({ id: 1 }, payload)));
            else if (m.type === 'result' && m.id === 1) {
                if (m.success) finish(resolve, m.result);
                else finish(reject, new Error((m.error && m.error.message) || 'Opdracht mislukt.'));
            }
        };
    });
}

async function mlibEntryId_() {
    if (mlibEntryId !== null) return mlibEntryId;
    try {
        const list = await mlibWs({ type: 'config_entries/get', domain: 'music_assistant' });
        mlibEntryId = (Array.isArray(list) && list[0] && list[0].entry_id) || '';
    } catch (e) { mlibEntryId = ''; }
    return mlibEntryId;
}

function mlibImg(u) {
    if (!u) return '';
    const p = String(u);
    if (/^https?:\/\//i.test(p)) return p;
    const base = typeof getCleanHaUrl === 'function' ? getCleanHaUrl() : '';
    return base && p.startsWith('/') ? base + p : '';
}
const mlibEsc = (t) => haEscape(String(t == null ? '' : t));

/* ---------- openen en tabs ---------- */
window.musicLibOpen = function(entityId) {
    if (typeof musicValidEntity === 'function' && !musicValidEntity(entityId)) return;
    if (typeof permAllowed === 'function' && !permAllowed('view_music')) return;
    Object.assign(mlib, { entity: entityId, tab: 'browse', stack: [], node: null, error: '', results: null, queue: null, items: [], loading: false });
    const modal = document.getElementById('musicLibModal');
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
    musicLibRender();
    mlibBrowse(null);
};
window.musicLibClose = function() {
    const modal = document.getElementById('musicLibModal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    mlib.entity = '';
};
window.musicLibTab = function(tab) {
    mlib.tab = tab; mlib.error = '';
    musicLibRender();
    if (tab === 'queue') mlibLoadQueue();
    if (tab === 'browse' && !mlib.node) mlibBrowse(null);
};

/* ---------- bladeren ---------- */
async function mlibBrowse(item) {
    const ent = mlib.entity;
    mlib.loading = true; mlib.error = '';
    musicLibRender();
    try {
        const payload = { type: 'media_player/browse_media', entity_id: ent };
        if (item) { payload.media_content_id = item.media_content_id; payload.media_content_type = item.media_content_type; }
        const res = await mlibWs(payload);
        if (mlib.entity !== ent) return;
        mlib.node = res;
        mlib.items = Array.isArray(res && res.children) ? res.children : [];
    } catch (e) {
        mlib.error = e.message + ' Deze speler ondersteunt bladeren misschien niet.';
        mlib.items = [];
    }
    mlib.loading = false;
    musicLibRender();
}
window.musicLibOpenItem = function(i) {
    const it = mlib.items[i];
    if (!it) return;
    if (it.can_expand) {
        mlib.stack.push({ title: (mlib.node && mlib.node.title) || 'Bibliotheek', item: mlib.stack.length ? mlib.stack[mlib.stack.length - 1].item : null, node: mlib.node });
        mlibBrowse(it);
    } else if (it.can_play) window.musicLibPlay(i, 'replace');
};
window.musicLibBack = function() {
    const prev = mlib.stack.pop();
    if (!prev) return;
    mlib.node = prev.node; mlib.items = (prev.node && prev.node.children) || [];
    mlib.error = '';
    musicLibRender();
};
window.musicLibHome = function() { mlib.stack = []; mlibBrowse(null); };

/* ---------- afspelen ---------- */
function mlibPlayData(it, enqueue) {
    return { entity_id: mlib.entity, media_content_id: it.media_content_id || it.uri, media_content_type: it.media_content_type || it.media_type, enqueue };
}
window.musicLibPlay = async function(i, enqueue, fromSearch) {
    if (!permGuard('control_music')) return;
    const it = fromSearch ? mlib.flat[i] : mlib.items[i];
    if (!it || !mlib.entity) return;
    const data = mlibPlayData(it, enqueue || 'replace');
    if (!data.media_content_id) return;
    const ok = await window.callHomeAssistantService('media_player', 'play_media', data);
    showToast(ok === false ? 'Opdracht niet verzonden (geen verbinding met Home Assistant).'
        : (enqueue === 'add' ? `Toegevoegd aan wachtrij: ${it.title || it.name}` : `Afspelen: ${it.title || it.name}`));
    if (ok !== false && enqueue !== 'add') setTimeout(() => { if (mlib.tab === 'queue') mlibLoadQueue(); }, 1500);
};

/* ---------- zoeken (Music Assistant, met Spotify als bron) ---------- */
window.musicLibSearch = async function() {
    const input = document.getElementById('musicLibQuery');
    const q = String((input && input.value) || mlib.query || '').trim();
    if (!q) return;
    mlib.query = q; mlib.loading = true; mlib.error = ''; mlib.results = null;
    musicLibRender();
    const ent = mlib.entity;
    try {
        const data = { name: q, media_type: ML_SEARCH_TYPES.map(t => ML_TYPE_OF[t[0]]), limit: 8 };
        const entry = await mlibEntryId_();
        if (entry) data.config_entry_id = entry;
        const res = await mlibWs({ type: 'call_service', domain: 'music_assistant', service: 'search', service_data: data, return_response: true });
        if (mlib.entity !== ent) return;
        mlib.results = (res && res.response) || {};
    } catch (e) {
        mlib.error = 'Zoeken lukt niet: ' + e.message + ' Zoeken werkt via de Music Assistant-integratie.';
    }
    mlib.loading = false;
    musicLibRender();
};

/* ---------- wachtrij ---------- */
async function mlibLoadQueue() {
    const ent = mlib.entity;
    mlib.loading = true; mlib.error = ''; musicLibRender();
    try {
        const res = await mlibWs({ type: 'call_service', domain: 'music_assistant', service: 'get_queue', service_data: { entity_id: ent }, return_response: true });
        if (mlib.entity !== ent) return;
        const r = (res && res.response) || {};
        mlib.queue = r[ent] || r[Object.keys(r)[0]] || null;
    } catch (e) {
        mlib.error = 'De wachtrij is niet op te halen: ' + e.message + ' Dit werkt enkel met spelers van Music Assistant.';
        mlib.queue = null;
    }
    mlib.loading = false;
    musicLibRender();
}
window.musicLibRefreshQueue = function() { mlibLoadQueue(); };

/* ---------- weergave ---------- */
function mlibThumb(url, cls = '') {
    const u = mlibImg(url);
    return `<div class="w-12 h-12 rounded-xl bg-[#e8f2ec] overflow-hidden shrink-0 flex items-center justify-center text-lg ${cls}">${u ? `<img src="${mlibEsc(u)}" alt="" class="w-full h-full object-cover" loading="lazy" onerror="this.remove()">` : '🎵'}</div>`;
}
function mlibQueueItemHtml(it, active, idx) {
    if (!it) return '';
    const name = it.name || it.title || (it.media_item && it.media_item.name) || 'Onbekend';
    const artist = it.artist || (it.media_item && Array.isArray(it.media_item.artists) && it.media_item.artists.map(a => a.name).join(', ')) || '';
    const img = it.image || it.local_image_encoded || (it.media_item && it.media_item.image) || '';
    return `<div class="flex items-center gap-3 p-2 rounded-2xl ${active ? 'bg-[#dcece3]' : 'bg-[#f6f8f5]'}">
        ${idx !== undefined ? `<span class="w-6 text-center text-[11px] font-extrabold text-[#68736d]">${active ? '▶' : idx}</span>` : ''}${mlibThumb(img)}
        <div class="min-w-0 flex-1"><p class="text-sm font-bold text-[#1c2520] truncate">${mlibEsc(name)}</p><p class="text-xs text-[#68736d] truncate">${mlibEsc(artist)}</p></div>
        ${it.duration ? `<span class="text-[11px] font-semibold text-[#68736d]">${musicFormatTime(it.duration)}</span>` : ''}</div>`;
}

function musicLibRender() {
    const box = document.getElementById('musicLibBody');
    if (!box) return;
    const canPlay = permAllowed('control_music');
    const pl = (musicPlayersToShow().players || []).find(p => p.entityId === mlib.entity);
    const tabBtn = (k, label) => `<button type="button" onclick="window.musicLibTab('${k}')" class="px-3.5 py-2 rounded-full text-xs font-extrabold cursor-pointer ${mlib.tab === k ? 'bg-[#152920] text-white' : 'bg-white border border-stone-200 text-[#38443d] hover:bg-stone-100'}">${label}</button>`;
    let body = '';
    if (mlib.loading) body = '<p class="text-sm text-[#68736d] p-4">Laden…</p>';
    else if (mlib.error) body = `<p class="text-sm text-[#9e4516] bg-[#fbf0e8] rounded-2xl p-4">${mlibEsc(mlib.error)}</p>`;

    if (mlib.tab === 'browse' && !mlib.loading) {
        const crumbs = `<div class="flex items-center gap-2 mb-3">
            ${mlib.stack.length ? `<button type="button" onclick="window.musicLibBack()" class="px-3 py-1.5 rounded-xl bg-white border border-stone-200 text-xs font-bold cursor-pointer hover:bg-stone-100">← Terug</button><button type="button" onclick="window.musicLibHome()" class="px-3 py-1.5 rounded-xl bg-white border border-stone-200 text-xs font-bold cursor-pointer hover:bg-stone-100">🏠</button>` : ''}
            <span class="text-sm font-extrabold text-[#1c2520] truncate">${mlibEsc((mlib.node && mlib.node.title) || 'Bibliotheek')}</span></div>`;
        const rows = mlib.items.map((it, i) => `
            <div class="flex items-center gap-3 p-2 rounded-2xl bg-[#f6f8f5] hover:bg-[#eef3ef]">
                <button type="button" onclick="window.musicLibOpenItem(${i})" class="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer">
                    ${mlibThumb(it.thumbnail)}<span class="min-w-0"><span class="block text-sm font-bold text-[#1c2520] truncate">${mlibEsc(it.title)}</span>
                    <span class="block text-[11px] text-[#68736d]">${it.can_expand ? 'Openen ›' : mlibEsc(String(it.media_class || '').replace('_', ' '))}</span></span></button>
                ${it.can_play && canPlay ? `<button type="button" title="Afspelen" onclick="window.musicLibPlay(${i}, 'replace')" class="w-9 h-9 rounded-full bg-[#152920] text-white text-sm cursor-pointer shrink-0">▶</button>
                <button type="button" title="Aan wachtrij toevoegen" onclick="window.musicLibPlay(${i}, 'add')" class="w-9 h-9 rounded-full bg-white border border-stone-200 text-sm cursor-pointer shrink-0">＋</button>` : ''}
            </div>`).join('');
        body += crumbs + (rows ? `<div class="space-y-1.5">${rows}</div>` : (mlib.error ? '' : '<p class="text-sm text-[#68736d] p-2">Niets gevonden op dit niveau.</p>'));
    }

    if (mlib.tab === 'search') {
        mlib.flat = [];
        let res = '';
        if (mlib.results) {
            res = ML_SEARCH_TYPES.map(([k, label, ic]) => {
                const arr = Array.isArray(mlib.results[k]) ? mlib.results[k] : [];
                if (!arr.length) return '';
                return `<div><p class="text-[11px] font-extrabold uppercase tracking-wider text-[#68736d] mt-3 mb-1.5">${ic} ${label}</p><div class="space-y-1.5">${arr.map(it => {
                    const idx = mlib.flat.push(Object.assign({ title: it.name }, it)) - 1;
                    const sub = Array.isArray(it.artists) ? it.artists.map(a => a.name).join(', ') : (it.artist || '');
                    return `<div class="flex items-center gap-3 p-2 rounded-2xl bg-[#f6f8f5]">${mlibThumb(it.image)}<div class="min-w-0 flex-1"><p class="text-sm font-bold text-[#1c2520] truncate">${mlibEsc(it.name)}</p><p class="text-[11px] text-[#68736d] truncate">${mlibEsc(sub)}</p></div>
                        ${canPlay ? `<button type="button" title="Afspelen" onclick="window.musicLibPlay(${idx}, 'replace', true)" class="w-9 h-9 rounded-full bg-[#152920] text-white text-sm cursor-pointer shrink-0">▶</button>
                        <button type="button" title="Aan wachtrij toevoegen" onclick="window.musicLibPlay(${idx}, 'add', true)" class="w-9 h-9 rounded-full bg-white border border-stone-200 text-sm cursor-pointer shrink-0">＋</button>` : ''}</div>`;
                }).join('')}</div></div>`;
            }).join('') || '<p class="text-sm text-[#68736d] p-2">Niets gevonden.</p>';
        }
        body = `<div class="flex gap-2 mb-2"><input id="musicLibQuery" type="text" value="${mlibEsc(mlib.query)}" placeholder="Zoek een nummer, artiest, album of afspeellijst" onkeydown="if(event.key==='Enter')window.musicLibSearch()" class="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl border border-stone-200 text-sm">
            <button type="button" onclick="window.musicLibSearch()" class="px-4 py-2.5 rounded-xl bg-[#152920] text-white text-xs font-extrabold cursor-pointer">Zoek</button></div>` + body + res;
    }

    if (mlib.tab === 'queue' && !mlib.loading) {
        const q = mlib.queue;
        let list = '';
        if (q) {
            const items = Array.isArray(q.items) ? q.items : null;
            const cur = Number(q.current_index);
            if (items && items.length) {
                list = `<div class="space-y-1.5">${items.map((it, i) => mlibQueueItemHtml(it, i === cur, i + 1)).join('')}</div>`;
            } else {
                list = `<div class="space-y-1.5">
                    ${q.current_item ? `<p class="text-[11px] font-extrabold uppercase tracking-wider text-[#68736d] mb-1">Nu aan het spelen</p>${mlibQueueItemHtml(q.current_item, true)}` : ''}
                    ${q.next_item ? `<p class="text-[11px] font-extrabold uppercase tracking-wider text-[#68736d] mt-3 mb-1">Hierna</p>${mlibQueueItemHtml(q.next_item, false)}` : ''}</div>
                    ${typeof q.items === 'number' && q.items > 0 ? `<p class="text-[11px] text-[#68736d] mt-3">Nog ${q.items} nummers in de wachtrij. Music Assistant geeft aan Home Assistant enkel het huidige en volgende nummer door.</p>` : ''}`;
            }
            list = `<div class="flex items-center gap-2 text-[11px] font-bold text-[#68736d] mb-2">${q.shuffle_enabled ? '<span>🔀 Willekeurig</span>' : ''}${q.repeat_mode && q.repeat_mode !== 'off' ? `<span>🔁 ${mlibEsc(q.repeat_mode)}</span>` : ''}</div>` + (list || '');
        }
        body += `<div class="flex justify-end mb-2"><button type="button" onclick="window.musicLibRefreshQueue()" class="px-3 py-1.5 rounded-xl bg-white border border-stone-200 text-xs font-bold cursor-pointer hover:bg-stone-100">↻ Vernieuwen</button></div>` +
            (list.replace(/<[^>]*>/g, '').trim() ? list : (mlib.error ? '' : '<p class="text-sm text-[#68736d] p-2">De wachtrij is leeg of er speelt niets.</p>'));
    }

    box.innerHTML = `
        <div class="flex items-center justify-between gap-3 mb-3">
            <div class="min-w-0"><h3 class="text-lg font-extrabold text-[#1c2520] truncate">🎶 ${mlibEsc((pl && pl.name) || 'Muziek')}</h3><p class="text-[11px] text-[#68736d]">Spotify en andere bronnen via Music Assistant of Home Assistant</p></div>
            <button type="button" onclick="window.musicLibClose()" aria-label="Sluiten" class="w-9 h-9 rounded-full bg-stone-100 hover:bg-stone-200 cursor-pointer shrink-0">✕</button></div>
        <div class="flex flex-wrap gap-2 mb-4">${tabBtn('browse', '📚 Bibliotheek')}${tabBtn('search', '🔎 Zoeken')}${tabBtn('queue', '📋 Wachtrij')}</div>
        <div>${body}</div>`;
}
