'use strict';
/* Ruimtes en verlichting (incl. drag & drop en beheer) */

window.setRoomsFilter = function(filterMode) {
    activeRoomsFilter = filterMode;
    ['all', 'lights', 'shutters', 'climate'].forEach(m => {
        const btn = document.getElementById('roomFilterBtn_' + m);
        if (!btn) return;
        if (m === filterMode) {
            btn.className = "px-3 py-1.5 rounded-lg bg-[#5cd69c] text-[#152920] cursor-pointer transition font-extrabold";
        } else {
            btn.className = "px-3 py-1.5 rounded-lg text-white hover:bg-white/10 cursor-pointer transition font-bold";
        }
    });
    renderShuttersView();
};

window.toggleRoomAccordion = function(roomName) {
    if (expandedRoomsSet.has(roomName)) {
        expandedRoomsSet.delete(roomName);
    } else {
        expandedRoomsSet.add(roomName);
    }
    renderShuttersView();
};

window.toggleAllRoomAccordions = function() {
    const rooms = (appState.rooms && appState.rooms.length) ? appState.rooms : ["Woonkamer", "Keuken", "Slaapkamer"];
    if (expandedRoomsSet.size >= rooms.length) {
        expandedRoomsSet.clear();
    } else {
        rooms.forEach(r => expandedRoomsSet.add(r));
    }
    renderShuttersView();
};

// =====================================================================
// DRAG & DROP HANDLERS VOOR RUIMTES, LAMPEN, ROLLUIKEN EN AIRCO'S
// =====================================================================
window.handleDeviceDragStart = function(ev, type, index) {
    dragItemPayload = { type, index };
    if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', JSON.stringify(dragItemPayload));
    }
    ev.currentTarget.classList.add('opacity-50', 'scale-95');
};

window.handleDeviceDragEnd = function(ev) {
    ev.currentTarget.classList.remove('opacity-50', 'scale-95');
};

window.handleDeviceDragOver = function(ev) {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
};

window.handleDeviceDrop = function(ev, targetType, targetIndex, targetRoomName = null) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!dragItemPayload) return;

    const { type, index } = dragItemPayload;
    dragItemPayload = null;

    const listMap = {
        room: appState.rooms,
        light: appState.roomLights,
        shutter: appState.shutters,
        climate: appState.climates
    };

    // Als een apparaat op een andere Ruimte-balk wordt gesleept, verplaats het naar die kamer!
    if (targetType === 'room_DropZone' && targetRoomName && type !== 'room') {
        const arr = listMap[type];
        if (arr && arr[index]) {
            arr[index].room = targetRoomName;
            expandedRoomsSet.add(targetRoomName);
            renderAdminShuttersAndClimateLists();
            renderShuttersView();
            persistStateToFirestore(true);
        }
        return;
    }

    if (type !== targetType || index === targetIndex) return;
    const arr = listMap[type];
    if (!arr || index < 0 || index >= arr.length || targetIndex < 0 || targetIndex >= arr.length) return;

    // Als we binnen of tussen kamers slepen, neem ook de kamer van het doel-item over
    if (type !== 'room' && targetRoomName) {
        arr[index].room = targetRoomName;
    }

    const [movedItem] = arr.splice(index, 1);
    arr.splice(targetIndex, 0, movedItem);

    renderAdminShuttersAndClimateLists();
    renderShuttersView();
    persistStateToFirestore(true);
};

function renderRoomLightCardHtml(lt, idx) {
    const isOn = lt.state === 'on';
    const bri = Math.max(0, Math.min(100, Math.round(Number(lt.brightnessPct) ?? (isOn ? 100 : 0))));

    return `
        <div draggable="true"
             ondragstart="window.handleDeviceDragStart(event, 'light', ${idx})"
             ondragend="window.handleDeviceDragEnd(event)"
             ondragover="window.handleDeviceDragOver(event)"
             ondrop="window.handleDeviceDrop(event, 'light', ${idx}, '${lt.room || 'Woonkamer'}')"
             class="bg-white rounded-[24px] p-5 shadow-xs border ${isOn ? 'border-amber-300 bg-amber-50/20' : 'border-stone-200/90'} flex flex-col justify-between gap-4 transition cursor-grab active:cursor-grabbing">
            <div>
                <div class="flex items-start justify-between gap-2 mb-3">
                    <div class="flex items-start gap-2">
                        <span title="Sleep om te verplaatsen" class="text-stone-400 hover:text-stone-700 font-bold text-base select-none px-1 cursor-grab">⠿</span>
                        <div>
                            <span class="text-[10px] font-extrabold uppercase tracking-wider ${isOn ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-600'} px-2 py-0.5 rounded-full">💡 Lamp • ${lt.room || 'Woonkamer'}</span>
                            <h4 class="text-base font-bold text-[#1c2520] mt-1">${lt.name}</h4>
                            <p class="text-[10px] font-mono text-[#68736d]">${lt.entityId || 'Lokale bediening'}</p>
                        </div>
                    </div>
                    <button onclick="window.toggleSingleRoomLight(${idx})" class="px-3.5 py-1.5 rounded-full text-xs font-extrabold cursor-pointer transition ${isOn ? 'bg-amber-400 text-[#152920] shadow-xs' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'}">
                        ${isOn ? '💡 AAN' : '⏻ UIT'}
                    </button>
                </div>

                <div class="space-y-1 mt-2">
                    <div class="flex justify-between text-[11px] font-bold text-[#55605a]">
                        <span>Helderheid</span>
                        <span>${isOn ? bri + '%' : 'Uit (0%)'}</span>
                    </div>
                    <input type="range" min="1" max="100" step="5" value="${bri}" onchange="window.setRoomLightBrightness(${idx}, this.value)" class="w-full accent-amber-500 cursor-pointer h-2 rounded-lg">
                </div>
            </div>
        </div>
    `;
}

function renderActiveLightsBadgeAndModal() {
    const lights = appState.roomLights || [];
    const activeLights = lights.map((lt, idx) => ({ ...lt, idx })).filter(lt => lt.state === 'on');

    const textEl = document.getElementById('headerActiveLightsText');
    const dotEl = document.getElementById('headerLightsDot');
    const btnEl = document.getElementById('headerActiveLightsBtn');

    if (textEl) {
        if (activeLights.length === 0) {
            textEl.textContent = "Alle lampen uit";
        } else if (activeLights.length === 1) {
            textEl.textContent = `1 lamp aan (${activeLights[0].name})`;
        } else {
            const previewNames = activeLights.slice(0, 2).map(l => l.name).join(', ');
            textEl.textContent = `${activeLights.length} lampen aan (${previewNames}${activeLights.length > 2 ? '...' : ''})`;
        }
    }

    if (dotEl && btnEl) {
        if (activeLights.length > 0) {
            dotEl.className = "w-2 h-2 rounded-full bg-amber-500 animate-pulse";
            btnEl.className = "bg-amber-50 hover:bg-amber-100/90 shadow-sm px-3.5 py-2 rounded-full flex items-center gap-1.5 text-xs font-extrabold text-amber-900 transition cursor-pointer border border-amber-300";
        } else {
            dotEl.className = "w-2 h-2 rounded-full bg-stone-400";
            btnEl.className = "bg-white/95 hover:bg-white shadow-sm px-3.5 py-2 rounded-full flex items-center gap-1.5 text-xs font-bold text-[#55605a] transition cursor-pointer border border-black/5";
        }
    }

    const modalList = document.getElementById('activeLightsModalList');
    const modalSub = document.getElementById('activeLightsModalSub');
    if (modalSub) {
        modalSub.textContent = activeLights.length > 0
            ? `Er staan momenteel ${activeLights.length} van de ${lights.length} lampen aan:`
            : `Alle ${lights.length} gekoppelde lampen zijn momenteel uitgeschakeld.`;
    }
    if (modalList) {
        if (lights.length === 0) {
            modalList.innerHTML = `<p class="text-xs text-[#68736d] italic py-4 text-center">Nog geen lampen gekoppeld.</p>`;
        } else {
            modalList.innerHTML = lights.map((lt, idx) => {
                const isOn = lt.state === 'on';
                return `
                    <div class="flex items-center justify-between p-3 rounded-2xl border ${isOn ? 'bg-amber-50/70 border-amber-300' : 'bg-stone-50 border-stone-200/70 opacity-70'}">
                        <div class="flex items-center gap-3">
                            <span class="w-8 h-8 rounded-xl ${isOn ? 'bg-amber-400 text-[#152920]' : 'bg-stone-200 text-stone-600'} flex items-center justify-center text-sm font-bold">💡</span>
                            <div>
                                <p class="text-xs font-extrabold text-[#1c2520]">${lt.name}</p>
                                <p class="text-[10px] text-[#68736d]">🏠 ${lt.room || 'Woonkamer'} • ${isOn ? (lt.brightnessPct ?? 100) + '% helderheid' : 'Uit'}</p>
                            </div>
                        </div>
                        <button onclick="window.toggleSingleRoomLight(${idx})" class="px-3 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer ${isOn ? 'bg-[#152920] text-white' : 'bg-stone-200 text-stone-700'}">
                            ${isOn ? 'Zet Uit' : 'Zet Aan'}
                        </button>
                    </div>
                `;
            }).join('');
        }
    }
}

window.toggleActiveLightsModal = function(open) {
    const modal = document.getElementById('activeLightsModalOverlay');
    if (!modal) return;
    renderActiveLightsBadgeAndModal();
    modal.classList.toggle('hidden', !open);
    modal.classList.toggle('flex', !!open);
};

window.toggleSingleRoomLight = async function(idx) {
    const lt = appState.roomLights?.[idx];
    if (!lt) return;
    lt.state = lt.state === 'on' ? 'off' : 'on';
    if (lt.state === 'on' && !lt.brightnessPct) lt.brightnessPct = 100;

    if (lt.entityId) {
        const service = lt.state === 'on' ? 'turn_on' : 'turn_off';
        await window.callHomeAssistantService('light', service, { entity_id: lt.entityId });
    }
    renderActiveLightsBadgeAndModal();
    renderShuttersView();
    persistStateToFirestore(false);
    showToast(`${lt.name}: ${lt.state === 'on' ? 'Aangezet 💡' : 'Uitgezet ⏻'}`);
};

window.setRoomLightBrightness = async function(idx, pctVal) {
    const lt = appState.roomLights?.[idx];
    if (!lt) return;
    const pct = Math.max(1, Math.min(100, parseInt(pctVal, 10) || 100));
    lt.brightnessPct = pct;
    lt.state = 'on';

    if (lt.entityId) {
        await window.callHomeAssistantService('light', 'turn_on', {
            entity_id: lt.entityId,
            brightness_pct: pct
        });
    }
    renderActiveLightsBadgeAndModal();
    renderShuttersView();
    persistStateToFirestore(false);
    showToast(`${lt.name} helderheid: ${pct}%`);
};

window.turnOffAllRoomLights = async function() {
    (appState.roomLights || []).forEach((lt, i) => {
        if (lt.state === 'on') window.toggleSingleRoomLight(i);
    });
};

window.adminAddRoomLight = function() {
    const name = document.getElementById('newLightName').value.trim();
    const room = document.getElementById('newLightRoom')?.value || (appState.rooms?.[0] || 'Woonkamer');
    const entityId = document.getElementById('newLightEntity').value.trim();
    if (!name) {
        showToast("Geef de lamp een naam.");
        return;
    }
    if (!appState.roomLights) appState.roomLights = [];
    appState.roomLights.push({ id: 'lt_' + Date.now(), name, room, entityId, state: 'off', brightnessPct: 100 });
    document.getElementById('newLightName').value = '';
    document.getElementById('newLightEntity').value = '';
    if (discoveredHaEntities.length > 0) applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    renderAdminShuttersAndClimateLists();
    renderActiveLightsBadgeAndModal();
    renderShuttersView();
    persistStateToFirestore(true);
};

window.adminUpdateRoomLight = function(idx, field, val) {
    if (!appState.roomLights?.[idx]) return;
    appState.roomLights[idx][field] = val.trim();
    if (discoveredHaEntities.length > 0) applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    renderActiveLightsBadgeAndModal();
    renderShuttersView();
    persistStateToFirestore(true);
};

window.adminRemoveRoomLight = function(idx) {
    appState.roomLights.splice(idx, 1);
    renderAdminShuttersAndClimateLists();
    renderActiveLightsBadgeAndModal();
    renderShuttersView();
    persistStateToFirestore(true);
};

window.adminAddRoom = function() {
    const input = document.getElementById('newRoomNameInput');
    const name = (input?.value || '').trim();
    if (!name) {
        showToast("Geef de ruimte een naam.");
        return;
    }
    if (!appState.rooms) appState.rooms = [];
    if (appState.rooms.some(r => r.toLowerCase() === name.toLowerCase())) {
        showToast("Deze ruimte bestaat al.");
        return;
    }
    appState.rooms.push(name);
    if (input) input.value = '';
    renderAdminShuttersAndClimateLists();
    renderActiveLightsBadgeAndModal();
    renderShuttersView();
    persistStateToFirestore(true);
};

window.adminRenameRoom = function(rIdx, newName) {
    const clean = (newName || '').trim();
    if (!clean || !appState.rooms?.[rIdx]) return;
    const oldName = appState.rooms[rIdx];
    appState.rooms[rIdx] = clean;
    (appState.shutters || []).forEach(sh => { if (sh.room === oldName) sh.room = clean; });
    (appState.climates || []).forEach(cl => { if (cl.room === oldName) cl.room = clean; });
    renderAdminShuttersAndClimateLists();
    renderShuttersView();
    persistStateToFirestore(true);
};

window.adminRemoveRoom = function(rIdx) {
    if (!appState.rooms || appState.rooms.length <= 1) return;
    const removed = appState.rooms.splice(rIdx, 1)[0];
    const fallback = appState.rooms[0];
    (appState.shutters || []).forEach(sh => { if (sh.room === removed) sh.room = fallback; });
    (appState.climates || []).forEach(cl => { if (cl.room === removed) cl.room = fallback; });
    renderAdminShuttersAndClimateLists();
    renderShuttersView();
    persistStateToFirestore(true);
};

window.moveRoomOrder = function(rIdx, dir) {
    const arr = appState.rooms || [];
    const target = rIdx + dir;
    if (target < 0 || target >= arr.length) return;
    const temp = arr[rIdx];
    arr[rIdx] = arr[target];
    arr[target] = temp;
    renderAdminShuttersAndClimateLists();
    renderShuttersView();
    persistStateToFirestore(true);
};
