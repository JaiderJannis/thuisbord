'use strict';
/* Multi-gezin beheer */

function syncActiveHouseholdPointer() {
    if (!platformState.households || Object.keys(platformState.households).length === 0) {
        platformState.households = { "Jannis - Bellens": createDefaultHouseholdConfig("Jannis - Bellens") };
    }
    if (!platformState.households[activeHouseholdName]) {
        const firstKey = Object.keys(platformState.households)[0];
        activeHouseholdName = firstKey;
    }
    appState = platformState.households[activeHouseholdName];
    if (!appState.entityMap) appState.entityMap = createDefaultHouseholdConfig(activeHouseholdName).entityMap;
    if (!appState.tomorrowPrices || appState.tomorrowPrices.length !== 24) {
        appState.tomorrowPrices = createDefaultHouseholdConfig(activeHouseholdName).tomorrowPrices;
    }
    if (!appState.powerHistory || !Array.isArray(appState.powerHistory)) {
        appState.powerHistory = createDefaultHouseholdConfig(activeHouseholdName).powerHistory;
    }
    if (!appState.rooms || !Array.isArray(appState.rooms) || appState.rooms.length === 0) {
        appState.rooms = ["Woonkamer", "Keuken", "Slaapkamer"];
    }
    if (!appState.roomLights || !Array.isArray(appState.roomLights)) {
        appState.roomLights = createDefaultHouseholdConfig(activeHouseholdName).roomLights;
    }
    if (!appState.shutters || !Array.isArray(appState.shutters)) {
        appState.shutters = createDefaultHouseholdConfig(activeHouseholdName).shutters;
    }
    if (!appState.climates || !Array.isArray(appState.climates)) {
        appState.climates = createDefaultHouseholdConfig(activeHouseholdName).climates;
    }
    if (!appState.robots || !Array.isArray(appState.robots)) {
        appState.robots = createDefaultHouseholdConfig(activeHouseholdName).robots;
    }
    (appState.roomLights || []).forEach(lt => { if (!lt.room) lt.room = appState.rooms[0] || "Woonkamer"; });
    (appState.shutters || []).forEach(sh => { if (!sh.room) sh.room = appState.rooms[0] || "Woonkamer"; });
    (appState.climates || []).forEach(cl => { if (!cl.room) cl.room = appState.rooms[0] || "Woonkamer"; });
    if (!appState.liveWasteItems) appState.liveWasteItems = [];
    if (!appState.haTodayEvents) appState.haTodayEvents = [];
}

function renderHouseholdsOverview() {
    const container = document.getElementById('householdsOverviewContainer');
    const badge = document.getElementById('totalHouseholdsCountBadge');
    const switcherSelect = document.getElementById('superAdminHouseholdSelect');
    const memberHouseholdSelect = document.getElementById('newMemberHouseholdSelect');

    const householdNames = Object.keys(platformState.households || {});
    if (badge) badge.textContent = `${householdNames.length} gezinnen actief`;

    if (switcherSelect) {
        switcherSelect.innerHTML = householdNames.map(hName =>
            `<option value="${hName}" class="text-[#152920] font-bold" ${hName === activeHouseholdName ? 'selected' : ''}>${hName}</option>`
        ).join('');
    }

    if (memberHouseholdSelect) {
        const allowedHouseholds = currentRole === 'admin' ? householdNames : [activeHouseholdName];
        memberHouseholdSelect.innerHTML = allowedHouseholds.map(hName =>
            `<option value="${hName}" ${hName === activeHouseholdName ? 'selected' : ''}>${hName}</option>`
        ).join('');
    }

    if (!container) return;

    container.innerHTML = householdNames.map(hName => {
        const hData = platformState.households[hName];
        const members = (platformState.accounts || []).filter(a => a.household === hName && a.role !== 'admin');
        const managers = members.filter(m => m.role === 'manager');
        const regularMembers = members.filter(m => m.role === 'user');
        const isCurrent = hName === activeHouseholdName;
        const hasHaToken = !!(hData.haUrl && hData.haToken);

        return `
            <div class="p-5 rounded-2xl border transition ${isCurrent ? 'bg-[#f4fbf7] border-[#19975c] shadow-xs' : 'bg-[#f6f8f5] border-stone-200/80'} flex flex-col justify-between gap-4">
                <div>
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <h4 class="text-base font-extrabold text-[#1c2520]">🏡 ${hName}</h4>
                        <span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full ${hasHaToken ? 'bg-[#dcece3] text-[#152920]' : 'bg-stone-200 text-stone-600'}">
                            ${hasHaToken ? '🔌 HA Token Actief' : 'Nog geen HA Token'}
                        </span>
                    </div>

                    <div class="space-y-1.5 text-xs text-[#38443d] mt-3">
                        <p class="font-bold text-[#152920]">Gezinsbeheerder(s) (${managers.length}):</p>
                        ${managers.length ? managers.map(m => `<p class="pl-2">• <strong>${m.name}</strong> (${m.email})</p>`).join('') : `<p class="pl-2 italic text-stone-400">Nog geen gezinsbeheerder</p>`}

                        <p class="font-bold text-[#152920] pt-1">Gezinsleden (${regularMembers.length}):</p>
                        ${regularMembers.length ? regularMembers.map(m => `<p class="pl-2">• ${m.name} (${m.email})</p>`).join('') : `<p class="pl-2 italic text-stone-400">Nog geen gezinsleden</p>`}
                    </div>
                </div>

                <div class="flex items-center justify-between gap-2 pt-3 border-t border-stone-200/70">
                    <button onclick="window.switchActiveHousehold('${hName}')" class="flex-1 py-2 px-3 rounded-xl font-bold text-xs cursor-pointer ${isCurrent ? 'bg-[#19975c] text-white' : 'bg-[#152920] text-white hover:bg-[#223f31]'}">
                        ${isCurrent ? '✓ Nu Geselecteerd' : 'Open & Beheer Gezin →'}
                    </button>
                    ${householdNames.length > 1 ? `
                        <button onclick="window.deleteHousehold('${hName}')" class="py-2 px-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 font-bold text-xs cursor-pointer">
                            Verwijder
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

window.createNewHousehold = function() {
    if (currentRole !== 'admin') return;
    const title = document.getElementById('newHouseholdTitleInput').value.trim();
    const mgrName = document.getElementById('newHouseholdManagerName').value.trim();
    const mgrEmail = document.getElementById('newHouseholdManagerEmail').value.trim().toLowerCase();

    if (!title) {
        showToast("Geef het nieuwe gezin een naam (bijv. Familie Janssens).");
        return;
    }
    if (!platformState.households[title]) {
        platformState.households[title] = createDefaultHouseholdConfig(title);
    }
    if (mgrName && mgrEmail) {
        platformState.accounts.push({
            id: 'acc_' + Date.now(),
            name: mgrName,
            email: mgrEmail,
            role: 'manager',
            household: title
        });
    }
    activeHouseholdName = title;
    syncActiveHouseholdPointer();
    document.getElementById('newHouseholdTitleInput').value = '';
    document.getElementById('newHouseholdManagerName').value = '';
    document.getElementById('newHouseholdManagerEmail').value = '';
    populateAdminInputs();
    renderAll();
    persistStateToFirestore(true);
};

window.switchActiveHousehold = function(hName) {
    if (!platformState.households[hName]) return;
    activeHouseholdName = hName;
    syncActiveHouseholdPointer();
    populateAdminInputs();
    renderAll();
    showToast(`Gewisseld naar ${hName}`);
    if (appState.haUrl && appState.haToken) {
        window.fetchHomeAssistantEntities(true);
    }
};

window.deleteHousehold = function(hName) {
    if (currentRole !== 'admin') return;
    const keys = Object.keys(platformState.households);
    if (keys.length <= 1) {
        showToast("Er moet minimaal één gezin actief blijven.");
        return;
    }
    delete platformState.households[hName];
    platformState.accounts = (platformState.accounts || []).filter(a => a.household !== hName || a.role === 'admin');
    activeHouseholdName = Object.keys(platformState.households)[0];
    syncActiveHouseholdPointer();
    populateAdminInputs();
    renderAll();
    persistStateToFirestore(true);
};
