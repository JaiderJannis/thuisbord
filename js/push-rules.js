'use strict';
/* Maakt pushregels (voor push-server/rules.json) uit wat in Thuisbord is ingesteld en stuurt ze naar de pushserver.
   Zo komen dezelfde dingen binnen als op het display, ook met een gesloten app:
   wasmachine/droger klaar, autoportier open, auto-batterij laag, robotstoring, stofbak vol, water bijna leeg, internetlimiet.
   Niet mogelijk via de server (hangt van tijd of berekeningen in de app af): afvalophaling, airco, muziek, bandendruk. */

const PR_RUN = ['run', 'running', 'on', 'active', 'washing', 'drying', 'in_progress', 'busy', 'working'];
const PR_NOT_DONE = PR_RUN.concat(['pause', 'paused', 'unavailable', 'unknown']);
const prUnit = (map, id) => { const st = haStateObj(map, id); return String((st && st.attributes && st.attributes.unit_of_measurement) || ''); };
const prId = (s) => /^[a-z0-9_]+\.[a-z0-9_]+$/.test(String(s || '')) ? String(s) : '';

function pushRulesBuild() {
    const map = typeof haStatesMap === 'function' ? haStatesMap() : new Map();
    const rules = [], skipped = [];
    const add = (r) => rules.push(r);
    const st = (typeof appState !== 'undefined' && appState) || {};

    // Wasmachine / droger klaar
    ((st.laundry && st.laundry.devices) || []).forEach(d => {
        const name = d.name || (d.kind === 'dryer' ? 'Droger' : 'Wasmachine');
        const id = prId(d.entities && d.entities.state);
        if (id) add({ naam: `${name} klaar`, entity: id, van: PR_RUN, nietNaar: PR_NOT_DONE, titel: 'Thuisbord', tekst: `${d.kind === 'dryer' ? '👕' : '🧺'} ${name} is klaar`, tag: `laun_${d.id}` });
        else skipped.push(`${name}: geen statussensor gekoppeld`);
    });

    // Auto's
    (st.cars || []).forEach(car => {
        const e = car.entities || {}, name = car.name || 'Auto';
        const doors = { df: 'bestuurder voor', pf: 'passagier voor', dr: 'bestuurder achter', pr: 'passagier achter' };
        Object.keys(doors).forEach(p => {
            const id = prId(e['door_open_' + p]);
            if (id) add({ naam: `${name}: portier open (${doors[p]})`, entity: id, naar: 'on', titel: 'Thuisbord', tekst: `🚪 ${name}: portier open (${doors[p]})`, tag: `car_${car.id}_door_${p}` });
        });
        const bid = prId(e.battery);
        if (bid) add({ naam: `${name}: batterij laag`, entity: bid, onder: typeof NOTIF_CAR_BATTERY_WARN === 'number' ? NOTIF_CAR_BATTERY_WARN : 20, titel: 'Thuisbord', tekst: `🪫 ${name}: batterij bijna leeg`, tag: `car_${car.id}_battery` });
    });

    // Robots
    (st.robots || []).forEach(rob => {
        const name = rob.name || 'Robot', id = prId(rob.entityId);
        if (id) add({ naam: `${name}: storing`, entity: id, naar: 'error', titel: 'Thuisbord', tekst: `🚨 ${name}: storing, controleer de robot`, tag: `rob_${rob.id}_error` });
        (rob.extras || []).forEach(ex => {
            const eid = prId(ex.entityId); if (!eid) return;
            const label = String(ex.label || ''), pct = prUnit(map, eid) === '%';
            if (/stofbak|\bbin\b|dust|vuil|container|afval/i.test(label) && pct) add({ naam: `${name}: ${label} vol`, entity: eid, boven: 90, titel: 'Thuisbord', tekst: `🗑️ ${name}: ${label.toLowerCase()} is vol`, tag: `rob_${rob.id}_${ex.id}` });
            else if (/water|tank|reservoir/i.test(label) && pct) add({ naam: `${name}: ${label} leeg`, entity: eid, onder: 10, titel: 'Thuisbord', tekst: `💧 ${name}: ${label.toLowerCase()} bijna leeg`, tag: `rob_${rob.id}_${ex.id}` });
        });
    });

    // Internet (Telenet): drempel op 90% en 100% van de limiet, omgerekend naar de eenheid van de sensor
    if (typeof telenetEntities === 'function') {
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
    return { rules, skipped };
}

window.pushRulesSend = async function() {
    if (typeof currentRole !== 'undefined' && currentRole !== 'manager' && currentRole !== 'admin') return;
    const c = typeof pushServerCfg === 'function' ? pushServerCfg() : null;
    if (!c) { showToast('Vul eerst het adres en de sleutel van de pushserver in en tik op Opslaan.'); return; }
    const { rules, skipped } = pushRulesBuild();
    if (!rules.length) { showToast('Niets gevonden om te melden. Koppel eerst wasmachine, auto of robot met een entiteit.'); return; }
    try {
        const r = await fetch(c.url + '/rules', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Key': c.key }, body: JSON.stringify({ rules }) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) showToast('Pushserver: sleutel klopt niet.');
        else if (!r.ok) showToast('Server weigert de regels: ' + (j.error || r.status));
        else showToast(`${j.regels} meldingsregels staan nu op de server${skipped.length ? ` (${skipped.length} overgeslagen)` : ''}.`);
    } catch (e) { showToast('Pushserver niet bereikbaar. Staat Tailscale aan en is de server bijgewerkt?'); }
};
