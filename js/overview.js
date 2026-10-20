'use strict';
/* Overzicht: maand- en jaartotalen uit appState.history (zie stats.js), met staafgrafiek, tabel en CSV-export.
   Kleuren: vaste categorische slots (identiteit volgt de grootheid): afname blauw, zon oranje, teruglevering aqua. */

const OVERVIEW_METRICS = [
    { key: 'i', label: 'Afname',        unit: 'kWh', color: '#2a78d6', dec: 1 },
    { key: 's', label: 'Zon opgewekt',  unit: 'kWh', color: '#eb6834', dec: 1 },
    { key: 'e', label: 'Teruglevering', unit: 'kWh', color: '#1baf7a', dec: 1 },
    { key: 'g', label: 'Gas',           unit: 'm³',  color: '#6250d6', dec: 2 },
    { key: 'w', label: 'Water',         unit: 'L',   color: '#e87ba4', dec: 0 },
    { key: 'c', label: 'Kosten',        unit: '€',   color: '#eda100', dec: 2 }
];
const OV_MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const OV_MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

const OV_DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
function ovMonday(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function ovKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
// De 7 dagen van de gekozen week: { date, key, e (of undefined) }
function ovWeekDays(start) {
    const h = appState.history || {};
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i); const key = ovKey(d); return { date: d, key, e: h[key] }; });
}
function ovWeekTotals(start) {
    const t = emptyTotals();
    ovWeekDays(start).forEach(d => { if (d.e) addEntryToTotals(t, d.e); });
    return finishTotals(t);
}
function ovPrevMonth() { let m = overviewState.month - 1, y = overviewState.year; if (m < 1) { m = 12; y--; } return [y, m]; }
function ovPrevTotals() {
    if (overviewState.mode === 'week') return ovWeekTotals(new Date(overviewState.weekStart.getFullYear(), overviewState.weekStart.getMonth(), overviewState.weekStart.getDate() - 7));
    if (overviewState.mode === 'month') { const [y, m] = ovPrevMonth(); return totalsForMonth(y, m); }
    return totalsForYear(overviewState.year - 1).total;
}
// Verschil met vorige periode als kleine tekst: dalend = groen voor verbruik en kosten
function ovDelta(cur, prev, lowerIsBetter = true) {
    if (!(prev > 0) || !(cur >= 0)) return '';
    const p = ((cur - prev) / prev) * 100;
    if (Math.abs(p) < 1) return '<span class="text-[#68736d]">≈ vorige periode</span>';
    const good = lowerIsBetter ? p < 0 : p > 0;
    return `<span class="${good ? 'text-[#197447]' : 'text-[#9e4516]'} font-bold">${p > 0 ? '▲' : '▼'} ${Math.abs(Math.round(p))}% t.o.v. vorige</span>`;
}

const overviewState = { mode: 'month', weekStart: ovMonday(new Date()), year: new Date().getFullYear(), month: new Date().getMonth() + 1, metric: 'i', table: false };

function ovFmt(n, dec = 1) {
    return (Number(n) || 0).toLocaleString('nl-BE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function ovFmtMetric(m, v) {
    return m.unit === '€' ? `€ ${ovFmt(v, m.dec)}` : `${ovFmt(v, m.dec)} ${m.unit}`;
}
function ovPct(p) { return p === null || p === undefined ? '—' : `${Math.round(p)}%`; }

function ovNiceStep(rough) {
    if (!(rough > 0)) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const f = rough / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

// Elke kolom: { label, value (of null = geen gegevens), tip }
function ovBuildColumns(metric) {
    const m = OVERVIEW_METRICS.find(x => x.key === metric) || OVERVIEW_METRICS[0];
    const cols = [];
    if (overviewState.mode === 'week') {
        const names = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
        ovWeekDays(overviewState.weekStart).forEach(d => {
            cols.push({
                label: `${OV_DAYS[d.date.getDay()]} ${d.date.getDate()}`,
                value: d.e ? (d.e[metric] || 0) : null,
                tip: `${names[d.date.getDay()]} ${d.date.getDate()} ${OV_MONTHS[d.date.getMonth()]}: ${d.e ? ovFmtMetric(m, d.e[metric] || 0) : 'geen gegevens'}`
            });
        });
    } else if (overviewState.mode === 'month') {
        const dim = new Date(overviewState.year, overviewState.month, 0).getDate();
        const byDay = new Map(historyDaysOfMonth(overviewState.year, overviewState.month).map(d => [d.day, d.e]));
        for (let d = 1; d <= dim; d++) {
            const e = byDay.get(d);
            cols.push({
                label: String(d),
                value: e ? (e[metric] || 0) : null,
                tip: `${d} ${OV_MONTHS[overviewState.month - 1]}: ${e ? ovFmtMetric(m, e[metric] || 0) : 'geen gegevens'}`
            });
        }
    } else {
        const { months } = totalsForYear(overviewState.year);
        months.forEach((t, i) => cols.push({
            label: OV_MONTHS_SHORT[i],
            value: t.days ? (t[metric] || 0) : null,
            tip: `${OV_MONTHS[i]} ${overviewState.year}: ${t.days ? ovFmtMetric(m, t[metric] || 0) : 'geen gegevens'}`
        }));
    }
    return { m, cols };
}

function ovChartSvg(metric) {
    const { m, cols } = ovBuildColumns(metric);
    const W = 720, H = 250, L = 46, R = 8, T = 10, B = 26;
    const pw = W - L - R, ph = H - T - B;
    const max = Math.max(0, ...cols.map(c => c.value || 0));
    const step = ovNiceStep(max / 4 || 1);
    const top = Math.max(step * 4, step * Math.ceil(max / step));
    const y = v => T + ph - (v / top) * ph;
    const slot = pw / cols.length;
    const bw = Math.max(3, Math.min(overviewState.mode === 'week' ? 44 : 22, slot * 0.6));
    const labelEvery = cols.length > 20 ? 5 : 1;

    let grid = '';
    for (let v = 0; v <= top + 1e-9; v += step) {
        grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e4e8e5" stroke-width="${v === 0 ? 1.5 : 1}"/>` +
                `<text x="${L - 6}" y="${y(v) + 3.5}" font-size="10" text-anchor="end" fill="#68736d">${ovFmt(v, step < 1 ? 1 : 0)}</text>`;
    }
    let bars = '', labels = '';
    cols.forEach((c, i) => {
        const x = L + i * slot + (slot - bw) / 2;
        if (c.value !== null && c.value > 0) {
            const h = Math.max(1.5, ph - (y(c.value) - T));
            bars += `<rect x="${x.toFixed(1)}" y="${y(c.value).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 2).toFixed(1)}" fill="${m.color}"/>`;
        }
        if (i % labelEvery === 0 || cols.length <= 12) {
            labels += `<text x="${(L + i * slot + slot / 2).toFixed(1)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#68736d">${c.label}</text>`;
        }
        bars += `<rect x="${(L + i * slot).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${ph}" fill="transparent" data-tip="${haEscape(c.tip)}" onmousemove="window.ovTip(event, this)" onclick="window.ovTip(event, this)" onmouseleave="window.ovTipHide()"/>`;
    });
    const unit = `<text x="${L}" y="8" font-size="10" fill="#68736d">${m.unit}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="${m.label} per ${overviewState.mode === 'year' ? 'maand' : 'dag'}">${grid}${unit}${bars}${labels}</svg>`;
}

window.ovTip = function(ev, el) {
    const tip = document.getElementById('ovTooltip');
    const wrap = document.getElementById('ovChartWrap');
    if (!tip || !wrap) return;
    const r = wrap.getBoundingClientRect();
    tip.textContent = el.getAttribute('data-tip') || '';
    tip.classList.remove('hidden');
    const x = Math.min(Math.max(ev.clientX - r.left + 12, 4), Math.max(4, r.width - tip.offsetWidth - 4));
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.max(0, ev.clientY - r.top - 36)}px`;
};
window.ovTipHide = function() {
    const tip = document.getElementById('ovTooltip');
    if (tip) tip.classList.add('hidden');
};

function ovTile(label, value, sub = '') {
    return `<div class="bg-[#f6f8f5] rounded-2xl px-3.5 py-3">
        <p class="text-[10px] font-bold uppercase tracking-wide text-[#68736d]">${label}</p>
        <p class="text-lg font-extrabold text-[#1c2520] mt-0.5">${value}</p>${sub ? `<p class="text-[10px] text-[#68736d]">${sub}</p>` : ''}
    </div>`;
}

function ovCurrentTotals() {
    if (overviewState.mode === 'week') return ovWeekTotals(overviewState.weekStart);
    return overviewState.mode === 'month'
        ? totalsForMonth(overviewState.year, overviewState.month)
        : totalsForYear(overviewState.year).total;
}

function ovTableHtml() {
    const rows = [];
    const dec0 = null;
    const head = ['Periode', 'Afname kWh', 'Zon kWh', 'Teruglevering kWh', 'Gas m³', 'Water L', 'Kosten €', 'Piek kW'];
    if (overviewState.mode === 'week') {
        ovWeekDays(overviewState.weekStart).forEach(d => { if (d.e) rows.push([`${OV_DAYS[d.date.getDay()]} ${d.date.getDate()} ${OV_MONTHS_SHORT[d.date.getMonth()]}`, d.e.i, d.e.s, d.e.e, d.e.g, d.e.w, d.e.c, d.e.p]); });
    } else if (overviewState.mode === 'month') {
        historyDaysOfMonth(overviewState.year, overviewState.month).forEach(d => rows.push([
            `${d.day} ${OV_MONTHS_SHORT[overviewState.month - 1]}`, d.e.i, d.e.s, d.e.e, d.e.g, d.e.w, d.e.c, d.e.p]));
    } else {
        totalsForYear(overviewState.year).months.forEach((t, i) => { if (t.days) rows.push([OV_MONTHS[i], t.i, t.s, t.e, t.g, t.w, t.c, t.p]); });
    }
    if (!rows.length) return `<p class="text-sm text-[#68736d] p-4">Geen gegevens in deze periode.</p>`;
    const dec = [null, 1, 1, 1, 2, 0, 2, 2];
    return `<div class="overflow-x-auto"><table class="w-full text-xs">
        <thead><tr>${head.map((h, i) => `<th class="text-${i ? 'right' : 'left'} font-bold text-[#38443d] px-2 py-1.5 border-b border-stone-200">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td class="${i ? 'text-right tabular-nums' : 'text-left font-bold'} px-2 py-1.5 border-b border-stone-100">${i === 0 ? v : ovFmt(i === 7 ? (v || 0) / 1000 : v, dec[i])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
}

function renderOverviewView() {
    const container = document.getElementById('overviewContainer');
    const view = document.getElementById('viewOverview');
    if (!container || (view && view.classList.contains('hidden'))) return;

    const t = ovCurrentTotals();
    const years = historyYears();
    const hasAny = Object.keys(appState.history || {}).length > 0 || Object.keys(appState.historyArchive || {}).length > 0;
    const ws = overviewState.weekStart, we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6);
    const weekNo = (() => { const t = new Date(Date.UTC(ws.getFullYear(), ws.getMonth(), ws.getDate() + 3)); const j = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return 1 + Math.round(((t - j) / 86400000 - 3 + ((j.getUTCDay() + 6) % 7)) / 7); })();
    const prev = ovPrevTotals();
    const periodLabel = overviewState.mode === 'week' ? `Week ${weekNo}` : overviewState.mode === 'month' ? `${OV_MONTHS[overviewState.month - 1]} ${overviewState.year}` : String(overviewState.year);
    const periodSub = overviewState.mode === 'week' ? `${ws.getDate()} ${OV_MONTHS_SHORT[ws.getMonth()]} – ${we.getDate()} ${OV_MONTHS_SHORT[we.getMonth()]} ${we.getFullYear()}` : '';
    // beste en duurste dag (op kosten, anders afname) in week of maand
    let bestWorst = '';
    if (overviewState.mode !== 'year') {
        const days = overviewState.mode === 'week' ? ovWeekDays(ws).filter(d => d.e).map(d => ({ label: `${OV_DAYS[d.date.getDay()]} ${d.date.getDate()}`, e: d.e }))
            : historyDaysOfMonth(overviewState.year, overviewState.month).map(d => ({ label: `${d.day} ${OV_MONTHS_SHORT[overviewState.month - 1]}`, e: d.e }));
        const key = days.some(d => (d.e.c || 0) > 0) ? 'c' : 'i';
        const mm = OVERVIEW_METRICS.find(x => x.key === key);
        if (days.length >= 2) {
            const lo = days.reduce((a, b) => (b.e[key] || 0) < (a.e[key] || 0) ? b : a), hi = days.reduce((a, b) => (b.e[key] || 0) > (a.e[key] || 0) ? b : a);
            const avg = days.reduce((a, d) => a + (d.e[key] || 0), 0) / days.length;
            bestWorst = `<div class="grid grid-cols-3 gap-2.5">
                <div class="rounded-2xl bg-[#e8f2ec] px-3.5 py-3"><p class="text-[10px] font-bold uppercase text-[#197447]">Zuinigste dag</p><p class="text-base font-extrabold text-[#1c2520]">${lo.label}</p><p class="text-[10px] text-[#68736d]">${ovFmtMetric(mm, lo.e[key] || 0)}</p></div>
                <div class="rounded-2xl bg-[#fbe9dc] px-3.5 py-3"><p class="text-[10px] font-bold uppercase text-[#9e4516]">Duurste dag</p><p class="text-base font-extrabold text-[#1c2520]">${hi.label}</p><p class="text-[10px] text-[#68736d]">${ovFmtMetric(mm, hi.e[key] || 0)}</p></div>
                <div class="rounded-2xl bg-[#f6f8f5] px-3.5 py-3"><p class="text-[10px] font-bold uppercase text-[#68736d]">Gemiddeld per dag</p><p class="text-base font-extrabold text-[#1c2520]">${ovFmtMetric(mm, avg)}</p><p class="text-[10px] text-[#68736d]">${mm.label.toLowerCase()}</p></div>
            </div>`;
        }
    }
    // budgetbalk (alleen huidige maand)
    let budgetHtml = '';
    const nowD = new Date();
    if (overviewState.mode === 'month' && overviewState.year === nowD.getFullYear() && overviewState.month === nowD.getMonth() + 1 && typeof budgetStatus === 'function') {
        const bs = budgetStatus(nowD);
        const bar = (label, o, fmt) => {
            const pct = Math.min(100, (o.used / o.goal) * 100), pp = Math.min(100, (o.proj / o.goal) * 100);
            const over = o.proj > o.goal;
            return `<div><div class="flex justify-between text-xs font-bold text-[#1c2520] mb-1"><span>${label}</span><span>${fmt(o.used)} van ${fmt(o.goal)}</span></div>
                <div class="relative h-3 rounded-full bg-stone-200 overflow-hidden"><div class="absolute inset-y-0 left-0 rounded-full opacity-35" style="width:${pp.toFixed(0)}%;background:${over ? '#e07a2d' : '#19975c'}"></div><div class="absolute inset-y-0 left-0 rounded-full" style="width:${pct.toFixed(0)}%;background:${over ? '#e07a2d' : '#19975c'}"></div></div>
                <p class="text-[10px] mt-1 ${over ? 'text-[#9e4516] font-bold' : 'text-[#68736d]'}">Prognose einde maand: ${fmt(o.proj)}${over ? ' (boven je doel)' : ''}</p></div>`;
        };
        if (bs) budgetHtml = `<div class="rounded-2xl bg-[#f6f8f5] p-4 space-y-3"><p class="text-[10px] font-bold uppercase tracking-wide text-[#68736d]">🎯 Maanddoel</p>
            ${bs.euro ? bar('Kosten', bs.euro, v => '€ ' + ovFmt(v, 0)) : ''}${bs.kwh ? bar('Afname', bs.kwh, v => ovFmt(v, 0) + ' kWh') : ''}</div>`;
    }
    const btn = (active) => active ? 'bg-[#152920] text-white' : 'bg-white border border-stone-200 text-[#38443d] hover:bg-stone-100';

    container.innerHTML = `
        <div class="bg-white rounded-[26px] p-5 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                    <button onclick="window.ovShift(-1)" aria-label="Vorige periode" class="w-9 h-9 rounded-xl bg-white border border-stone-200 hover:bg-stone-100 cursor-pointer font-bold">‹</button>
                    <div class="min-w-[150px] text-center"><h3 class="text-lg font-extrabold text-[#1c2520] capitalize">${periodLabel}</h3>${periodSub ? `<p class="text-[11px] text-[#68736d]">${periodSub}</p>` : ''}</div>
                    <button onclick="window.ovShift(1)" aria-label="Volgende periode" class="w-9 h-9 rounded-xl bg-white border border-stone-200 hover:bg-stone-100 cursor-pointer font-bold">›</button>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <div class="flex rounded-xl overflow-hidden border border-stone-200">
                        <button onclick="window.ovSetMode('week')" class="px-3.5 py-2 text-xs font-bold cursor-pointer ${btn(overviewState.mode === 'week')}">Week</button>
                        <button onclick="window.ovSetMode('month')" class="px-3.5 py-2 text-xs font-bold cursor-pointer ${btn(overviewState.mode === 'month')}">Maand</button>
                        <button onclick="window.ovSetMode('year')" class="px-3.5 py-2 text-xs font-bold cursor-pointer ${btn(overviewState.mode === 'year')}">Jaar</button>
                    </div>
                    ${overviewState.mode !== 'week' && years.length > 1 ? `<select onchange="window.ovSetYear(this.value)" class="px-3 py-2 rounded-xl border border-stone-200 text-xs font-bold bg-white">${years.map(y => `<option value="${y}" ${y === overviewState.year ? 'selected' : ''}>${y}</option>`).join('')}</select>` : ''}
                    <button onclick="window.exportOverviewCsv()" class="px-3.5 py-2 rounded-xl text-xs font-bold bg-white border border-stone-200 hover:bg-stone-100 cursor-pointer">⬇ CSV</button>
                </div>
            </div>

            ${!hasAny ? `<p class="text-sm text-[#68736d] bg-[#f6f8f5] rounded-2xl p-4">Nog geen gegevens. De app bewaart vanaf nu elke dag de cijfers van je wanddisplay. Dat werkt zodra Home Assistant verbonden is en afname, teruglevering of zon aan een entiteit zijn gekoppeld. Oudere dagen kunnen niet achteraf worden aangevuld.</p>` : ''}

            <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
                ${ovTile('Afname', `${ovFmt(t.i, 1)} kWh`, ovDelta(t.i, prev.i, true))}
                ${ovTile('Teruglevering', `${ovFmt(t.e, 1)} kWh`, ovDelta(t.e, prev.e, false))}
                ${ovTile('Zon opgewekt', `${ovFmt(t.s, 1)} kWh`, ovDelta(t.s, prev.s, false))}
                ${ovTile('Zelfverbruik', ovPct(t.selfPct), 'van je zonnestroom zelf gebruikt')}
                ${ovTile('Zelfvoorzienend', ovPct(t.suffPct), 'van je verbruik door de zon gedekt')}
                ${ovTile('Gas', `${ovFmt(t.g, 1)} m³`, ovDelta(t.g, prev.g, true))}
                ${ovTile('Water', `${ovFmt(t.w, 0)} L`, `${ovFmt(t.w / 1000, 1)} m³`)}
                ${ovTile('Kosten', `€ ${ovFmt(t.c, 2)}`, ovDelta(t.c, prev.c, true) || 'indicatief')}
                ${ovTile('Maandpiek', `${ovFmt(t.p / 1000, 2)} kW`, overviewState.mode === 'year' ? 'hoogste van het jaar' : overviewState.mode === 'week' ? 'hoogste van de week' : 'hoogste van de maand')}
                ${ovTile('Dagen met gegevens', String(t.days))}
            </div>

            ${budgetHtml}
            ${bestWorst}
            <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div class="flex flex-wrap gap-1.5">
                    ${OVERVIEW_METRICS.map(m => `<button onclick="window.ovSetMetric('${m.key}')" class="px-3 py-1.5 rounded-full text-[11px] font-bold cursor-pointer flex items-center gap-1.5 ${btn(overviewState.metric === m.key)}"><span class="w-2.5 h-2.5 rounded-full" style="background:${m.color}"></span>${m.label}</button>`).join('')}
                </div>
                <button onclick="window.ovToggleTable()" class="px-3 py-1.5 rounded-full text-[11px] font-bold cursor-pointer ${btn(overviewState.table)}">${overviewState.table ? '📊 Grafiek' : '📋 Tabel'}</button>
            </div>

            ${overviewState.table ? ovTableHtml() : `
            <div id="ovChartWrap" class="relative">
                ${ovChartSvg(overviewState.metric)}
                <div id="ovTooltip" class="hidden absolute pointer-events-none bg-[#152920] text-white text-[11px] font-bold px-2.5 py-1.5 rounded-lg shadow whitespace-nowrap z-10"></div>
            </div>`}
            <p class="text-[10px] text-[#8a958f]">Kosten zijn een schatting: afname × uurprijs, plus gas, water en vaste kosten. Zelfverbruik en zelfvoorzienendheid zijn berekend uit afname, teruglevering en zonne-opbrengst (batterijverliezen niet meegerekend).</p>
        </div>`;
}

window.ovShift = function(dir) {
    if (overviewState.mode === 'week') {
        const w = overviewState.weekStart;
        overviewState.weekStart = new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7 * dir);
    } else if (overviewState.mode === 'month') {
        let m = overviewState.month + dir, y = overviewState.year;
        if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
        overviewState.month = m; overviewState.year = y;
    } else {
        overviewState.year += dir;
    }
    renderOverviewView();
};
window.ovSetMode = function(mode) { overviewState.mode = mode; renderOverviewView(); };
window.ovSetYear = function(y) { overviewState.year = parseInt(y, 10) || overviewState.year; renderOverviewView(); };
window.ovSetMetric = function(k) { overviewState.metric = k; renderOverviewView(); };
window.ovToggleTable = function() { overviewState.table = !overviewState.table; renderOverviewView(); };

window.exportOverviewCsv = function() {
    const nl = (v, d) => (Number(v) || 0).toFixed(d).replace('.', ',');
    const lines = ['Datum;Afname kWh;Zon kWh;Teruglevering kWh;Gas m3;Water L;Kosten EUR;Piek W'];
    const addRow = (label, e) => lines.push([label, nl(e.i, 2), nl(e.s, 2), nl(e.e, 2), nl(e.g, 2), nl(e.w, 0), nl(e.c, 2), nl(e.p, 0)].join(';'));
    let name;
    if (overviewState.mode === 'week') {
        ovWeekDays(overviewState.weekStart).forEach(d => { if (d.e) addRow(d.key, d.e); });
        name = `thuisbord-overzicht-week-${ovKey(overviewState.weekStart)}.csv`;
    } else if (overviewState.mode === 'month') {
        historyDaysOfMonth(overviewState.year, overviewState.month).forEach(d => addRow(d.key, d.e));
        name = `thuisbord-overzicht-${overviewState.year}-${String(overviewState.month).padStart(2, '0')}.csv`;
    } else {
        totalsForYear(overviewState.year).months.forEach((t, i) => { if (t.days) addRow(`${overviewState.year}-${String(i + 1).padStart(2, '0')}`, t); });
        name = `thuisbord-overzicht-${overviewState.year}.csv`;
    }
    if (lines.length === 1) { showToast("Geen gegevens om te exporteren in deze periode."); return; }
    downloadTextFile(name, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
};
