'use strict';
/* Algemene UI: toast, menu, view-wissel, klok, fullscreen en renderAll() */

function showToast(message) {
    const toast = document.getElementById('toastBanner');
    document.getElementById('toastMessage').textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('flex');
    setTimeout(() => {
        toast.classList.add('hidden');
        toast.classList.remove('flex');
    }, 3200);
}

window.copyCorsYamlSnippet = function() {
    const yamlText = `http:\n  cors_allowed_origins:\n    - ${window.location.origin}\n    - https://jaiderjannis.github.io`;
    const temp = document.createElement('textarea');
    temp.value = yamlText;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    showToast("YAML gekopieerd naar je klembord!");
};

window.toggleLiveTickerMode = function(enabled) {
    liveTickerEnabled = !!enabled;
    showToast(liveTickerEnabled ? "Live 2-seconden verversing actief" : "Enkel gekoppelde HA sensoren verversen");
};

window.toggleHamburgerMenu = function(open) {
    const overlay = document.getElementById('hamburgerOverlay');
    const drawer = document.getElementById('hamburgerDrawer');
    if (!overlay || !drawer) return;
    if (open) {
        overlay.classList.remove('hidden');
        drawer.classList.remove('translate-x-full');
    } else {
        overlay.classList.add('hidden');
        drawer.classList.add('translate-x-full');
    }
};

function flashElementOnUpdate(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.classList.add('text-[#19975c]', 'transition-colors', 'duration-300');
    setTimeout(() => {
        el.classList.remove('text-[#19975c]');
    }, 550);
}

function renderAll() {
    syncActiveHouseholdPointer();
    applyBackgroundFromState();
    document.getElementById('haStatusText').textContent = appState.statusText || 'Live via Home Assistant';
    document.getElementById('householdNamePill').textContent = `🏡 Huishouden: ${appState.householdName || activeHouseholdName}`;
    const householdLine = document.getElementById('householdNameLine');
    if (householdLine) householdLine.textContent = `🏡 ${appState.householdName || activeHouseholdName}`;
    const adminHouseholdBadge = document.getElementById('activeAdminHouseholdBadge');
    if (adminHouseholdBadge) adminHouseholdBadge.textContent = `🏡 Gezin: ${activeHouseholdName}`;

    renderPulseLampBadges();

    document.getElementById('valSolar').textContent = appState.solarW;
    document.getElementById('valHouse').textContent = appState.houseW;

    const gridImportW = Number(appState.gridImportW ?? appState.gridW ?? 0);
    const gridExportW = Number(appState.gridExportW ?? 0);
    const isExportingToGrid = gridExportW > gridImportW;
    const activeGridW = isExportingToGrid ? gridExportW : gridImportW;

    document.getElementById('valGrid').textContent = activeGridW;
    const gridImpSub = document.getElementById('valGridImportSub');
    const gridExpSub = document.getElementById('valGridExportSub');
    if (gridImpSub) gridImpSub.textContent = gridImportW;
    if (gridExpSub) gridExpSub.textContent = gridExportW;

    const netArrowEl = document.getElementById('netArrow');
    const netStatusLabel = document.getElementById('netStatusLabel');
    const arrowLeftToHouse = document.getElementById('gridArrowLeftToHouse');
    const arrowRightToGrid = document.getElementById('gridArrowRightToGrid');
    const gridDot1 = document.getElementById('gridDot1');
    const gridDot2 = document.getElementById('gridDot2');
    const gridLineTrack = document.getElementById('gridLineTrack');

    if (isExportingToGrid) {
        netArrowEl.textContent = '↑';
        netArrowEl.className = 'text-[#19975c] font-bold';
        if (netStatusLabel) netStatusLabel.textContent = 'Net (Export)';
        if (arrowLeftToHouse) arrowLeftToHouse.classList.add('hidden');
        if (arrowRightToGrid) arrowRightToGrid.classList.remove('hidden');
        if (gridLineTrack) gridLineTrack.className = 'h-[2px] w-full bg-[#bce3ce]';
        if (gridDot1) gridDot1.className = 'w-2 h-2 rounded-full bg-[#19975c] dot-flow-right';
        if (gridDot2) gridDot2.className = 'w-2 h-2 rounded-full bg-[#19975c] dot-flow-right';
    } else {
        netArrowEl.textContent = '↓';
        netArrowEl.className = 'text-[#3b6998] font-bold';
        if (netStatusLabel) netStatusLabel.textContent = 'Net (Import)';
        if (arrowLeftToHouse) arrowLeftToHouse.classList.remove('hidden');
        if (arrowRightToGrid) arrowRightToGrid.classList.add('hidden');
        if (gridLineTrack) gridLineTrack.className = 'h-[2px] w-full bg-[#c5d4eb]';
        if (gridDot1) gridDot1.className = 'w-2 h-2 rounded-full bg-[#7897c9] dot-flow-left';
        if (gridDot2) gridDot2.className = 'w-2 h-2 rounded-full bg-[#7897c9] dot-flow-left';
    }

    document.getElementById('valBatteryW').textContent = appState.batteryW;
    document.getElementById('valBatteryPct').textContent = appState.batteryPct;
    document.getElementById('valBatteryCap').textContent = formatNum(appState.batteryCap, 1);

    const isDischarging = (appState.batteryMode || 'discharging') === 'discharging';
    const batBranchPath = document.getElementById('batteryBranchPath');
    const batArrowCharge = document.getElementById('batteryArrowCharge');
    const batArrowDischarge = document.getElementById('batteryArrowDischarge');
    const batDotCharge = document.getElementById('batteryFlowDotCharge');
    const batDotDischarge = document.getElementById('batteryFlowDotDischarge');
    const batModePill = document.getElementById('batteryModePill');

    if (Number(appState.batteryW) <= 0) {
        if (batDotCharge) batDotCharge.classList.add('hidden');
        if (batDotDischarge) batDotDischarge.classList.add('hidden');
        if (batModePill) {
            batModePill.textContent = 'Rust';
            batModePill.className = 'text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-stone-200 text-stone-600';
        }
    } else if (isDischarging) {
        if (batBranchPath) batBranchPath.setAttribute('stroke', '#8ebd9f');
        if (batArrowCharge) batArrowCharge.classList.add('hidden');
        if (batArrowDischarge) batArrowDischarge.classList.remove('hidden');
        if (batDotCharge) batDotCharge.classList.add('hidden');
        if (batDotDischarge) batDotDischarge.classList.remove('hidden');
        if (batModePill) {
            batModePill.textContent = '↑ Naar Huis';
            batModePill.className = 'text-[9px] font-extrabold px-1.5 py-0.2 rounded-full bg-[#dcece3] text-[#197447]';
        }
    } else {
        if (batBranchPath) batBranchPath.setAttribute('stroke', '#f3d078');
        if (batArrowCharge) batArrowCharge.classList.remove('hidden');
        if (batArrowDischarge) batArrowDischarge.classList.add('hidden');
        if (batDotCharge) batDotCharge.classList.remove('hidden');
        if (batDotDischarge) batDotDischarge.classList.add('hidden');
        if (batModePill) {
            batModePill.textContent = '↓ Laden';
            batModePill.className = 'text-[9px] font-extrabold px-1.5 py-0.2 rounded-full bg-[#faecc8] text-[#b47b1c]';
        }
    }

    document.getElementById('valGasRate').textContent = formatNum(appState.gasRate, 2);
    document.getElementById('valGasToday').textContent = formatNum(appState.gasToday, 2);
    document.getElementById('valWaterRate').textContent = formatNum(appState.waterRate, 1);
    document.getElementById('valWaterToday').textContent = Math.round(appState.waterTodayLiters || 0);

    const waterDot = document.getElementById('waterFlowDot');
    if (waterDot) waterDot.style.display = Number(appState.waterRate) > 0 ? 'block' : 'none';

    renderDisplayAppliancesFlow();
    renderLiveMovingGraph();

    // Column 2: Automatisch berekende dagkosten
    const effectiveToday = getEffectivePricesArray('today');
    const currentHourPrice = effectiveToday[new Date().getHours()] ?? 0.25;
    const autoElecCost = Number(appState.kwhImport) * currentHourPrice;
    const autoGasCost = Number(appState.gasToday) * Number(appState.gasPricePerM3);
    const waterM3 = (Number(appState.waterTodayLiters) || 0) / 1000;
    const waterCost = waterM3 * (Number(appState.waterPricePerM3) || 0);
    const fixedCost = Number(appState.fixedDailyCost) || 0;
    const totalCost = autoElecCost + autoGasCost + waterCost + fixedCost;

    document.getElementById('costTotal').textContent = formatEuro(totalCost);
    document.getElementById('costElec').textContent = formatEuro(autoElecCost);
    document.getElementById('costGas').textContent = formatEuro(autoGasCost);
    document.getElementById('costWater').textContent = formatEuro(waterCost);
    document.getElementById('costFixed').textContent = formatEuro(fixedCost);

    document.getElementById('kwhImport').textContent = `${formatNum(appState.kwhImport, 2)} kWh`;
    document.getElementById('kwhSolar').textContent = formatNum(appState.kwhSolar, 1);
    document.getElementById('kwhExport').textContent = `${formatNum(appState.kwhExport, 1)} kWh`;

    renderSelfUseStats();

    // Piekverbruik huidige maand: enkel zichtbaar als er een entiteit aan gekoppeld is
    const peakRow = document.getElementById('rowMonthlyPeak');
    if (peakRow) {
        const hasPeakEntity = !!((appState.entityMap || {}).monthlyPeakW || '').trim();
        peakRow.classList.toggle('hidden', !hasPeakEntity);
        peakRow.classList.toggle('flex', hasPeakEntity);
        const peakEl = document.getElementById('valMonthlyPeak');
        if (peakEl) peakEl.textContent = (hasPeakEntity && Number(appState.monthlyPeakW) > 0)
            ? `${formatNum(Number(appState.monthlyPeakW) / 1000, 2)} kW` : '—';
    }
    document.getElementById('m3GasTotal').textContent = `${formatNum(appState.gasToday, 2)} m³`;
    document.getElementById('litersWaterTotal').textContent = `${Math.round(appState.waterTodayLiters || 0)} L (${formatNum(waterM3, 2)} m³)`;

    document.getElementById('displayVatBadge').textContent = `BTW: ${appState.vatPercent}% incl.`;
    document.getElementById('displayGasPriceBadge').textContent = `Gas: ${formatEuro(appState.gasPricePerM3)}/m³`;
    document.getElementById('displayWaterPriceBadge').textContent = `Water: ${formatEuro(appState.waterPricePerM3)}/m³`;

    renderPriceBars();
    renderAdviceBanner();
    renderDisplayAgenda();
    renderDisplayTasks();
    renderDisplayWaste();
    renderGoogleCalendarTab();
    renderActiveLightsBadgeAndModal();
    renderShuttersView();
    renderRobotsMaintenanceView();
    renderCarsView();
    renderNotifications();
    recordDailyHistory();
    renderOverviewView();
}

window.switchView = function(view) {
    if (!currentRole) {
        view = 'login';
    } else if (view === 'admin' && currentRole !== 'manager' && currentRole !== 'admin') {
        view = 'display';
    }
    if (view === 'userPortal') view = 'calendar';
    if (view === 'climate') {
        activeRoomsFilter = 'all';
        view = 'shutters';
    }
    // Rechten: een scherm dat niet mag, leidt terug naar het wanddisplay
    if (view !== 'login' && view !== 'display' && typeof permViewAllowed === 'function' && !permViewAllowed(view)) {
        showToast("Je hebt hiervoor geen toestemming. Vraag het aan de beheerder.");
        view = 'display';
    }
    window.currentViewName = view;

    document.getElementById('viewDisplay').classList.toggle('hidden', view !== 'display');
    document.getElementById('viewDisplay').classList.toggle('flex', view === 'display');

    const vCal = document.getElementById('viewCalendar');
    if (vCal) {
        vCal.classList.toggle('hidden', view !== 'calendar');
        vCal.classList.toggle('flex', view === 'calendar');
        if (view === 'calendar') {
            renderAdminLists();
            renderGoogleCalendarTab();
        }
    }

    const vShutters = document.getElementById('viewShutters');
    if (vShutters) {
        vShutters.classList.toggle('hidden', view !== 'shutters');
        vShutters.classList.toggle('flex', view === 'shutters');
        if (view === 'shutters') renderShuttersView();
    }

    const vRobots = document.getElementById('viewRobots');
    if (vRobots) {
        vRobots.classList.toggle('hidden', view !== 'robots');
        vRobots.classList.toggle('flex', view === 'robots');
        if (view === 'robots') renderRobotsMaintenanceView();
    }

    const vCars = document.getElementById('viewCars');
    if (vCars) {
        vCars.classList.toggle('hidden', view !== 'cars');
        vCars.classList.toggle('flex', view === 'cars');
        if (view === 'cars') renderCarsView();
    }

    const vOverview = document.getElementById('viewOverview');
    if (vOverview) {
        vOverview.classList.toggle('hidden', view !== 'overview');
        vOverview.classList.toggle('flex', view === 'overview');
        if (view === 'overview') renderOverviewView();
    }

    document.getElementById('viewLogin').classList.toggle('hidden', view !== 'login');
    document.getElementById('viewLogin').classList.toggle('flex', view === 'login');

    document.getElementById('viewAdmin').classList.toggle('hidden', view !== 'admin');

    const topSystemNav = document.getElementById('topSystemNav');
    if (topSystemNav) {
        const showSubBar = currentRole && view !== 'display' && view !== 'login';
        topSystemNav.classList.toggle('hidden', !showSubBar);
        topSystemNav.classList.toggle('flex', !!showSubBar);
    }

    const btnDisplay = document.getElementById('navBtnDisplay');
    const btnRooms = document.getElementById('navBtnRooms');
    const btnRobots = document.getElementById('navBtnRobots');
    const btnOverview = document.getElementById('navBtnOverview');
    const btnCars = document.getElementById('navBtnCars');
    const btnCal = document.getElementById('navBtnCalendar');
    const btnAdmin = document.getElementById('navBtnAdmin');

    const tileBase = 'nav-tile relative flex flex-col items-center justify-center text-center gap-1 px-2 py-4 rounded-2xl transition cursor-pointer';
    const activeClass = tileBase + ' font-bold bg-white text-[#152920]';
    const inactiveClass = tileBase + ' font-semibold bg-white/10 hover:bg-white/20 text-white';

    if (btnDisplay) btnDisplay.className = view === 'display' ? activeClass : inactiveClass;
    if (btnRooms) btnRooms.className = view === 'shutters' ? activeClass : inactiveClass;
    if (btnRobots) btnRobots.className = view === 'robots' ? activeClass : inactiveClass;
    if (btnOverview) btnOverview.className = view === 'overview' ? activeClass : inactiveClass;
    if (btnCars) btnCars.className = view === 'cars' ? activeClass : inactiveClass;
    if (btnCal) btnCal.className = view === 'calendar' ? activeClass : inactiveClass;
    if (btnAdmin) btnAdmin.className = (view === 'admin' ? activeClass : inactiveClass) + ' col-span-2';

    updateNavigationAndRoleVisibility();
};

window.toggleFullScreen = function() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
};

function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('liveClock').textContent = `${hours}:${mins}`;
    const timeLabel = document.getElementById('liveGraphTimeLabel');
    if (timeLabel) timeLabel.textContent = `live (${hours}:${mins}:${secs})`;

    const formatter = new Intl.DateTimeFormat('nl-NL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    });
    document.getElementById('liveDate').textContent = formatter.format(now);
    const dm = document.getElementById('liveDateMobile');
    if (dm) dm.textContent = formatter.format(now);
}
