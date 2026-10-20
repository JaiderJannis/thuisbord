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

async function sendAll(payload, onlyHousehold) {
    const body = JSON.stringify(payload);
    const targets = subs.filter(s => !onlyHousehold || s.household === onlyHousehold);
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
    sendAll({ title: r.titel || 'Thuisbord', body: String(r.tekst || '{naam} is klaar').replace('{naam}', name), tag: k })
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
        sendAll({ title: r.titel || 'Thuisbord', body: String(r.tekst || '{naam}: {nieuw}').replace('{naam}', name).replace('{nieuw}', to).replace('{oud}', from || ''), tag: r.tag || ev.entity_id })
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
        if (now - t < 6 * 3600000) sendAll({ title: p.titel, body: p.tekst, tag: p.tag }).then(x => console.log(`[plan] ${p.id} -> ${x.sent} verstuurd`));
    });
    if (changed) { writeJson('plannen-gedaan.json', Array.from(firedPlans).slice(-300)); }
}
setInterval(runPlans, 30000);

// Melding als Home Assistant langer dan 5 minuten niet bereikbaar is (en als het weer werkt)
let haTimer = null, haAlerted = false;
function haDown() {
    if (haTimer || haAlerted) return;
    haTimer = setTimeout(() => { haTimer = null; haAlerted = true; sendAll({ title: 'Thuisbord', body: '📡 Home Assistant is al 5 minuten niet bereikbaar', tag: 'ha_offline' }); }, 5 * 60000);
}
function haUp() {
    if (haTimer) { clearTimeout(haTimer); haTimer = null; }
    if (haAlerted) { haAlerted = false; sendAll({ title: 'Thuisbord', body: '✅ Home Assistant is weer bereikbaar', tag: 'ha_offline' }); }
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
        if (req.method === 'GET' && u === '/health') return send(res, 200, { ok: true, abonnementen: subs.length });
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
        if (req.method === 'GET' && u === '/rules') return send(res, 200, { rules });
        if (req.method === 'POST' && u === '/rules') {
            const b = await readBody(req);
            const clean = cleanRules(b.rules);
            if (!clean) return send(res, 400, { error: 'ongeldige regels' });
            writeJson('rules.json', clean); rules = clean;
            let np = 0;
            if (b.plannen !== undefined) { const pl = cleanPlans(b.plannen); if (pl) { plans = pl; writeJson('plannen.json', pl); np = pl.length; } }
            console.log('Regels ontvangen van de app:', clean.length, 'plannen:', np);
            return send(res, 200, { ok: true, regels: clean.length, plannen: np });
        }
        if (req.method === 'POST' && u === '/notify') {
            const b = await readBody(req);
            const r = await sendAll({ title: String(b.title || 'Thuisbord').slice(0, 80), body: String(b.body || '').slice(0, 300), tag: String(b.tag || 'thuisbord').slice(0, 60) }, b.household);
            return send(res, 200, r);
        }
        send(res, 404, { error: 'onbekend' });
    } catch (e) { send(res, 400, { error: String(e.message || e) }); }
}).listen(cfg.port, process.env.HOST || '127.0.0.1', () => console.log(`Push-server draait op poort ${cfg.port} (${subs.length} abonnementen, ${rules.length} regels)`));

fs.watchFile(path.join(DIR, 'rules.json'), { interval: 5000 }, () => { rules = readJson('rules.json', []); console.log('rules.json opnieuw ingelezen:', rules.length, 'regels'); });
connectHa();
