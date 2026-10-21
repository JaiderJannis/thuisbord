'use strict';
/* Thuisbord push-server. Zie README.md voor de installatie.
   - Slaat push-abonnementen van telefoons op (subscriptions.json)
   - Luistert via de WebSocket van Home Assistant naar wijzigingen en verstuurt een pushmelding volgens rules.json
   - POST /notify laat Home Assistant (of iets anders) zelf een melding sturen */
const fs = require('fs');
const path = require('path');
const http = require('http');
const webpush = require('web-push');
const WebSocket = require('ws');

const DIR = __dirname;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { return d; } };
const writeJson = (f, v) => { const p = path.join(DIR, f), t = p + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };

if (process.argv.includes('--keys')) {
    const k = webpush.generateVAPIDKeys();
    console.log('\nVAPID_PUBLIC_KEY=' + k.publicKey + '\nVAPID_PRIVATE_KEY=' + k.privateKey + '\n\nZet deze twee regels in je .env-bestand (de private sleutel nooit delen).\n');
    process.exit(0);
}

// .env inlezen (geen extra pakket nodig)
try {
    fs.readFileSync(path.join(DIR, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
} catch (e) { /* geen .env */ }

const cfg = {
    port: Number(process.env.PORT || 8787),
    pub: process.env.VAPID_PUBLIC_KEY,
    priv: process.env.VAPID_PRIVATE_KEY,
    mail: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    key: process.env.SHARED_KEY,                  // geheim dat de app en Home Assistant meesturen
    origin: process.env.ALLOWED_ORIGIN || '*',    // bv. https://jaiderjannis.github.io
    haUrl: (process.env.HA_URL || '').replace(/\/+$/, ''),
    haToken: process.env.HA_TOKEN || ''
};
if (!cfg.pub || !cfg.priv || !cfg.key) {
    console.error('Ontbrekend: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY en SHARED_KEY moeten in .env staan. Maak sleutels met: npm run keys');
    process.exit(1);
}
webpush.setVapidDetails(cfg.mail, cfg.pub, cfg.priv);

let subs = readJson('subscriptions.json', []);
const saveSubs = () => writeJson('subscriptions.json', subs);

/* OWNER-START */
// Elke server hoort bij één gezin (de eigenaar van deze Home Assistant). Meldingen uit Home Assistant gaan enkel naar toestellen van dat gezin.
function subsFor(list, household) { return list.filter(x => !household || x.household === household); }
// Mag dit gezin regels op de server zetten? HOUSEHOLD in .env gaat voor; anders is het eerste gezin dat regels stuurt de eigenaar.
function ownerCheck(owner, env, hh) {
    hh = String(hh || '');
    if (env) return hh === env ? { ok: true, owner: env } : { ok: false };
    if (!hh) return owner ? { ok: false } : { ok: true, owner: '' };
    if (!owner) return { ok: true, owner: hh };
    return hh === owner ? { ok: true, owner } : { ok: false };
}
/* OWNER-END */
let owner = process.env.HOUSEHOLD || String((readJson('owner.json', {}) || {}).household || '');
const toOwner = () => owner || undefined;

async function sendAll(payload, onlyHousehold) {
    const body = JSON.stringify(payload);
    const targets = subsFor(subs, onlyHousehold);
    let ok = 0, gone = 0;
    await Promise.all(targets.map(async s => {
        try { await webpush.sendNotification(s.sub, body, { TTL: 3600, urgency: 'normal' }); ok++; }
        catch (e) {
            if (e && (e.statusCode === 404 || e.statusCode === 410)) { s.dead = true; gone++; }
            else console.warn('Versturen mislukt:', e && (e.statusCode || e.message));
        }
    }));
    if (gone) { subs = subs.filter(s => !s.dead); saveSubs(); }
    return { sent: ok, removed: gone };
}

/* ---------- Home Assistant ---------- */
let rules = readJson('rules.json', []);
const lastState = new Map();
const lastFire = new Map();

const asList = (v) => (Array.isArray(v) ? v : [v]).map(x => String(x));
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };

// Past een regel bij deze wijziging? Regels: naar/van (tekst of lijst), nietNaar (lijst), boven/onder (drempel wordt overschreden)
function ruleMatches(r, to, from) {
    if (r.naar != null && !asList(r.naar).includes(to)) return false;
    if (r.van != null && !asList(r.van).includes(from)) return false;
    if (r.nietNaar != null && asList(r.nietNaar).includes(to)) return false;
    if (r.boven != null) { const n = num(to), o = num(from); if (n === null || n < Number(r.boven) || (o !== null && o >= Number(r.boven))) return false; }
    if (r.onder != null) { const n = num(to), o = num(from); if (n === null || n > Number(r.onder) || (o !== null && o <= Number(r.onder))) return false; }
    return true;
}

// Toestel dat draait en dan stopt: het vermogen was minstens "stroomBoven" gedurende "minMinuten" en zakt nu eronder
const running = new Map();
function stroomRule(r, ev, to) {
    const n = num(to); if (n === null) return;
    const k = r.tag || r.entity, lim = Number(r.stroomBoven), now = Date.now();
    if (n >= lim) { if (!running.has(k)) running.set(k, now); return; }
    if (!running.has(k)) return;
    const since = running.get(k); running.delete(k);
    if (now - since < (Number(r.minMinuten) || 5) * 60000) return;
    const name = (ev.new_state.attributes && ev.new_state.attributes.friendly_name) || ev.entity_id;
    sendAll({ title: r.titel || 'Thuisbord', body: String(r.tekst || '{naam} is klaar').replace('{naam}', name), tag: k }, toOwner())
        .then(x => console.log(`[regel] ${r.naam || r.entity} -> ${x.sent} verstuurd`));
}

function handleStateChange(ev) {
    if (!ev || !ev.entity_id) return;
    const to = ev.new_state ? String(ev.new_state.state) : null;
    const from = ev.old_state ? String(ev.old_state.state) : null;
    if (to === null || from === to) return;
    rules.forEach(r => {
        if (r.entity !== ev.entity_id) return;
        if (r.stroomBoven != null) return stroomRule(r, ev, to);
        if (!ruleMatches(r, to, from)) return;
        const k = r.tag || r.entity, now = Date.now();
        if (now - (lastFire.get(k) || 0) < 30000) return;   // niet vaker dan 1x per 30 s per melding
        lastFire.set(k, now);
        const name = (ev.new_state.attributes && ev.new_state.attributes.friendly_name) || ev.entity_id;
        sendAll({ title: r.titel || 'Thuisbord', body: String(r.tekst || '{naam}: {nieuw}').replace('{naam}', name).replace('{nieuw}', to).replace('{oud}', from || ''), tag: r.tag || ev.entity_id }, toOwner())
            .then(x => console.log(`[regel] ${r.naam || r.entity} -> ${x.sent} verstuurd`));
    });
}

// Regels die van buitenaf (de app) binnenkomen: streng opschonen
function cleanRules(list) {
    if (!Array.isArray(list) || list.length > 150) return null;
    const txt = (v, n) => String(v == null ? '' : v).slice(0, n);
    const arr = (v) => (v == null ? undefined : (Array.isArray(v) ? v : [v]).slice(0, 30).map(x => txt(x, 60)));
    const out = [];
    for (const r of list) {
        if (!r || typeof r.entity !== 'string' || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(r.entity)) continue;
        const c = { naam: txt(r.naam, 80), entity: r.entity, titel: txt(r.titel || 'Thuisbord', 60), tekst: txt(r.tekst, 200), tag: txt(r.tag || r.entity, 60) };
        ['naar', 'van', 'nietNaar'].forEach(k => { const a = arr(r[k]); if (a && a.length) c[k] = a.length === 1 && k !== 'nietNaar' ? a[0] : a; });
        ['boven', 'onder', 'stroomBoven', 'minMinuten'].forEach(k => { if (r[k] != null && isFinite(Number(r[k]))) c[k] = Number(r[k]); });
        if (c.minMinuten != null && c.stroomBoven == null) delete c.minMinuten;
        if (c.naar == null && c.van == null && c.nietNaar == null && c.boven == null && c.onder == null && c.stroomBoven == null) continue;
        out.push(c);
    }
    return out;
}

// Meldingen op een vast tijdstip (bv. afvalophaling): { id, op: ISO-tijd, titel, tekst, tag }
function cleanPlans(list) {
    if (!Array.isArray(list) || list.length > 60) return null;
    const out = [];
    for (const p of list) {
        if (!p || !p.tekst) continue;
        const t = Date.parse(p.op); if (isNaN(t)) continue;
        out.push({ id: String(p.id || p.tag || t).slice(0, 80), op: new Date(t).toISOString(), titel: String(p.titel || 'Thuisbord').slice(0, 60), tekst: String(p.tekst).slice(0, 200), tag: String(p.tag || p.id || 'plan').slice(0, 60) });
    }
    return out;
}
let plans = readJson('plannen.json', []);
let firedPlans = new Set(readJson('plannen-gedaan.json', []));
function runPlans() {
    const now = Date.now(); let changed = false;
    plans.forEach(p => {
        const t = Date.parse(p.op), key = p.id + '@' + p.op;
        if (t > now || firedPlans.has(key)) return;
        firedPlans.add(key); changed = true;
        if (now - t < 6 * 3600000) sendAll({ title: p.titel, body: p.tekst, tag: p.tag }, toOwner()).then(x => console.log(`[plan] ${p.id} -> ${x.sent} verstuurd`));
    });
    if (changed) { writeJson('plannen-gedaan.json', Array.from(firedPlans).slice(-300)); }
}
setInterval(runPlans, 30000);

// Melding als Home Assistant langer dan 5 minuten niet bereikbaar is (en als het weer werkt)
let haTimer = null, haAlerted = false;
function haDown() {
    if (haTimer || haAlerted) return;
    haTimer = setTimeout(() => { haTimer = null; haAlerted = true; sendAll({ title: 'Thuisbord', body: '📡 Home Assistant is al 5 minuten niet bereikbaar', tag: 'ha_offline' }, toOwner()); }, 5 * 60000);
}
function haUp() {
    if (haTimer) { clearTimeout(haTimer); haTimer = null; }
    if (haAlerted) { haAlerted = false; sendAll({ title: 'Thuisbord', body: '✅ Home Assistant is weer bereikbaar', tag: 'ha_offline' }, toOwner()); }
}

function connectHa() {
    if (!cfg.haUrl || !cfg.haToken) { console.log('HA_URL/HA_TOKEN niet ingesteld: alleen /notify is actief.'); return; }
    const url = cfg.haUrl.replace(/^http/, 'ws') + '/api/websocket';
    let id = 1, ws;
    const retry = () => setTimeout(connectHa, 10000);
    try { ws = new WebSocket(url); } catch (e) { console.warn('HA-url ongeldig:', e.message); return; }
    ws.on('message', raw => {
        let m; try { m = JSON.parse(raw); } catch (e) { return; }
        if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: cfg.haToken }));
        else if (m.type === 'auth_ok') { console.log('Verbonden met Home Assistant'); haUp(); ws.send(JSON.stringify({ id: id++, type: 'subscribe_events', event_type: 'state_changed' })); }
        else if (m.type === 'auth_invalid') { console.error('HA_TOKEN is ongeldig'); ws.close(); }
        else if (m.type === 'event' && m.event && m.event.data) handleStateChange(m.event.data);
    });
    ws.on('close', () => { console.log('HA-verbinding weg, opnieuw proberen over 10 s'); haDown(); retry(); });
    ws.on('error', e => console.warn('HA-fout:', e.message));
}

/* KNMI-START */
// KNMI-regenvoorspelling (Web Map Service). De sleutel gaat als Authorization-header mee, dus de server haalt de beelden op voor de app.
const KNMI = { key: process.env.KNMI_KEY || '', base: 'https://api.dataplatform.knmi.nl/wms/adaguc-server', dataset: 'radar_forecast_2.0', layer: 'precipitation_nowcast' };

function isoDurMs(sv) {
    const m = /^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(String(sv || '').trim());
    if (!m) return 0;
    return ((Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0)) * 1000;
}

// Alle tijdstippen uit de GetCapabilities (lijst "a,b,c" of interval "begin/einde/PT5M"), oplopend en uniek
function parseNowcastTimes(xml, layer) {
    xml = String(xml || '');
    const i = xml.indexOf('<Name>' + layer + '</Name>');
    const part = i >= 0 ? xml.slice(i) : xml;
    const m = part.match(/<Dimension[^>]*name="time"[^>]*>([^<]+)<\/Dimension>/i);
    if (!m) return [];
    const out = new Set();
    m[1].split(',').forEach(tok => {
        tok = tok.trim(); if (!tok) return;
        const p = tok.split('/');
        if (p.length === 3) {
            const a = Date.parse(p[0]), b = Date.parse(p[1]), step = isoDurMs(p[2]);
            if (!isNaN(a) && !isNaN(b) && step > 0) for (let t = a; t <= b && out.size < 3000; t += step) out.add(t);
        } else { const t = Date.parse(tok); if (!isNaN(t)) out.add(t); }
    });
    return Array.from(out).sort((x, y) => x - y);
}

// Kies de beelden vanaf nu tot +2 uur, ongeveer elke 10 minuten (spaart het quotum van 1000 verzoeken per uur)
function pickNowcastTimes(all, now) {
    let sel = all.filter(t => t >= now - 15 * 60000 && t <= now + 125 * 60000);
    if (!sel.length) sel = all.slice(-13);
    const out = [];
    sel.forEach(t => { if (!out.length || t - out[out.length - 1] >= 9 * 60000) out.push(t); });
    return out.slice(0, 16).map(t => new Date(t).toISOString().replace('.000Z', 'Z'));
}

// Alleen geldige kaartvragen doorlaten. Geeft de GetMap-query terug of null.
function knmiMapQuery(sp) {
    const bbox = String(sp.get('bbox') || '').split(',').map(Number);
    const w = parseInt(sp.get('w'), 10), h = parseInt(sp.get('h'), 10), t = String(sp.get('time') || '');
    if (bbox.length !== 4 || bbox.some(n => !isFinite(n) || Math.abs(n) > 3e7) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return null;
    if (!(w >= 64 && w <= 1280 && h >= 64 && h <= 1280)) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(t)) return null;
    return `DATASET=${KNMI.dataset}&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${KNMI.layer}&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857&BBOX=${bbox.map(n => Math.round(n)).join(',')}&WIDTH=${w}&HEIGHT=${h}&TIME=${t}`;
}
/* KNMI-END */

let knmiCaps = { at: 0, times: [] };
const knmiImgs = new Map();           // query -> { at, buf }
async function knmiTimes() {
    if (Date.now() - knmiCaps.at < 120000 && knmiCaps.times.length) return knmiCaps.times;
    const r = await fetch(`${KNMI.base}?DATASET=${KNMI.dataset}&SERVICE=WMS&REQUEST=GetCapabilities`, { headers: { Authorization: KNMI.key } });
    if (!r.ok) throw new Error('KNMI antwoordde ' + r.status);
    knmiCaps = { at: Date.now(), times: pickNowcastTimes(parseNowcastTimes(await r.text(), KNMI.layer), Date.now()) };
    return knmiCaps.times;
}
async function knmiImage(query) {
    const hit = knmiImgs.get(query);
    if (hit && Date.now() - hit.at < 300000) return hit.buf;
    const r = await fetch(`${KNMI.base}?${query}`, { headers: { Authorization: KNMI.key } });
    const type = String(r.headers.get('content-type') || '');
    if (!r.ok || !/^image\//.test(type)) throw new Error('KNMI gaf geen beeld (' + r.status + ')');
    const buf = Buffer.from(await r.arrayBuffer());
    knmiImgs.set(query, { at: Date.now(), buf });
    if (knmiImgs.size > 300) knmiImgs.delete(knmiImgs.keys().next().value);
    return buf;
}

/* REGEN-START */
// Regenmelding: de server kijkt zelf naar de verwachting op jouw locatie (Open-Meteo, per kwartier) en stuurt een push, ook als de app dicht is
function rainSlots(j, now) {
    const m = j && j.minutely_15, out = [];
    if (!m || !Array.isArray(m.time) || !Array.isArray(m.precipitation)) return out;
    m.time.forEach((t, i) => { const start = Number(t) * 1000; if (start + 900000 > now && out.length < 8) out.push({ start, mm: Number(m.precipitation[i]) || 0 }); });
    return out;
}
// Meldt één keer per bui: niet als het al regent, en pas na minstens 3 uur weer
function rainDecision(slots, st, now) {
    st = Object.assign({ lastAlert: 0 }, st || {});
    if (!slots.length) return { alert: null, st };
    const WET = 0.1;
    if (slots[0].mm >= WET) return { alert: null, st: Object.assign({}, st, { wet: true }) };
    const idx = slots.findIndex(x => x.mm >= WET);
    if (idx === -1) return { alert: null, st: Object.assign({}, st, { wet: false }) };
    if (now - st.lastAlert < 3 * 3600000) return { alert: null, st };
    const min = Math.max(5, Math.round((slots[idx].start - now) / 300000) * 5);
    return { alert: min, st: Object.assign({}, st, { wet: false, lastAlert: now }) };
}
function cleanRegen(r) {
    if (!r || typeof r !== 'object') return null;
    const lat = Number(r.lat), lon = Number(r.lon);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, naam: String(r.naam || '').slice(0, 60), household: String(r.household || '').slice(0, 80) };
}
/* REGEN-END */

let regen = cleanRegen(readJson('regen.json', null));
let regenState = readJson('regen-state.json', { lastAlert: 0 });
async function checkRain() {
    if (!regen) return;
    try {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${regen.lat}&longitude=${regen.lon}&minutely_15=precipitation&forecast_minutely_15=8&timezone=UTC&timeformat=unixtime`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const now = Date.now(), d = rainDecision(rainSlots(await r.json(), now), regenState, now);
        regenState = d.st; writeJson('regen-state.json', regenState);
        if (d.alert !== null) {
            const x = await sendAll({ title: 'Thuisbord', body: `🌧️ Regen verwacht over ongeveer ${d.alert} min${regen.naam ? ' (' + regen.naam + ')' : ''}`, tag: 'regen' }, owner || regen.household || undefined);
            console.log(`[regen] melding over ${d.alert} min -> ${x.sent} verstuurd`);
        }
    } catch (e) { console.warn('Regencontrole mislukt:', e && e.message); }
}
setInterval(checkRain, 10 * 60000);
setTimeout(checkRain, 20000);

/* ---------- HTTP ---------- */
const send = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': cfg.origin, 'Access-Control-Allow-Headers': 'Content-Type, X-Key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
    res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve, reject) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 100000) { reject(new Error('te groot')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
});
const keyOk = (req) => { const k = String(req.headers['x-key'] || ''); return k.length === cfg.key.length && require('crypto').timingSafeEqual(Buffer.from(k), Buffer.from(cfg.key)); };

http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const u = (req.url || '').split('?')[0];
    try {
        if (req.method === 'GET' && u === '/health') return send(res, 200, { ok: true, abonnementen: subs.length, knmi: !!KNMI.key, eigenaar: !!owner });
        if (req.method === 'GET' && u === '/vapid') return send(res, 200, { publicKey: cfg.pub });
        if (!keyOk(req)) return send(res, 401, { error: 'sleutel klopt niet' });
        if (req.method === 'POST' && u === '/subscribe') {
            const b = await readBody(req);
            if (!b.subscription || !/^https:\/\//.test(String(b.subscription.endpoint || ''))) return send(res, 400, { error: 'ongeldig abonnement' });
            subs = subs.filter(s => s.sub.endpoint !== b.subscription.endpoint);
            subs.push({ sub: b.subscription, household: String(b.household || '').slice(0, 80), since: new Date().toISOString() });
            saveSubs();
            return send(res, 200, { ok: true, abonnementen: subs.length });
        }
        if (req.method === 'POST' && u === '/unsubscribe') {
            const b = await readBody(req);
            subs = subs.filter(s => s.sub.endpoint !== (b.endpoint || ''));
            saveSubs();
            return send(res, 200, { ok: true });
        }
        if (req.method === 'GET' && u === '/knmi/times') {
            if (!KNMI.key) return send(res, 404, { error: 'KNMI_KEY staat niet in .env' });
            try { return send(res, 200, { times: await knmiTimes() }); } catch (e) { return send(res, 502, { error: String(e.message || e) }); }
        }
        if (req.method === 'GET' && u === '/knmi/map') {
            if (!KNMI.key) return send(res, 404, { error: 'KNMI_KEY staat niet in .env' });
            const q = knmiMapQuery(new URL(req.url, 'http://x').searchParams);
            if (!q) return send(res, 400, { error: 'ongeldige kaartvraag' });
            try {
                const buf = await knmiImage(q);
                res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': cfg.origin });
                return res.end(buf);
            } catch (e) { return send(res, 502, { error: String(e.message || e) }); }
        }
        if (req.method === 'GET' && u === '/rules') return send(res, 200, { rules });
        if (req.method === 'POST' && u === '/rules') {
            const b = await readBody(req);
            const oc = ownerCheck(owner, process.env.HOUSEHOLD || '', b.household);
            if (!oc.ok) return send(res, 403, { error: 'deze server hoort bij een ander gezin' });
            if (oc.owner !== owner) { owner = oc.owner; writeJson('owner.json', { household: owner }); console.log('Eigenaar van deze server:', owner); }
            const clean = cleanRules(b.rules);
            if (!clean) return send(res, 400, { error: 'ongeldige regels' });
            writeJson('rules.json', clean); rules = clean;
            let np = 0;
            if (b.plannen !== undefined) { const pl = cleanPlans(b.plannen); if (pl) { plans = pl; writeJson('plannen.json', pl); np = pl.length; } }
            if (b.regen !== undefined) { regen = cleanRegen(b.regen); writeJson('regen.json', regen); if (regen) setTimeout(checkRain, 2000); }
            console.log('Regels ontvangen van de app:', clean.length, 'plannen:', np, 'regenmelding:', regen ? 'aan' : 'uit');
            return send(res, 200, { ok: true, regels: clean.length, plannen: np, regen: !!regen });
        }
        if (req.method === 'POST' && u === '/notify') {
            const b = await readBody(req);
            const r = await sendAll({ title: String(b.title || 'Thuisbord').slice(0, 80), body: String(b.body || '').slice(0, 300), tag: String(b.tag || 'thuisbord').slice(0, 60) }, b.household || toOwner());
            return send(res, 200, r);
        }
        send(res, 404, { error: 'onbekend' });
    } catch (e) { send(res, 400, { error: String(e.message || e) }); }
}).listen(cfg.port, process.env.HOST || '127.0.0.1', () => console.log(`Push-server draait op poort ${cfg.port} (${subs.length} abonnementen, ${rules.length} regels)`));

fs.watchFile(path.join(DIR, 'rules.json'), { interval: 5000 }, () => { rules = readJson('rules.json', []); console.log('rules.json opnieuw ingelezen:', rules.length, 'regels'); });
connectHa();
