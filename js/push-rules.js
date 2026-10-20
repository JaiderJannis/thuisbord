'use strict';
/* Maakt pushregels (voor push-server/rules.json) uit wat in Thuisbord is ingesteld en stuurt ze naar de pushserver.
   Zo komen dezelfde dingen binnen als op het display, ook met een gesloten app:
   wasmachine/droger klaar, autoportier open, auto-batterij laag, robotstoring, stofbak vol, water bijna leeg, internetlimiet.
   Ook: bandendruk laag, toestel zonder statussensor klaar (op het stroomverbruik), robot klaar, afvalophaling (de avond ervoor en 's ochtends)
   en Home Assistant langer dan 5 minuten weg (dat laatste doet de server zelf).
   Alleen categorieën die bij Meldingen aanstaan worden meegenomen. Niet mogelijk: airco en muziek (live weergave, geen gebeurtenis). */

const PR_RUN = ['run', 'running', 'on', 'active', 'washing', 'drying', 'in_progress', 'busy', 'working'];
const PR_NOT_DONE = PR_RUN.concat(['pause', 'paused', 'unavailable', 'unknown']);
const prUnit = (map, id) => { const st = haStateObj(map, id); return String((st && st.attributes && st.attributes.unit_of_measurement) || ''); };
const prId = (s) => /^[a-z0-9_]+\.[a-z0-9_]+$/.test(String(s || '')) ? String(s) : '';

function pushRulesBuild() {
    const map = typeof haStatesMap === 'function' ? haStatesMap() : new Map();
    const rules = [], skipped = [];
    const add = (r) => rules.push(r);
    const on = (cat) => typeof notifEnabled !== 'function' || notifEnabled(cat);
    const st = (typeof appState !== 'undefined' && appState) || {};

    // Wasmachine / droger klaar
    ((on('appliances') && st.laundry && st.laundry.devices) || []).forEach(d => {
        const name = d.name || (d.kind === 'dryer' ? 'Droger' : 'Wasmachine');
        const id = prId(d.entities && d.entities.state), pw = prId(d.entities && d.entities.power);
        if (!id && pw) add(prPowerRule(map, pw, name, d.kind === 'dryer' ? '👕' : '🧺', `laun_${d.id}`));
        else if (id) add({ naam: `${name} klaar`, entity: id, van: PR_RUN, nietNaar: PR_NOT_DONE, titel: 'Thuisbord', tekst: `${d.kind === 'dryer' ? '👕' : '🧺'} ${name} is klaar`, tag: `laun_${d.id}` });
        else skipped.push(`${name}: geen status- of stroomsensor gekoppeld`);
    });

    // Overige toestellen (vaatwasser, ...) met een stroomsensor
    (on('appliances') ? (st.appliances || []) : []).forEach(a => {
        const id = prId(a.entityId);
        if (id) add(prPowerRule(map, id, a.name || 'Toestel', a.icon || '🔌', `done_${a.id}`));
    });

    // Auto's
    (on('cars') ? (st.cars || []) : []).forEach(car => {
        const e = car.entities || {}, name = car.name || 'Auto';
        const doors = { df: 'bestuurder voor', pf: 'passagier voor', dr: 'bestuurder achter', pr: 'passagier achter' };
        Object.keys(doors).forEach(p => {
            const id = prId(e['door_open_' + p]);
            if (id) add({ naam: `${name}: portier open (${doors[p]})`, entity: id, naar: 'on', titel: 'Thuisbord', tekst: `🚪 ${name}: portier open (${doors[p]})`, tag: `car_${car.id}_door_${p}` });
        });
        ['df', 'pf', 'dr', 'pr'].forEach(p => {
            const tid = prId(e['tp_' + p]); if (!tid) return;
            const u = prUnit(map, tid).toLowerCase(), v = parseFloat(String((haStateObj(map, tid) || {}).state));
            const bar = typeof NOTIF_TIRE_WARN_BAR === 'number' ? NOTIF_TIRE_WARN_BAR : 1.9;
            const lim = u === 'kpa' || (!u && v > 10) ? bar * 100 : (u === 'psi' ? bar / 0.0689476 : bar);
            add({ naam: `${name}: bandendruk laag (${doors[p]})`, entity: tid, onder: Math.round(lim * 100) / 100, titel: 'Thuisbord', tekst: `🛞 ${name}: bandendruk laag (${doors[p]})`, tag: `car_${car.id}_tire_${p}` });
        });
        const bid = prId(e.battery);
        if (bid) add({ naam: `${name}: batterij laag`, entity: bid, onder: typeof NOTIF_CAR_BATTERY_WARN === 'number' ? NOTIF_CAR_BATTERY_WARN : 20, titel: 'Thuisbord', tekst: `🪫 ${name}: batterij bijna leeg`, tag: `car_${car.id}_battery` });
    });

    // Robots
    (on('robots') ? (st.robots || []) : []).forEach(rob => {
        const name = rob.name || 'Robot', id = prId(rob.entityId);
        if (id) add({ naam: `${name}: storing`, entity: id, naar: 'error', titel: 'Thuisbord', tekst: `🚨 ${name}: storing, controleer de robot`, tag: `rob_${rob.id}_error` });
        if (id) add({ naam: `${name}: klaar`, entity: id, van: ['cleaning', 'mowing', 'returning'], naar: 'docked', titel: 'Thuisbord', tekst: `${String(rob.entityId || '').startsWith('lawn_mower.') ? '🚜' : '🤖'} ${name} is klaar en staat terug op het dock`, tag: `rob_${rob.id}_klaar` });
        (rob.extras || []).forEach(ex => {
            const eid = prId(ex.entityId); if (!eid) return;
            const label = String(ex.label || ''), pct = prUnit(map, eid) === '%';
            if (/stofbak|\bbin\b|dust|vuil|container|afval/i.test(label) && pct) add({ naam: `${name}: ${label} vol`, entity: eid, boven: 90, titel: 'Thuisbord', tekst: `🗑️ ${name}: ${label.toLowerCase()} is vol`, tag: `rob_${rob.id}_${ex.id}` });
            else if (/water|tank|reservoir/i.test(label) && pct) add({ naam: `${name}: ${label} leeg`, entity: eid, onder: 10, titel: 'Thuisbord', tekst: `💧 ${name}: ${label.toLowerCase()} bijna leeg`, tag: `rob_${rob.id}_${ex.id}` });
        });
    });

    // Internet (Telenet): drempel op 90% en 100% van de limiet, omgerekend naar de eenheid van de sensor
    if (on('internet') && typeof telenetEntities === 'function') {
        try {
            const a = telenetAnalyze(telenetEntities(), ensureTelenet());
            const uid = prId(a.ids && a.ids.usage);
            if (uid && a.limit > 0) {
                const u = prUnit(map, uid).toLowerCase(), f = u === 'mb' || u === 'mib' ? 1024 : (u === 'tb' || u === 'tib' ? 1 / 1024 : 1);
                const r2 = (n) => Math.round(n * 100) / 100;
                add({ naam: 'Internet 90%', entity: uid, boven: r2(a.limit * 0.9 * f), titel: 'Thuisbord', tekst: '📶 Je internetverbruik zit op 90% van je limiet', tag: 'net_90' });
                add({ naam: 'Internet limiet bereikt', entity: uid, boven: r2(a.limit * f), titel: 'Thuisbord', tekst: '🚫 Je internetlimiet is bereikt', tag: 'net_100' });
            }
        } catch (e) { /* negeren */ }
    }
    return { rules, skipped, plannen: on('waste') ? pushPlansBuild() : [] };
}

// Stroomgebaseerde "klaar": vermogen was minstens 5 W en zakt eronder (na minstens 5 minuten)
function prPowerRule(map, id, name, icon, tag) {
    const kw = prUnit(map, id).toLowerCase() === 'kw';
    return { naam: `${name} klaar`, entity: id, stroomBoven: kw ? 0.005 : 5, minMinuten: 5, titel: 'Thuisbord', tekst: `${icon} ${name} is klaar`, tag };
}

// Afvalophaling: de avond ervoor om 18:00 en 's ochtends om 7:00, op basis van het aantal dagen dat de sensor opgeeft
function pushPlansBuild(now) {
    const out = [], t0 = now || Date.now();
    (appState.liveWasteItems || []).forEach(item => {
        const d = Number(item.daysUntil);
        if (item.daysUntil === null || item.daysUntil === undefined || isNaN(d) || d < 0 || d > 14) return;
        const label = item.short || item.label || 'Afval';
        const day = new Date(t0); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + d);
        const at = (back, h) => { const x = new Date(day); x.setDate(x.getDate() - back); x.setHours(h, 0, 0, 0); return x; };
        const ymd = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
        [[1, 18, `♻️ Morgen wordt ${label} opgehaald: buiten zetten`, 'eve'], [0, 7, `♻️ Vandaag wordt ${label} opgehaald`, 'dag']].forEach(([back, h, tekst, k]) => {
            const x = at(back, h);
            if (x.getTime() > t0) out.push({ id: `waste_${label}_${ymd}_${k}`, op: x.toISOString(), titel: 'Thuisbord', tekst, tag: `waste_${label}` });
        });
    });
    return out;
}

window.pushRulesSend = async function(silent) {
    if (typeof currentRole !== 'undefined' && currentRole !== 'manager' && currentRole !== 'admin') return;
    const c = typeof pushServerCfg === 'function' ? pushServerCfg() : null;
    if (!c) { showToast('Vul eerst het adres en de sleutel van de pushserver in en tik op Opslaan.'); return; }
    const { rules, skipped, plannen } = pushRulesBuild();
    const say = (m) => { if (silent !== true) showToast(m); };
    if (!rules.length && !plannen.length) { say('Niets gevonden om te melden. Koppel eerst wasmachine, auto of robot met een entiteit.'); return; }
    try {
        const r = await fetch(c.url + '/rules', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Key': c.key }, body: JSON.stringify({ rules, plannen }) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) say('Pushserver: sleutel klopt niet.');
        else if (!r.ok) say('Server weigert de regels: ' + (j.error || r.status));
        else { try { localStorage.setItem('pushRulesSync', String(Date.now())); } catch (e) { /* negeren */ } say(`${j.regels} meldingsregels staan nu op de server${j.plannen ? ` + ${j.plannen} geplande (afval)` : ''}${skipped.length ? ` (${skipped.length} overgeslagen)` : ''}.`); }
    } catch (e) { say('Pushserver niet bereikbaar. Staat Tailscale aan en is de server bijgewerkt?'); }
};

// Houdt de server bij: bij het openen van de app (max. 1x per 6 uur) worden regels en afvalplanning stilletjes vernieuwd
function pushRulesAutoSync() {
    try {
        if (typeof currentRole === 'undefined' || (currentRole !== 'manager' && currentRole !== 'admin')) return;
        if (typeof pushServerCfg !== 'function' || !pushServerCfg() || typeof pushActive === 'function' && !pushActive()) return;
        if (Date.now() - Number(localStorage.getItem('pushRulesSync') || 0) < 6 * 3600000) return;
        if (!(appState.liveWasteItems || []).length && !(appState.cars || []).length && !(appState.robots || []).length) return;
        window.pushRulesSend(true);
    } catch (e) { /* negeren */ }
}
setTimeout(pushRulesAutoSync, 20000);
setInterval(pushRulesAutoSync, 10 * 60000);
