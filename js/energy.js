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
        container.innerHTML = '';
        return;
    }

    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    // Elk apparaat houdt zijn eigen vaste kleur (op volgorde in de lijst)
    const APP_COLORS = ['#e6862a', '#d6447e', '#0f9aa8', '#6b8e23', '#5568d3', '#c2503a', '#8b5cf6', '#b8860b'];
    const mix = (hex, pct) => {            // meng met wit: pct = aandeel wit
        const n = parseInt(hex.slice(1), 16);
        const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => Math.round(v + (255 - v) * pct));
        return `rgb(${c[0]},${c[1]},${c[2]})`;
    };
    const LINE_OFF = '#dfe4e1';
    const perRow = 5;
    const rows = [];
    for (let i = 0; i < list.length; i += perRow) rows.push({ start: i, items: list.slice(i, i + perRow) });

    container.innerHTML = rows.map(({ start, items: row }) => {
        const n = row.length;
        const W = 300, H = 40, center = W / 2;
        const gap = Math.min(12, 36 / Math.max(1, n));
        const geo = row.map((app, i) => ({
            i, app, color: APP_COLORS[(start + i) % APP_COLORS.length], on: isRunning(app),
            sx: Math.round((center + (i - (n - 1) / 2) * gap) * 10) / 10,
            cx: Math.round((i + 0.5) * W / n)
        }));
        // Elke lijn krijgt een eigen hoogte voor het zijwaartse stuk, zodat lijnen elkaar nooit kruisen of overlappen:
        // hoe verder naar buiten, hoe lager de baan.
        const assignLanes = (group) => {
            group.sort((a, b) => Math.abs(b.cx - center) - Math.abs(a.cx - center));
            group.forEach((g, j) => { g.lane = group.length === 1 ? 22 : Math.round(31 - j * (19 / (group.length - 1))); });
        };
        assignLanes(geo.filter(g => g.cx < center - 1));
        assignLanes(geo.filter(g => g.cx > center + 1));

        const cards = geo.map(({ app, color, on }) => `
                <div class="app-node ${on ? 'is-on' : 'is-off'} flex flex-col items-center text-center px-1 py-2 rounded-2xl min-w-0" style="--c:${color}">
                    <div class="app-node-ico w-7 h-7 rounded-full flex items-center justify-center text-sm mb-1 shadow-2xs">${esc(app.icon || '🔌')}</div>
                    <p class="app-node-name text-[11px] font-bold w-full truncate px-0.5" title="${esc(app.name)}">${esc(app.name)}</p>
                    ${on
                        ? `<p class="app-node-val text-xs font-extrabold leading-tight">${Number(app.watts)} <span class="text-[10px] font-normal">W</span></p>`
                        : `<p class="text-[10px] font-medium text-[#68736d] leading-tight">Uit</p>`}
                </div>`).join('');

        const paths = geo.map(({ app, color, on, sx, cx, lane }) => {
            const d = lane === undefined
                ? `M ${cx} ${H} L ${cx} 4`
                : `M ${sx} ${H} L ${sx} ${lane} L ${cx} ${lane} L ${cx} 4`;
            const head = on ? `<path d="M ${cx - 4} 9 L ${cx} 3 L ${cx + 4} 9" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` : '';
            const dur = Math.max(1.5, Math.min(3.4, 3.4 - Number(app.watts || 0) / 900));   // meer verbruik = sneller
            const dots = on ? [0, 1, 2].map(k => `<circle r="3.2" fill="${color}"><animateMotion dur="${dur.toFixed(1)}s" begin="${(-k * dur / 3).toFixed(2)}s" repeatCount="indefinite" path="${d}"/></circle>`).join('') : '';
            return `<path d="${d}" stroke="${on ? mix(color, 0.55) : LINE_OFF}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>${head}${dots}`;
        }).join('');

        return `
            <div class="mb-0">
                <div class="grid gap-2" style="grid-template-columns: repeat(${n}, minmax(0, 1fr));">${cards}</div>
                <svg class="w-full h-10 block overflow-visible" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" fill="none" aria-hidden="true">${paths}</svg>
            </div>`;
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
