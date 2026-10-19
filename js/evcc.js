'use strict';
/* evcc: laadpunten bekijken en bedienen via Home Assistant.
   evcc (evcc.io) laadt je auto slim met zonne-overschot. Via de evcc-koppeling in Home Assistant krijg je entiteiten
   (select voor de laadmodus, sensoren voor vermogen, energie, ...). Hier koppel je ze per laadpunt:
   appState.evcc = { loadpoints: [ { id, name, icon, entities: { mode, status, connected, charging, power, energy, duration, soc, limit_soc, limit_energy, vehicle } } ] } */

const EVCC_FIELDS = [
    ['mode', 'Laadmodus', 'select.evcc_laadpunt_mode'],
    ['status', 'Status', 'sensor.evcc_laadpunt_status'],
    ['connected', 'Auto aangesloten', 'binary_sensor.evcc_laadpunt_connected'],
    ['charging', 'Laadt nu', 'binary_sensor.evcc_laadpunt_charging'],
    ['power', 'Laadvermogen', 'sensor.evcc_laadpunt_charge_power'],
    ['energy', 'Geladen deze sessie', 'sensor.evcc_laadpunt_charged_energy'],
    ['duration', 'Laadduur', 'sensor.evcc_laadpunt_charge_duration'],
    ['soc', 'Batterij auto (%)', 'sensor.evcc_laadpunt_vehicle_soc'],
    ['limit_soc', 'Limiet batterij (%)', 'number.evcc_laadpunt_limit_soc'],
    ['limit_energy', 'Limiet energie (kWh)', 'number.evcc_laadpunt_limit_energy'],
    ['vehicle', 'Voertuig (naam)', 'sensor.evcc_laadpunt_vehicle_name']
];

const EVCC_MODE_LABELS = { off: 'Uit', pv: 'Zon', minpv: 'Min + zon', now: 'Snel' };
const EVCC_MODE_HINTS = {
    off: 'Er wordt niet geladen.',
    pv: 'Laadt enkel met zonne-overschot.',
    minpv: 'Laadt minimaal, en sneller als er zon over is.',
    now: 'Laadt zo snel mogelijk, ook met netstroom.'
};
const EVCC_DEFAULT_MODES = ['off', 'pv', 'minpv', 'now'];

function ensureEvcc() {
    if (!appState.evcc || typeof appState.evcc !== 'object') appState.evcc = { loadpoints: [] };
    if (!Array.isArray(appState.evcc.loadpoints)) appState.evcc.loadpoints = [];
    appState.evcc.loadpoints.forEach(lp => { if (!lp.entities) lp.entities = {}; });
    return appState.evcc;
}

/* ============================ HULPFUNCTIES ============================ */

function evccIsOn(st) {
    return !!st && String(st.state).toLowerCase() === 'on';
}

// Vermogen in W (kW wordt omgerekend)
function evccPowerW(st) {
    const n = haNumber(st);
    if (n === null) return null;
    const unit = String((st.attributes || {}).unit_of_measurement || '').toLowerCase();
    return unit === 'kw' ? n * 1000 : n;
}

function evccFormatPower(w) {
    if (w === null || w === undefined) return '—';
    const abs = Math.abs(w);
    if (abs >= 1000) return `${(w / 1000).toLocaleString('nl-BE', { maximumFractionDigits: 1 })} kW`;
    return `${Math.round(w).toLocaleString('nl-BE')} W`;
}

function evccFormatDuration(st) {
    if (!haIsUsable(st)) return '—';
    const raw = String(st.state);
    const unit = String((st.attributes || {}).unit_of_measurement || '').toLowerCase();
    if (/^\d+:\d{2}(:\d{2})?$/.test(raw)) return raw.length === 8 ? raw.slice(0, 5) : raw;
    const n = parseFloat(raw.replace(',', '.'));
    if (isNaN(n)) return haPrettify(raw);
    let minutes = n;
    if (unit === 's') minutes = n / 60;
    else if (unit === 'h') minutes = n * 60;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h} u ${String(m).padStart(2, '0')} min` : `${m} min`;
}

// { connected, charging } of null als er niets over bekend is
function evccLoadpointStatus(lp, map) {
    const e = lp.entities || {};
    const chargingSt = haStateObj(map, e.charging);
    const connectedSt = haStateObj(map, e.connected);
    const statusSt = haStateObj(map, e.status);
    const stat = haIsUsable(statusSt) ? String(statusSt.state).toLowerCase() : '';
    if (!haIsUsable(chargingSt) && !haIsUsable(connectedSt) && !stat) return null;
    let charging = haIsUsable(chargingSt) ? evccIsOn(chargingSt) : (stat === 'c' || /charging|laadt|laden/.test(stat));
    let connected = haIsUsable(connectedSt) ? evccIsOn(connectedSt) : (stat === 'b' || stat === 'c' || /connected|charging|aangesloten|laadt|laden/.test(stat));
    if (charging) connected = true;
    return { connected, charging };
}

function evccModeOptions(st) {
    const opts = st && st.attributes && Array.isArray(st.attributes.options) ? st.attributes.options.map(String) : [];
    return opts.length ? opts : EVCC_DEFAULT_MODES;
}

function evccModeLabel(opt) {
    return EVCC_MODE_LABELS[String(opt).toLowerCase()] || haPrettify(opt);
}

/* ============================ WEERGAVE ============================ */

function evccLoadpointCardHtml(lp, idx, map) {
    const e = lp.entities || {};
    const stat = evccLoadpointStatus(lp, map);
    const powerSt = haStateObj(map, e.power);
    const powerW = evccPowerW(powerSt);
    const energySt = haStateObj(map, e.energy);
    const energyKwh = (() => {
        const n = haNumber(energySt);
        if (n === null) return null;
        return String((energySt.attributes || {}).unit_of_measurement || '').toLowerCase() === 'wh' ? n / 1000 : n;
    })();
    const socPct = haNumber(haStateObj(map, e.soc));
    const vehicleSt = haStateObj(map, e.vehicle);
    const modeSt = haStateObj(map, e.mode);
    const modeNow = haIsUsable(modeSt) ? String(modeSt.state) : '';
    const canControl = permAllowed('control_evcc');

    const chip = !stat ? { t: 'Status onbekend', c: 'bg-stone-200 text-stone-600' }
        : stat.charging ? { t: '⚡ Laadt', c: 'bg-[#dcece3] text-[#1c643f]' }
        : stat.connected ? { t: '🔌 Aangesloten', c: 'bg-sky-100 text-sky-800' }
        : { t: 'Niet aangesloten', c: 'bg-stone-200 text-stone-600' };

    const modeButtons = (() => {
        if (!e.mode) return '<p class="text-xs text-[#68736d] italic">Geen laadmodus gekoppeld.</p>';
        if (!haIsUsable(modeSt)) return '<p class="text-xs text-[#68736d] italic">Laadmodus nu niet beschikbaar.</p>';
        return `<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            ${evccModeOptions(modeSt).map(opt => {
                const active = String(opt).toLowerCase() === modeNow.toLowerCase();
                return `<button type="button" ${canControl ? `onclick="window.evccSetMode(${idx}, '${haEscape(opt)}')"` : 'disabled'} aria-pressed="${active}"
                    class="py-2.5 rounded-xl text-xs font-extrabold transition ${active ? 'bg-[#152920] text-white' : 'bg-stone-100 text-[#1c2520] hover:bg-stone-200'} ${canControl ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}">${haEscape(evccModeLabel(opt))}</button>`;
            }).join('')}
        </div>
        ${EVCC_MODE_HINTS[modeNow.toLowerCase()] ? `<p class="text-[11px] text-[#68736d] mt-1.5">${EVCC_MODE_HINTS[modeNow.toLowerCase()]}</p>` : ''}`;
    })();

    const limitHtml = ['limit_soc', 'limit_energy'].map(key => {
        if (!e[key]) return '';
        const st = haStateObj(map, e[key]);
        if (!haIsUsable(st)) return '';
        const a = st.attributes || {};
        const val = haNumber(st);
        const isSoc = key === 'limit_soc';
        const min = a.min !== undefined ? a.min : 0;
        const max = a.max !== undefined ? a.max : (isSoc ? 100 : 100);
        const step = a.step !== undefined ? a.step : (isSoc ? 5 : 1);
        return `
            <div>
                <div class="flex items-center justify-between text-[11px] font-bold text-[#38443d] mb-1">
                    <span>${isSoc ? 'Laden tot (batterij)' : 'Laden tot (energie)'}</span>
                    <span id="evccLimitLabel_${idx}_${key}">${val === null ? '—' : val.toLocaleString('nl-BE')}${isSoc ? ' %' : ' kWh'}</span>
                </div>
                <input type="range" min="${min}" max="${max}" step="${step}" value="${val === null ? min : val}" ${canControl ? '' : 'disabled'}
                    oninput="document.getElementById('evccLimitLabel_${idx}_${key}').textContent = this.value + '${isSoc ? ' %' : ' kWh'}'"
                    onchange="window.evccSetLimit(${idx}, '${key}', this.value)" class="w-full accent-[#152920] ${canControl ? 'cursor-pointer' : 'opacity-60'}">
            </div>`;
    }).join('');

    const tile = (label, value) => `<div class="rounded-2xl bg-[#f6f8f5] border border-stone-200/70 px-3.5 py-3"><p class="text-[11px] font-bold text-[#68736d]">${label}</p><p class="text-base font-extrabold text-[#1c2520] mt-0.5">${value}</p></div>`;

    return `
        <article class="bg-white rounded-[26px] p-5 sm:p-6 shadow-sm border border-stone-200/80 space-y-4">
            <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                    <span class="w-11 h-11 rounded-2xl bg-[#e8f2ec] flex items-center justify-center text-xl shrink-0">${haEscape(lp.icon || '🔌')}</span>
                    <div class="min-w-0">
                        <h3 class="text-lg font-bold text-[#1c2520] truncate">${haEscape(lp.name || 'Laadpunt')}</h3>
                        ${haIsUsable(vehicleSt) ? `<p class="text-xs text-[#68736d] truncate">${haEscape(vehicleSt.state)}</p>` : ''}
                    </div>
                </div>
                <span class="text-[11px] font-extrabold px-3 py-1.5 rounded-full whitespace-nowrap ${chip.c}">${chip.t}</span>
            </div>

            <div class="flex items-end justify-between gap-3">
                <div>
                    <p class="text-[11px] font-bold text-[#68736d]">Laadvermogen</p>
                    <p class="text-4xl font-bold tracking-tight text-[#1c2520]">${evccFormatPower(powerW)}</p>
                </div>
                ${socPct !== null ? `
                <div class="w-1/2 max-w-[220px]">
                    <div class="flex items-center justify-between text-[11px] font-bold text-[#38443d] mb-1"><span>Batterij auto</span><span>${Math.round(socPct)}%</span></div>
                    <div class="h-2.5 rounded-full bg-stone-200 overflow-hidden"><div class="h-full rounded-full bg-[#19975c]" style="width:${Math.max(0, Math.min(100, socPct))}%"></div></div>
                </div>` : ''}
            </div>

            <div class="grid grid-cols-2 gap-2.5">
                ${tile('Geladen deze sessie', energyKwh === null ? '—' : `${energyKwh.toLocaleString('nl-BE', { maximumFractionDigits: 1 })} kWh`)}
                ${tile('Laadduur', evccFormatDuration(haStateObj(map, e.duration)))}
            </div>

            <div>
                <p class="text-[11px] font-extrabold uppercase tracking-wider text-[#68736d] mb-2">Laadmodus</p>
                ${modeButtons}
            </div>
            ${limitHtml ? `<div class="space-y-3 pt-1">${limitHtml}</div>` : ''}
        </article>`;
}

function renderEvccView() {
    const lps = (appState.evcc && appState.evcc.loadpoints) || [];
    const badge = document.getElementById('menuEvccBadge');
    const map = haStatesMap();
    if (badge) {
        const charging = lps.filter(lp => { const s = evccLoadpointStatus(lp, map); return s && s.charging; }).length;
        badge.textContent = charging ? `⚡ ${charging}` : '';
    }
    const container = document.getElementById('evccContainer');
    const view = document.getElementById('viewEvcc');
    if (!container || (view && view.classList.contains('hidden'))) return;

    if (!lps.length) {
        container.innerHTML = `<p class="text-sm text-[#68736d] bg-white rounded-2xl p-6 col-span-full">Er zijn nog geen laadpunten gekoppeld. Doe dat via Beheer → 🔌 Laden (evcc).</p>`;
        return;
    }

    // Overzicht bovenaan: zon, net en totaal laadvermogen
    const totalW = lps.reduce((sum, lp) => sum + (evccPowerW(haStateObj(map, (lp.entities || {}).power)) || 0), 0);
    const solar = Number(appState.solarW) || 0;
    const gridImport = Number(appState.gridImportW ?? appState.gridW ?? 0);
    const gridExport = Number(appState.gridExportW ?? 0);
    const net = gridExport > gridImport ? -gridExport : gridImport;
    const summaryTile = (icon, label, value) => `<div class="rounded-2xl bg-white shadow-sm border border-stone-200/80 px-4 py-3.5"><p class="text-[11px] font-bold text-[#68736d]">${icon} ${label}</p><p class="text-xl font-extrabold text-[#1c2520] mt-0.5">${value}</p></div>`;
    const summary = `
        <div class="col-span-full grid grid-cols-3 gap-3">
            ${summaryTile('☀️', 'Zon', evccFormatPower(solar))}
            ${summaryTile('🔌', 'Laden', evccFormatPower(totalW))}
            ${summaryTile('🏭', net < 0 ? 'Teruglevering' : 'Afname net', evccFormatPower(Math.abs(net)))}
        </div>`;

    container.innerHTML = summary + lps.map((lp, i) => evccLoadpointCardHtml(lp, i, map)).join('');
}

/* ============================ BEDIENING ============================ */

window.evccSetMode = async function(idx, option) {
    if (!permGuard('control_evcc')) return;
    const lp = appState.evcc && appState.evcc.loadpoints[idx];
    const entityId = String((lp && lp.entities && lp.entities.mode) || '').trim();
    if (!entityId) return;
    const domain = entityId.split('.')[0];
    if (domain !== 'select' && domain !== 'input_select') { showToast("De laadmodus moet een select-entiteit zijn."); return; }
    const ok = await window.callHomeAssistantService(domain, 'select_option', { entity_id: entityId, option: String(option) });
    showToast(ok === false ? "Opdracht niet verzonden (geen verbinding met Home Assistant)." : `${lp.name || 'Laadpunt'}: modus ${evccModeLabel(option)}`);
};

window.evccSetLimit = async function(idx, key, value) {
    if (!permGuard('control_evcc')) return;
    if (key !== 'limit_soc' && key !== 'limit_energy') return;
    const lp = appState.evcc && appState.evcc.loadpoints[idx];
    const entityId = String((lp && lp.entities && lp.entities[key]) || '').trim();
    const n = parseFloat(String(value).replace(',', '.'));
    if (!entityId || isNaN(n)) return;
    const domain = entityId.split('.')[0];
    if (domain !== 'number' && domain !== 'input_number') { showToast("De limiet moet een number-entiteit zijn."); return; }
    const ok = await window.callHomeAssistantService(domain, 'set_value', { entity_id: entityId, value: n });
    showToast(ok === false ? "Opdracht niet verzonden (geen verbinding met Home Assistant)." : `${lp.name || 'Laadpunt'}: limiet ${n}${key === 'limit_soc' ? ' %' : ' kWh'}`);
};

/* ============================ AUTOMATISCH ZOEKEN ============================ */

// Zoekt evcc-entiteiten en maakt per laadmodus-entiteit een laadpunt. Zuivere functie (testbaar).
function evccDetectLoadpoints(entities) {
    const all = (entities || []).filter(s => s && s.entity_id && /evcc/i.test(s.entity_id));
    const modeEntities = all.filter(s => /^(select|input_select)\./.test(s.entity_id) && /mode/i.test(s.entity_id));
    const objectId = s => s.entity_id.split('.')[1];
    const rules = [
        ['limit_soc', s => /^(number|input_number)\./.test(s.entity_id) && /limit/i.test(s.entity_id) && /soc/i.test(s.entity_id)],
        ['limit_energy', s => /^(number|input_number)\./.test(s.entity_id) && /limit/i.test(s.entity_id) && /energy/i.test(s.entity_id)],
        ['charging', s => s.entity_id.startsWith('binary_sensor.') && /charging/i.test(s.entity_id)],
        ['connected', s => s.entity_id.startsWith('binary_sensor.') && /connected/i.test(s.entity_id)],
        ['power', s => s.entity_id.startsWith('sensor.') && /(charge|charging)_?power|chargepower/i.test(s.entity_id)],
        ['energy', s => s.entity_id.startsWith('sensor.') && /(charged|session|charge)_?energy/i.test(s.entity_id)],
        ['duration', s => s.entity_id.startsWith('sensor.') && /duration/i.test(s.entity_id)],
        ['soc', s => s.entity_id.startsWith('sensor.') && /soc/i.test(s.entity_id) && !/limit/i.test(s.entity_id)],
        ['vehicle', s => s.entity_id.startsWith('sensor.') && /vehicle_?(name|title)|vehicle$/i.test(s.entity_id)],
        ['status', s => s.entity_id.startsWith('sensor.') && /status/i.test(s.entity_id)]
    ];
    const prefixOf = s => objectId(s).replace(/_?mode$/i, '').replace(/_?(load)?(point)?_?mode$/i, '');
    const lps = [];
    const used = new Set();
    const make = (mode, idx) => {
        const prefix = mode ? prefixOf(mode) : '';
        const lp = { id: 'lp_' + Date.now() + '_' + idx, name: '', icon: '🔌', entities: {} };
        if (mode) { lp.entities.mode = mode.entity_id; used.add(mode.entity_id); }
        rules.forEach(([key, test]) => {
            const cands = all.filter(s => test(s) && !used.has(s.entity_id));
            if (!cands.length) return;
            const preferred = prefix ? cands.find(s => objectId(s).startsWith(prefix)) : null;
            const pick = preferred || (modeEntities.length <= 1 ? cands[0] : null);
            if (pick) { lp.entities[key] = pick.entity_id; used.add(pick.entity_id); }
        });
        lp.name = ((mode && mode.attributes && mode.attributes.friendly_name) || '').replace(/\s*(laad)?modus$/i, '').replace(/^evcc\s*/i, '').trim() || `Laadpunt ${idx + 1}`;
        return lp;
    };
    if (!all.length) return [];
    if (!modeEntities.length) {
        const lp = make(null, 0);
        return Object.keys(lp.entities).length ? [lp] : [];
    }
    modeEntities.forEach((m, i) => lps.push(make(m, i)));
    return lps;
}

window.evccAutoDetect = function() {
    if (!permGuard('manage_evcc')) return;
    if (!(discoveredHaEntities || []).length) { showToast("Haal eerst de entiteiten op bij Home Assistant (tab Home Assistant)."); return; }
    const found = evccDetectLoadpoints(discoveredHaEntities);
    if (!found.length) { showToast("Geen evcc-entiteiten gevonden. Is de evcc-koppeling in Home Assistant geïnstalleerd?"); return; }
    const evcc = ensureEvcc();
    const existing = new Set(evcc.loadpoints.map(lp => (lp.entities || {}).mode).filter(Boolean));
    const fresh = found.filter(lp => !lp.entities.mode || !existing.has(lp.entities.mode));
    evcc.loadpoints.push(...fresh);
    renderAdminEvccList();
    renderEvccView();
    showToast(fresh.length ? `${fresh.length} laadpunt(en) toegevoegd. Controleer de koppelingen en sla op.` : "Alle gevonden laadpunten staan er al in.");
};

/* ============================ BEHEER ============================ */

function renderAdminEvccList() {
    const container = document.getElementById('adminEvccContainer');
    if (!container) return;
    const lps = ensureEvcc().loadpoints;

    const cards = lps.map((lp, i) => {
        const fields = EVCC_FIELDS.map(([key, label, ph]) => {
            const val = (lp.entities || {})[key] || '';
            const exists = typeof carEntityExists === 'function' ? carEntityExists(val) : null;
            const dot = !val ? '' : (exists === null ? '' : (exists ? '<span title="Gevonden in Home Assistant" class="text-[#19975c]">●</span>' : '<span title="Niet gevonden in Home Assistant" class="text-red-500">●</span>'));
            return `<div>
                <label class="block text-[11px] font-bold text-[#38443d] mb-1">${label} ${dot}</label>
                <input type="text" list="haEntitiesDatalist" value="${haEscape(val)}" placeholder="${haEscape(ph)}" onchange="window.updateEvccEntity(${i}, '${key}', this.value)" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-xs font-mono">
            </div>`;
        }).join('');
        return `
            <div class="bg-white rounded-[26px] p-6 shadow-sm space-y-4 border border-stone-200/80">
                <div class="flex flex-wrap items-end gap-3">
                    <div class="w-20">
                        <label class="block text-[11px] font-bold text-[#38443d] mb-1">Icoon</label>
                        <input type="text" value="${haEscape(lp.icon || '🔌')}" maxlength="4" onchange="window.updateEvccField(${i}, 'icon', this.value)" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-center text-lg">
                    </div>
                    <div class="flex-1 min-w-[160px]">
                        <label class="block text-[11px] font-bold text-[#38443d] mb-1">Naam van laadpunt ${i + 1}</label>
                        <input type="text" value="${haEscape(lp.name || '')}" onchange="window.updateEvccField(${i}, 'name', this.value)" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm font-bold">
                    </div>
                    <button onclick="window.removeEvccLoadpoint(${i})" class="px-3 py-2 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 cursor-pointer">🗑 Verwijderen</button>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${fields}</div>
            </div>`;
    }).join('');

    container.innerHTML = `
        <div class="bg-white rounded-[26px] p-6 shadow-sm space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="max-w-2xl">
                    <h3 class="text-lg font-bold text-[#1c2520]">Laden met evcc</h3>
                    <p class="text-xs text-[#68736d]">Koppel per laadpunt de entiteiten die de evcc-koppeling in Home Assistant aanmaakt. Alleen de <strong>laadmodus</strong> is nodig om te bedienen; de rest is voor de weergave. Een ● toont of de entiteit in Home Assistant bestaat (groen) of niet (rood).</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button onclick="window.evccAutoDetect()" class="bg-[#dcece3] hover:bg-[#c8e2d3] text-[#152920] font-bold px-4 py-2.5 rounded-xl text-sm cursor-pointer">⚡ Auto-zoek evcc in HA</button>
                    <button onclick="window.addEvccLoadpoint()" class="bg-white border border-stone-200 hover:bg-stone-100 text-[#38443d] font-bold px-4 py-2.5 rounded-xl text-sm cursor-pointer">+ Laadpunt</button>
                    <button onclick="window.saveEvccAdmin()" class="bg-[#152920] hover:bg-[#233f31] text-white font-bold px-5 py-2.5 rounded-xl text-sm cursor-pointer">💾 Opslaan</button>
                </div>
            </div>
            <p class="text-[11px] text-[#68736d]">Tip: laadmodus is een <code>select</code>-entiteit met de opties <code>off</code>, <code>pv</code>, <code>minpv</code> en <code>now</code>. De limieten zijn <code>number</code>-entiteiten.</p>
        </div>
        ${lps.length ? cards : '<p class="text-sm text-[#68736d] bg-white rounded-2xl p-6">Nog geen laadpunten. Klik op "Auto-zoek evcc in HA" of voeg er handmatig een toe.</p>'}`;
}

window.updateEvccField = function(i, field, value) {
    if (!permGuard('manage_evcc')) return;
    const lp = ensureEvcc().loadpoints[i];
    if (!lp || !['name', 'icon'].includes(field)) return;
    lp[field] = String(value).trim();
    renderEvccView();
};

window.updateEvccEntity = function(i, key, value) {
    if (!permGuard('manage_evcc')) return;
    const lp = ensureEvcc().loadpoints[i];
    if (!lp || !EVCC_FIELDS.some(f => f[0] === key)) return;
    lp.entities[key] = String(value).trim();
    renderEvccView();
};

window.addEvccLoadpoint = function() {
    if (!permGuard('manage_evcc')) return;
    ensureEvcc().loadpoints.push({ id: 'lp_' + Date.now(), name: `Laadpunt ${appState.evcc.loadpoints.length + 1}`, icon: '🔌', entities: {} });
    renderAdminEvccList();
};

window.removeEvccLoadpoint = function(i) {
    if (!permGuard('manage_evcc')) return;
    const lp = ensureEvcc().loadpoints[i];
    if (!lp || !window.confirm(`Laadpunt "${lp.name || i + 1}" verwijderen?`)) return;
    appState.evcc.loadpoints.splice(i, 1);
    renderAdminEvccList();
    renderEvccView();
    persistStateToFirestore(true);
};

window.saveEvccAdmin = function() {
    if (!permGuard('manage_evcc')) return;
    renderEvccView();
    persistStateToFirestore(true);
    showToast("Laadpunten opgeslagen.");
};
