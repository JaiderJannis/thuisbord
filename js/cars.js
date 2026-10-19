'use strict';
/* Auto's: weergave (naast elkaar) en beheer, gebaseerd op de Home Assistant "smart-ev-card".
   Elke auto heeft een naam, een model en een lijst entiteiten (sleutel = kaartveld zonder "_entity"). */

// Groepen en velden voor het beheer. [sleutel, label]; het voorbeeld uit DEFAULT_SMART_EV_ENTITIES dient als hint.
const CAR_ENTITY_GROUPS = [
    { id: 'basis', title: '🔋 Basis', open: true, fields: [
        ['status', 'Lader aangesloten'], ['charge_status', 'Laadstatus'], ['time_remaining', 'Resterende laadtijd'],
        ['battery', 'Batterij (%)'], ['range', 'Actieradius'], ['odometer', 'Kilometerteller'],
        ['interior_temp', 'Binnentemperatuur'], ['motor', 'Motor'], ['service', 'Dagen tot onderhoud']
    ] },
    { id: 'laden', title: '⚡ Laden', open: false, fields: [
        ['power', 'Laadvermogen'], ['charge_current', 'Laadstroom'], ['charge_control', 'Laden aan/uit (switch)']
    ] },
    { id: 'bediening', title: '🔐 Bediening', open: false, fields: [
        ['lock', 'Deurslot (lock)'], ['defrost', 'Voorruit ontwasemen (switch)'], ['central_lock', 'Centrale vergrendeling']
    ] },
    { id: 'portieren', title: '🚪 Portieren', open: false, fields: [
        ['door_df', 'Slot bestuurder voor'], ['door_pf', 'Slot passagier voor'], ['door_dr', 'Slot bestuurder achter'], ['door_pr', 'Slot passagier achter'],
        ['door_open_df', 'Open bestuurder voor'], ['door_open_pf', 'Open passagier voor'], ['door_open_dr', 'Open bestuurder achter'], ['door_open_pr', 'Open passagier achter']
    ] },
    { id: 'locatie', title: '📍 Locatie (kaart)', open: false, fields: [
        ['tracker', 'Locatie-tracker (device_tracker)']
    ] },
    { id: 'banden', title: '🛞 Banden', open: false, fields: [
        ['tp_df', 'Druk bestuurder voor'], ['tp_pf', 'Druk passagier voor'], ['tp_dr', 'Druk bestuurder achter'], ['tp_pr', 'Druk passagier achter'],
        ['tt_df', 'Temperatuur bestuurder voor'], ['tt_pf', 'Temperatuur passagier voor'], ['tt_dr', 'Temperatuur bestuurder achter'], ['tt_pr', 'Temperatuur passagier achter']
    ] }
];
const CAR_ALL_KEYS = CAR_ENTITY_GROUPS.flatMap(g => g.fields.map(f => f[0]));

function ensureCars() {
    if (!Array.isArray(appState.cars)) appState.cars = createDefaultCars(activeHouseholdName);
    appState.cars.forEach(c => { if (!c.entities) c.entities = {}; });
    return appState.cars;
}

/* ============================ WEERGAVE ============================ */

function carChargeInfo(chargeSt, plugSt) {
    const raw = haIsUsable(chargeSt) ? String(chargeSt.state).toLowerCase() : '';
    const plugRaw = haIsUsable(plugSt) ? String(plugSt.state).toLowerCase() : '';
    const charging = raw !== '' && (/^(on|true|1)$/.test(raw) || (raw.includes('charging') && !/not|no_|stop|complete|done|idle|finish/.test(raw)));
    let plugged = null;
    if (plugRaw) plugged = /(dis|not|unplug)/.test(plugRaw) || /^(no|off|false|0)$/.test(plugRaw) ? false : /(connect|plug)|^(on|true|yes|1)$/.test(plugRaw);
    if (charging) plugged = true;
    const labels = {
        charging: 'Aan het laden', not_charging: 'Niet aan het laden', idle: 'Niet aan het laden', charging_complete: 'Laden voltooid',
        complete: 'Laden voltooid', done: 'Laden voltooid', fault: 'Storing', scheduled: 'Laden gepland', connected: 'Aangesloten'
    };
    const label = raw ? (labels[raw] || haPrettify(raw)) : '';
    return { charging, plugged, label, hasData: !!raw || !!plugRaw };
}

function carFormatTimeRemaining(st) {
    if (!haIsUsable(st)) return null;
    const n = haNumber(st);
    if (n === null) return haPrettify(st.state);
    if (n <= 0) return null;
    const unit = String(st.attributes?.unit_of_measurement || 'min').toLowerCase();
    const minutes = unit.startsWith('h') ? n * 60 : (unit === 's' ? n / 60 : n);
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h} u ${m} min` : `${m} min`;
}

function carTirePressure(st) {
    const n = haNumber(st);
    if (n === null) return null;
    const unit = String(st.attributes?.unit_of_measurement || '').toLowerCase();
    let bar = n;
    if (unit === 'kpa' || (!unit && n > 10)) bar = n / 100;
    else if (unit === 'psi') bar = n * 0.0689476;
    return bar;
}

function carTireTemp(st) {
    const n = haNumber(st);
    return n === null ? null : n;
}

function carDoorStates(car, map, pos) {
    const e = car.entities || {};
    const lockSt = haStateObj(map, e['door_' + pos]);
    const openSt = haStateObj(map, e['door_open_' + pos]);
    let locked = null;
    if (haIsUsable(lockSt)) {
        const raw = String(lockSt.state).toLowerCase();
        if (raw === 'locked') locked = true;
        else if (raw === 'unlocked') locked = false;
        else if (raw === 'on' || raw === 'off') {
            const on = raw === 'on';
            locked = (car.lockOnMeans || 'unlocked') === 'unlocked' ? !on : on; // instelbaar: wat betekent "aan"?
        }
    }
    const open = haIsUsable(openSt) ? String(openSt.state).toLowerCase() === 'on' : null;
    return { locked, open };
}

function carDiagramSvg(car, map) {
    const e = car.entities || {};
    const doors = [
        { pos: 'df', x: 78, y: 108, w: 40, h: 66, dx: -12 },
        { pos: 'pf', x: 122, y: 108, w: 40, h: 66, dx: 12 },
        { pos: 'dr', x: 78, y: 178, w: 40, h: 58, dx: -12 },
        { pos: 'pr', x: 122, y: 178, w: 40, h: 58, dx: 12 }
    ];
    const doorSvg = doors.map(d => {
        const s = carDoorStates(car, map, d.pos);
        let fill = '#f1f3f2', stroke = '#c9d0cc', icon = '';
        if (s.locked === true) { fill = '#e1f1e8'; stroke = '#19975c'; icon = '🔒'; }
        else if (s.locked === false) { fill = '#fdf0cf'; stroke = '#e6a100'; icon = '🔓'; }
        let shift = 0;
        if (s.open === true) { fill = '#fde2e2'; stroke = '#dc2626'; icon = '⚠️'; shift = d.dx; }
        return `<g transform="translate(${shift},0)"><rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="2"/>` +
               (icon ? `<text x="${d.x + d.w / 2}" y="${d.y + d.h / 2 + 5}" font-size="15" text-anchor="middle">${icon}</text>` : '') + `</g>`;
    }).join('');

    const wheels = [
        { pos: 'df', x: 56, y: 66, side: 'l', ly: 84 },
        { pos: 'pf', x: 170, y: 66, side: 'r', ly: 84 },
        { pos: 'dr', x: 56, y: 230, side: 'l', ly: 248 },
        { pos: 'pr', x: 170, y: 230, side: 'r', ly: 248 }
    ];
    const wheelSvg = wheels.map(w => {
        const bar = carTirePressure(haStateObj(map, e['tp_' + w.pos]));
        const temp = carTireTemp(haStateObj(map, e['tt_' + w.pos]));
        let color = '#1c2520';
        if (bar !== null) color = bar < 1.8 ? '#dc2626' : (bar < 2.2 ? '#b45309' : '#1c2520');
        const anchor = w.side === 'l' ? 'end' : 'start';
        const tx = w.side === 'l' ? 48 : 192;
        const pText = bar === null ? '' : `${bar.toLocaleString('nl-BE', { maximumFractionDigits: 2 })} bar`;
        const tText = temp === null ? '' : `${Math.round(temp)}°C`;
        return `<rect x="${w.x}" y="${w.y}" width="14" height="46" rx="5" fill="#2b3530"/>` +
               (pText ? `<text x="${tx}" y="${w.ly}" font-size="11" font-weight="700" text-anchor="${anchor}" fill="${color}">${pText}</text>` : '') +
               (tText ? `<text x="${tx}" y="${w.ly + 14}" font-size="10" text-anchor="${anchor}" fill="#68736d">${tText}</text>` : '');
    }).join('');

    return `
        <svg viewBox="0 0 240 340" class="w-full max-w-[240px] mx-auto" role="img" aria-label="Portieren en banden van ${haEscape(car.name)}">
            <text x="120" y="12" font-size="9" font-weight="700" text-anchor="middle" fill="#8a958f">▲ VOOR</text>
            ${wheelSvg}
            <rect x="70" y="20" width="100" height="300" rx="44" fill="#eef2ed" stroke="#9fb0a6" stroke-width="2"/>
            <path d="M 84 80 Q 120 64 156 80 L 150 104 Q 120 96 90 104 Z" fill="#cfe3ef" stroke="#9fb0a6" stroke-width="1.5"/>
            <path d="M 88 262 Q 120 274 152 262 L 150 240 Q 120 246 90 240 Z" fill="#cfe3ef" stroke="#9fb0a6" stroke-width="1.5"/>
            ${doorSvg}
        </svg>`;
}

function carInfoTile(icon, label, valueHtml, extraClass = '') {
    return `
        <div class="bg-[#f6f8f5] rounded-2xl px-3 py-2.5 ${extraClass}">
            <p class="text-[10px] font-bold uppercase tracking-wide text-[#68736d]">${icon} ${label}</p>
            <p class="text-sm font-extrabold text-[#1c2520] mt-0.5">${valueHtml}</p>
        </div>`;
}

function renderCarCard(car, cIdx, map) {
    const e = car.entities || {};
    const st = (key) => haStateObj(map, e[key]);
    const mapped = (key) => !!(e[key] && String(e[key]).trim());
    const anyMapped = CAR_ALL_KEYS.some(mapped);
    const hasHa = map.size > 0;

    const batSt = st('battery');
    const pct = haNumber(batSt);
    const pctClamped = pct === null ? 0 : Math.max(0, Math.min(100, pct));
    const barColor = pct === null ? 'bg-stone-300' : (pct < 20 ? 'bg-red-500' : (pct < 50 ? 'bg-amber-500' : 'bg-[#19975c]'));
    const rangeFv = haFriendlyValue(st('range'));
    const charge = carChargeInfo(st('charge_status'), st('status'));

    // Statuspil in de kop
    let pill = { text: 'Geen gegevens', cls: 'bg-stone-200 text-stone-600' };
    if (!anyMapped) pill = { text: 'Niet gekoppeld', cls: 'bg-stone-200 text-stone-600' };
    else if (!hasHa) pill = { text: 'Niet verbonden met HA', cls: 'bg-stone-200 text-stone-600' };
    else if (charge.charging) pill = { text: '⚡ Aan het laden', cls: 'bg-[#dcece3] text-[#197447]' };
    else if (charge.plugged === true) pill = { text: '🔌 Aangesloten', cls: 'bg-sky-100 text-sky-800' };
    else if (charge.plugged === false) pill = { text: 'Niet aangesloten', cls: 'bg-stone-200 text-stone-700' };
    else if (charge.hasData) pill = { text: charge.label, cls: 'bg-stone-200 text-stone-700' };

    // Info-tegels (enkel voor gekoppelde entiteiten)
    const tiles = [];
    if (mapped('range')) tiles.push(carInfoTile('🛣️', 'Actieradius', haEscape(rangeFv.text)));
    if (mapped('time_remaining') && charge.charging) {
        const t = carFormatTimeRemaining(st('time_remaining'));
        if (t) tiles.push(carInfoTile('⏱️', 'Laden klaar over', haEscape(t)));
    }
    if (mapped('power')) tiles.push(carInfoTile('⚡', 'Laadvermogen', haEscape(haFriendlyValue(st('power')).text)));
    if (mapped('charge_current')) tiles.push(carInfoTile('🔌', 'Laadstroom', haEscape(haFriendlyValue(st('charge_current')).text)));
    if (mapped('odometer')) tiles.push(carInfoTile('🧭', 'Kilometerstand', haEscape(haFriendlyValue(st('odometer')).text)));
    if (mapped('interior_temp')) tiles.push(carInfoTile('🌡️', 'Binnentemperatuur', haEscape(haFriendlyValue(st('interior_temp')).text)));
    if (mapped('motor')) tiles.push(carInfoTile('🚗', 'Motor', haEscape(haFriendlyValue(st('motor')).text)));
    if (mapped('service')) {
        const days = haNumber(st('service'));
        let cls = '', txt = '—';
        if (days !== null) {
            txt = days < 0 ? 'Achterstallig' : `${Math.round(days)} dagen`;
            cls = days < 7 ? 'text-red-700' : (days < 30 ? 'text-amber-700' : '');
        }
        tiles.push(carInfoTile('🛠️', 'Onderhoud over', `<span class="${cls}">${haEscape(txt)}</span>`));
    }

    // Open portieren samenvatten
    const doorNames = { df: 'bestuurder voor', pf: 'passagier voor', dr: 'bestuurder achter', pr: 'passagier achter' };
    const openDoors = ['df', 'pf', 'dr', 'pr'].filter(p => carDoorStates(car, map, p).open === true).map(p => doorNames[p]);
    const anyDoorSensor = ['df', 'pf', 'dr', 'pr'].some(p => mapped('door_open_' + p));
    const doorSummary = !anyDoorSensor ? '' : (openDoors.length
        ? `<p class="text-xs font-bold text-red-700">⚠️ Open: ${haEscape(openDoors.join(', '))}</p>`
        : `<p class="text-xs font-bold text-[#197447]">✓ Alle portieren dicht</p>`);

    // Bediening
    const buttons = [];
    if (mapped('lock')) {
        const lockSt = st('lock');
        const state = haIsUsable(lockSt) ? String(lockSt.state).toLowerCase() : '';
        const locked = state === 'locked';
        const pillTxt = state === 'locked' ? 'Vergrendeld' : (state === 'unlocked' ? 'Ontgrendeld' : (state ? haPrettify(state) : '—'));
        buttons.push(`<button onclick="window.carToggleLock(${cIdx})" class="px-3.5 py-2 rounded-2xl text-xs font-extrabold cursor-pointer transition ${locked ? 'bg-[#e1f1e8] text-[#197447] hover:bg-[#d3eadc]' : 'bg-amber-100 text-amber-900 hover:bg-amber-200'}">${locked ? '🔒' : '🔓'} ${pillTxt} · ${locked ? 'Ontgrendel' : 'Vergrendel'}</button>`);
    }
    [['defrost', '❄️ Ontwasemen'], ['charge_control', '⚡ Laden toegestaan']].forEach(([key, label]) => {
        if (!mapped(key)) return;
        const s = st(key);
        const on = haIsUsable(s) && String(s.state).toLowerCase() === 'on';
        buttons.push(`<button onclick="window.carToggleSwitch(${cIdx}, '${key}')" class="px-3.5 py-2 rounded-2xl text-xs font-extrabold cursor-pointer transition ${on ? 'bg-[#152920] text-white hover:bg-[#233f31]' : 'bg-white border border-stone-200 text-[#38443d] hover:bg-stone-100'}">${label}: ${on ? 'Aan' : 'Uit'}</button>`);
    });

    const showDiagram = ['df', 'pf', 'dr', 'pr'].some(p => mapped('door_' + p) || mapped('door_open_' + p) || mapped('tp_' + p) || mapped('tt_' + p));

    return `
        <div class="bg-white rounded-[28px] p-6 shadow-sm border border-stone-200/90 flex flex-col gap-5">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex items-center gap-3">
                    <div class="w-14 h-14 rounded-2xl bg-[#e8f2ec] text-[#152920] flex items-center justify-center text-3xl shadow-2xs">🚗</div>
                    <div>
                        <h3 class="text-xl font-extrabold text-[#1c2520] leading-tight">${haEscape(car.name || 'Auto')}</h3>
                        <p class="text-xs text-[#68736d]">${haEscape(car.model || '')}</p>
                    </div>
                </div>
                <span class="px-3 py-1 rounded-full text-[11px] font-extrabold ${pill.cls} ${charge.charging ? 'animate-pulse' : ''}">${pill.text}</span>
            </div>

            ${mapped('battery') ? `
            <div>
                <div class="flex items-end justify-between mb-1.5">
                    <p class="text-4xl font-extrabold text-[#1c2520]">${pct === null ? '—' : Math.round(pct)}<span class="text-lg font-bold text-[#68736d]">%</span></p>
                    <p class="text-xs font-bold text-[#68736d]">${charge.label ? haEscape(charge.label) : ''}</p>
                </div>
                <div class="h-3.5 rounded-full bg-stone-200 overflow-hidden"><div class="h-full ${barColor} transition-all duration-500" style="width:${pctClamped}%"></div></div>
            </div>` : ''}

            ${anyMapped ? `
            <div class="flex flex-col md:flex-row gap-5 items-start">
                <div class="flex-1 w-full space-y-3 min-w-0">
                    ${tiles.length ? `<div class="grid grid-cols-2 gap-2">${tiles.join('')}</div>` : ''}
                    ${doorSummary}
                    ${buttons.length ? `<div class="flex flex-wrap gap-2 pt-1">${buttons.join('')}</div>` : ''}
                </div>
                ${showDiagram ? `<div class="w-full md:w-[240px] shrink-0">${carDiagramSvg(car, map)}
                    <p class="text-[10px] text-center text-[#8a958f] mt-1">🔒 vergrendeld · 🔓 ontgrendeld · ⚠️ open</p></div>` : ''}
            </div>` : `
            <p class="text-sm text-[#68736d] bg-[#f6f8f5] rounded-2xl p-4">Nog geen entiteiten gekoppeld voor deze auto. Ga naar <strong>Beheer → 🚗 Auto's</strong> om ze in te stellen of de Home Assistant-kaartcode te plakken.</p>`}
            ${carLocation(car, map) ? carMapBlockHtml(car, map) : (mapped('tracker') ? `<p class="text-xs text-[#68736d] bg-[#f6f8f5] rounded-2xl p-3">📍 De tracker geeft nog geen locatie door.</p>` : '')}
        </div>`;
}

// Locatie van de auto uit de tracker (device_tracker met latitude/longitude). Null als er geen geldige locatie is.
function carLocation(car, map) {
    const id = String((car.entities || {}).tracker || '').trim();
    if (!id) return null;
    const st = haStateObj(map, id);
    const a = st && st.attributes;
    if (!st || !a || !mapsValidCoord(a.latitude, a.longitude)) return null;
    return { lat: Number(a.latitude), lon: Number(a.longitude), state: String(st.state || ''), updated: st.last_changed || st.last_updated || '', accuracy: Number(a.gps_accuracy) || 0 };
}

function carMapBlockHtml(car, map) {
    const loc = carLocation(car, map);
    const where = loc.state === 'home' ? '🏡 Thuis' : (loc.state === 'not_home' ? 'Onderweg' : haEscape(loc.state));
    const when = loc.updated ? new Date(loc.updated).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    return `
        <div>
            <div class="flex items-center justify-between gap-2 mb-2">
                <p class="text-xs font-extrabold text-[#38443d]">📍 ${where}${when ? ` <span class="font-semibold text-[#8a958f]">· ${when}</span>` : ''}</p>
                <a href="https://www.google.com/maps?q=${loc.lat},${loc.lon}" target="_blank" rel="noopener" class="text-[11px] font-bold text-[#197447] underline">Openen in Maps</a>
            </div>
            <div id="carMap_${haEscape(car.id)}" class="car-map w-full h-56 rounded-2xl overflow-hidden bg-[#e8f2ec] flex items-center justify-center text-xs text-[#68736d]">Kaart laden…</div>
        </div>`;
}

// Zet na het tekenen de blijvende kaarten terug en schuift de markers naar de nieuwste positie
function carsMountMaps(cars, map) {
    (cars || []).forEach(car => {
        const loc = carLocation(car, map);
        if (!loc || !document.getElementById('carMap_' + car.id)) return;
        const home = typeof weatherHomeLocation === 'function' ? weatherHomeLocation() : null;
        mapsMount('car-' + car.id, 'carMap_' + car.id, (h, L) => {
            h.map.setView([loc.lat, loc.lon], 15);
            h.marker = L.marker([loc.lat, loc.lon], { icon: mapsPinIcon(L, '🚗', 'is-car') }).addTo(h.map);
            h.marker.bindTooltip(car.name || 'Auto');
            if (home) h.home = L.marker([home.lat, home.lon], { icon: mapsPinIcon(L, '🏠') }).addTo(h.map);
        }).then(h => {
            if (!h || !h.marker) return;
            const prev = h.marker.getLatLng();
            if (Math.abs(prev.lat - loc.lat) > 1e-6 || Math.abs(prev.lng - loc.lon) > 1e-6) {
                h.marker.setLatLng([loc.lat, loc.lon]);
                if (!h.map.getBounds().contains([loc.lat, loc.lon])) h.map.panTo([loc.lat, loc.lon]);
            }
        });
    });
}

function renderCarsView() {
    const cars = appState.cars || [];
    const badge = document.getElementById('menuCarsBadge');
    if (badge) badge.textContent = cars.length;
    const container = document.getElementById('carsContainer');
    const view = document.getElementById('viewCars');
    if (!container || (view && view.classList.contains('hidden'))) return;

    if (!cars.length) {
        container.innerHTML = `<p class="text-sm text-[#68736d] bg-white rounded-2xl p-6 col-span-full">Er zijn nog geen auto's toegevoegd. Doe dat via Beheer → 🚗 Auto's.</p>`;
        return;
    }
    const map = haStatesMap();
    container.innerHTML = cars.map((car, i) => renderCarCard(car, i, map)).join('');
    carsMountMaps(cars, map);
}

/* ============================ BEDIENING ============================ */

window.carToggleLock = async function(cIdx) {
    if (!permGuard('control_cars')) return;
    const car = appState.cars?.[cIdx];
    const entityId = String(car?.entities?.lock || '').trim();
    if (!entityId) return;
    const st = haStateObj(haStatesMap(), entityId);
    const locked = !!st && String(st.state).toLowerCase() === 'locked';
    if (locked && !window.confirm(`${car.name} ontgrendelen?`)) return;
    await window.callHomeAssistantService('lock', locked ? 'unlock' : 'lock', { entity_id: entityId });
    showToast(`${car.name}: ${locked ? 'ontgrendel' : 'vergrendel'}-opdracht verzonden`);
};

window.carToggleSwitch = async function(cIdx, key) {
    if (!permGuard('control_cars')) return;
    const car = appState.cars?.[cIdx];
    const entityId = String(car?.entities?.[key] || '').trim();
    if (!entityId) return;
    const st = haStateObj(haStatesMap(), entityId);
    const on = !!st && String(st.state).toLowerCase() === 'on';
    await window.callHomeAssistantService('switch', on ? 'turn_off' : 'turn_on', { entity_id: entityId });
    showToast(`${car.name}: ${on ? 'uitgeschakeld' : 'ingeschakeld'}`);
};

/* ============================ BEHEER ============================ */

// Leest de tekst van een HA-kaart (custom:smart-ev-card) en haalt naam + entiteiten eruit
function parseSmartEvCardYaml(text) {
    const result = { name: null, entities: {}, count: 0 };
    String(text || '').split(/\r?\n/).forEach(line => {
        const nameMatch = line.match(/^\s*name\s*:\s*(.+?)\s*$/i);
        if (nameMatch) { result.name = nameMatch[1].replace(/^['"]|['"]$/g, ''); return; }
        const m = line.match(/^\s*(?:-\s*)?([a-z0-9_]+)_entity\s*:\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/i);
        if (!m) return;
        const key = m[1].toLowerCase();
        if (CAR_ALL_KEYS.includes(key)) { result.entities[key] = m[2]; result.count++; }
    });
    return result;
}

function carEntityExists(entityId) {
    if (!entityId) return null;
    if (!(discoveredHaEntities || []).length) return null;
    return discoveredHaEntities.some(s => s.entity_id === entityId.trim());
}

function renderAdminCarsList() {
    const container = document.getElementById('adminCarsContainer');
    if (!container) return;
    const cars = ensureCars();

    const carCards = cars.map((car, cIdx) => {
        const e = car.entities || {};
        const groupsHtml = CAR_ENTITY_GROUPS.map(g => {
            const filled = g.fields.filter(f => (e[f[0]] || '').trim()).length;
            const fieldsHtml = g.fields.map(([key, label]) => {
                const val = e[key] || '';
                const exists = carEntityExists(val);
                const dot = !val ? '' : (exists === null ? '' : (exists ? '<span title="Gevonden in Home Assistant" class="text-[#19975c]">●</span>' : '<span title="Niet gevonden in Home Assistant" class="text-red-500">●</span>'));
                return `
                    <div>
                        <label class="block text-[11px] font-bold text-[#38443d] mb-1">${label} ${dot}</label>
                        <input type="text" list="haEntitiesDatalist" value="${haEscape(val)}" placeholder="${haEscape(DEFAULT_SMART_EV_ENTITIES[key] || '')}"
                            onchange="window.updateCarEntity(${cIdx}, '${key}', this.value)"
                            class="w-full px-3 py-2 rounded-xl border border-stone-200 text-xs font-mono">
                    </div>`;
            }).join('');
            return `
                <details class="rounded-2xl border border-stone-200 bg-white" ${g.open ? 'open' : ''}>
                    <summary class="cursor-pointer select-none px-4 py-2.5 text-sm font-extrabold text-[#1c2520] flex items-center justify-between">
                        <span>${g.title}</span><span class="text-[11px] font-semibold text-[#68736d]">${filled}/${g.fields.length} ingevuld</span>
                    </summary>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 pb-4 pt-1">${fieldsHtml}</div>
                </details>`;
        }).join('');

        return `
            <div class="bg-white rounded-[26px] p-6 shadow-sm space-y-4 border border-stone-200/80">
                <div class="flex flex-wrap items-end gap-3">
                    <div class="flex-1 min-w-[160px]">
                        <label class="block text-[11px] font-bold text-[#38443d] mb-1">Naam van auto ${cIdx + 1}</label>
                        <input type="text" value="${haEscape(car.name || '')}" onchange="window.updateCarField(${cIdx}, 'name', this.value)" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm font-bold">
                    </div>
                    <div class="w-40">
                        <label class="block text-[11px] font-bold text-[#38443d] mb-1">Model</label>
                        <input type="text" value="${haEscape(car.model || '')}" onchange="window.updateCarField(${cIdx}, 'model', this.value)" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm">
                    </div>
                    <div class="w-56">
                        <label class="block text-[11px] font-bold text-[#38443d] mb-1">Slot-sensor "aan" betekent</label>
                        <select onchange="window.updateCarField(${cIdx}, 'lockOnMeans', this.value)" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white">
                            <option value="unlocked" ${(car.lockOnMeans || 'unlocked') === 'unlocked' ? 'selected' : ''}>Ontgrendeld (HA-standaard)</option>
                            <option value="locked" ${car.lockOnMeans === 'locked' ? 'selected' : ''}>Vergrendeld</option>
                        </select>
                    </div>
                    <button onclick="window.removeCar(${cIdx})" class="px-3 py-2 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 cursor-pointer">🗑 Verwijderen</button>
                </div>

                <div class="rounded-2xl bg-[#f0f9ff] border border-[#bae6fd] p-4 space-y-2">
                    <p class="text-xs font-extrabold text-[#0369a1]">📥 Plak de Home Assistant-kaartcode (custom:smart-ev-card)</p>
                    <textarea id="carYaml_${cIdx}" rows="4" placeholder="type: custom:smart-ev-card&#10;name: Smart Jaider&#10;battery_entity: sensor.smart_jaider_battery&#10;…" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-[11px] font-mono"></textarea>
                    <div class="flex flex-wrap gap-2">
                        <button onclick="window.importCarFromYaml(${cIdx})" class="bg-[#0369a1] hover:bg-[#075985] text-white font-bold px-4 py-2 rounded-xl text-xs cursor-pointer">Entiteiten overnemen</button>
                        ${cars.length > 1 ? `<button onclick="window.copyCarEntities(${cIdx})" class="bg-white border border-stone-200 hover:bg-stone-100 text-[#38443d] font-bold px-4 py-2 rounded-xl text-xs cursor-pointer">📋 Kopieer van een andere auto…</button>` : ''}
                    </div>
                </div>

                <div class="space-y-2.5">${groupsHtml}</div>
            </div>`;
    }).join('');

    container.innerHTML = `
        <div class="bg-white rounded-[26px] p-6 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div>
                <h3 class="text-lg font-bold text-[#1c2520]">Auto's &amp; entiteiten</h3>
                <p class="text-xs text-[#68736d]">Koppel per auto de Home Assistant-entiteiten. De auto's staan op het tabblad "Auto's" naast elkaar. Een ● naast een veld toont of de entiteit in HA bestaat (groen) of niet (rood).</p>
            </div>
            <div class="flex gap-2">
                <button onclick="window.addCar()" class="bg-white border border-stone-200 hover:bg-stone-100 text-[#38443d] font-bold px-4 py-2.5 rounded-xl text-sm cursor-pointer">+ Auto toevoegen</button>
                <button onclick="window.saveCarsAdmin()" class="bg-[#152920] hover:bg-[#233f31] text-white font-bold px-5 py-2.5 rounded-xl text-sm cursor-pointer">💾 Auto's opslaan</button>
            </div>
        </div>
        ${carCards}`;
}

window.updateCarField = function(cIdx, field, value) {
    const car = ensureCars()[cIdx];
    if (!car) return;
    car[field] = String(value).trim();
    renderCarsView();
};

window.updateCarEntity = function(cIdx, key, value) {
    const car = ensureCars()[cIdx];
    if (!car) return;
    car.entities[key] = String(value).trim();
    renderCarsView();
};

window.addCar = function() {
    const cars = ensureCars();
    cars.push({ id: 'car_' + Date.now(), name: 'Nieuwe auto', model: 'Smart #1', lockOnMeans: 'unlocked', entities: {} });
    renderAdminCarsList();
    renderCarsView();
    persistStateToFirestore(false);
};

window.removeCar = function(cIdx) {
    const cars = ensureCars();
    const car = cars[cIdx];
    if (!car || !window.confirm(`"${car.name}" verwijderen?`)) return;
    cars.splice(cIdx, 1);
    renderAdminCarsList();
    renderCarsView();
    persistStateToFirestore(true);
};

window.importCarFromYaml = function(cIdx) {
    const car = ensureCars()[cIdx];
    const box = document.getElementById('carYaml_' + cIdx);
    if (!car || !box) return;
    const parsed = parseSmartEvCardYaml(box.value);
    if (!parsed.count) {
        showToast("Geen entiteiten gevonden. Plak de volledige kaartcode (met regels zoals battery_entity: sensor.…).");
        return;
    }
    Object.assign(car.entities, parsed.entities);
    if (parsed.name) car.name = parsed.name;
    renderAdminCarsList();
    renderCarsView();
    persistStateToFirestore(true);
    showToast(`${parsed.count} entiteiten overgenomen voor ${car.name}.`);
};

// Kopieert alle entiteiten van een andere auto en vervangt een stukje tekst (bv. "jaider" -> "partner")
window.copyCarEntities = function(toIdx) {
    const cars = ensureCars();
    const target = cars[toIdx];
    if (!target) return;
    const fromRaw = window.prompt(`Kopieer van welke auto? (nummer 1 t/m ${cars.length})`, toIdx === 0 ? '2' : '1');
    if (fromRaw === null) return;
    const from = parseInt(fromRaw, 10) - 1;
    if (isNaN(from) || from < 0 || from >= cars.length || from === toIdx) { showToast("Ongeldig autonummer."); return; }
    const search = window.prompt("Tekst die in alle entiteitsnamen vervangen moet worden (bv. jaider). Laat leeg om niets te vervangen.", 'jaider');
    if (search === null) return;
    let replacement = '';
    if (search) {
        replacement = window.prompt(`Vervangen door (bv. partner):`, '');
        if (replacement === null) return;
    }
    const re = search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null;
    const copy = {};
    Object.keys(cars[from].entities).forEach(k => {
        const v = String(cars[from].entities[k] || '');
        copy[k] = re ? v.replace(re, replacement) : v;
    });
    target.entities = copy;
    renderAdminCarsList();
    renderCarsView();
    persistStateToFirestore(true);
    showToast(`Entiteiten gekopieerd naar ${target.name}. Controleer de ● bij elk veld.`);
};

window.saveCarsAdmin = function() {
    renderCarsView();
    persistStateToFirestore(true);
};
