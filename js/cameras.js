'use strict';
/* Camera's uit Home Assistant met snapshots die ververst worden en livebeeld (MJPEG-stream).
   appState.cameras = { items: [ { id, name, entityId } ] }. Zonder gekozen camera's worden alle camera.* entiteiten getoond.
   Beelden komen rechtstreeks van Home Assistant via /api/camera_proxy(_stream)/<entiteit>?token=<access_token van de entiteit>.
   Dus: Home Assistant moet vanaf dit toestel bereikbaar zijn via dezelfde URL als de koppeling (bij https-bord ook https). */

const CAM_REFRESH_MS = 2000;       // snapshot-interval op de pagina
const CAM_FULL_MS = 1000;          // sneller verversen in volledig scherm (voelt als live, zonder stream)
let camEdit = false;
let camHtmlCache = '';
let camFull = '';
let camSaveTimer = null;
let camTimer = null;

function ensureCameras() {
    if (!appState.cameras || typeof appState.cameras !== 'object') appState.cameras = { items: [] };
    if (!Array.isArray(appState.cameras.items)) appState.cameras.items = [];
    return appState.cameras;
}
const caEsc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const camValid = (id) => typeof id === 'string' && /^camera\.[a-z0-9_]+$/.test(id);
function camSave(now) {
    clearTimeout(camSaveTimer);
    const go = () => { try { persistStateToFirestore(false); } catch (e) { /* negeren */ } };
    if (now) go(); else camSaveTimer = setTimeout(go, 600);
}

function camerasAll() {
    return ((typeof discoveredHaEntities !== 'undefined' ? discoveredHaEntities : []) || []).filter(s => s && camValid(s.entity_id));
}
function camerasToShow() {
    const cfg = ensureCameras().items.filter(c => c && camValid(c.entityId));
    if (cfg.length) return { configured: true, items: cfg };
    return { configured: false, items: camerasAll().slice(0, 12).map(s => ({ id: s.entity_id, name: (s.attributes && s.attributes.friendly_name) || s.entity_id, entityId: s.entity_id })) };
}

/* ---------- adressen van beeld en stream ---------- */
function camBase() { return typeof getCleanHaUrl === 'function' ? getCleanHaUrl() : ''; }
function camState(entityId) { return haStateObj(haStatesMap(), entityId); }
function camToken(st) { return st && st.attributes && st.attributes.access_token ? String(st.attributes.access_token) : ''; }
function cameraSnapshotUrl(entityId, bust) {
    const st = camState(entityId), base = camBase();
    if (!base || !st) return '';
    let u = '';
    const pic = st.attributes && st.attributes.entity_picture;
    if (pic) u = /^https?:\/\//i.test(String(pic)) ? String(pic) : (String(pic).startsWith('/') ? base + pic : '');
    if (!u) { const t = camToken(st); if (t) u = `${base}/api/camera_proxy/${entityId}?token=${encodeURIComponent(t)}`; }
    if (!u) return '';
    return bust ? u + (u.includes('?') ? '&' : '?') + '_=' + Date.now() : u;
}
function camKind(st) {
    if (!st || !haIsUsable(st)) return 'unavailable';
    const s = String(st.state).toLowerCase();
    if (s === 'recording') return 'recording';
    if (s === 'streaming') return 'streaming';
    return 'idle';
}

/* ---------- weergave ---------- */
function camCardHtml(c, i) {
    const st = camState(c.entityId);
    const kind = camKind(st);
    const eid = caEsc(c.entityId);
    const snap = cameraSnapshotUrl(c.entityId, false);
    const chip = { recording: ['● Neemt op', 'bg-red-100 text-red-700'], streaming: ['Streamt', 'bg-[#dcece3] text-[#1c643f]'], idle: ['Stand-by', 'bg-stone-200 text-stone-600'], unavailable: ['Niet beschikbaar', 'bg-red-50 text-red-700'] }[kind];
    const src = snap;
    return `
        <article class="bg-white rounded-[26px] overflow-hidden shadow-sm border border-stone-200/80">
            <div class="relative bg-black aspect-video cursor-pointer" onclick="window.camerasOpen('${eid}')">
                ${src ? `<img data-cam="${eid}" src="${caEsc(src)}" alt="${caEsc(c.name)}" class="w-full h-full object-cover" onerror="this.style.opacity='.25'" onload="this.style.opacity='1'">`
                      : `<div class="absolute inset-0 flex flex-col items-center justify-center text-center text-white/80 p-4"><span class="text-3xl mb-2">📹</span><p class="text-xs font-bold">${camBase() ? 'Geen beeldtoken beschikbaar voor deze camera' : 'Nog geen verbinding met Home Assistant'}</p></div>`}
                <span class="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[11px] font-extrabold ${chip[1]}">${chip[0]}</span>
            </div>
            <div class="flex items-center justify-between gap-3 p-4">
                <h3 class="text-base font-extrabold text-[#1c2520] truncate">${caEsc(c.name || c.entityId)}</h3>
                <div class="flex gap-2 shrink-0">
                    <button type="button" onclick="window.camerasOpen('${eid}')" title="Volledig scherm" aria-label="Volledig scherm" class="w-9 h-9 rounded-xl bg-stone-100 hover:bg-stone-200 cursor-pointer">⤢</button>
                </div>
            </div>
        </article>`;
}

function camEditHtml() {
    const cfg = ensureCameras().items;
    const all = camerasAll();
    const chosen = new Set(cfg.map(c => c.entityId));
    const rows = cfg.map((c, i) => `
        <div class="flex flex-wrap items-center gap-2 bg-[#f6f8f5] p-3 rounded-2xl border border-stone-200/70">
            <input type="text" value="${caEsc(c.name || '')}" onchange="window.camerasSetName(${i},this.value)" class="flex-1 min-w-[140px] px-3 py-2 rounded-xl border border-stone-200 text-sm font-bold">
            <input type="text" list="haEntitiesDatalist" value="${caEsc(c.entityId || '')}" onchange="window.camerasSetEntity(${i},this.value)" class="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-stone-200 text-xs font-mono">
            <button type="button" onclick="window.camerasMove(${i},-1)" class="w-9 h-9 rounded-xl bg-white border border-stone-200 cursor-pointer">↑</button>
            <button type="button" onclick="window.camerasMove(${i},1)" class="w-9 h-9 rounded-xl bg-white border border-stone-200 cursor-pointer">↓</button>
            <button type="button" onclick="window.camerasRemove(${i})" class="px-3 h-9 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 cursor-pointer">🗑</button>
        </div>`).join('');
    const avail = all.filter(s => !chosen.has(s.entity_id));
    return `
        <div class="bg-white rounded-[26px] p-6 shadow-sm space-y-4 border-2 border-[#19975c]/40">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="max-w-2xl"><h3 class="text-lg font-bold text-[#1c2520]">Camera's kiezen</h3>
                <p class="text-xs text-[#68736d]">Kies welke camera's op deze pagina staan. Kies je er geen, dan worden alle camera's uit Home Assistant getoond.</p></div>
                <button type="button" onclick="window.camerasToggleEdit()" class="px-5 py-2.5 rounded-xl bg-[#152920] text-white text-sm font-bold cursor-pointer">✓ Klaar</button>
            </div>
            ${rows || '<p class="text-xs text-[#68736d] italic">Nog geen camera\'s gekozen: nu worden ze allemaal getoond.</p>'}
            <div><p class="text-[11px] font-extrabold uppercase tracking-wider text-[#68736d] mb-2">Gevonden in Home Assistant (${all.length})</p>
            ${avail.length ? `<div class="flex flex-wrap gap-2">${avail.map(s => `<button type="button" onclick="window.camerasAdd('${caEsc(s.entity_id)}')" class="px-3 py-1.5 rounded-xl bg-[#e8f2ec] hover:bg-[#dcece3] text-[#152920] text-xs font-bold cursor-pointer">+ ${caEsc((s.attributes && s.attributes.friendly_name) || s.entity_id)}</button>`).join('')}</div>`
                : `<p class="text-xs text-[#68736d] italic">${all.length ? 'Alle gevonden camera\'s staan al in de lijst.' : 'Geen camera-entiteiten gevonden. Haal eerst de entiteiten op bij Beheer → Home Assistant.'}</p>`}</div>
        </div>`;
}

function renderCamerasView() {
    const { items } = camerasToShow();
    const eb = document.getElementById('camerasEditBtn');
    if (eb) eb.classList.toggle('hidden', !permAllowed('edit_cameras'));
    renderCameraModal();

    const container = document.getElementById('camerasContainer');
    const view = document.getElementById('viewCameras');
    if (!container || (view && view.classList.contains('hidden'))) return;
    const ae = document.activeElement;
    if (camEdit && ae && container.contains && container.contains(ae) && ['INPUT', 'SELECT'].includes(ae.tagName)) return;

    let html = '';
    if (camEdit && permAllowed('edit_cameras')) html += camEditHtml();
    if (!items.length) {
        html += `<div class="bg-white rounded-[26px] p-8 text-center shadow-sm"><p class="text-5xl mb-3">📹</p><h3 class="text-lg font-extrabold text-[#1c2520]">Geen camera's gevonden</h3>
            <p class="text-sm text-[#68736d] mt-1 max-w-md mx-auto">${(typeof discoveredHaEntities !== 'undefined' && discoveredHaEntities.length) ? 'Er zijn geen camera-entiteiten in Home Assistant gevonden.' : 'Koppel eerst Home Assistant bij Beheer.'}</p></div>`;
    } else {
        html += `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">${items.map((c, i) => camCardHtml(c, i)).join('')}</div>`;
    }
    // de tokens in de adressen wisselen af en toe; alleen herschrijven bij echte wijzigingen (anders haperen de streams)
    const key = html.replace(/(token=)[^"&]+/g, '$1').replace(/&_=\d+/g, '');
    if (key === camHtmlCache) return;
    camHtmlCache = key;
    container.innerHTML = html;
}

/* ---------- volledig scherm ---------- */
function renderCameraModal() {
    const modal = document.getElementById('cameraModal');
    if (!modal) return;
    if (!camFull) { modal.classList.add('hidden'); modal.classList.remove('flex'); const im = document.getElementById('cameraModalImg'); if (im && im.getAttribute && im.getAttribute('src')) im.setAttribute('src', ''); return; }
    const cams = camerasToShow().items.concat(camerasAll().map(s => ({ entityId: s.entity_id, name: (s.attributes && s.attributes.friendly_name) || s.entity_id })));
    const c = cams.find(x => x.entityId === camFull);
    const title = document.getElementById('cameraModalTitle');
    if (title) title.textContent = (c && c.name) || camFull;
    const img = document.getElementById('cameraModalImg');
    if (img && img.getAttribute) {
        if (!img.getAttribute('src')) img.setAttribute('src', cameraSnapshotUrl(camFull, false));   // meteen het laatste beeld, nooit zwart
    }
    modal.classList.remove('hidden'); modal.classList.add('flex');
}
window.camerasOpen = function(entityId) {
    if (!permGuard('view_cameras')) return;
    if (!camValid(entityId)) return;
    camFull = entityId;
    const img = document.getElementById('cameraModalImg'); if (img && img.setAttribute) img.setAttribute('src', cameraSnapshotUrl(entityId, false));
    renderCameraModal();
    camerasEnsureTimer();
    camRtcStart(entityId);
};
window.camerasClose = function() { camFull = ''; camRtcStop(); renderCameraModal(); };

/* ---------- echt livebeeld via WebRTC (Home Assistant + go2rtc) ----------
   Alleen voor camera's die een stream aanbieden (supported_features bit 2; bij 'Algemene camera' = ingevulde Stream-bron).
   Tot het eerste videobeeld er is blijft het snapshot-beeld staan; lukt WebRTC niet, dan blijven de snapshots lopen. */
let camRtc = null;
function camStreamable(entityId) {
    const st = camState(entityId);
    return !!(st && st.attributes && (Number(st.attributes.supported_features) & 2));
}
function camRtcStop() {
    const r = camRtc; camRtc = null;
    if (r) { clearTimeout(r.timer); try { r.pc && r.pc.close(); } catch (e) { /* negeren */ } try { r.ws && r.ws.close(); } catch (e) { /* negeren */ } }
    const v = document.getElementById('cameraModalVideo');
    if (v) { try { v.srcObject = null; } catch (e) { /* negeren */ } v.classList.add('hidden'); }
    const b = document.getElementById('cameraModalLive'); if (b) b.textContent = '';
}
function camRtcStart(entityId) {
    camRtcStop();
    const v = document.getElementById('cameraModalVideo'), tag = document.getElementById('cameraModalLive');
    const base = camBase(), token = String(appState.haToken || '').trim();
    if (!camStreamable(entityId) || !base || !token || typeof RTCPeerConnection === 'undefined' || !v) {
        if (tag) tag.textContent = camStreamable(entityId) ? '' : 'Deze camera heeft geen stream-bron: beeld ververst elke seconde.';
        return;
    }
    const r = camRtc = { ws: null, pc: null, timer: null, id: entityId, sid: null, queue: [] };
    const fail = (why) => { if (camRtc !== r) return; camRtcStop(); if (tag) tag.textContent = 'Livebeeld niet gelukt (' + why + '): beeld ververst elke seconde.'; };
    if (tag) tag.textContent = 'Livebeeld verbinden…';
    r.timer = setTimeout(() => fail('time-out'), 12000);
    let n = 1;
    try { r.ws = new WebSocket(base.replace(/^http/i, 'ws') + '/api/websocket'); } catch (e) { fail('geen verbinding'); return; }
    r.ws.onerror = () => fail('geen verbinding');
    r.ws.onclose = () => { if (camRtc === r && !v.srcObject) fail('verbroken'); };
    const send = (o) => { try { r.ws.send(JSON.stringify(o)); } catch (e) { /* negeren */ } };
    const begin = async () => {
        let ice = [{ urls: 'stun:stun.l.google.com:19302' }];
        const cfgId = ++n; r.cfgId = cfgId;
        send({ id: cfgId, type: 'camera/webrtc/get_client_config', entity_id: entityId });
        r.cfgWait = (res) => { if (res && res.configuration && res.configuration.iceServers) ice = res.configuration.iceServers; offer(ice); };
    };
    const offer = async (ice) => {
        try {
            const pc = r.pc = new RTCPeerConnection({ iceServers: ice });
            pc.addTransceiver('video', { direction: 'recvonly' });
            pc.addTransceiver('audio', { direction: 'recvonly' });
            pc.createDataChannel('dataSendChannel');
            pc.ontrack = (e) => { if (camRtc !== r) return; if (!v.srcObject) v.srcObject = e.streams[0] || new MediaStream([e.track]); };
            pc.onicecandidate = (e) => {
                if (!e.candidate) return;
                const cand = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
                if (r.sid) send({ id: ++n, type: 'camera/webrtc/candidate', entity_id: entityId, session_id: r.sid, candidate: cand }); else r.queue.push(cand);
            };
            pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) fail('verbinding'); };
            v.onplaying = () => { if (camRtc !== r) return; clearTimeout(r.timer); v.classList.remove('hidden'); if (tag) tag.textContent = '● Live'; };
            const o = await pc.createOffer();
            await pc.setLocalDescription(o);
            r.offerId = ++n;
            send({ id: r.offerId, type: 'camera/webrtc/offer', entity_id: entityId, offer: o.sdp });
        } catch (e) { fail('browser'); }
    };
    r.ws.onmessage = async (ev) => {
        if (camRtc !== r) return;
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'auth_required') send({ type: 'auth', access_token: token });
        else if (m.type === 'auth_invalid') fail('toegangstoken');
        else if (m.type === 'auth_ok') begin();
        else if (m.type === 'result' && m.id === r.cfgId) { r.cfgWait && r.cfgWait(m.success ? m.result : null); r.cfgWait = null; }
        else if (m.type === 'result' && m.id === r.offerId && !m.success) fail((m.error && m.error.message) || 'geweigerd');
        else if (m.type === 'event' && m.id === r.offerId && m.event) {
            const e = m.event;
            try {
                if (e.type === 'session') { r.sid = e.session_id; r.queue.splice(0).forEach(c => send({ id: ++n, type: 'camera/webrtc/candidate', entity_id: entityId, session_id: r.sid, candidate: c })); }
                else if (e.type === 'answer') await r.pc.setRemoteDescription({ type: 'answer', sdp: e.answer });
                else if (e.type === 'candidate' && e.candidate) await r.pc.addIceCandidate(typeof e.candidate === 'string' ? { candidate: e.candidate, sdpMid: '0' } : e.candidate);
                else if (e.type === 'error') fail(e.message || e.code || 'fout');
            } catch (err) { /* losse kandidaat negeren */ }
        }
    };
}

/* ---------- verversen (vooraf laden, dan pas wisselen: nooit zwart of flikkerend) ---------- */
function camSwap(img, u) {
    const pre = new Image();
    pre.onload = () => { img.src = u; img.style.opacity = '1'; };
    pre.src = u;
}
function camerasTick() {
    if (typeof document === 'undefined' || document.hidden) return;
    const imgs = document.querySelectorAll ? Array.from(document.querySelectorAll('img[data-cam]')) : [];
    imgs.forEach(img => { const u = cameraSnapshotUrl(img.getAttribute('data-cam'), true); if (u) camSwap(img, u); });
}
function camerasFullTick() {
    if (!camFull || camRtc && document.getElementById('cameraModalVideo') && !document.getElementById('cameraModalVideo').classList.contains('hidden') || (typeof document !== 'undefined' && document.hidden)) return;
    const img = document.getElementById('cameraModalImg');
    const u = cameraSnapshotUrl(camFull, true);
    if (img && u) camSwap(img, u);
}
function camerasEnsureTimer() {
    if (camTimer) return;
    camTimer = setInterval(() => {
        const viewOn = window.currentViewName === 'cameras' || window.currentViewName === 'display';
        if (viewOn && !camFull) camerasTick();
    }, CAM_REFRESH_MS);
    setInterval(camerasFullTick, CAM_FULL_MS);
}
function camerasViewActive(on) {
    camHtmlCache = '';
    if (on) { camerasEnsureTimer(); camerasTick(); }
}

/* ---------- widget voor het wanddisplay ---------- */
function cameraWidgetHtml(b) {
    const items = camerasToShow().items;
    const c = items.find(x => x.entityId === b.camera) || items[0];
    if (!c) return '<p class="text-sm text-[#68736d] my-auto text-center">Geen camera beschikbaar.</p>';
    const u = cameraSnapshotUrl(c.entityId, false);
    camerasEnsureTimer();
    return `<div class="flex flex-col gap-2 h-full"><div class="flex items-center justify-between"><span class="text-xs font-bold uppercase tracking-wider text-[#68736d]">📹 ${caEsc(c.name)}</span>
        <button type="button" onclick="window.camerasOpen('${caEsc(c.entityId)}')" class="text-[11px] font-bold text-[#197447] hover:underline cursor-pointer">Groot ›</button></div>
        <div class="relative flex-1 min-h-[140px] rounded-2xl overflow-hidden bg-black cursor-pointer" onclick="window.camerasOpen('${caEsc(c.entityId)}')">
        ${u ? `<img data-cam="${caEsc(c.entityId)}" src="${caEsc(u)}" alt="${caEsc(c.name)}" class="absolute inset-0 w-full h-full object-cover">` : '<div class="absolute inset-0 flex items-center justify-center text-white/70 text-xs">Geen beeld</div>'}</div></div>`;
}

/* ---------- bewerken ---------- */
const camRerender = () => { camHtmlCache = ''; renderCamerasView(); camSave(false); };
window.camerasToggleEdit = function() {
    if (!permGuard('edit_cameras')) return;
    camEdit = !camEdit; camHtmlCache = ''; renderCamerasView();
    if (!camEdit) camSave(true);
};
window.camerasAdd = function(entityId) {
    if (!permGuard('edit_cameras') || !camValid(entityId)) return;
    const l = ensureCameras().items;
    if (l.some(c => c.entityId === entityId)) return;
    const st = camState(entityId);
    l.push({ id: 'cam' + Date.now().toString(36), name: (st && st.attributes && st.attributes.friendly_name) || entityId, entityId });
    camRerender();
};
window.camerasSetName = function(i, v) { if (!permGuard('edit_cameras')) return; const c = ensureCameras().items[i]; if (c) { c.name = String(v).trim().slice(0, 40); camRerender(); } };
window.camerasSetEntity = function(i, v) {
    if (!permGuard('edit_cameras')) return;
    const c = ensureCameras().items[i]; const id = String(v).trim();
    if (!c) return;
    if (!camValid(id)) { showToast('Dat is geen geldige camera-entiteit (bv. camera.voordeur).'); return; }
    c.entityId = id; camRerender();
};
window.camerasMove = function(i, dir) {
    if (!permGuard('edit_cameras')) return;
    const a = ensureCameras().items, j = i + dir;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; camRerender();
};
window.camerasRemove = function(i) { if (!permGuard('edit_cameras')) return; ensureCameras().items.splice(i, 1); camRerender(); };
