'use strict';
/* Robots en onderhoudstaken */

// =====================================================================
// ROBOTMAAIER & ROBOTSTOFZUIGER ONDERHOUD & BEDIENING
// =====================================================================
function renderRobotsMaintenanceView() {
    const container = document.getElementById('robotsMaintenanceContainer');
    if (!container) return;
    const robots = appState.robots || [];

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
                                    <span class="text-xs font-bold text-[#197447]">🔋 ${rob.batteryPct ?? 100}%</span>
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

window.updateRobotField = function(rIdx, field, val) {
    if (!appState.robots?.[rIdx]) return;
    appState.robots[rIdx][field] = val.trim();
    if (discoveredHaEntities.length > 0) applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    renderRobotsMaintenanceView();
    persistStateToFirestore(true);
};

window.controlRobot = async function(rIdx, action) {
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
    const task = appState.robots?.[rIdx]?.tasks?.[tIdx];
    if (!task) return;
    task.usedHours = Math.max(0, Number(task.usedHours || 0) + addH);
    renderRobotsMaintenanceView();
    persistStateToFirestore(false);
};

window.addRobotMaintenanceTask = function(rIdx) {
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
