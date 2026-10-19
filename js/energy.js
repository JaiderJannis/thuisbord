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
    if (!container) return;
    const list = appState.appliances || [];
    const isRunning = (a) => !!a.active && Number(a.watts) > 0;
    const activeCount = list.filter(isRunning).length;
    if (countBadge) countBadge.textContent = `${activeCount} actief`;

    if (list.length === 0) {
        container.innerHTML = `<p class="text-[11px] text-[#68736d] italic">Geen extra apparaten gekoppeld.</p>`;
        return;
    }

    const totalW = list.filter(isRunning).reduce((sum, a) => sum + Number(a.watts || 0), 0);
    const lineOn = '#8ebd9f';
    const lineOff = '#d9e0dc';
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // Huis-label bovenaan; daaronder krijgt elk apparaat zijn eigen flowlijn (eigen pad, eigen bewegend bolletje)
    const houseNode = `
        <div class="flex justify-center mt-2.5">
            <div class="flex items-center justify-center gap-1.5 px-3 py-1 rounded-full bg-[#dcece3] text-[#1c643f] border-2 border-white shadow-2xs w-[78%]">
                <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9.5z"/></svg>
                <span class="text-[11px] font-extrabold truncate">${totalW > 0 ? `${totalW} W naar apparaten · ${activeCount} actief` : 'Huis → apparaten'}</span>
            </div>
        </div>`;

    // Rijen van maximaal 4 apparaten
    const perRow = 4;
    const rows = [];
    for (let i = 0; i < list.length; i += perRow) rows.push(list.slice(i, i + perRow));

    const rowsHtml = rows.map((row, rowIdx) => {
        const n = row.length;
        const W = 300, H = 34, mid = 15;
        const gap = Math.min(30, 150 / Math.max(1, n));          // startpunten verspreid onder het huis-label
        const paths = row.map((app, i) => {
            const on = isRunning(app);
            const sx = Math.round(W / 2 + (i - (n - 1) / 2) * gap);
            const cx = Math.round((i + 0.5) * W / n);
            const d = `M ${sx} 0 L ${sx} ${mid} L ${cx} ${mid} L ${cx} ${H - 3}`;
            const head = on ? `<path d="M ${cx - 3.5} ${H - 8} L ${cx} ${H - 2} L ${cx + 3.5} ${H - 8}" stroke="#19975c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` : '';
            const dot = on ? `<circle r="3.2" fill="#19975c"><animateMotion dur="${(1.6 + (i % 3) * 0.3).toFixed(1)}s" repeatCount="indefinite" path="${d}"/></circle>` : '';
            return `<path d="${d}" stroke="${on ? '#8ebd9f' : lineOff}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>${head}${dot}`;
        }).join('');
        const chips = row.map((app) => {
            const on = isRunning(app);
            return `
                <div class="w-full flex flex-col items-center text-center px-1 py-1.5 rounded-xl border ${on ? 'bg-[#f4fbf7] border-[#bce3ce]' : 'bg-stone-50/70 border-stone-200/60 opacity-70'}">
                    <span class="text-base leading-none">${esc(app.icon || '🔌')}</span>
                    <span class="text-[10px] font-bold text-[#1c2520] w-full truncate mt-0.5" title="${esc(app.name)}">${esc(app.name)}</span>
                    ${on
                        ? `<span class="text-[11px] font-extrabold text-[#197447] leading-tight">${Number(app.watts)} W</span>`
                        : `<span class="text-[10px] font-medium text-[#68736d] leading-tight">Uit</span>`}
                </div>`;
        }).join('');
        return `
            <div class="${rowIdx > 0 ? 'mt-1' : ''}">
                <svg class="w-full block overflow-visible" style="height:auto" viewBox="0 0 ${W} ${H}" fill="none" aria-hidden="true">${paths}</svg>
                <div class="grid gap-1" style="grid-template-columns: repeat(${n}, minmax(0, 1fr));">${chips}</div>
            </div>`;
    }).join('');

    container.innerHTML = houseNode + rowsHtml;
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
