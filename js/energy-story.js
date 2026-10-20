'use strict';
/* Energie-uitleg in gewone taal: vergelijkt een periode met de vorige en vertelt het in een paar zinnen.
   Zuivere functie energyStoryFrom(cur, prev, label, opts) -> { title, lines[], badge } of null. */

function esKwh(n) { return Math.round(n).toLocaleString('nl-BE') + ' kWh'; }
function esEuro(n) { return '€ ' + n.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esChange(cur, prev) {
    if (!(prev > 0.5) || !(cur >= 0)) return null;
    const p = Math.round(((cur - prev) / prev) * 100);
    return Math.abs(p) < 3 ? 0 : p;
}

function energyStoryFrom(t, prev, label, opts) {
    opts = opts || {};
    if (!t || !(t.days >= 3)) return null;
    const lines = [];
    const prevOk = prev && prev.days >= 3;
    // 1. Verbruik van het net
    const ci = prevOk ? esChange(t.i, prev.i) : null;
    let first = `${label} haalde je ${esKwh(t.i)} van het net`;
    if (ci === 0) first += ', ongeveer evenveel als de vorige periode';
    else if (ci !== null) first += `, ${Math.abs(ci)}% ${ci < 0 ? 'minder' : 'meer'} dan de vorige periode`;
    lines.push(first + '.');
    // 2. Zon
    if (t.s > 1) {
        const cs = prevOk ? esChange(t.s, prev.s) : null;
        let sun = `Je zonnepanelen leverden ${esKwh(t.s)}`;
        if (t.selfPct !== null && t.selfPct !== undefined) sun += `, waarvan je ${Math.round(t.selfPct)}% zelf opgebruikte`;
        if (cs !== null && cs !== 0) sun += ` (${Math.abs(cs)}% ${cs > 0 ? 'meer' : 'minder'} zon dan de vorige periode)`;
        lines.push(sun + '.');
        if (t.e > 1) lines.push(`${esKwh(t.e)} ging terug naar het net.`);
    }
    // 3. Kosten
    if (t.c > 0.5) {
        const cc = prevOk ? esChange(t.c, prev.c) : null;
        let cost = `Dat kostte ongeveer ${esEuro(t.c)}`;
        if (cc === 0) cost += ', vrijwel gelijk aan de vorige periode';
        else if (cc !== null) cost += `, ${Math.abs(cc)}% ${cc < 0 ? 'goedkoper' : 'duurder'} dan de vorige periode`;
        lines.push(cost + '.');
    }
    // 4. Zuinigste/duurste dag
    if (opts.best && opts.worst && opts.best.label !== opts.worst.label) {
        lines.push(`Je zuinigste dag was ${opts.best.label}, de duurste ${opts.worst.label}.`);
    }
    // 5. Eén concrete tip
    let tip = '';
    if (t.suffPct !== null && t.suffPct !== undefined && t.s > 1 && t.selfPct !== null && t.selfPct < 35) tip = 'Tip: plan wasmachine, droger en vaatwasser als de zon schijnt; zo gebruik je meer van je eigen stroom.';
    else if (ci !== null && ci > 10) tip = 'Tip: kijk bij Slim advies naar de goedkoopste uren en verschuif zware apparaten daarheen.';
    else if (ci !== null && ci < -5) tip = 'Goed bezig: je verbruik daalt. Hou dit vol.';
    if (tip) lines.push(tip);
    const badge = ci === null ? 'Samenvatting' : ci <= -3 ? 'Minder verbruik' : ci >= 3 ? 'Meer verbruik' : 'Stabiel';
    return { title: label, lines, badge };
}

// Verhaal voor de periode die in het Overzicht gekozen is
function energyStoryForOverview() {
    if (typeof overviewState === 'undefined') return null;
    const t = ovCurrentTotals(), prev = ovPrevTotals();
    let label, best = null, worst = null;
    if (overviewState.mode === 'week') label = 'Deze week';
    else if (overviewState.mode === 'month') label = 'In ' + OV_MONTHS[overviewState.month - 1];
    else label = 'In ' + overviewState.year;
    if (overviewState.mode !== 'year') {
        const ws = overviewState.weekStart;
        const days = overviewState.mode === 'week' ? ovWeekDays(ws).filter(d => d.e).map(d => ({ label: ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'][d.date.getDay()], e: d.e }))
            : historyDaysOfMonth(overviewState.year, overviewState.month).map(d => ({ label: `${d.day} ${OV_MONTHS_SHORT[overviewState.month - 1]}`, e: d.e }));
        const key = days.some(d => (d.e.c || 0) > 0) ? 'c' : 'i';
        if (days.length >= 2) {
            best = days.reduce((a, b) => (b.e[key] || 0) < (a.e[key] || 0) ? b : a);
            worst = days.reduce((a, b) => (b.e[key] || 0) > (a.e[key] || 0) ? b : a);
        }
    }
    return energyStoryFrom(t, prev, label, { best, worst });
}

// Voor het adviesbord: de afgelopen week (ma-zo), de eerste dagen van een nieuwe week
function energyStoryLastWeek(now) {
    now = now || new Date();
    const dow = (now.getDay() + 6) % 7;            // 0 = maandag
    if (dow > 2 || typeof ovWeekTotals !== 'function') return null;
    const thisMon = ovMonday(now);
    const lastMon = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 7);
    const prevMon = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 14);
    const s = energyStoryFrom(ovWeekTotals(lastMon), ovWeekTotals(prevMon), 'Vorige week');
    return s;
}
