'use strict';
/* Gezondheidscontrole van het bord: test de verbinding met Home Assistant, de gekoppelde entiteiten, de functies,
   meldingen en push, en de beveiliging (inclusief een echte test van de Firestore-regels voor niet-admins).
   healthEvaluate(env) is een zuivere functie (testbaar): omgeving in, lijst met bevindingen uit.
   Bevinding: { group, status: 'ok'|'warn'|'bad'|'info', label, detail, hint } */

const HEALTH_GROUPS = [['conn', '🔌', 'Verbinding'], ['ents', '🔗', 'Gekoppelde entiteiten'], ['feat', '🧩', 'Functies'], ['push', '🔔', 'Meldingen en push'], ['sec', '🛡️', 'Beveiliging']];
const hl = { running: false, findings: [], ranAt: 0 };
let hlHtmlCache = '';

/* ---------- gegevens verzamelen ---------- */
function healthLinkedEntities(st) {
    const out = [], add = (label, id) => { id = String(id || '').trim(); if (id) out.push({ label, id }); };
    (st.robots || []).forEach(r => { add('Robot ' + (r.name || ''), r.entityId); (r.extras || []).forEach(x => add((r.name || 'Robot') + ' · ' + (x.label || ''), x.entityId)); });
    ((st.laundry && st.laundry.devices) || []).forEach(d => { Object.entries(d.entities || {}).forEach(([k, v]) => add((d.name || 'Wasserij') + ' · ' + k, v)); (d.extras || []).forEach(v => add((d.name || 'Wasserij') + ' · extra', v)); });
    ((st.cameras && st.cameras.items) || []).forEach(c => add("Camera " + (c.name || ''), c.entityId));
    (st.roomLights || []).forEach(l => add('Lamp ' + (l.name || ''), l.entityId));
    (st.shutters || []).forEach(l => add('Rolluik ' + (l.name || ''), l.entityId));
    (st.climates || []).forEach(l => add('Airco ' + (l.name || ''), l.entityId));
    Object.entries(st.entityMap || {}).forEach(([k, v]) => { if (typeof v === 'string') add('Koppeling ' + k, v); });
    return out;
}

async function healthGather() {
    const env = { role: typeof currentRole !== 'undefined' ? currentRole : '', page: { https: location.protocol === 'https:', online: navigator.onLine !== false } };
    const st = appState || {};
    env.state = st;
    env.ha = { url: String(st.haUrl || '').trim(), token: !!String(st.haToken || '').trim(), ws: typeof haWsConnected !== 'undefined' && !!haWsConnected,
        entities: (typeof discoveredHaEntities !== 'undefined' ? discoveredHaEntities : []) || [], version: '', reach: 'skip', error: '' };
    if (env.ha.url && env.ha.token && typeof mlibWs === 'function') {
        try { const c = await mlibWs({ type: 'get_config' }, 10000); env.ha.reach = 'ok'; env.ha.version = (c && c.version) || ''; }
        catch (e) { env.ha.reach = 'bad'; env.ha.error = (e && e.message) || ''; }
    }
    const map = typeof haStatesMap === 'function' ? haStatesMap() : new Map();
    env.linked = healthLinkedEntities(st).map(x => { const s = map && typeof map.get === 'function' ? haStateObj(map, x.id) : null; return Object.assign({}, x, { found: !!s, usable: !!s && haIsUsable(s) }); });
    env.weather = { loc: typeof weatherLocation === 'function' ? !!weatherLocation() : false, error: typeof weatherError !== 'undefined' ? String(weatherError || '') : '' };
    env.cameras = (((st.cameras && st.cameras.items) || [])).map(c => { const s = map && haStateObj(map, c.entityId); return { name: c.name || c.entityId, found: !!s, token: !!(s && s.attributes && s.attributes.access_token), stream: !!(s && s.attributes && (Number(s.attributes.supported_features) & 2)) }; });
    env.push = { perm: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported', sw: false, sub: false, server: null, serverReach: 'skip' };
    try { const reg = await navigator.serviceWorker.getRegistration(); env.push.sw = !!reg; env.push.sub = !!(reg && await reg.pushManager.getSubscription()); } catch (e) { /* geen service worker */ }
    const ps = st.pushServer;
    if (ps && ps.url) {
        env.push.server = { url: ps.url, https: /^https:\/\//i.test(ps.url), key: !!ps.key };
        try { const r = await fetch(String(ps.url).replace(/\/+$/, '') + '/health', { cache: 'no-store' }); env.push.serverReach = r.ok ? 'ok' : 'bad'; } catch (e) { env.push.serverReach = 'bad'; }
    }
    env.rules = await healthRulesProbe(env.role);
    return env;
}

// Probeert als niet-admin dingen te lezen die de regels moeten weigeren
async function healthRulesProbe(role) {
    if (role === 'admin') return { skipped: 'admin' };
    if (typeof getDoc !== 'function' || typeof fsDoc !== 'function' || typeof FS_META_COL === 'undefined') return { skipped: 'geen cloud' };
    const probes = [];
    const run = async (name, fn) => { try { await fn(); probes.push({ name, open: true }); } catch (e) { probes.push({ name, open: false, denied: e && e.code === 'permission-denied', code: e && e.code }); } };
    await run('het oude instellingsdocument', () => getDoc(fsDoc('thuisbord_settings', 'main_dashboard')));
    await run('de lijst met alle gezinnen', () => getDocs(fsCol(FS_HOUSEHOLDS_COL)));
    await run('migratie-markering', () => getDoc(fsDoc(FS_META_COL, FS_META_MIGRATION_DOC)));
    return { probes };
}

/* ---------- beoordelen (zuiver) ---------- */
function healthEvaluate(env) {
    const f = [];
    const add = (group, status, label, detail, hint) => f.push({ group, status, label, detail: detail || '', hint: hint || '' });
    const st = env.state || {};
    // Verbinding
    if (!env.page.online) add('conn', 'bad', 'Geen internet', 'Dit toestel is offline.', 'Controleer wifi of netwerkkabel.');
    if (!env.ha.url || !env.ha.token) add('conn', 'bad', 'Home Assistant niet gekoppeld', 'Adres of token ontbreekt.', 'Vul ze in bij Beheer → Home Assistant.');
    else {
        if (env.page.https && /^http:\/\//i.test(env.ha.url)) add('conn', 'bad', 'Home Assistant via http op een https-pagina', 'Browsers blokkeren dat (mixed content).', 'Gebruik het https-adres, bv. via Tailscale (Serve) of Nabu Casa.');
        if (env.ha.reach === 'ok') add('conn', 'ok', 'Home Assistant bereikbaar', env.ha.version ? 'Versie ' + env.ha.version : '');
        else if (env.ha.reach === 'bad') add('conn', 'bad', 'Home Assistant niet bereikbaar of token ongeldig', env.ha.error, 'Controleer adres, token (langdurige toegangstoken) en of Tailscale/VPN aan staat.');
        add('conn', env.ha.ws ? 'ok' : 'warn', env.ha.ws ? 'Live verbinding actief' : 'Geen live verbinding', env.ha.ws ? '' : 'Gegevens komen niet realtime binnen.', env.ha.ws ? '' : 'Herlaad de pagina; blijft het zo, kijk dan naar adres en token.');
        add('conn', env.ha.entities.length ? 'ok' : 'warn', env.ha.entities.length ? env.ha.entities.length + ' entiteiten geladen' : 'Nog geen entiteiten geladen', '', env.ha.entities.length ? '' : 'Haal ze op bij Beheer → Home Assistant.');
    }
    // Entiteiten
    const linked = env.linked || [];
    const missing = linked.filter(x => !x.found), down = linked.filter(x => x.found && !x.usable);
    const names = (l) => l.slice(0, 6).map(x => x.label + ' (' + x.id + ')').join(', ') + (l.length > 6 ? ' …en ' + (l.length - 6) + ' meer' : '');
    if (env.ha.entities.length) {
        if (missing.length) add('ents', 'bad', missing.length + ' gekoppelde entiteit(en) bestaan niet in Home Assistant', names(missing), 'Waarschijnlijk hernoemd of verwijderd: kies de juiste entiteit opnieuw.');
        if (down.length) add('ents', 'warn', down.length + ' gekoppelde entiteit(en) "niet beschikbaar"', names(down), 'Controleer of het apparaat aan staat en verbonden is.');
        if (!missing.length && !down.length) add('ents', 'ok', 'Alle ' + linked.length + ' gekoppelde entiteiten zijn in orde');
    }
    // Functies
    add('feat', env.weather.loc ? (env.weather.error ? 'warn' : 'ok') : 'warn', env.weather.loc ? (env.weather.error ? 'Weer kon niet worden opgehaald' : 'Weer: locatie bekend') : 'Weer: geen locatie', env.weather.error, env.weather.loc ? '' : 'Zet bij Weer een plaats of gebruik zone.home in Home Assistant.');
    env.cameras.forEach(c => {
        if (!c.found) return;
        if (!c.token) add('feat', 'warn', 'Camera "' + c.name + '": geen beeldtoken', '', 'Controleer de camera-integratie in Home Assistant.');
        else if (!c.stream) add('feat', 'info', 'Camera "' + c.name + '": enkel snapshots', 'Geen stream-bron ingesteld, dus geen echt livebeeld.', 'Vul bij de Algemene camera de Stream-bron (rtsp://…) in.');
        else add('feat', 'ok', 'Camera "' + c.name + '": livebeeld mogelijk');
    });
    const ld = (st.laundry && st.laundry.devices) || [];
    ld.filter(d => !(d.entities && d.entities.state)).forEach(d => add('feat', 'warn', 'Wasserij "' + (d.name || '') + '" zonder status-entiteit', '', 'Koppel een status-entiteit bij Wasserij → Instellen.'));
    const hp = st.hourlyPrices;
    if (!Array.isArray(hp) || hp.length < 24 || hp.every(v => !Number(v))) add('feat', 'warn', 'Geen uurprijzen beschikbaar', 'Slim advies en planner hebben ze nodig.', 'Koppel de prijssensor bij Beheer → Prijzen.');
    else add('feat', 'ok', 'Uurprijzen beschikbaar');
    (st.robots || []).filter(r => r.entityId && r.batteryPct == null).forEach(r => add('feat', 'info', 'Robot "' + (r.name || '') + '": batterij onbekend', 'Geen batterijsensor gevonden.', 'Voeg bij Extra entiteiten een Batterij-sensor toe.'));
    // Push
    if (env.push.perm === 'unsupported') add('push', 'warn', 'Meldingen niet ondersteund in deze browser', '', 'Op iPhone: voeg de app toe aan het beginscherm.');
    else if (env.push.perm === 'denied') add('push', 'warn', 'Meldingen geblokkeerd', '', 'Sta meldingen toe in de browserinstellingen voor deze site.');
    else add('push', env.push.perm === 'granted' ? 'ok' : 'info', env.push.perm === 'granted' ? 'Meldingen toegestaan op dit toestel' : 'Meldingen nog niet toegestaan');
    if (env.push.server) {
        add('push', env.push.serverReach === 'ok' ? 'ok' : 'bad', env.push.serverReach === 'ok' ? 'Pushserver bereikbaar' : 'Pushserver niet bereikbaar', env.push.server.url, env.push.serverReach === 'ok' ? '' : 'Staat Tailscale aan en draait de service? Zie push-server/README.md.');
        if (!env.push.server.https) add('push', 'bad', 'Pushserver-adres is geen https', '', 'Gebruik het https-adres van Tailscale Serve.');
        add('push', env.push.sub ? 'ok' : 'info', env.push.sub ? 'Dit toestel is aangemeld voor push' : 'Dit toestel is nog niet aangemeld voor push', '', env.push.sub ? '' : 'Zet Meldingen aan in het menu.');
    } else add('push', 'info', 'Geen pushserver ingesteld', 'Meldingen werken enkel als de app open staat.', 'Zie push-server/README.md.');
    // Beveiliging
    if (!env.page.https && !/^(localhost|127\.)/.test(location.hostname || '')) add('sec', 'warn', 'Pagina niet via https', '', 'Gebruik https zodat inloggen en tokens beschermd zijn.');
    else add('sec', 'ok', 'Pagina via https');
    if (env.rules && env.rules.probes) {
        const open = env.rules.probes.filter(p => p.open), odd = env.rules.probes.filter(p => !p.open && !p.denied);
        if (open.length) add('sec', 'bad', 'Firestore-regels zijn te open voor jouw rol', 'Je kon lezen: ' + open.map(p => p.name).join(', '), 'Publiceer firestore-stap4.rules in de Firebase-console (zie FIREBASE.md).');
        else if (odd.length) add('sec', 'warn', 'Firestore-regels: onverwachte fout bij test', odd.map(p => p.name + ' (' + p.code + ')').join(', '), 'Probeer opnieuw; blijft het zo, controleer je internet.');
        else add('sec', 'ok', 'Firestore-regels weigeren wat ze moeten weigeren', 'Getest met jouw account (' + env.role + ').');
    } else add('sec', 'info', 'Firestore-regels niet getest', env.rules && env.rules.skipped === 'admin' ? 'Een admin mag alles lezen, dus de test zegt niets.' : 'Geen cloudverbinding.', 'Open deze pagina met een gezinsbeheerder- of gezinslid-account om de regels te testen.');
    if (env.ha.token) add('sec', 'warn', 'Home Assistant-token staat in het gezinsdocument', 'Elk gezinslid kan het lezen (Firestore kan velden niet apart verbergen).', 'Maak in Home Assistant een apart gebruiker zonder beheerrechten voor Thuisbord en gebruik daarvan het token.');
    if (env.push.server && env.push.server.key) add('sec', 'info', 'Pushserver-sleutel staat in het gezinsdocument', 'Gezinsleden kunnen ermee meldingen versturen naar dit gezin.', 'Deel het gezinsaccount alleen met mensen die je vertrouwt.');
    const g = st.guest;
    if (g && g.wifiName && !g.pin) add('sec', 'info', 'Gastmodus zonder pincode', 'Gasten kunnen het gastenscherm zelf afsluiten.', 'Stel een pincode in bij Gastmodus.');
    return f;
}

/* ---------- uitvoeren en tonen ---------- */
async function healthRun() {
    if (hl.running) return;
    hl.running = true; hlHtmlCache = ''; healthRender();
    try { hl.findings = healthEvaluate(await healthGather()); }
    catch (e) { hl.findings = [{ group: 'conn', status: 'bad', label: 'De controle zelf is mislukt', detail: (e && e.message) || '', hint: 'Probeer opnieuw.' }]; }
    hl.running = false; hl.ranAt = Date.now(); hlHtmlCache = ''; healthRender();
}
const HL_ICON = { ok: ['✅', 'bg-[#e8f2ec] text-[#197447]'], warn: ['⚠️', 'bg-[#fdf3d8] text-[#8a5a00]'], bad: ['❌', 'bg-[#fbe3df] text-[#b42318]'], info: ['ℹ️', 'bg-stone-100 text-stone-600'] };
const hEsc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function healthRender() {
    const box = document.getElementById('healthContainer'), view = document.getElementById('viewHealth');
    if (!box || (view && view.classList.contains('hidden'))) return;
    const f = hl.findings;
    const cnt = (s) => f.filter(x => x.status === s).length;
    const head = hl.running ? '<p class="text-sm font-bold text-[#68736d]">Controle bezig…</p>' : !hl.ranAt ? '<p class="text-sm text-[#68736d]">Nog niet uitgevoerd.</p>'
        : `<div class="flex flex-wrap gap-2 text-xs font-extrabold"><span class="px-3 py-1.5 rounded-full ${HL_ICON.bad[1]}">❌ ${cnt('bad')} fout</span><span class="px-3 py-1.5 rounded-full ${HL_ICON.warn[1]}">⚠️ ${cnt('warn')} let op</span><span class="px-3 py-1.5 rounded-full ${HL_ICON.ok[1]}">✅ ${cnt('ok')} in orde</span></div>`;
    const groups = HEALTH_GROUPS.map(([k, ic, lb]) => {
        const items = f.filter(x => x.group === k);
        if (!items.length) return '';
        return `<section class="bg-white rounded-[22px] p-5 shadow-sm"><h3 class="text-sm font-extrabold text-[#1c2520] mb-3">${ic} ${lb}</h3><ul class="space-y-2.5">${items.map(x => `
            <li class="flex gap-3"><span class="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${HL_ICON[x.status][1]}">${HL_ICON[x.status][0]}</span>
            <div class="min-w-0"><p class="text-sm font-bold text-[#1c2520]">${hEsc(x.label)}</p>${x.detail ? `<p class="text-xs text-[#68736d] break-words">${hEsc(x.detail)}</p>` : ''}${x.hint ? `<p class="text-xs text-[#197447] mt-0.5">→ ${hEsc(x.hint)}</p>` : ''}</div></li>`).join('')}</ul></section>`;
    }).join('');
    const html = `<div class="bg-white rounded-[22px] p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">${head}<button type="button" onclick="window.healthRun()" ${hl.running ? 'disabled' : ''} class="px-5 py-2.5 rounded-xl bg-[#152920] text-white text-sm font-extrabold cursor-pointer disabled:opacity-50">↻ Controle uitvoeren</button></div>${groups}`;
    if (html === hlHtmlCache) return;
    hlHtmlCache = html; box.innerHTML = html;
}
function renderHealthView() { healthRender(); }
function healthViewActive(on) { if (on && !hl.ranAt && !hl.running) healthRun(); else if (on) { hlHtmlCache = ''; healthRender(); } }
window.healthRun = healthRun;
