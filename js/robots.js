'use strict';
/* Robots en onderhoudstaken */

// =====================================================================
// ROBOTMAAIER & ROBOTSTOFZUIGER ONDERHOUD & BEDIENING
// =====================================================================
function renderRobotsMaintenanceView() {
    const container = document.getElementById('robotsMaintenanceContainer');
    if (!container) return;
    const active = document.activeElement;
    if (active && container.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return; // niet storen tijdens typen
    const robots = appState.robots || [];
    const haMap = haStatesMap();
    robots.forEach(r => { if (r.entityId) { const b = robotBatteryPct(r, haMap); r.batteryPct = b; robotAutoExtras(r, haMap); } });

    const statusLabels = {
        cleaning: { text: "Aan het schoonmaken", pill: "bg-emerald-100 text-emerald-800" },
        mowing: { text: "Aan het maaien", pill: "bg-emerald-100 text-emerald-800" },
        docked: { text: "In laadstation (Opgeladen)", pill: "bg-stone-200 text-stone-700" },
        returning: { text: "Keert terug naar dock", pill: "bg-sky-100 text-sky-800" },
        paused: { text: "Gepauzeerd", pill: "bg-amber-100 text-amber-800" },
        error: { text: "Controleer robot (Storing)", pill: "bg-red-100 text-red-800" }
    };

    container.innerHTML = robots.map((rob, rIdx) => {
        const stMeta = statusLabels[rob.state] || { text: rob.state || "Gereed", pill: "bg-[#dcece3] text-[#152920]" };
        const domain = rob.entityId?.startsWith('lawn_mower.') ? 'lawn_mower' : 'vacuum';

        return `
            <div class="bg-white rounded-[28px] p-6 shadow-sm border border-stone-200/90 flex flex-col justify-between gap-5">
                <div class="space-y-4">
                    <!-- Robot Header -->
                    <div class="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 pb-4">
                        <div class="flex items-center gap-3">
                            <div class="w-14 h-14 rounded-2xl bg-[#e8f2ec] text-[#152920] flex items-center justify-center text-3xl shadow-2xs">
                                ${rob.icon || '🤖'}
                            </div>
                            <div>
                                <input type="text" value="${rob.name}" onchange="window.updateRobotField(${rIdx}, 'name', this.value)" class="text-xl font-extrabold text-[#1c2520] bg-transparent focus:outline-none focus:underline">
                                <div class="flex items-center gap-2 mt-0.5">
                                    <span class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${stMeta.pill}">${stMeta.text}</span>
                                    <span class="text-xs font-bold text-[#197447]">${rob.batteryPct != null ? '🔋 ' + rob.batteryPct + '%' : ''}</span>
                                </div>
                            </div>
                        </div>

                        <div class="w-full sm:w-auto">
                            <label class="block text-[10px] font-bold text-[#68736d] mb-0.5">Koppel HA Entiteit (${domain}.*)</label>
                            <input type="text" list="haEntitiesDatalist" value="${rob.entityId || ''}" onchange="window.updateRobotField(${rIdx}, 'entityId', this.value)" placeholder="${rob.type === 'mower' ? 'lawn_mower.robotmaaier' : 'vacuum.robotstofzuiger'}" class="w-full sm:w-56 px-3 py-1.5 rounded-xl bg-[#f4f7f4] border border-stone-200 text-xs font-mono text-[#152920]">
                        </div>
                    </div>

                    <!-- Directe Bedieningsknoppen -->
                    <div class="grid grid-cols-3 gap-2.5">
                        <button onclick="window.controlRobot(${rIdx}, 'start')" class="bg-[#152920] hover:bg-[#1f3b2e] text-white font-extrabold py-2.5 px-3 rounded-2xl text-xs cursor-pointer transition">
                            ▶ Start
                        </button>
                        <button onclick="window.controlRobot(${rIdx}, 'pause')" class="bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold py-2.5 px-3 rounded-2xl text-xs cursor-pointer transition">
                            ⏸ Pauze
                        </button>
                        <button onclick="window.controlRobot(${rIdx}, 'dock')" class="bg-[#e8f2ec] hover:bg-[#dcece3] text-[#152920] font-extrabold py-2.5 px-3 rounded-2xl text-xs cursor-pointer transition">
                            🏠 Naar Dock
                        </button>
                    </div>

                    <!-- Extra entiteiten (bv. stofbak, waterreservoir) -->
                    ${renderRobotExtrasHtml(rob, rIdx, haMap)}

                    <!-- Onderhoud Onderdelen & Vervangings-Tellers -->
                    <div class="space-y-3 pt-2">
                        <div class="flex items-center justify-between">
                            <h4 class="text-sm font-extrabold text-[#1c2520]">🛠️ Onderhoud &amp; Slijtage Onderdelen</h4>
                            <button onclick="window.addRobotMaintenanceTask(${rIdx})" class="text-xs font-bold text-[#197447] hover:underline cursor-pointer">+ Onderdeel toevoegen</button>
                        </div>

                        <div class="space-y-2.5">
                            ${(rob.tasks || []).map((t, tIdx) => {
                                const pctUsed = Math.min(100, Math.round((Number(t.usedHours || 0) / Math.max(1, Number(t.maxHours || 50))) * 100));
                                const barColor = pctUsed >= 85 ? 'bg-red-500' : pctUsed >= 65 ? 'bg-amber-500' : 'bg-[#19975c]';
                                return `
                                    <div class="p-3.5 rounded-2xl bg-[#f6f8f5] border border-stone-200/80 space-y-2">
                                        <div class="flex flex-wrap items-center justify-between gap-2">
                                            <div>
                                                <p class="text-xs font-extrabold text-[#1c2520]">${t.name}</p>
                                                <p class="text-[11px] text-[#68736d]">Laatst gereinigd/vervangen: <strong>${t.lastReset || 'Onbekend'}</strong> • Draaiuren: <strong>${t.usedHours}u / ${t.maxHours}u</strong></p>
                                            </div>
                                            <div class="flex items-center gap-1.5">
                                                <button onclick="window.incrementRobotTaskHours(${rIdx}, ${tIdx}, 2)" title="Voeg 2 draaiuren toe" class="px-2 py-1 rounded-lg bg-white border border-stone-200 text-[11px] font-bold cursor-pointer hover:bg-stone-100">+2u</button>
                                                <button onclick="window.resetRobotMaintenanceTask(${rIdx}, ${tIdx})" class="px-3 py-1 rounded-lg bg-[#152920] text-white text-[11px] font-bold cursor-pointer hover:bg-[#233f31]">
                                                    ✓ Gereinigd / Reset
                                                </button>
                                            </div>
                                        </div>
                                        <div class="w-full h-2 rounded-full bg-stone-200 overflow-hidden">
                                            <div class="h-full ${barColor} transition-all duration-300" style="width: ${pctUsed}%"></div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

const ROBOT_EXTRA_PRESETS = [
    { icon: '🗑️', label: 'Stofbak', keywords: ['bin', 'dust', 'stof'] },
    { icon: '💧', label: 'Waterreservoir', keywords: ['water', 'tank'] },
    { icon: '🧽', label: 'Filter', keywords: ['filter'] },
    { icon: '🪥', label: 'Borstel', keywords: ['brush', 'borstel'] },
    { icon: '🔋', label: 'Batterij', keywords: ['battery', 'batterij'] }
];

function renderRobotExtrasHtml(rob, rIdx, haMap) {
    const extras = rob.extras || [];
    const rows = extras.map((ex, eIdx) => {
        const st = haStateObj(haMap, ex.entityId);
        const fv = haFriendlyValue(st, ex.label);
        let valueHtml = `<span class="text-xs font-bold text-[#68736d]">${haEscape(fv.text)}</span>`;
        if (fv.kind !== 'none') {
            const isPct = fv.kind === 'number' && fv.unit === '%';
            const warnHigh = /stofbak|\bbin\b|dust|vuil|container|afval/i.test(ex.label || '');
            let color = 'text-[#197447]', bar = 'bg-[#19975c]';
            if (fv.kind === 'bad') { color = 'text-red-700'; bar = 'bg-red-500'; }
            else if (fv.kind === 'warn') { color = 'text-amber-700'; bar = 'bg-amber-500'; }
            else if (isPct) {
                const bad = warnHigh ? fv.value >= 95 : fv.value <= 10;
                const warn = warnHigh ? fv.value >= 80 : fv.value <= 25;
                if (bad) { color = 'text-red-700'; bar = 'bg-red-500'; }
                else if (warn) { color = 'text-amber-700'; bar = 'bg-amber-500'; }
            } else if (fv.kind === 'text' || fv.kind === 'neutral' || fv.kind === 'number') {
                color = 'text-[#1c2520]';
            }
            valueHtml = isPct
                ? `<div class="w-24"><div class="flex justify-between text-[11px] font-extrabold ${color}"><span>${haEscape(fv.text)}</span></div>
                       <div class="h-1.5 rounded-full bg-stone-200 overflow-hidden mt-0.5"><div class="h-full ${bar}" style="width:${Math.max(0, Math.min(100, fv.value))}%"></div></div></div>`
                : `<span class="text-xs font-extrabold ${color}">${haEscape(fv.text)}</span>`;
        }
        return `
            <div class="flex flex-wrap items-center gap-2 p-2.5 rounded-2xl bg-[#f6f8f5] border border-stone-200/80">
                <input type="text" value="${haEscape(ex.icon || '📊')}" maxlength="4" onchange="window.updateRobotExtra(${rIdx}, ${eIdx}, 'icon', this.value)" class="w-10 text-center px-1 py-1.5 rounded-lg bg-white border border-stone-200 text-sm">
                <input type="text" value="${haEscape(ex.label || '')}" placeholder="Naam" onchange="window.updateRobotExtra(${rIdx}, ${eIdx}, 'label', this.value)" class="w-28 px-2 py-1.5 rounded-lg bg-white border border-stone-200 text-xs font-bold text-[#1c2520]">
                <input type="text" list="haEntitiesDatalist" value="${haEscape(ex.entityId || '')}" placeholder="sensor.…" onchange="window.updateRobotExtra(${rIdx}, ${eIdx}, 'entityId', this.value)" class="flex-1 min-w-[150px] px-2 py-1.5 rounded-lg bg-white border border-stone-200 text-[11px] font-mono text-[#152920]">
                <div class="min-w-[70px] text-right">${valueHtml}</div>
                <button onclick="window.removeRobotExtra(${rIdx}, ${eIdx})" title="Verwijderen" class="w-7 h-7 rounded-lg text-[#68736d] hover:bg-red-50 hover:text-red-600 text-sm cursor-pointer">✕</button>
            </div>`;
    }).join('');

    const presetBtns = ROBOT_EXTRA_PRESETS.map((p, i) =>
        `<button onclick="window.addRobotExtra(${rIdx}, ${i})" class="px-2.5 py-1 rounded-full bg-white border border-stone-200 hover:bg-[#e8f2ec] text-[11px] font-bold text-[#38443d] cursor-pointer">${p.icon} ${p.label}</button>`
    ).join('');

    return `
        <div class="space-y-2.5 pt-1">
            <div class="flex items-center justify-between">
                <h4 class="text-sm font-extrabold text-[#1c2520]">📊 Extra entiteiten</h4>
                <button onclick="window.addRobotExtra(${rIdx}, -1)" class="text-xs font-bold text-[#197447] hover:underline cursor-pointer">+ Eigen entiteit</button>
            </div>
            ${rows || '<p class="text-[11px] text-[#68736d] italic">Nog geen extra entiteiten. Kies hieronder een voorbeeld of voeg er zelf een toe.</p>'}
            <div class="flex flex-wrap gap-1.5">${presetBtns}</div>
        </div>`;
}

// Zoekt in alle HA-entiteiten naar een sensor van deze robot (zelfde naamdeel + trefwoord), bv. sensor.noo_noo_batterij
function robotGuessEntity(rob, keywords, map, preferNumeric) {
    if (!rob || !rob.entityId || !map || typeof map.forEach !== 'function') return '';
    const base = (String(rob.entityId).split('.')[1] || '').toLowerCase();
    if (!base) return '';
    let best = '';
    map.forEach((st, id) => {
        if (best || !/^(sensor|binary_sensor)\./.test(id)) return;
        const low = id.toLowerCase();
        if (!low.includes(base) || !keywords.some(k => low.includes(k))) return;
        if (preferNumeric && !/^-?\d+([.,]\d+)?$/.test(String(st && st.state).trim())) return;
        best = id;
    });
    return best;
}
// Batterij: eerst de eigen sensor, dan de attributen van de robot zelf; anders onbekend (null), nooit een verzonnen 100%.
function robotBatteryPct(rob, map) {
    const own = rob.batteryEntity && haStateObj(map, rob.batteryEntity);
    const id = own ? rob.batteryEntity : robotGuessEntity(rob, ['batterij', 'battery'], map, true);
    const st = id ? haStateObj(map, id) : null;
    if (st && haIsUsable(st) && !isNaN(parseFloat(st.state))) return Math.round(parseFloat(st.state));
    const base = haStateObj(map, rob.entityId);
    const a = base && base.attributes ? (base.attributes.battery_level ?? base.attributes.battery) : undefined;
    return a !== undefined && !isNaN(parseFloat(a)) ? Math.round(parseFloat(a)) : null;
}
// Lege extra's (bv. "Stofbak") automatisch koppelen aan de bijpassende sensor van de robot
function robotAutoExtras(rob, map) {
    let changed = false;
    (rob.extras || []).forEach(ex => {
        if (ex.entityId) return;
        const preset = ROBOT_EXTRA_PRESETS.find(p => p.label.toLowerCase() === String(ex.label || '').toLowerCase());
        if (!preset) return;
        const hit = robotGuessEntity(rob, preset.keywords, map, false);
        if (hit) { ex.entityId = hit; changed = true; }
    });
    return changed;
}

// Probeert een passende entiteit te vinden bij deze robot (bv. sensor.<robot>_dust_bin)
function guessRobotExtraEntity(rob, preset) {
    if (!preset || !rob.entityId || !(discoveredHaEntities || []).length) return '';
    const base = rob.entityId.split('.')[1] || '';
    if (!base) return '';
    const hit = discoveredHaEntities.find(s => {
        if (!/^(sensor|binary_sensor)\./.test(s.entity_id)) return false;
        const id = s.entity_id.toLowerCase();
        return id.includes(base.toLowerCase()) && preset.keywords.some(k => id.includes(k));
    });
    return hit ? hit.entity_id : '';
}

window.addRobotExtra = function(rIdx, presetIdx) {
    if (!permGuard('edit_robots')) return;
    const rob = appState.robots?.[rIdx];
    if (!rob) return;
    if (!rob.extras) rob.extras = [];
    const preset = presetIdx >= 0 ? ROBOT_EXTRA_PRESETS[presetIdx] : null;
    rob.extras.push({
        id: 'rx_' + Date.now(),
        icon: preset ? preset.icon : '📊',
        label: preset ? preset.label : 'Nieuwe entiteit',
        entityId: guessRobotExtraEntity(rob, preset)
    });
    renderRobotsMaintenanceView();
    persistStateToFirestore(false);
};

window.updateRobotExtra = function(rIdx, eIdx, field, val) {
    if (!permGuard('edit_robots')) return;
    const ex = appState.robots?.[rIdx]?.extras?.[eIdx];
    if (!ex) return;
    ex[field] = String(val).trim();
    renderRobotsMaintenanceView();
    persistStateToFirestore(false);
};

window.removeRobotExtra = function(rIdx, eIdx) {
    if (!permGuard('edit_robots')) return;
    const rob = appState.robots?.[rIdx];
    if (!rob?.extras) return;
    rob.extras.splice(eIdx, 1);
    renderRobotsMaintenanceView();
    persistStateToFirestore(false);
};

window.updateRobotField = function(rIdx, field, val) {
    if (!permGuard('edit_robots')) return;
    if (!appState.robots?.[rIdx]) return;
    appState.robots[rIdx][field] = val.trim();
    if (discoveredHaEntities.length > 0) applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    renderRobotsMaintenanceView();
    persistStateToFirestore(true);
};

window.controlRobot = async function(rIdx, action) {
    if (!permGuard('control_robots')) return;
    const rob = appState.robots?.[rIdx];
    if (!rob) return;
    const isMower = rob.entityId?.startsWith('lawn_mower.');
    const domain = isMower ? 'lawn_mower' : 'vacuum';

    if (action === 'start') {
        rob.state = isMower ? 'mowing' : 'cleaning';
        if (rob.entityId) await window.callHomeAssistantService(domain, isMower ? 'start_mowing' : 'start', { entity_id: rob.entityId });
    } else if (action === 'pause') {
        rob.state = 'paused';
        if (rob.entityId) await window.callHomeAssistantService(domain, 'pause', { entity_id: rob.entityId });
    } else if (action === 'dock') {
        rob.state = 'returning';
        if (rob.entityId) await window.callHomeAssistantService(domain, isMower ? 'dock' : 'return_to_base', { entity_id: rob.entityId });
    }
    renderRobotsMaintenanceView();
    persistStateToFirestore(false);
    showToast(`${rob.name}: commando '${action}' verzonden`);
};

window.resetRobotMaintenanceTask = function(rIdx, tIdx) {
    if (!permGuard('control_robots')) return;
    const task = appState.robots?.[rIdx]?.tasks?.[tIdx];
    if (!task) return;
    task.usedHours = 0;
    const now = new Date();
    task.lastReset = now.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
    renderRobotsMaintenanceView();
    persistStateToFirestore(true);
    showToast(`${task.name} gereset naar 0 uur!`);
};

window.incrementRobotTaskHours = function(rIdx, tIdx, addH) {
    if (!permGuard('control_robots')) return;
    const task = appState.robots?.[rIdx]?.tasks?.[tIdx];
    if (!task) return;
    task.usedHours = Math.max(0, Number(task.usedHours || 0) + addH);
    renderRobotsMaintenanceView();
    persistStateToFirestore(false);
};

window.addRobotMaintenanceTask = function(rIdx) {
    if (!permGuard('edit_robots')) return;
    const rob = appState.robots?.[rIdx];
    if (!rob) return;
    if (!rob.tasks) rob.tasks = [];
    rob.tasks.push({
        id: 'rt_' + Date.now(),
        name: "Nieuw onderhoudspunt (bijv. Wielen / Sensor)",
        usedHours: 0,
        maxHours: 30,
        lastReset: "Vandaag"
    });
    renderRobotsMaintenanceView();
    persistStateToFirestore(true);
};

window.autoDetectRobotsFromHa = function() {
    if (!permGuard('edit_robots')) return;
    if (!discoveredHaEntities || !discoveredHaEntities.length) {
        showToast("Verbind eerst met Home Assistant in Tabblad 2.");
        return;
    }
    const vac = discoveredHaEntities.find(s => s.entity_id.startsWith('vacuum.'));
    const mow = discoveredHaEntities.find(s => s.entity_id.startsWith('lawn_mower.'));
    if (vac && appState.robots?.[0]) {
        appState.robots[0].entityId = vac.entity_id;
        appState.robots[0].name = vac.attributes?.friendly_name || appState.robots[0].name;
    }
    if (mow && appState.robots?.[1]) {
        appState.robots[1].entityId = mow.entity_id;
        appState.robots[1].name = mow.attributes?.friendly_name || appState.robots[1].name;
    }
    applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    renderRobotsMaintenanceView();
    persistStateToFirestore(true);
    showToast("Robots gecontroleerd en gekoppeld vanuit Home Assistant!");
};
