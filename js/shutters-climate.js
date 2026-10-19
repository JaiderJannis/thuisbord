'use strict';
/* Rolluiken en airco/klimaat (incl. beheer) */

function renderShutterCardHtml(sh, idx) {
    const pos = Math.max(0, Math.min(100, Math.round(Number(sh.position) ?? 100)));
    const isClosed = pos === 0 || sh.state === 'closed';
    const statusLabel = isClosed ? 'Gesloten (0%)' : pos === 100 ? 'Open (100%)' : `Geopend (${pos}%)`;
    const closedHeightPct = 100 - pos;

    return `
        <div draggable="true"
             ondragstart="window.handleDeviceDragStart(event, 'shutter', ${idx})"
             ondragend="window.handleDeviceDragEnd(event)"
             ondragover="window.handleDeviceDragOver(event)"
             ondrop="window.handleDeviceDrop(event, 'shutter', ${idx}, '${sh.room || 'Woonkamer'}')"
             class="bg-white rounded-[24px] p-5 shadow-xs border border-stone-200/90 flex flex-col justify-between gap-4 transition cursor-grab active:cursor-grabbing">
            <div>
                <div class="flex items-start justify-between gap-2 mb-3">
                    <div class="flex items-start gap-2">
                        <span title="Sleep om te verplaatsen" class="text-stone-400 hover:text-stone-700 font-bold text-base select-none px-1 cursor-grab">⠿</span>
                        <div>
                            <span class="text-[10px] font-extrabold uppercase tracking-wider bg-[#e8f2ec] text-[#1c643f] px-2 py-0.5 rounded-full">🪟 Rolluik • ${sh.room || 'Woonkamer'}</span>
                            <h4 class="text-base font-bold text-[#1c2520] mt-1">${sh.name}</h4>
                            <p class="text-[10px] font-mono text-[#68736d]">${sh.entityId || 'Lokale bediening'}</p>
                        </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-full text-[11px] font-extrabold ${isClosed ? 'bg-stone-200 text-stone-700' : 'bg-[#dcece3] text-[#152920]'}">
                        ${statusLabel}
                    </span>
                </div>

                <div class="relative h-24 rounded-2xl bg-gradient-to-b from-sky-100 to-emerald-50 border-2 border-stone-300 overflow-hidden mb-3">
                    <div class="w-full bg-[#38443d] transition-all duration-500 flex flex-col justify-end" style="height: ${closedHeightPct}%; background-image: repeating-linear-gradient(0deg, #2c3630, #2c3630 6px, #435149 6px, #435149 8px);">
                        <div class="h-1.5 w-full bg-[#152920]"></div>
                    </div>
                    <div class="absolute bottom-2 right-2.5 bg-white/90 px-2 py-0.5 rounded-full text-[10px] font-extrabold text-[#152920]">
                        ${pos}% open
                    </div>
                </div>

                <div class="space-y-1">
                    <div class="flex justify-between text-[11px] font-bold text-[#55605a]">
                        <span>Dicht (0%)</span>
                        <span>Stand: ${pos}%</span>
                        <span>Open (100%)</span>
                    </div>
                    <input type="range" min="0" max="100" step="5" value="${pos}" onchange="window.setShutterPosition(${idx}, this.value)" class="w-full accent-[#152920] cursor-pointer h-2 rounded-lg">
                </div>
            </div>

            <div class="grid grid-cols-3 gap-2 pt-2 border-t border-stone-100">
                <button onclick="window.controlSingleShutter(${idx}, 'open_cover')" class="bg-[#e8f2ec] hover:bg-[#dcece3] text-[#152920] font-extrabold py-2.5 rounded-xl text-xs transition cursor-pointer">
                    ↑ Open
                </button>
                <button onclick="window.controlSingleShutter(${idx}, 'stop_cover')" class="bg-stone-100 hover:bg-stone-200 text-[#1c2520] font-bold py-2.5 rounded-xl text-xs transition cursor-pointer">
                    ⏹ Stop
                </button>
                <button onclick="window.controlSingleShutter(${idx}, 'close_cover')" class="bg-[#152920] hover:bg-[#233d30] text-white font-extrabold py-2.5 rounded-xl text-xs transition cursor-pointer">
                    ↓ Dicht
                </button>
            </div>
        </div>
    `;
}

function renderClimateCardHtml(cl, idx) {
    const modeMeta = {
        off: { label: "Uit", icon: "⏻", pill: "bg-stone-200 text-stone-700", activeBtn: "bg-stone-700 text-white" },
        cool: { label: "Koelen", icon: "❄️", pill: "bg-sky-100 text-sky-800", activeBtn: "bg-sky-600 text-white" },
        heat: { label: "Verwarmen", icon: "🔥", pill: "bg-orange-100 text-orange-800", activeBtn: "bg-orange-600 text-white" },
        heat_cool: { label: "Auto", icon: "🔄", pill: "bg-emerald-100 text-emerald-800", activeBtn: "bg-emerald-700 text-white" },
        auto: { label: "Auto", icon: "🔄", pill: "bg-emerald-100 text-emerald-800", activeBtn: "bg-emerald-700 text-white" },
        dry: { label: "Drogen", icon: "💧", pill: "bg-amber-100 text-amber-800", activeBtn: "bg-amber-600 text-white" },
        fan_only: { label: "Ventilator", icon: "🌀", pill: "bg-teal-100 text-teal-800", activeBtn: "bg-teal-700 text-white" }
    };
    const mode = cl.hvacMode || 'off';
    const meta = modeMeta[mode] || modeMeta.off;
    const modesList = ["off", "cool", "heat", "heat_cool", "dry", "fan_only"];
    const fanList = cl.fanModes?.length ? cl.fanModes : ["auto", "low", "medium", "high"];
    const swingList = cl.swingModes?.length ? cl.swingModes : ["off", "vertical", "horizontal", "both"];

    return `
        <div draggable="true"
             ondragstart="window.handleDeviceDragStart(event, 'climate', ${idx})"
             ondragend="window.handleDeviceDragEnd(event)"
             ondragover="window.handleDeviceDragOver(event)"
             ondrop="window.handleDeviceDrop(event, 'climate', ${idx}, '${cl.room || 'Woonkamer'}')"
             class="bg-white rounded-[24px] p-5 shadow-xs border border-stone-200/90 flex flex-col justify-between gap-4 transition cursor-grab active:cursor-grabbing">
            <div>
                <div class="flex items-start justify-between gap-2 mb-3">
                    <div class="flex items-start gap-2">
                        <span title="Sleep om te verplaatsen" class="text-stone-400 hover:text-stone-700 font-bold text-base select-none px-1 cursor-grab">⠿</span>
                        <div>
                            <span class="text-[10px] font-extrabold uppercase tracking-wider bg-[#e0f2fe] text-[#0369a1] px-2 py-0.5 rounded-full">❄️ Airco / Klimaat • ${cl.room || 'Woonkamer'}</span>
                            <h4 class="text-base font-bold text-[#1c2520] mt-1">${cl.name}</h4>
                            <p class="text-[10px] font-mono text-[#68736d]">${cl.entityId || 'Lokale bediening'}</p>
                        </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-full text-[11px] font-extrabold ${meta.pill}">
                        ${meta.icon} ${meta.label}
                    </span>
                </div>

                <div class="bg-[#f4f7f4] rounded-2xl p-3.5 flex items-center justify-between mb-3 border border-stone-200/60">
                    <button onclick="window.adjustAircoTemp(${idx}, -0.5)" class="w-11 h-11 rounded-2xl bg-white hover:bg-stone-100 shadow-xs text-xl font-extrabold text-[#152920] cursor-pointer transition">−</button>
                    <div class="text-center">
                        <p class="text-[10px] font-bold uppercase tracking-wider text-[#68736d]">Doeltemperatuur</p>
                        <p class="text-2xl font-extrabold text-[#1c2520]">${formatNum(cl.targetTemp ?? 20, 1)} °C</p>
                        <p class="text-[11px] font-semibold text-[#197447]">Kamer nu: ${formatNum(cl.currentTemp ?? 21, 1)} °C</p>
                    </div>
                    <button onclick="window.adjustAircoTemp(${idx}, 0.5)" class="w-11 h-11 rounded-2xl bg-white hover:bg-stone-100 shadow-xs text-xl font-extrabold text-[#152920] cursor-pointer transition">+</button>
                </div>

                <div class="grid grid-cols-3 gap-1.5">
                    ${modesList.map(m => {
                        const mInfo = modeMeta[m] || modeMeta.off;
                        const isActive = mode === m;
                        return `
                            <button onclick="window.setAircoHvacMode(${idx}, '${m}')" class="py-1.5 px-2 rounded-xl text-[11px] font-bold transition cursor-pointer flex items-center justify-center gap-1 ${isActive ? mInfo.activeBtn : 'bg-stone-100 hover:bg-stone-200 text-[#38443d]'}">
                                <span>${mInfo.icon}</span>
                                <span>${mInfo.label}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>

            <div class="grid grid-cols-2 gap-2.5 pt-2.5 border-t border-stone-100">
                <div>
                    <label class="block text-[10px] font-bold text-[#55605a] mb-0.5">🌀 Ventilator</label>
                    <select onchange="window.setAircoFanMode(${idx}, this.value)" class="w-full px-2.5 py-1.5 rounded-xl bg-[#f4f7f4] border border-stone-200 text-xs font-bold text-[#1c2520] cursor-pointer">
                        ${fanList.map(f => `<option value="${f}" ${cl.fanMode === f ? 'selected' : ''}>${f.toUpperCase()}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-[#55605a] mb-0.5">↕️ Swing</label>
                    <select onchange="window.setAircoSwingMode(${idx}, this.value)" class="w-full px-2.5 py-1.5 rounded-xl bg-[#f4f7f4] border border-stone-200 text-xs font-bold text-[#1c2520] cursor-pointer">
                        ${swingList.map(sw => `<option value="${sw}" ${cl.swingMode === sw ? 'selected' : ''}>${sw.toUpperCase()}</option>`).join('')}
                    </select>
                </div>
            </div>
        </div>
    `;
}

function renderShuttersView() {
    const container = document.getElementById('roomsCombinedContainer');
    const badge = document.getElementById('menuShuttersCountBadge');
    const lights = appState.roomLights || [];
    const shutters = appState.shutters || [];
    const climates = appState.climates || [];
    const rooms = (appState.rooms && appState.rooms.length) ? appState.rooms : ["Woonkamer", "Keuken", "Slaapkamer"];

    if (badge) badge.textContent = `${lights.length + shutters.length + climates.length} units`;
    if (!container) return;

    if (activeRoomsFilter === 'lights') {
        container.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">${lights.map((lt, i) => renderRoomLightCardHtml(lt, i)).join('')}</div>`;
        return;
    }
    if (activeRoomsFilter === 'shutters') {
        container.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">${shutters.map((sh, i) => renderShutterCardHtml(sh, i)).join('')}</div>`;
        return;
    }
    if (activeRoomsFilter === 'climate') {
        container.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">${climates.map((cl, i) => renderClimateCardHtml(cl, i)).join('')}</div>`;
        return;
    }

    const allRoomNames = [...rooms];
    lights.forEach(l => { if (l.room && !allRoomNames.includes(l.room)) allRoomNames.push(l.room); });
    shutters.forEach(s => { if (s.room && !allRoomNames.includes(s.room)) allRoomNames.push(s.room); });
    climates.forEach(c => { if (c.room && !allRoomNames.includes(c.room)) allRoomNames.push(c.room); });

    container.innerHTML = allRoomNames.map((rName, rIdx) => {
        const roomLights = lights.map((lt, i) => ({ lt, i })).filter(x => (x.lt.room || rooms[0]) === rName);
        const roomShutters = shutters.map((sh, i) => ({ sh, i })).filter(x => (x.sh.room || rooms[0]) === rName);
        const roomClimates = climates.map((cl, i) => ({ cl, i })).filter(x => (x.cl.room || rooms[0]) === rName);

        if (roomLights.length === 0 && roomShutters.length === 0 && roomClimates.length === 0) return '';

        const isExpanded = expandedRoomsSet.has(rName);
        const lightsOnCount = roomLights.filter(x => x.lt.state === 'on').length;
        const activeClCount = roomClimates.filter(x => x.cl.hvacMode && x.cl.hvacMode !== 'off').length;

        return `
            <section draggable="true"
                     ondragstart="window.handleDeviceDragStart(event, 'room', ${rIdx})"
                     ondragend="window.handleDeviceDragEnd(event)"
                     ondragover="window.handleDeviceDragOver(event)"
                     ondrop="window.handleDeviceDrop(event, 'room_DropZone', ${rIdx}, '${rName}')"
                     class="bg-white/80 rounded-[26px] border border-stone-200/90 shadow-2xs overflow-hidden transition">
                <!-- Klikbare Ruimte Header (Standaard Dichtgeklapt) -->
                <div onclick="window.toggleRoomAccordion('${rName}')" class="p-5 flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:bg-white transition select-none">
                    <div class="flex items-center gap-3">
                        <span title="Sleep ruimte om volgorde te wijzigen" onclick="event.stopPropagation()" class="text-stone-400 hover:text-stone-700 font-bold text-lg px-1 cursor-grab">⠿</span>
                        <span class="w-10 h-10 rounded-2xl bg-[#152920] text-white flex items-center justify-center text-base font-bold">🏠</span>
                        <div>
                            <h3 class="text-lg font-extrabold text-[#1c2520]">${rName}</h3>
                            <p class="text-xs text-[#68736d]">
                                ${roomLights.length} lamp(en) • ${roomShutters.length} rolluik(en) • ${roomClimates.length} airco('s)
                            </p>
                        </div>
                    </div>

                    <div class="flex items-center gap-2 flex-wrap">
                        ${lightsOnCount > 0 ? `<span class="px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-extrabold">💡 ${lightsOnCount} aan</span>` : `<span class="px-3 py-1 rounded-full bg-stone-100 text-stone-600 text-xs font-semibold">💡 Uit</span>`}
                        ${activeClCount > 0 ? `<span class="px-3 py-1 rounded-full bg-sky-100 text-sky-900 text-xs font-extrabold">❄️ ${activeClCount} actief</span>` : ''}
                        <span class="w-9 h-9 rounded-full bg-[#f4f7f4] text-[#152920] flex items-center justify-center font-extrabold text-sm transition-transform ${isExpanded ? 'rotate-180 bg-[#dcece3]' : ''}">
                            ▼
                        </span>
                    </div>
                </div>

                <!-- Inhoud van de Ruimte (Alleen zichtbaar als uitgeklapt) -->
                <div class="${isExpanded ? 'block' : 'hidden'} p-5 pt-2 border-t border-stone-200/60 bg-[#f6f8f5]">
                    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                        ${roomLights.map(x => renderRoomLightCardHtml(x.lt, x.i)).join('')}
                        ${roomClimates.map(x => renderClimateCardHtml(x.cl, x.i)).join('')}
                        ${roomShutters.map(x => renderShutterCardHtml(x.sh, x.i)).join('')}
                    </div>
                </div>
            </section>
        `;
    }).join('');
}

function renderClimateView() {
    renderShuttersView();
}

window.controlSingleShutter = async function(idx, action) {
    if (!permGuard('control_rooms')) return;
    const sh = appState.shutters?.[idx];
    if (!sh) return;
    if (action === 'open_cover') { sh.state = 'open'; sh.position = 100; }
    if (action === 'close_cover') { sh.state = 'closed'; sh.position = 0; }

    if (sh.entityId) {
        await window.callHomeAssistantService('cover', action, { entity_id: sh.entityId });
    }
    renderShuttersView();
    persistStateToFirestore(false);
    showToast(`${sh.name}: ${action === 'open_cover' ? 'Openen ↑' : action === 'close_cover' ? 'Sluiten ↓' : 'Gestopt ⏹'}`);
};

window.setShutterPosition = async function(idx, positionVal) {
    if (!permGuard('control_rooms')) return;
    const sh = appState.shutters?.[idx];
    if (!sh) return;
    const pos = Math.max(0, Math.min(100, parseInt(positionVal, 10) || 0));
    sh.position = pos;
    sh.state = pos === 0 ? 'closed' : 'open';

    if (sh.entityId) {
        await window.callHomeAssistantService('cover', 'set_cover_position', {
            entity_id: sh.entityId,
            position: pos
        });
    }
    renderShuttersView();
    persistStateToFirestore(false);
    showToast(`${sh.name} ingesteld op ${pos}%`);
};

window.controlAllShutters = async function(action) {
    if (!permGuard('control_rooms')) return;
    (appState.shutters || []).forEach((sh, i) => {
        window.controlSingleShutter(i, action);
    });
};

window.adjustAircoTemp = async function(idx, delta) {
    if (!permGuard('control_rooms')) return;
    const cl = appState.climates?.[idx];
    if (!cl) return;
    const nextTemp = Math.max(16, Math.min(30, Number((Number(cl.targetTemp || 20) + delta).toFixed(1))));
    cl.targetTemp = nextTemp;
    if (cl.hvacMode === 'off') cl.hvacMode = 'cool';

    if (cl.entityId) {
        await window.callHomeAssistantService('climate', 'set_temperature', {
            entity_id: cl.entityId,
            temperature: nextTemp
        });
    }
    renderShuttersView();
    persistStateToFirestore(false);
    showToast(`${cl.name} ingesteld op ${formatNum(nextTemp, 1)} °C`);
};

window.setAircoHvacMode = async function(idx, newMode) {
    if (!permGuard('control_rooms')) return;
    const cl = appState.climates?.[idx];
    if (!cl) return;
    cl.hvacMode = newMode;

    if (cl.entityId) {
        await window.callHomeAssistantService('climate', 'set_hvac_mode', {
            entity_id: cl.entityId,
            hvac_mode: newMode
        });
    }
    renderShuttersView();
    persistStateToFirestore(false);
    showToast(`${cl.name} modus: ${newMode.toUpperCase()}`);
};

window.setAircoFanMode = async function(idx, newFan) {
    if (!permGuard('control_rooms')) return;
    const cl = appState.climates?.[idx];
    if (!cl) return;
    cl.fanMode = newFan;

    if (cl.entityId) {
        await window.callHomeAssistantService('climate', 'set_fan_mode', {
            entity_id: cl.entityId,
            fan_mode: newFan
        });
    }
    renderShuttersView();
    persistStateToFirestore(false);
    showToast(`${cl.name} ventilator: ${newFan}`);
};

window.setAircoSwingMode = async function(idx, newSwing) {
    if (!permGuard('control_rooms')) return;
    const cl = appState.climates?.[idx];
    if (!cl) return;
    cl.swingMode = newSwing;

    if (cl.entityId) {
        await window.callHomeAssistantService('climate', 'set_swing_mode', {
            entity_id: cl.entityId,
            swing_mode: newSwing
        });
    }
    renderShuttersView();
    persistStateToFirestore(false);
    showToast(`${cl.name} swing: ${newSwing}`);
};

window.turnOffAllAircos = async function() {
    if (!permGuard('control_rooms')) return;
    (appState.climates || []).forEach((cl, i) => {
        window.setAircoHvacMode(i, 'off');
    });
};

function renderAdminShuttersAndClimateLists() {
    const rooms = (appState.rooms && appState.rooms.length) ? appState.rooms : ["Woonkamer", "Keuken", "Slaapkamer"];
    const roomsEl = document.getElementById('adminRoomsList');
    const ltRoomSelect = document.getElementById('newLightRoom');
    const shRoomSelect = document.getElementById('newShutterRoom');
    const clRoomSelect = document.getElementById('newClimateRoom');

    const roomOptionsHtml = rooms.map(r => `<option value="${r}">🏠 ${r}</option>`).join('');
    if (ltRoomSelect) ltRoomSelect.innerHTML = roomOptionsHtml;
    if (shRoomSelect) shRoomSelect.innerHTML = roomOptionsHtml;
    if (clRoomSelect) clRoomSelect.innerHTML = roomOptionsHtml;

    if (roomsEl) {
        roomsEl.innerHTML = rooms.map((r, rIdx) => `
            <div draggable="true"
                 ondragstart="window.handleDeviceDragStart(event, 'room', ${rIdx})"
                 ondragend="window.handleDeviceDragEnd(event)"
                 ondragover="window.handleDeviceDragOver(event)"
                 ondrop="window.handleDeviceDrop(event, 'room', ${rIdx})"
                 class="inline-flex items-center gap-1.5 bg-[#f4f7f4] px-3 py-1.5 rounded-xl border border-stone-200 text-xs font-bold text-[#152920] cursor-grab">
                <span class="text-stone-400">⠿</span>
                <input type="text" value="${r}" onchange="window.adminRenameRoom(${rIdx}, this.value)" class="bg-transparent font-bold text-xs w-28 focus:outline-none focus:underline">
                ${rooms.length > 1 ? `<button onclick="window.adminRemoveRoom(${rIdx})" class="text-red-600 hover:underline px-1 cursor-pointer">✕</button>` : ''}
            </div>
        `).join('');
    }

    const ltEl = document.getElementById('adminRoomLightsList');
    const shEl = document.getElementById('adminShuttersList');
    const clEl = document.getElementById('adminClimateList');

    if (ltEl) {
        ltEl.innerHTML = (appState.roomLights || []).map((lt, idx) => `
            <div draggable="true"
                 ondragstart="window.handleDeviceDragStart(event, 'light', ${idx})"
                 ondragend="window.handleDeviceDragEnd(event)"
                 ondragover="window.handleDeviceDragOver(event)"
                 ondrop="window.handleDeviceDrop(event, 'light', ${idx})"
                 class="bg-[#f6f8f5] p-3 rounded-2xl border border-stone-200/80 space-y-2 cursor-grab">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-stone-400 font-bold text-xs">⠿ Sleep</span>
                    <button onclick="window.adminRemoveRoomLight(${idx})" class="text-xs font-bold text-red-600 hover:underline cursor-pointer">Verwijder</button>
                </div>
                <div class="grid grid-cols-1 gap-2">
                    <input type="text" value="${lt.name}" onchange="window.adminUpdateRoomLight(${idx}, 'name', this.value)" placeholder="Naam lamp" class="px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 text-xs font-bold text-[#1c2520]">
                    <div class="grid grid-cols-2 gap-2">
                        <select onchange="window.adminUpdateRoomLight(${idx}, 'room', this.value)" class="px-2 py-1.5 rounded-lg bg-white border border-stone-200 text-xs font-semibold">
                            ${rooms.map(r => `<option value="${r}" ${(lt.room || rooms[0]) === r ? 'selected' : ''}>🏠 ${r}</option>`).join('')}
                        </select>
                        <input type="text" list="haEntitiesDatalist" value="${lt.entityId || ''}" onchange="window.adminUpdateRoomLight(${idx}, 'entityId', this.value)" placeholder="light.lamp..." class="px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 text-[11px] font-mono text-amber-800">
                    </div>
                </div>
            </div>
        `).join('');
    }

    if (shEl) {
        shEl.innerHTML = (appState.shutters || []).map((sh, idx) => `
            <div draggable="true"
                 ondragstart="window.handleDeviceDragStart(event, 'shutter', ${idx})"
                 ondragend="window.handleDeviceDragEnd(event)"
                 ondragover="window.handleDeviceDragOver(event)"
                 ondrop="window.handleDeviceDrop(event, 'shutter', ${idx})"
                 class="bg-[#f6f8f5] p-3 rounded-2xl border border-stone-200/80 space-y-2 cursor-grab">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-stone-400 font-bold text-xs">⠿ Sleep</span>
                    <button onclick="window.adminRemoveShutter(${idx})" class="text-xs font-bold text-red-600 hover:underline cursor-pointer">Verwijder</button>
                </div>
                <div class="grid grid-cols-1 gap-2">
                    <input type="text" value="${sh.name}" onchange="window.adminUpdateShutter(${idx}, 'name', this.value)" placeholder="Naam rolluik" class="px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 text-xs font-bold text-[#1c2520]">
                    <div class="grid grid-cols-2 gap-2">
                        <select onchange="window.adminUpdateShutter(${idx}, 'room', this.value)" class="px-2 py-1.5 rounded-lg bg-white border border-stone-200 text-xs font-semibold">
                            ${rooms.map(r => `<option value="${r}" ${(sh.room || rooms[0]) === r ? 'selected' : ''}>🏠 ${r}</option>`).join('')}
                        </select>
                        <input type="text" list="haEntitiesDatalist" value="${sh.entityId || ''}" onchange="window.adminUpdateShutter(${idx}, 'entityId', this.value)" placeholder="cover.rolluik..." class="px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 text-[11px] font-mono text-[#197447]">
                    </div>
                </div>
            </div>
        `).join('');
    }

    if (clEl) {
        clEl.innerHTML = (appState.climates || []).map((cl, idx) => `
            <div draggable="true"
                 ondragstart="window.handleDeviceDragStart(event, 'climate', ${idx})"
                 ondragend="window.handleDeviceDragEnd(event)"
                 ondragover="window.handleDeviceDragOver(event)"
                 ondrop="window.handleDeviceDrop(event, 'climate', ${idx})"
                 class="bg-[#f6f8f5] p-3 rounded-2xl border border-stone-200/80 space-y-2 cursor-grab">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-stone-400 font-bold text-xs">⠿ Sleep</span>
                    <button onclick="window.adminRemoveClimate(${idx})" class="text-xs font-bold text-red-600 hover:underline cursor-pointer">Verwijder</button>
                </div>
                <div class="grid grid-cols-1 gap-2">
                    <input type="text" value="${cl.name}" onchange="window.adminUpdateClimate(${idx}, 'name', this.value)" placeholder="Naam airco" class="px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 text-xs font-bold text-[#1c2520]">
                    <div class="grid grid-cols-2 gap-2">
                        <select onchange="window.adminUpdateClimate(${idx}, 'room', this.value)" class="px-2 py-1.5 rounded-lg bg-white border border-stone-200 text-xs font-semibold">
                            ${rooms.map(r => `<option value="${r}" ${(cl.room || rooms[0]) === r ? 'selected' : ''}>🏠 ${r}</option>`).join('')}
                        </select>
                        <input type="text" list="haEntitiesDatalist" value="${cl.entityId || ''}" onchange="window.adminUpdateClimate(${idx}, 'entityId', this.value)" placeholder="climate.airco..." class="px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 text-[11px] font-mono text-[#0369a1]">
                    </div>
                </div>
            </div>
        `).join('');
    }
}

window.moveShutterOrder = function(idx, dir) {
    const arr = appState.shutters || [];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    const temp = arr[idx];
    arr[idx] = arr[target];
    arr[target] = temp;
    renderAdminShuttersAndClimateLists();
    renderShuttersView();
    persistStateToFirestore(true);
};

window.moveClimateOrder = function(idx, dir) {
    const arr = appState.climates || [];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    const temp = arr[idx];
    arr[idx] = arr[target];
    arr[target] = temp;
    renderAdminShuttersAndClimateLists();
    renderShuttersView();
    persistStateToFirestore(true);
};

window.adminUpdateShutter = function(idx, field, val) {
    if (!appState.shutters?.[idx]) return;
    appState.shutters[idx][field] = val.trim();
    if (discoveredHaEntities.length > 0) applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    renderShuttersView();
    persistStateToFirestore(true);
};

window.adminUpdateClimate = function(idx, field, val) {
    if (!appState.climates?.[idx]) return;
    appState.climates[idx][field] = val.trim();
    if (discoveredHaEntities.length > 0) applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    renderShuttersView();
    persistStateToFirestore(true);
};

window.adminAddShutter = function() {
    const name = document.getElementById('newShutterName').value.trim();
    const room = document.getElementById('newShutterRoom')?.value || (appState.rooms?.[0] || 'Woonkamer');
    const entityId = document.getElementById('newShutterEntity').value.trim();
    if (!name) {
        showToast("Geef het rolluik een naam.");
        return;
    }
    if (!appState.shutters) appState.shutters = [];
    appState.shutters.push({ id: 'sh_' + Date.now(), name, room, entityId, state: 'open', position: 100 });
    document.getElementById('newShutterName').value = '';
    document.getElementById('newShutterEntity').value = '';
    if (discoveredHaEntities.length > 0) applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    renderAdminShuttersAndClimateLists();
    renderShuttersView();
    persistStateToFirestore(true);
};

window.adminRemoveShutter = function(idx) {
    appState.shutters.splice(idx, 1);
    renderAdminShuttersAndClimateLists();
    renderShuttersView();
    persistStateToFirestore(true);
};

window.adminAddClimate = function() {
    const name = document.getElementById('newClimateName').value.trim();
    const room = document.getElementById('newClimateRoom')?.value || (appState.rooms?.[0] || 'Woonkamer');
    const entityId = document.getElementById('newClimateEntity').value.trim();
    if (!name) {
        showToast("Geef de airco een naam.");
        return;
    }
    if (!appState.climates) appState.climates = [];
    appState.climates.push({
        id: 'cl_' + Date.now(),
        name,
        room,
        entityId,
        hvacMode: 'off',
        currentTemp: 21.0,
        targetTemp: 20.0,
        fanMode: 'auto',
        swingMode: 'off',
        hvacModes: ["off", "cool", "heat", "heat_cool", "dry", "fan_only"],
        fanModes: ["auto", "low", "medium", "high"],
        swingModes: ["off", "vertical", "horizontal", "both"]
    });
    document.getElementById('newClimateName').value = '';
    document.getElementById('newClimateEntity').value = '';
    if (discoveredHaEntities.length > 0) applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    renderAdminShuttersAndClimateLists();
    renderShuttersView();
    persistStateToFirestore(true);
};

window.adminRemoveClimate = function(idx) {
    appState.climates.splice(idx, 1);
    renderAdminShuttersAndClimateLists();
    renderShuttersView();
    persistStateToFirestore(true);
};
