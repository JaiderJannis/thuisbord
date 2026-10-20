'use strict';
/* Scènes: één tik en meerdere apparaten volgen.

   appState.scenes = [{ id, name, icon, color, desc, onDisplay, actions: [...] }]
   Acties (type):
     lights    { target: 'all'|'room'|'light', room?, id?, state: 'on'|'off', brightness? }
     shutters  { target: 'all'|'room'|'shutter', room?, id?, action: 'open'|'close'|'position', position? }
     climate   { target: 'all'|'room'|'climate', room?, id?, mode: 'off'|'cool'|'heat'|'auto'|'dry'|'fan_only', temp? }
     service   { service: 'domein.dienst', entity?, data? (JSON) }     -> om het even welke Home Assistant-dienst (scene, script, schakelaar…)
     wait      { seconds }
     message   { text }
   Rechten: view_scenes, control_scenes (uitvoeren), manage_scenes (beheren, enkel gezinsbeheerder). */

const SCENE_COLORS = ['#19975c', '#3b6998', '#c26b1d', '#8e5bb5', '#c2415d', '#0e8a9a', '#6b8e23', '#5568d3'];
const SCENE_EMOJIS = ['🌅', '🌙', '🎬', '🏠', '🚪', '☀️', '❄️', '🔥', '🎉', '📚', '🍽️', '😴', '🧹', '🎵', '💡', '🛋️', '🌿', '🚗'];
const SCENE_ACTION_TYPES = [
    ['lights', '💡 Lampen'], ['shutters', '🪟 Rolluiken'], ['climate', '❄️ Airco'],
    ['service', '⚙️ Home Assistant-dienst'], ['wait', '⏱ Wachten'], ['message', '💬 Melding']
];
const SCENE_HVAC = [['off', 'Uit'], ['cool', 'Koelen'], ['heat', 'Verwarmen'], ['auto', 'Auto'], ['dry', 'Drogen'], ['fan_only', 'Ventilator']];

const sceneRunning = new Set();
const sceneDone = new Set();
let sceneEditOpen = null;       // id van de scène die in Beheer openstaat
let sceneConfirmDelete = null;
let sceneSaveTimer = null;
let scenesHtmlCache = '';
let sceneRowHtmlCache = null;

function sceneEsc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function sceneArr() { if (!Array.isArray(appState.scenes)) appState.scenes = []; return appState.scenes; }
function sceneRooms() { return (appState.rooms && appState.rooms.length) ? appState.rooms : ['Woonkamer', 'Keuken', 'Slaapkamer']; }
function sceneById(id) { return sceneArr().find(s => s.id === id); }
function sceneNewId() { return 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function sceneSave() {
    clearTimeout(sceneSaveTimer);
    sceneSaveTimer = setTimeout(() => { try { persistStateToFirestore(false); } catch (e) { /* negeren */ } }, 500);
}

/* ---------- laatst uitgevoerd (per apparaat, lokaal) ---------- */
function sceneLastRuns() { try { return JSON.parse(localStorage.getItem('thuisbord_scene_last') || '{}') || {}; } catch (e) { return {}; } }
function sceneMarkRun(id) {
    try { const m = sceneLastRuns(); m[id] = Date.now(); localStorage.setItem('thuisbord_scene_last', JSON.stringify(m)); } catch (e) { /* negeren */ }
}
function sceneAgo(ts) {
    if (!ts) return 'nog niet uitgevoerd';
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 1) return 'zonet';
    if (min < 60) return `${min} min geleden`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} u geleden`;
    return `${Math.round(h / 24)} d geleden`;
}

/* ---------- doelen van een actie ---------- */
function sceneTargets(list, a, idKey) {
    const rooms = sceneRooms();
    const items = list.map((item, idx) => ({ item, idx }));
    if (a.target === 'room') return items.filter(x => (x.item.room || rooms[0]) === a.room);
    if (a.target === idKey || a.target === 'item') return items.filter(x => (x.item.id || ('i' + x.idx)) === a.id);
    return items;
}

function sceneActionLabel(a) {
    if (a.type === 'lights') {
        const name = (a.target === 'room' || a.target === 'all') ? '' : ((appState.roomLights || []).find((l, i) => (l.id || 'i' + i) === a.id) || {}).name;
        const who = a.target === 'all' ? 'Alle lampen' : (a.target === 'room' ? `Lampen ${sceneEsc(a.room || '?')}` : `Lamp ${sceneEsc(name || '?')}`);
        return `💡 ${who} ${a.state === 'on' ? `aan${a.brightness ? ` (${a.brightness}%)` : ''}` : 'uit'}`;
    }
    if (a.type === 'shutters') {
        const name = (a.target === 'shutter') ? ((appState.shutters || []).find((l, i) => (l.id || 'i' + i) === a.id) || {}).name : '';
        const who = a.target === 'all' ? 'Alle rolluiken' : (a.target === 'room' ? `Rolluiken ${sceneEsc(a.room || '?')}` : `Rolluik ${sceneEsc(name || '?')}`);
        const what = a.action === 'open' ? 'open' : a.action === 'close' ? 'dicht' : `op ${Number(a.position) || 0}%`;
        return `🪟 ${who} ${what}`;
    }
    if (a.type === 'climate') {
        const name = (a.target === 'climate') ? ((appState.climates || []).find((l, i) => (l.id || 'i' + i) === a.id) || {}).name : '';
        const who = a.target === 'all' ? "Alle airco's" : (a.target === 'room' ? `Airco ${sceneEsc(a.room || '?')}` : `Airco ${sceneEsc(name || '?')}`);
        const mode = (SCENE_HVAC.find(m => m[0] === a.mode) || [0, a.mode])[1].toLowerCase();
        return `❄️ ${who}: ${mode}${a.mode !== 'off' && a.temp ? ` ${a.temp}°` : ''}`;
    }
    if (a.type === 'service') return `⚙️ ${sceneEsc(a.service || 'dienst')}${a.entity ? ' → ' + sceneEsc(a.entity) : ''}`;
    if (a.type === 'wait') return `⏱ Wacht ${Number(a.seconds) || 0} s`;
    if (a.type === 'message') return `💬 ${sceneEsc(a.text || 'Melding')}`;
    return sceneEsc(a.type || '?');
}

/* ---------- uitvoeren ---------- */
const sceneSleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sceneCall(domain, service, data) {
    try { return await window.callHomeAssistantService(domain, service, data); } catch (e) { return false; }
}

async function sceneExecAction(a) {
    if (a.type === 'lights') {
        const targets = sceneTargets(appState.roomLights || [], a, 'light');
        await Promise.all(targets.map(async ({ item: lt }) => {
            const on = a.state === 'on';
            lt.state = on ? 'on' : 'off';
            if (on && a.brightness) lt.brightnessPct = Math.max(1, Math.min(100, Number(a.brightness) || 100));
            if (on && !lt.brightnessPct) lt.brightnessPct = 100;
            if (lt.entityId) {
                const data = { entity_id: lt.entityId };
                if (on && a.brightness) data.brightness_pct = lt.brightnessPct;
                await sceneCall('light', on ? 'turn_on' : 'turn_off', data);
            }
        }));
        return targets.length;
    }
    if (a.type === 'shutters') {
        const targets = sceneTargets(appState.shutters || [], a, 'shutter');
        await Promise.all(targets.map(async ({ item: sh }) => {
            if (a.action === 'open') { sh.state = 'open'; sh.position = 100; if (sh.entityId) await sceneCall('cover', 'open_cover', { entity_id: sh.entityId }); }
            else if (a.action === 'close') { sh.state = 'closed'; sh.position = 0; if (sh.entityId) await sceneCall('cover', 'close_cover', { entity_id: sh.entityId }); }
            else {
                const pos = Math.max(0, Math.min(100, parseInt(a.position, 10) || 0));
                sh.position = pos; sh.state = pos === 0 ? 'closed' : 'open';
                if (sh.entityId) await sceneCall('cover', 'set_cover_position', { entity_id: sh.entityId, position: pos });
            }
        }));
        return targets.length;
    }
    if (a.type === 'climate') {
        const targets = sceneTargets(appState.climates || [], a, 'climate');
        await Promise.all(targets.map(async ({ item: cl }) => {
            cl.hvacMode = a.mode || 'off';
            if (cl.entityId) await sceneCall('climate', 'set_hvac_mode', { entity_id: cl.entityId, hvac_mode: cl.hvacMode });
            if (a.mode !== 'off' && a.temp) {
                const t = Math.max(16, Math.min(30, Number(a.temp) || 21));
                cl.targetTemp = t;
                if (cl.entityId) await sceneCall('climate', 'set_temperature', { entity_id: cl.entityId, temperature: t });
            }
        }));
        return targets.length;
    }
    if (a.type === 'service') {
        const parts = String(a.service || '').trim().split('.');
        if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('ongeldige dienst');
        let data = {};
        if (a.data && String(a.data).trim()) data = JSON.parse(a.data);
        if (a.entity) data.entity_id = a.entity;
        const ok = await sceneCall(parts[0], parts[1], data);
        if (ok === false) throw new Error('Home Assistant niet bereikbaar');
        return 1;
    }
    if (a.type === 'wait') { await sceneSleep(Math.max(0, Math.min(60, Number(a.seconds) || 0)) * 1000); return 0; }
    if (a.type === 'message') { if (typeof showToast === 'function') showToast(a.text || 'Scène'); return 0; }
    return 0;
}

window.runScene = async function(id) {
    if (!permGuard('control_scenes')) return;
    const sc = sceneById(id);
    if (!sc || sceneRunning.has(id)) return;
    sceneRunning.add(id);
    sceneDone.delete(id);
    sceneRefresh();
    let ok = 0, fail = 0;
    for (const a of (sc.actions || [])) {
        try { await sceneExecAction(a); ok++; } catch (e) { fail++; console.warn('Scène-actie mislukt:', e); }
    }
    sceneRunning.delete(id);
    sceneDone.add(id);
    sceneMarkRun(id);
    try {
        if (typeof renderActiveLightsBadgeAndModal === 'function') renderActiveLightsBadgeAndModal();
        if (typeof renderShuttersView === 'function') renderShuttersView();
    } catch (e) { /* negeren */ }
    persistStateToFirestore(false);
    sceneRefresh();
    if (typeof showToast === 'function') showToast(fail ? `${sc.icon || '🎬'} ${sc.name}: ${ok} gelukt, ${fail} mislukt` : `${sc.icon || '🎬'} ${sc.name} uitgevoerd`);
    setTimeout(() => { sceneDone.delete(id); sceneRefresh(); }, 2200);
};

function sceneRefresh() {
    scenesHtmlCache = ''; sceneRowHtmlCache = null;
    renderScenesView();
    renderDisplayScenesRow();
}

/* ---------- scherm: alle scènes ---------- */
function sceneTileHtml(sc, canRun, canEdit, last) {
    const running = sceneRunning.has(sc.id), done = sceneDone.has(sc.id);
    const n = (sc.actions || []).filter(a => a.type !== 'wait' && a.type !== 'message').length;
    return `
        <div class="scene-wrap relative">
            <button type="button" ${canRun ? '' : 'disabled'} onclick="window.runScene('${sc.id}')" class="scene-tile ${running ? 'is-running' : ''} ${done ? 'is-done' : ''} ${canRun ? '' : 'is-locked'}" style="--c:${sceneEsc(sc.color || SCENE_COLORS[0])}">
                <span class="scene-ico">${sceneEsc(sc.icon || '🎬')}</span>
                <span class="scene-name">${sceneEsc(sc.name || 'Scène')}</span>
                <span class="scene-desc">${sceneEsc(sc.desc || (n + ' acties'))}</span>
                <span class="scene-foot"><span>${n} acties · ${sceneAgo(last[sc.id])}</span>
                    <span class="scene-go">${running ? '⏳ Bezig…' : done ? '✓ Klaar' : canRun ? '▶ Uitvoeren' : '🔒'}</span></span>
            </button>
            ${canEdit ? `<button type="button" onclick="window.openScenesAdmin('${sc.id}')" title="Bewerken" aria-label="Bewerken" class="scene-edit">✏️</button>` : ''}
        </div>`;
}

function renderScenesView() {
    const container = document.getElementById('scenesContainer');
    const view = document.getElementById('viewScenes');
    if (!container || (view && view.classList.contains('hidden'))) return;
    const canRun = permAllowed('control_scenes'), canEdit = permAllowed('manage_scenes');
    const manageBtn = document.getElementById('scenesManageBtn');
    if (manageBtn) manageBtn.classList.toggle('hidden', !canEdit);
    const list = sceneArr();
    const last = sceneLastRuns();
    const html = list.length
        ? `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">${list.map(sc => sceneTileHtml(sc, canRun, canEdit, last)).join('')}</div>
           ${canRun ? '' : '<p class="text-xs text-[#68736d] mt-3">Je mag scènes bekijken maar niet uitvoeren. Vraag het aan de beheerder.</p>'}`
        : `<div class="bg-white rounded-[26px] p-8 text-center shadow-sm">
               <p class="text-5xl mb-3">🎬</p>
               <h3 class="text-lg font-extrabold text-[#1c2520]">Nog geen scènes</h3>
               <p class="text-sm text-[#68736d] mt-1 max-w-md mx-auto">Met een scène zet je met één tik meerdere lampen, rolluiken en airco's tegelijk, bijvoorbeeld "Goedenacht".</p>
               ${canEdit ? `<button onclick="window.openScenesAdmin()" class="mt-4 bg-[#152920] text-white font-bold px-5 py-2.5 rounded-xl text-sm cursor-pointer">+ Eerste scène maken</button>` : `<p class="text-xs text-[#8a958f] mt-3">Vraag de beheerder om scènes aan te maken.</p>`}
           </div>`;
    if (html === scenesHtmlCache) return;
    scenesHtmlCache = html;
    container.innerHTML = html;
}

/* ---------- display: snelle scènes ---------- */
function renderDisplayScenesRow() {
    const row = document.getElementById('displayScenesRow');
    if (!row) return;
    const show = currentRole && permAllowed('view_scenes') ? sceneArr().filter(s => s.onDisplay) : [];
    let html = '';
    if (show.length) {
        const canRun = permAllowed('control_scenes');
        html = `<div class="flex items-center gap-2 overflow-x-auto pb-1">
            <span class="text-[11px] font-extrabold uppercase tracking-wider text-[#68736d] shrink-0">🎬 Scènes</span>
            ${show.map(sc => {
                const running = sceneRunning.has(sc.id), done = sceneDone.has(sc.id);
                return `<button type="button" ${canRun ? '' : 'disabled'} onclick="window.runScene('${sc.id}')" class="scene-chip ${running ? 'is-running' : ''} ${done ? 'is-done' : ''}" style="--c:${sceneEsc(sc.color || SCENE_COLORS[0])}">
                    <span>${sceneEsc(sc.icon || '🎬')}</span><span>${sceneEsc(sc.name)}</span>${done ? '<span>✓</span>' : running ? '<span>⏳</span>' : ''}</button>`;
            }).join('')}
        </div>`;
    }
    if (html === sceneRowHtmlCache) return;
    sceneRowHtmlCache = html;
    row.innerHTML = html;
    row.classList.toggle('hidden', !html);
}

/* =====================================================================
   BEHEER: scènes maken en bewerken
   ===================================================================== */
window.openScenesAdmin = function(id) {
    if (!permAllowed('manage_scenes')) { permGuard('manage_scenes'); return; }
    if (id) sceneEditOpen = id;
    switchView('admin');
    switchAdminTab('scenes');
};

const SCENE_TEMPLATES = [
    { name: 'Goedemorgen', icon: '🌅', color: '#c26b1d', desc: 'Rolluiken open, lampen uit',
      actions: () => [{ type: 'shutters', target: 'all', action: 'open' }, { type: 'lights', target: 'all', state: 'off' }] },
    { name: 'Goedenacht', icon: '🌙', color: '#5568d3', desc: 'Alles uit en rolluiken dicht',
      actions: () => [{ type: 'lights', target: 'all', state: 'off' }, { type: 'shutters', target: 'all', action: 'close' }, { type: 'climate', target: 'all', mode: 'off' }] },
    { name: 'Weg van huis', icon: '🚪', color: '#3b6998', desc: 'Lampen en airco uit, rolluiken dicht',
      actions: () => [{ type: 'lights', target: 'all', state: 'off' }, { type: 'climate', target: 'all', mode: 'off' }, { type: 'shutters', target: 'all', action: 'close' }] },
    { name: 'Thuiskomst', icon: '🏠', color: '#19975c', desc: 'Rolluiken open en lampen aan',
      actions: () => [{ type: 'shutters', target: 'all', action: 'open' }, { type: 'lights', target: 'room', room: sceneLivingRoom(), state: 'on', brightness: 70 }] },
    { name: 'Film kijken', icon: '🎬', color: '#8e5bb5', desc: 'Woonkamer gedimd, rolluiken dicht',
      actions: () => [{ type: 'lights', target: 'all', state: 'off' }, { type: 'lights', target: 'room', room: sceneLivingRoom(), state: 'on', brightness: 15 }, { type: 'shutters', target: 'room', room: sceneLivingRoom(), action: 'close' }] },
    { name: 'Gezellig', icon: '🛋️', color: '#c2415d', desc: 'Warm en gedimd licht in de woonkamer',
      actions: () => [{ type: 'lights', target: 'room', room: sceneLivingRoom(), state: 'on', brightness: 40 }] },
    { name: 'Hittegolf', icon: '☀️', color: '#c26b1d', desc: 'Rolluiken dicht en airco koelen',
      actions: () => [{ type: 'shutters', target: 'all', action: 'close' }, { type: 'climate', target: 'all', mode: 'cool', temp: 22 }] }
];
function sceneLivingRoom() {
    const rooms = sceneRooms();
    return rooms.find(r => /woon|living|zit/i.test(r)) || rooms[0];
}

function sceneDefaultAction(type) {
    const rooms = sceneRooms();
    if (type === 'lights') return { type, target: 'all', state: 'off' };
    if (type === 'shutters') return { type, target: 'all', action: 'close' };
    if (type === 'climate') return { type, target: 'all', mode: 'off' };
    if (type === 'service') return { type, service: '', entity: '', data: '' };
    if (type === 'wait') return { type, seconds: 5 };
    if (type === 'message') return { type, text: '' };
    return { type, room: rooms[0] };
}

window.sceneAdd = function(templateIdx) {
    if (!permGuard('manage_scenes')) return;
    const t = templateIdx === '' || templateIdx === undefined ? null : SCENE_TEMPLATES[Number(templateIdx)];
    const n = sceneArr().length;
    const sc = t
        ? { id: sceneNewId(), name: t.name, icon: t.icon, color: t.color, desc: t.desc, onDisplay: false, actions: t.actions() }
        : { id: sceneNewId(), name: 'Nieuwe scène', icon: '🎬', color: SCENE_COLORS[n % SCENE_COLORS.length], desc: '', onDisplay: false, actions: [] };
    sceneArr().push(sc);
    sceneEditOpen = sc.id;
    sceneSave(); sceneRefresh(); renderAdminScenes();
};

window.sceneDuplicate = function(id) {
    if (!permGuard('manage_scenes')) return;
    const sc = sceneById(id);
    if (!sc) return;
    const copy = JSON.parse(JSON.stringify(sc));
    copy.id = sceneNewId(); copy.name = sc.name + ' (kopie)';
    const i = sceneArr().indexOf(sc);
    sceneArr().splice(i + 1, 0, copy);
    sceneEditOpen = copy.id;
    sceneSave(); sceneRefresh(); renderAdminScenes();
};

window.sceneMove = function(id, dir) {
    if (!permGuard('manage_scenes')) return;
    const arr = sceneArr(), i = arr.findIndex(s => s.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    sceneSave(); sceneRefresh(); renderAdminScenes();
};

window.sceneDelete = function(id) {
    if (!permGuard('manage_scenes')) return;
    if (sceneConfirmDelete !== id) { sceneConfirmDelete = id; renderAdminScenes(); setTimeout(() => { if (sceneConfirmDelete === id) { sceneConfirmDelete = null; renderAdminScenes(); } }, 4000); return; }
    sceneConfirmDelete = null;
    appState.scenes = sceneArr().filter(s => s.id !== id);
    if (sceneEditOpen === id) sceneEditOpen = null;
    sceneSave(); sceneRefresh(); renderAdminScenes();
};

window.sceneToggleOpen = function(id) {
    sceneEditOpen = sceneEditOpen === id ? null : id;
    renderAdminScenes();
};

window.sceneSet = function(id, field, value, rerender) {
    if (!permGuard('manage_scenes')) return;
    const sc = sceneById(id);
    if (!sc) return;
    sc[field] = (field === 'onDisplay') ? !!value : value;
    sceneSave(); sceneRefresh();
    if (rerender) renderAdminScenes();
};

window.sceneActionAdd = function(id, type) {
    if (!permGuard('manage_scenes')) return;
    const sc = sceneById(id);
    if (!sc || !type) return;
    (sc.actions = sc.actions || []).push(sceneDefaultAction(type));
    sceneSave(); sceneRefresh(); renderAdminScenes();
};

window.sceneActionRemove = function(id, idx) {
    if (!permGuard('manage_scenes')) return;
    const sc = sceneById(id);
    if (!sc || !sc.actions) return;
    sc.actions.splice(idx, 1);
    sceneSave(); sceneRefresh(); renderAdminScenes();
};

window.sceneActionMove = function(id, idx, dir) {
    if (!permGuard('manage_scenes')) return;
    const sc = sceneById(id);
    if (!sc || !sc.actions) return;
    const j = idx + dir;
    if (j < 0 || j >= sc.actions.length) return;
    [sc.actions[idx], sc.actions[j]] = [sc.actions[j], sc.actions[idx]];
    sceneSave(); renderAdminScenes();
};

window.sceneActionSet = function(id, idx, field, value, rerender) {
    if (!permGuard('manage_scenes')) return;
    const sc = sceneById(id);
    const a = sc && sc.actions && sc.actions[idx];
    if (!a) return;
    if (field === 'type') {
        sc.actions[idx] = sceneDefaultAction(value);
        rerender = true;
    } else if (field === 'target') {
        a.target = value;
        const rooms = sceneRooms();
        if (value === 'room' && !a.room) a.room = rooms[0];
        if (value !== 'room') delete a.room;
        if (value === 'all') delete a.id;
        if (value !== 'all' && value !== 'room' && !a.id) a.id = sceneFirstItemId(a.type);
        rerender = true;
    } else if (['brightness', 'position', 'temp', 'seconds'].includes(field)) {
        a[field] = value === '' ? '' : Number(value);
    } else {
        a[field] = value;
    }
    sceneSave(); sceneRefresh();
    if (rerender) renderAdminScenes();
};

function sceneFirstItemId(type) {
    const list = type === 'lights' ? appState.roomLights : type === 'shutters' ? appState.shutters : appState.climates;
    const first = (list || [])[0];
    return first ? (first.id || 'i0') : '';
}

window.sceneTest = async function(id) {
    // Testen mag voor wie scènes beheert, ook zonder "uitvoeren"-recht
    if (!permGuard('manage_scenes')) return;
    return window.runScene(id);
};

/* ---------- editor ---------- */
function sceneSelect(options, value, onchange, extra = '') {
    return `<select onchange="${onchange}" class="px-2.5 py-2 rounded-xl bg-white border border-stone-200 text-xs font-bold ${extra}">${options.map(o => `<option value="${sceneEsc(o[0])}" ${String(o[0]) === String(value) ? 'selected' : ''}>${sceneEsc(o[1])}</option>`).join('')}</select>`;
}

function sceneActionEditor(sc, a, i) {
    const id = sc.id;
    const rooms = sceneRooms();
    const roomOpts = rooms.map(r => [r, '🏠 ' + r]);
    const set = (field, valueExpr, rerender = false) => `window.sceneActionSet('${id}', ${i}, '${field}', ${valueExpr}, ${rerender})`;
    const targetPicker = (kind, listLabel, items) => {
        const opts = [['all', 'Alle'], ['room', 'Een ruimte'], [kind, listLabel]];
        const itemOpts = items.map((x, k) => [x.id || ('i' + k), (x.room ? x.room + ' · ' : '') + x.name]);
        return sceneSelect(opts, a.target || 'all', set('target', 'this.value'))
            + (a.target === 'room' ? sceneSelect(roomOpts, a.room || rooms[0], set('room', 'this.value')) : '')
            + (a.target === kind ? (itemOpts.length ? sceneSelect(itemOpts, a.id || itemOpts[0][0], set('id', 'this.value')) : '<span class="text-[11px] text-red-600 font-semibold">Nog geen apparaten</span>') : '');
    };
    let fields = '';
    if (a.type === 'lights') {
        fields = targetPicker('light', 'Eén lamp', appState.roomLights || [])
            + sceneSelect([['on', 'Aan'], ['off', 'Uit']], a.state || 'off', set('state', 'this.value', true))
            + (a.state === 'on' ? `<label class="flex items-center gap-1.5 text-[11px] font-bold text-[#55605a]">Helderheid <input type="number" min="1" max="100" value="${sceneEsc(a.brightness || '')}" placeholder="–" onchange="${set('brightness', 'this.value')}" class="w-16 px-2 py-1.5 rounded-lg border border-stone-200 text-xs font-bold">%</label>` : '');
    } else if (a.type === 'shutters') {
        fields = targetPicker('shutter', 'Eén rolluik', appState.shutters || [])
            + sceneSelect([['open', 'Open'], ['close', 'Dicht'], ['position', 'Op een stand']], a.action || 'close', set('action', 'this.value', true))
            + (a.action === 'position' ? `<label class="flex items-center gap-1.5 text-[11px] font-bold text-[#55605a]">Open <input type="number" min="0" max="100" value="${sceneEsc(a.position ?? 50)}" onchange="${set('position', 'this.value')}" class="w-16 px-2 py-1.5 rounded-lg border border-stone-200 text-xs font-bold">%</label>` : '');
    } else if (a.type === 'climate') {
        fields = targetPicker('climate', 'Één airco', appState.climates || [])
            + sceneSelect(SCENE_HVAC, a.mode || 'off', set('mode', 'this.value', true))
            + (a.mode && a.mode !== 'off' ? `<label class="flex items-center gap-1.5 text-[11px] font-bold text-[#55605a]">Temperatuur <input type="number" min="16" max="30" step="0.5" value="${sceneEsc(a.temp || '')}" placeholder="–" onchange="${set('temp', 'this.value')}" class="w-16 px-2 py-1.5 rounded-lg border border-stone-200 text-xs font-bold">°C</label>` : '');
    } else if (a.type === 'service') {
        fields = `<input type="text" value="${sceneEsc(a.service || '')}" placeholder="dienst, bv. scene.turn_on" onchange="${set('service', 'this.value')}" class="flex-1 min-w-[160px] px-2.5 py-2 rounded-xl border border-stone-200 text-xs font-mono">
            <input type="text" list="haEntitiesDatalist" value="${sceneEsc(a.entity || '')}" placeholder="entiteit (optioneel)" onchange="${set('entity', 'this.value')}" class="flex-1 min-w-[160px] px-2.5 py-2 rounded-xl border border-stone-200 text-xs font-mono">
            <input type="text" value="${sceneEsc(a.data || '')}" placeholder='extra gegevens als JSON, bv. {"brightness_pct":30}' onchange="${set('data', 'this.value')}" class="w-full px-2.5 py-2 rounded-xl border border-stone-200 text-xs font-mono">`;
    } else if (a.type === 'wait') {
        fields = `<label class="flex items-center gap-1.5 text-[11px] font-bold text-[#55605a]">Wacht <input type="number" min="0" max="60" value="${sceneEsc(a.seconds ?? 5)}" onchange="${set('seconds', 'this.value')}" class="w-16 px-2 py-1.5 rounded-lg border border-stone-200 text-xs font-bold"> seconden (max. 60)</label>`;
    } else if (a.type === 'message') {
        fields = `<input type="text" value="${sceneEsc(a.text || '')}" placeholder="Tekst die even op het scherm verschijnt" onchange="${set('text', 'this.value')}" class="flex-1 min-w-[200px] px-2.5 py-2 rounded-xl border border-stone-200 text-xs font-semibold">`;
    }
    return `
        <div class="rounded-2xl border border-stone-200/80 bg-[#f6f8f5] p-3 space-y-2">
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                    <span class="w-6 h-6 rounded-full bg-[#152920] text-white text-[11px] font-extrabold flex items-center justify-center">${i + 1}</span>
                    ${sceneSelect(SCENE_ACTION_TYPES, a.type, set('type', 'this.value', true))}
                </div>
                <div class="flex items-center gap-1">
                    <button type="button" onclick="window.sceneActionMove('${id}', ${i}, -1)" aria-label="Omhoog" class="w-8 h-8 rounded-lg bg-white border border-stone-200 hover:bg-stone-100 text-xs font-bold cursor-pointer">↑</button>
                    <button type="button" onclick="window.sceneActionMove('${id}', ${i}, 1)" aria-label="Omlaag" class="w-8 h-8 rounded-lg bg-white border border-stone-200 hover:bg-stone-100 text-xs font-bold cursor-pointer">↓</button>
                    <button type="button" onclick="window.sceneActionRemove('${id}', ${i})" aria-label="Verwijder actie" class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold cursor-pointer">✕</button>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">${fields}</div>
        </div>`;
}

function sceneEditorCard(sc, idx, total) {
    const open = sceneEditOpen === sc.id;
    const nAct = (sc.actions || []).length;
    const confirm = sceneConfirmDelete === sc.id;
    const head = `
        <div class="flex flex-wrap items-center justify-between gap-3 p-4 ${open ? 'border-b border-stone-200/70' : ''}">
            <button type="button" onclick="window.sceneToggleOpen('${sc.id}')" class="flex items-center gap-3 text-left cursor-pointer min-w-0 flex-1">
                <span class="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl text-white shrink-0" style="background:${sceneEsc(sc.color || SCENE_COLORS[0])}">${sceneEsc(sc.icon || '🎬')}</span>
                <span class="min-w-0">
                    <span class="block text-sm font-extrabold text-[#1c2520] truncate">${sceneEsc(sc.name || 'Scène')}</span>
                    <span class="block text-[11px] text-[#68736d] truncate">${nAct} actie${nAct === 1 ? '' : 's'}${sc.onDisplay ? ' · op het display' : ''}</span>
                </span>
                <span class="ml-auto text-[#68736d] transition-transform ${open ? 'rotate-180' : ''}">▼</span>
            </button>
            <div class="flex items-center gap-1.5">
                <button type="button" onclick="window.sceneTest('${sc.id}')" class="px-3 py-1.5 rounded-xl bg-[#dcece3] hover:bg-[#c9e3d4] text-[#152920] text-xs font-bold cursor-pointer">▶ Test</button>
                <button type="button" onclick="window.sceneDuplicate('${sc.id}')" title="Dupliceren" class="w-8 h-8 rounded-lg bg-white border border-stone-200 hover:bg-stone-100 text-xs cursor-pointer">⧉</button>
                <button type="button" ${idx === 0 ? 'disabled' : ''} onclick="window.sceneMove('${sc.id}', -1)" aria-label="Omhoog" class="w-8 h-8 rounded-lg bg-white border border-stone-200 hover:bg-stone-100 text-xs font-bold cursor-pointer disabled:opacity-40">↑</button>
                <button type="button" ${idx === total - 1 ? 'disabled' : ''} onclick="window.sceneMove('${sc.id}', 1)" aria-label="Omlaag" class="w-8 h-8 rounded-lg bg-white border border-stone-200 hover:bg-stone-100 text-xs font-bold cursor-pointer disabled:opacity-40">↓</button>
                <button type="button" onclick="window.sceneDelete('${sc.id}')" class="px-2.5 h-8 rounded-lg ${confirm ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'} text-xs font-bold cursor-pointer">${confirm ? 'Zeker?' : '🗑'}</button>
            </div>
        </div>`;
    if (!open) return `<section class="bg-white rounded-[22px] shadow-sm border border-stone-200/70">${head}</section>`;
    return `<section class="bg-white rounded-[22px] shadow-sm border-2 border-[#19975c]/40">
        ${head}
        <div class="p-4 space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <label class="block text-[11px] font-bold text-[#38443d] mb-1">Naam</label>
                    <input type="text" value="${sceneEsc(sc.name || '')}" onchange="window.sceneSet('${sc.id}', 'name', this.value, true)" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm font-semibold">
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-[#38443d] mb-1">Korte omschrijving (optioneel)</label>
                    <input type="text" value="${sceneEsc(sc.desc || '')}" onchange="window.sceneSet('${sc.id}', 'desc', this.value)" placeholder="bv. Alles uit en rolluiken dicht" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm">
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-[#38443d] mb-1">Icoon</label>
                    <div class="flex flex-wrap items-center gap-1.5">
                        <input type="text" maxlength="4" value="${sceneEsc(sc.icon || '')}" onchange="window.sceneSet('${sc.id}', 'icon', this.value, true)" class="w-14 px-2 py-2 rounded-xl border border-stone-200 text-center text-lg">
                        ${SCENE_EMOJIS.map(e => `<button type="button" onclick="window.sceneSet('${sc.id}', 'icon', '${e}', true)" class="w-8 h-8 rounded-lg ${sc.icon === e ? 'bg-[#dcece3] ring-2 ring-[#19975c]' : 'bg-[#f4f7f4] hover:bg-stone-200'} text-base cursor-pointer">${e}</button>`).join('')}
                    </div>
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-[#38443d] mb-1">Kleur</label>
                    <div class="flex flex-wrap items-center gap-2">
                        ${SCENE_COLORS.map(c => `<button type="button" onclick="window.sceneSet('${sc.id}', 'color', '${c}', true)" aria-label="Kleur ${c}" class="w-8 h-8 rounded-full cursor-pointer ${sc.color === c ? 'ring-2 ring-offset-2 ring-[#152920]' : ''}" style="background:${c}"></button>`).join('')}
                    </div>
                    <label class="flex items-center gap-2 mt-3 text-xs font-bold text-[#38443d] cursor-pointer">
                        <input type="checkbox" ${sc.onDisplay ? 'checked' : ''} onchange="window.sceneSet('${sc.id}', 'onDisplay', this.checked)" class="w-4 h-4 accent-[#152920]">
                        Snelknop op het wanddisplay tonen
                    </label>
                </div>
            </div>

            <div class="space-y-2.5">
                <div class="flex items-center justify-between">
                    <h4 class="text-sm font-extrabold text-[#1c2520]">Wat gebeurt er? <span class="text-[11px] font-semibold text-[#68736d]">(van boven naar onder)</span></h4>
                </div>
                ${(sc.actions || []).length ? (sc.actions || []).map((a, i) => sceneActionEditor(sc, a, i)).join('') : '<p class="text-xs text-[#68736d] italic bg-[#f6f8f5] rounded-2xl p-3">Nog geen acties. Voeg er hieronder een toe.</p>'}
                <div class="flex flex-wrap items-center gap-2 pt-1">
                    ${sceneSelect([['', '+ Actie toevoegen…'], ...SCENE_ACTION_TYPES], '', `window.sceneActionAdd('${sc.id}', this.value)`)}
                    <span class="text-[11px] text-[#68736d]">Tip: met "Home Assistant-dienst" start je ook een eigen scène of script uit Home Assistant.</span>
                </div>
                ${(sc.actions || []).length ? `<div class="rounded-2xl bg-[#f0f5f1] p-3 text-[11px] text-[#38443d] space-y-0.5"><p class="font-extrabold">Samenvatting</p>${sc.actions.map(a => `<p>${sceneActionLabel(a)}</p>`).join('')}</div>` : ''}
            </div>
        </div>
    </section>`;
}

function renderAdminScenes() {
    const container = document.getElementById('adminScenesContainer');
    if (!container) return;
    const list = sceneArr();
    container.innerHTML = `
        <div class="bg-white rounded-[26px] p-5 sm:p-6 shadow-sm space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <span class="inline-block bg-[#e8f2ec] text-[#197447] text-[11px] font-extrabold px-2.5 py-1 rounded-full">🎬 Scènes</span>
                    <h3 class="text-lg font-bold text-[#1c2520] mt-1">Scènes beheren</h3>
                    <p class="text-xs text-[#68736d] max-w-xl">Een scène is een rijtje acties dat met één tik wordt uitgevoerd. Wie scènes mag bekijken of uitvoeren stel je in bij Rechten.</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    ${sceneSelect([['', '+ Uit sjabloon…'], ...SCENE_TEMPLATES.map((t, i) => [i, `${t.icon} ${t.name}`])], '', 'if (this.value !== \'\') window.sceneAdd(this.value)')}
                    <button type="button" onclick="window.sceneAdd()" class="bg-[#152920] hover:bg-[#233f31] text-white font-bold px-4 py-2 rounded-xl text-xs cursor-pointer">+ Lege scène</button>
                </div>
            </div>
            ${list.length ? '' : '<p class="text-sm text-[#68736d] bg-[#f6f8f5] rounded-2xl p-4">Nog geen scènes. Kies hierboven een sjabloon (bijv. Goedenacht) of maak een lege scène.</p>'}
        </div>
        <div class="space-y-3">${list.map((sc, i) => sceneEditorCard(sc, i, list.length)).join('')}</div>`;
}
