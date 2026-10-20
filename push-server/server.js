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

function handleStateChange(ev) {
    if (!ev || !ev.entity_id) return;
    const to = ev.new_state ? String(ev.new_state.state) : null;
    const from = ev.old_state ? String(ev.old_state.state) : null;
    if (to === null || from === to) return;
    rules.forEach(r => {
        if (r.entity !== ev.entity_id) return;
        if (r.naar != null && String(r.naar) !== to) return;
        if (r.van != null && String(r.van) !== from) return;
        const k = r.tag || r.entity, now = Date.now();
        if (now - (lastFire.get(k) || 0) < 30000) return;   // niet vaker dan 1x per 30 s per melding
        lastFire.set(k, now);
        const name = (ev.new_state.attributes && ev.new_state.attributes.friendly_name) || ev.entity_id;
        sendAll({ title: r.titel || 'Thuisbord', body: String(r.tekst || '{naam}: {nieuw}').replace('{naam}', name).replace('{nieuw}', to).replace('{oud}', from || ''), tag: r.tag || ev.entity_id })
            .then(x => console.log(`[regel] ${r.naam || r.entity} -> ${x.sent} verstuurd`));
    });
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
        else if (m.type === 'auth_ok') { console.log('Verbonden met Home Assistant'); ws.send(JSON.stringify({ id: id++, type: 'subscribe_events', event_type: 'state_changed' })); }
        else if (m.type === 'auth_invalid') { console.error('HA_TOKEN is ongeldig'); ws.close(); }
        else if (m.type === 'event' && m.event && m.event.data) handleStateChange(m.event.data);
    });
    ws.on('close', () => { console.log('HA-verbinding weg, opnieuw proberen over 10 s'); retry(); });
    ws.on('error', e => console.warn('HA-fout:', e.message));
}

/* ---------- HTTP ---------- */
const send = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': cfg.origin, 'Access-Control-Allow-Headers': 'Content-Type, X-Key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
    res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve, reject) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 20000) { reject(new Error('te groot')); req.destroy(); } });
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
