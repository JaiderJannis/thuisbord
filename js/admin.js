'use strict';
/* Admin-paneel: invoer, apparatenlijst, tabs en live toepassen */

function populateAdminInputs() {
    syncActiveHouseholdPointer();
    renderHouseholdsOverview();

    document.getElementById('admBznZone').value = appState.bznZone || 'BE';
    document.getElementById('admVatPercent').value = appState.vatPercent ?? 21;
    document.getElementById('admFixedDailyCost').value = appState.fixedDailyCost ?? 0.75;
    document.getElementById('admTaxPerKwh').value = appState.taxPerKwh ?? 0.108;
    document.getElementById('admMarkupPerKwh').value = appState.markupPerKwh ?? 0.02;
    document.getElementById('admApplyFormulaToHours').checked = !!appState.applyFormulaToHours;

    document.getElementById('admGasPrice').value = appState.gasPricePerM3;
    document.getElementById('admWaterPrice').value = appState.waterPricePerM3 ?? 1.25;
    document.getElementById('admKwhImport').value = appState.kwhImport;
    document.getElementById('admKwhExport').value = appState.kwhExport;
    document.getElementById('admKwhSolar').value = appState.kwhSolar;
    document.getElementById('admGasToday').value = appState.gasToday;

    document.getElementById('admWaterRate').value = appState.waterRate ?? 4.5;
    document.getElementById('admWaterToday').value = appState.waterTodayLiters ?? 118;

    document.getElementById('admSolarW').value = appState.solarW;
    document.getElementById('admHouseW').value = appState.houseW;
    document.getElementById('admGridW').value = appState.gridW;
    if (document.getElementById('admGridImportW')) document.getElementById('admGridImportW').value = appState.gridImportW ?? appState.gridW ?? 0;
    if (document.getElementById('admGridExportW')) document.getElementById('admGridExportW').value = appState.gridExportW ?? 0;
    document.getElementById('admBatteryW').value = appState.batteryW;
    if (document.getElementById('admBatteryMode')) document.getElementById('admBatteryMode').value = appState.batteryMode || 'discharging';
    if (document.getElementById('admBatterySignConvention')) document.getElementById('admBatterySignConvention').value = appState.batterySignConvention || 'negative_discharge';
    if (document.getElementById('admHouseCalcMode')) document.getElementById('admHouseCalcMode').value = appState.houseCalcMode || 'ha_formula';
    document.getElementById('admBatteryPct').value = appState.batteryPct;
    document.getElementById('admBatteryCap').value = appState.batteryCap;
    document.getElementById('admGasRate').value = appState.gasRate;

    document.getElementById('admAutoAdvice').checked = !!appState.autoAdvice;
    document.getElementById('admRotateAdvice').checked = !!appState.rotateAdvice;
    document.getElementById('admAdviceText').value = appState.adviceText;
    document.getElementById('admAdviceBadge').value = appState.adviceBadge;

    if (document.getElementById('admGcalUrl')) document.getElementById('admGcalUrl').value = appState.googleCalendarUrl || '';
    if (document.getElementById('quickGcalInput')) document.getElementById('quickGcalInput').value = appState.googleCalendarUrl || '';

    document.getElementById('admWasteEnabled').checked = appState.wasteEnabled;
    document.getElementById('admWasteType').value = appState.wasteType;
    document.getElementById('admWastePostal').value = appState.wastePostal;
    document.getElementById('admWasteDate').value = appState.wasteDate;
    document.getElementById('admWasteDesc').value = appState.wasteDesc;

    document.getElementById('admStatusText').value = appState.statusText;
    document.getElementById('admHaUrl').value = appState.haUrl;
    document.getElementById('admHaToken').value = appState.haToken;

    const em = appState.entityMap || {};
    [
        'solarW','houseW','gridW','gridImportW','gridExportW','batteryW','batteryPct',
        'gasRate','gasToday','waterRate','waterTodayLiters','kwhImport','kwhImportT2','kwhExport','kwhExportT2',
        'kwhSolar','monthlyPeakW','priceSensor','statusLamp','waste_pmd','waste_gft','waste_papier','waste_rest','calendarEntity'
    ].forEach(k => {
        const el = document.getElementById('map_' + k);
        if (el) el.value = em[k] || '';
    });

    const targetPrices = adminEditPriceDay === 'tomorrow' ? appState.tomorrowPrices : appState.hourlyPrices;
    const hourlyGrid = document.getElementById('adminHourlyGrid');
    hourlyGrid.innerHTML = (targetPrices || []).map((p, h) => {
        const eff = getEffectiveHourPrice(p);
        return `
        <div class="bg-[#f6f8f5] p-2 rounded-xl border border-stone-200/70">
            <div class="flex justify-between items-center mb-1">
                <label class="text-[10px] font-bold text-[#55605a]">${String(h).padStart(2, '0')}:00</label>
                <span class="text-[10px] font-semibold text-[#197447]">${formatEuro(eff)}</span>
            </div>
            <input type="number" step="0.001" value="${Number(p).toFixed(3)}" oninput="window.updateSingleHourPrice(${h}, this.value)" class="w-full px-2 py-1 rounded-lg bg-white border border-stone-200 text-xs font-bold text-[#1c2520]">
        </div>
    `}).join('');

    renderAccountsManagementTable();
    renderCustomAdviceList();
    renderAdminLists();
    renderAdminAppliancesList();
    renderAdminShuttersAndClimateLists();
    updateAdminRolePermissionsUI();
}

function renderAdminAppliancesList() {
    const container = document.getElementById('adminAppliancesList');
    if (!container) return;
    const list = appState.appliances || [];
    if (list.length === 0) {
        container.innerHTML = `<p class="text-xs text-[#68736d] italic py-2">Nog geen slimme apparaten toegevoegd.</p>`;
        return;
    }
    const icons = ["🧺", "🍽️", "🚗", "🔥", "👕", "❄️", "🔌"];
    container.innerHTML = list.map((app, idx) => `
        <div class="bg-[#f6f8f5] p-3 rounded-2xl border border-stone-200/70 space-y-2">
            <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                <select onchange="window.adminUpdateApplianceField(${idx}, 'icon', this.value)" class="sm:col-span-2 px-2 py-1.5 rounded-lg bg-white border border-stone-200 text-sm">
                    ${icons.map(ic => `<option value="${ic}" ${app.icon === ic ? 'selected' : ''}>${ic}</option>`).join('')}
                </select>
                <input type="text" value="${app.name}" onchange="window.adminUpdateApplianceField(${idx}, 'name', this.value)" placeholder="Naam apparaat" class="sm:col-span-4 px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 text-xs font-bold text-[#1c2520]">
                <input type="text" list="haEntitiesDatalist" value="${app.entityId || ''}" onchange="window.adminUpdateApplianceField(${idx}, 'entityId', this.value)" placeholder="sensor.wasmachine_power" class="sm:col-span-6 px-2.5 py-1.5 rounded-lg bg-white border border-stone-200 text-[11px] font-mono text-[#197447]">
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div class="flex items-center gap-1">
                    <button onclick="window.moveApplianceOrder(${idx}, -1)" class="px-2 py-0.5 rounded bg-white border border-stone-200 text-[11px] font-bold cursor-pointer">↑</button>
                    <button onclick="window.moveApplianceOrder(${idx}, 1)" class="px-2 py-0.5 rounded bg-white border border-stone-200 text-[11px] font-bold cursor-pointer">↓</button>
                </div>
                <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-stone-200">
                        <input type="number" value="${app.watts}" oninput="window.adminUpdateApplianceWatts(${idx}, this.value)" class="w-14 text-xs font-bold text-[#1c2520] focus:outline-none">
                        <span class="text-[11px] text-[#68736d]">W</span>
                    </div>
                    <button onclick="window.adminToggleAppliance(${idx})" class="px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${app.active ? 'bg-[#19975c] text-white' : 'bg-stone-200 text-stone-700'}">
                        ${app.active ? 'AAN' : 'UIT'}
                    </button>
                    <button onclick="window.adminRemoveAppliance(${idx})" class="text-xs font-bold text-red-600 hover:underline px-1.5 cursor-pointer">
                        Verwijder
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

window.adminUpdateApplianceField = function(idx, field, val) {
    if (!appState.appliances?.[idx]) return;
    appState.appliances[idx][field] = val.trim();
    if (discoveredHaEntities.length > 0) applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    renderAll();
    persistStateToFirestore(true);
};

window.moveApplianceOrder = function(idx, dir) {
    const arr = appState.appliances || [];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    const temp = arr[idx];
    arr[idx] = arr[target];
    arr[target] = temp;
    renderAdminAppliancesList();
    renderAll();
    persistStateToFirestore(true);
};

window.adminToggleAppliance = function(idx) {
    if (!appState.appliances[idx]) return;
    appState.appliances[idx].active = !appState.appliances[idx].active;
    renderAdminAppliancesList();
    renderAll();
    persistStateToFirestore(true);
};

window.adminUpdateApplianceWatts = function(idx, val) {
    if (!appState.appliances[idx]) return;
    appState.appliances[idx].watts = parseInt(val, 10) || 0;
    renderAll();
};

window.adminRemoveAppliance = function(idx) {
    appState.appliances.splice(idx, 1);
    renderAdminAppliancesList();
    renderAll();
    persistStateToFirestore(true);
};

window.adminAddAppliance = function() {
    const icon = document.getElementById('newAppIcon').value;
    const name = document.getElementById('newAppName').value.trim();
    const entityId = document.getElementById('newAppEntityId').value.trim();
    const watts = parseInt(document.getElementById('newAppWatts').value, 10) || 0;
    if (!name) {
        showToast("Geef het apparaat een naam (bijv. Wasmachine)");
        return;
    }
    if (!appState.appliances) appState.appliances = [];
    appState.appliances.push({
        id: 'app_' + Date.now(),
        icon,
        name,
        watts,
        entityId,
        active: true
    });
    document.getElementById('newAppName').value = '';
    document.getElementById('newAppEntityId').value = '';
    document.getElementById('newAppWatts').value = '';
    if (discoveredHaEntities.length > 0) applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    renderAdminAppliancesList();
    renderAll();
    persistStateToFirestore(true);
};

function renderAdminLists() {
    const agendaHtml = !appState.agendaItems?.length
        ? `<p class="text-xs text-[#68736d] italic py-2">Geen handmatige afspraken voor vandaag.</p>`
        : appState.agendaItems.map((item, idx) => `
            <div class="flex items-center justify-between bg-[#f6f8f5] px-3.5 py-2.5 rounded-xl text-sm">
                <span><strong>${item.time}</strong> – ${item.title}</span>
                <button onclick="window.adminRemoveAgendaItem(${idx})" class="text-xs font-bold text-red-600 hover:underline cursor-pointer">Verwijder</button>
            </div>
        `).join('');

    const taskHtml = !appState.tasks?.length
        ? `<p class="text-xs text-[#68736d] italic py-2">Geen taken ingesteld.</p>`
        : appState.tasks.map((task, idx) => `
            <div class="flex items-center justify-between bg-[#f6f8f5] px-3.5 py-2.5 rounded-xl text-sm">
                <span>${task.text}</span>
                <button onclick="window.adminRemoveTaskItem(${idx})" class="text-xs font-bold text-red-600 hover:underline cursor-pointer">Verwijder</button>
            </div>
        `).join('');

    const admAg = document.getElementById('adminAgendaList');
    const admTk = document.getElementById('adminTaskList');
    if (admAg) admAg.innerHTML = agendaHtml;
    if (admTk) admTk.innerHTML = taskHtml;

    const userAgendaEl = document.getElementById('userPortalAgendaList');
    const userTaskEl = document.getElementById('userPortalTaskList');
    if (userAgendaEl) userAgendaEl.innerHTML = agendaHtml;
    if (userTaskEl) userTaskEl.innerHTML = taskHtml;
}

const ADMIN_TAB_BASE = 'admin-tab flex items-center justify-center gap-1.5 text-center px-2.5 sm:px-4 py-2.5 rounded-xl text-[13px] sm:text-sm font-bold transition cursor-pointer';

window.switchAdminTab = function(tabName) {
    {
        if (typeof permAdminTabAllowed === 'function' && !permAdminTabAllowed(tabName)) {
            const fallback = permFirstAdminTab();
            if (!fallback) return;
            tabName = fallback;
        }
    }
    if (tabName === 'rechten') renderPermissionsAdmin();
    if (tabName === 'autos') renderAdminCarsList();
    if (tabName === 'evcc') renderAdminEvccList();
    if (tabName === 'muziek') renderAdminMusicList();
    if (tabName === 'weer') renderAdminWeather();
    if (tabName === 'scenes' && typeof renderAdminScenes === 'function') renderAdminScenes();
    if (tabName === 'advies' && typeof renderAdminAdviceAdvanced === 'function') renderAdminAdviceAdvanced();
    if (tabName === 'backup') renderBackupTab();
    if (tabName === 'weergave') renderNotifSettings();
    const tabs = ['gezinnen', 'gebruikers', 'rechten', 'ha_entiteiten', 'tarieven', 'apparaten', 'advies', 'agenda', 'rolluiken_airco', 'weergave', 'autos', 'evcc', 'muziek', 'weer', 'scenes', 'backup'];
    tabs.forEach(t => {
        const tabEl = document.getElementById('adminTab_' + t);
        if (tabEl) tabEl.classList.toggle('hidden', t !== tabName);
        const btn = document.getElementById('adminTabBtn_' + t);
        if (!btn) return;
        const isHidden = btn.classList.contains('hidden');
        if (t === tabName) {
            btn.className = ADMIN_TAB_BASE + ' bg-[#152920] text-white' + (isHidden ? ' hidden' : '');
        } else {
            btn.className = ADMIN_TAB_BASE + ' text-[#49544d] hover:bg-stone-100' + (isHidden ? ' hidden' : '');
        }
    });
};

window.applyAdminChangesLive = function() {
    if (document.getElementById('admVatPercent')) appState.vatPercent = parseFloat(document.getElementById('admVatPercent').value) || 0;
    if (document.getElementById('admFixedDailyCost')) appState.fixedDailyCost = parseFloat(document.getElementById('admFixedDailyCost').value) || 0;
    if (document.getElementById('admTaxPerKwh')) appState.taxPerKwh = parseFloat(document.getElementById('admTaxPerKwh').value) || 0;
    if (document.getElementById('admMarkupPerKwh')) appState.markupPerKwh = parseFloat(document.getElementById('admMarkupPerKwh').value) || 0;
    if (document.getElementById('admApplyFormulaToHours')) appState.applyFormulaToHours = document.getElementById('admApplyFormulaToHours').checked;

    if (document.getElementById('admGasPrice')) appState.gasPricePerM3 = parseFloat(document.getElementById('admGasPrice').value) || 0;
    if (document.getElementById('admWaterPrice')) appState.waterPricePerM3 = parseFloat(document.getElementById('admWaterPrice').value) || 0;
    if (document.getElementById('admKwhImport')) appState.kwhImport = parseFloat(document.getElementById('admKwhImport').value) || 0;
    if (document.getElementById('admKwhExport')) appState.kwhExport = parseFloat(document.getElementById('admKwhExport').value) || 0;
    if (document.getElementById('admKwhSolar')) appState.kwhSolar = parseFloat(document.getElementById('admKwhSolar').value) || 0;
    if (document.getElementById('admGasToday')) appState.gasToday = parseFloat(document.getElementById('admGasToday').value) || 0;

    if (document.getElementById('admWaterRate')) appState.waterRate = parseFloat(document.getElementById('admWaterRate').value) || 0;
    if (document.getElementById('admWaterToday')) appState.waterTodayLiters = parseFloat(document.getElementById('admWaterToday').value) || 0;

    if (document.getElementById('admSolarW')) appState.solarW = parseInt(document.getElementById('admSolarW').value, 10) || 0;
    if (document.getElementById('admHouseW')) appState.houseW = parseInt(document.getElementById('admHouseW').value, 10) || 0;
    if (document.getElementById('admGridW')) appState.gridW = parseInt(document.getElementById('admGridW').value, 10) || 0;
    if (document.getElementById('admGridImportW')) appState.gridImportW = parseInt(document.getElementById('admGridImportW').value, 10) || 0;
    if (document.getElementById('admGridExportW')) appState.gridExportW = parseInt(document.getElementById('admGridExportW').value, 10) || 0;
    if (document.getElementById('admBatteryW')) appState.batteryW = parseInt(document.getElementById('admBatteryW').value, 10) || 0;
    if (document.getElementById('admBatteryMode')) appState.batteryMode = document.getElementById('admBatteryMode').value;
    if (document.getElementById('admBatterySignConvention')) appState.batterySignConvention = document.getElementById('admBatterySignConvention').value;
    if (document.getElementById('admHouseCalcMode')) appState.houseCalcMode = document.getElementById('admHouseCalcMode').value;
    if (document.getElementById('admBatteryPct')) appState.batteryPct = parseInt(document.getElementById('admBatteryPct').value, 10) || 0;
    if (document.getElementById('admBatteryCap')) appState.batteryCap = parseFloat(document.getElementById('admBatteryCap').value) || 0;
    if (document.getElementById('admGasRate')) appState.gasRate = parseFloat(document.getElementById('admGasRate').value) || 0;

    if (document.getElementById('admAutoAdvice')) appState.autoAdvice = document.getElementById('admAutoAdvice').checked;
    if (document.getElementById('admRotateAdvice')) appState.rotateAdvice = document.getElementById('admRotateAdvice').checked;
    if (document.getElementById('admAdviceText')) appState.adviceText = document.getElementById('admAdviceText').value;
    if (document.getElementById('admAdviceBadge')) appState.adviceBadge = document.getElementById('admAdviceBadge').value;

    if (document.getElementById('admGcalUrl')) {
        appState.googleCalendarUrl = normalizeGoogleCalendarEmbedUrl(document.getElementById('admGcalUrl').value.trim());
    }

    if (document.getElementById('admWasteEnabled')) appState.wasteEnabled = document.getElementById('admWasteEnabled').checked;
    if (document.getElementById('admWasteType')) appState.wasteType = document.getElementById('admWasteType').value;
    if (document.getElementById('admWastePostal')) appState.wastePostal = document.getElementById('admWastePostal').value;
    if (document.getElementById('admWasteDate')) appState.wasteDate = document.getElementById('admWasteDate').value;
    if (document.getElementById('admWasteDesc')) appState.wasteDesc = document.getElementById('admWasteDesc').value;

    if (document.getElementById('admStatusText')) appState.statusText = document.getElementById('admStatusText').value;
    if (document.getElementById('admHaUrl')) appState.haUrl = document.getElementById('admHaUrl').value;
    if (document.getElementById('admHaToken')) appState.haToken = document.getElementById('admHaToken').value;

    window.saveEntityMapping();
    pushLivePowerPoint(appState.solarW, appState.houseW);
    renderAll();
};
