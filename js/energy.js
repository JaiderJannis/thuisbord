'use strict';
/* Live vermogen, grafiek, simulatie en apparatenstroom */

function pushLivePowerPoint(solarW, houseW) {
    if (!Array.isArray(appState.powerHistory)) appState.powerHistory = [];
    appState.powerHistory.push({
        s: Math.max(0, Number(solarW) || 0),
        h: Math.max(0, Number(houseW) || 0)
    });
    if (appState.powerHistory.length > 24) {
        appState.powerHistory.shift();
    }
    renderLiveMovingGraph();
}

function renderLiveMovingGraph() {
    const history = appState.powerHistory || [];
    if (history.length < 2) return;

    const maxVal = Math.max(500, ...history.map(p => Math.max(p.s, p.h))) * 1.15;
    const width = 235;
    const height = 78;
    const stepX = width / (history.length - 1);

    const solarPoints = history.map((pt, i) => {
        const x = Math.round(i * stepX);
        const y = Math.round(height - (pt.s / maxVal) * (height - 10));
        return `${x} ${y}`;
    });

    const housePoints = history.map((pt, i) => {
        const x = Math.round(i * stepX);
        const y = Math.round(height - (pt.h / maxVal) * (height - 10));
        return `${x} ${y}`;
    });

    const solarLineD = "M " + solarPoints.join(" L ");
    const solarAreaD = solarLineD + ` L ${width} 80 L 0 80 Z`;
    const houseLineD = "M " + housePoints.join(" L ");

    const solarAreaEl = document.getElementById('liveSolarAreaPath');
    const solarLineEl = document.getElementById('liveSolarLinePath');
    const houseLineEl = document.getElementById('liveHouseLinePath');
    const solarDot = document.getElementById('liveSolarEndDot');
    const houseDot = document.getElementById('liveHouseEndDot');

    if (solarAreaEl) solarAreaEl.setAttribute('d', solarAreaD);
    if (solarLineEl) solarLineEl.setAttribute('d', solarLineD);
    if (houseLineEl) houseLineEl.setAttribute('d', houseLineD);

    const lastSolarY = Math.round(height - (history[history.length - 1].s / maxVal) * (height - 10));
    const lastHouseY = Math.round(height - (history[history.length - 1].h / maxVal) * (height - 10));

    if (solarDot) { solarDot.setAttribute('cx', width); solarDot.setAttribute('cy', lastSolarY); }
    if (houseDot) { houseDot.setAttribute('cx', width); houseDot.setAttribute('cy', lastHouseY); }
}

function renderDisplayAppliancesFlow() {
            const container = document.getElementById('appliancesFlowContainer');
            const countBadge = document.getElementById('activeAppliancesCount');
            const list = appState.appliances || [];
            const activeCount = list.filter(a => a.active && Number(a.watts) > 0).length;
            if(countBadge) countBadge.textContent = `${activeCount} actief`;

            if (!container) return;
            if (list.length === 0) {
                container.innerHTML = `<p class="text-[11px] text-[#68736d] italic">Geen extra apparaten gekoppeld.</p>`;
                return;
            }

            container.innerHTML = list.map((app) => {
                const isRunning = app.active && Number(app.watts) > 0;
                return `
                    <div class="flex items-center justify-between px-2.5 py-2 rounded-xl border ${isRunning ? 'bg-[#f4fbf7] border-[#bce3ce] shadow-2xs' : 'bg-stone-50/70 border-stone-200/60 opacity-65'}">
                        <div class="flex items-center gap-3 w-full">
                            ${isRunning ? `
                                <!-- Mini-huisje met flow naar apparaat -->
                                <div class="flex items-center gap-1 w-16 shrink-0">
                                    <div class="w-5 h-5 rounded-full bg-[#dcece3] flex items-center justify-center text-[10px] shadow-2xs z-10 border border-white">🏠</div>
                                    <div class="flex-1 flex items-center relative overflow-hidden h-2">
                                        <div class="h-[2px] w-full bg-[#bce3ce]"></div>
                                        <span class="w-1.5 h-1.5 rounded-full bg-[#19975c] absolute dot-flow-right"></span>
                                    </div>
                                    <svg class="w-2.5 h-2.5 text-[#19975c] -ml-1 shrink-0" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
                                    </svg>
                                </div>
                            ` : `
                                <div class="w-16 shrink-0 flex items-center justify-center">
                                    <span class="text-[10px] text-stone-300">---</span>
                                </div>
                            `}
                            <div class="flex items-center gap-2 min-w-0 flex-1">
                                <div class="w-7 h-7 rounded-lg ${isRunning ? 'bg-white shadow-2xs text-[#1c2520]' : 'bg-transparent text-stone-500'} flex items-center justify-center text-sm shrink-0 border border-transparent">
                                    ${app.icon || '🔌'}
                                </div>
                                <span class="text-xs font-bold ${isRunning ? 'text-[#1c2520]' : 'text-stone-500'} truncate">${app.name}</span>
                            </div>
                            <div class="flex items-center justify-end shrink-0 pl-2">
                                ${isRunning ? `
                                    <span class="text-xs font-extrabold text-[#197447] bg-[#e8f2ec] px-2 py-0.5 rounded-md border border-[#bce3ce]">${app.watts} W</span>
                                ` : `
                                    <span class="text-[10px] font-medium text-[#68736d]">Uit (0W)</span>
                                `}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

function tickLiveEnergyMetrics() {
    const em = appState.entityMap || {};

    if (!em.solarW || !discoveredHaEntities.length) {
        const deltaSolar = Math.round((Math.random() - 0.47) * 14);
        const nextSolar = Math.max(15, Math.min(4200, (Number(appState.solarW) || 220) + deltaSolar));
        if (nextSolar !== appState.solarW) flashElementOnUpdate('valSolar');
        appState.solarW = nextSolar;
        appState.kwhSolar = Number((Number(appState.kwhSolar) + (appState.solarW / 1800000)).toFixed(2));
    }

    if (!em.houseW || !discoveredHaEntities.length) {
        const deltaHouse = Math.round((Math.random() - 0.49) * 11);
        const nextHouse = Math.max(45, Math.min(5500, (Number(appState.houseW) || 95) + deltaHouse));
        if (nextHouse !== appState.houseW) flashElementOnUpdate('valHouse');
        appState.houseW = nextHouse;
    }

    if ((!em.gridImportW && !em.gridExportW && !em.gridW) || !discoveredHaEntities.length) {
        const isDischarging = (appState.batteryMode || 'discharging') === 'discharging';
        const batContribution = isDischarging ? Number(appState.batteryW) : -Number(appState.batteryW);
        const netBalance = appState.houseW - appState.solarW - batContribution;

        if (netBalance >= 0) {
            appState.gridImportW = Math.max(2, Math.round(netBalance));
            appState.gridExportW = 0;
            appState.gridW = appState.gridImportW;
        } else {
            appState.gridImportW = 0;
            appState.gridExportW = Math.round(Math.abs(netBalance));
            appState.gridW = appState.gridExportW;
        }
        flashElementOnUpdate('valGrid');
    }

    if (!em.batteryW || !discoveredHaEntities.length) {
        const nextBatW = Math.max(25, Math.min(2500, (Number(appState.batteryW) || 143) + Math.round((Math.random() - 0.5) * 10)));
        if (nextBatW !== appState.batteryW) flashElementOnUpdate('valBatteryW');
        appState.batteryW = nextBatW;
    }

    (appState.appliances || []).forEach(app => {
        if (app.active && !app.entityId && Number(app.watts) > 0) {
            const appDelta = Math.round((Math.random() - 0.48) * 9);
            app.watts = Math.max(12, Number(app.watts) + appDelta);
        }
    });

    if ((!em.waterRate || !discoveredHaEntities.length) && Number(appState.waterRate) > 0) {
        const waterDelta = (Math.random() - 0.5) * 0.4;
        appState.waterRate = Math.max(0.5, Number((Number(appState.waterRate) + waterDelta).toFixed(1)));
    }

    pushLivePowerPoint(appState.solarW, appState.houseW);
    renderAll();
}
