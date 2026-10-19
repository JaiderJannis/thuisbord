'use strict';
/* Energie-statistieken: zelfverbruik, zelfvoorzienendheid en de dagelijkse historie (basis voor het Overzicht).

   Historie: appState.history = { "2026-10-19": { i, e, s, g, w, c, p, ce }, ... }
     i = afname kWh, e = teruglevering kWh, s = zon opgewekt kWh, g = gas m³, w = water L,
     c = kosten € (indicatief), p = maandpiek W (hoogste waarde die dag), ce = opgebouwde stroomkosten.
   Een dag wordt enkel hoger bijgewerkt (maximum), zodat meerdere schermen of een herstart nooit waarden verlagen.
   Dagen ouder dan HISTORY_KEEP_DAYS worden per maand samengevat in appState.historyArchive. */

const HISTORY_KEEP_DAYS = 800;
const HISTORY_PERSIST_EVERY_MS = 30 * 60 * 1000;

let historyDirty = false;
let historyLastPersistMs = Date.now() - (HISTORY_PERSIST_EVERY_MS - 2 * 60 * 1000); // eerste keer ±2 min na het laden
let historyLastKey = null;

function statRound(n, d = 2) {
    const f = Math.pow(10, d);
    return Math.round((Number(n) || 0) * f) / f;
}

/* ---------- zelfverbruik & zelfvoorzienendheid ---------- */
// imp = afname, exp = teruglevering, sol = zon opgewekt (alles kWh)
function computeEnergyStats(imp, exp, sol) {
    imp = Math.max(0, Number(imp) || 0);
    exp = Math.max(0, Number(exp) || 0);
    sol = Math.max(0, Number(sol) || 0);
    const selfKwh = Math.max(0, Math.min(sol, sol - exp));     // zonnestroom die in huis gebruikt (of in de batterij gezet) is
    const houseKwh = imp + selfKwh;                             // geschat verbruik van het huis
    return {
        selfKwh, houseKwh,
        selfPct: sol > 0.05 ? (selfKwh / sol) * 100 : null,           // % van de zonnestroom dat je zelf gebruikt
        suffPct: houseKwh > 0.05 ? (selfKwh / houseKwh) * 100 : null  // % van je verbruik dat de zon dekte
    };
}

function renderSelfUseStats() {
    const s = computeEnergyStats(appState.kwhImport, appState.kwhExport, appState.kwhSolar);
    const set = (valId, barId, pct) => {
        const v = document.getElementById(valId);
        const b = document.getElementById(barId);
        if (v) v.textContent = pct === null ? '—' : `${Math.round(pct)}%`;
        if (b) b.style.width = `${pct === null ? 0 : Math.max(0, Math.min(100, pct))}%`;
    };
    set('valSelfUse', 'barSelfUse', s.selfPct);
    set('valSelfSufficient', 'barSelfSufficient', s.suffPct);
}

/* ---------- dagelijkse historie ---------- */
function historyHasRealData() {
    const em = appState.entityMap || {};
    return (discoveredHaEntities || []).length > 0 && !!(em.kwhImport || em.kwhExport || em.kwhSolar);
}

function recordDailyHistory() {
    if (!appState || !historyHasRealData()) return;
    const mb = appState.midnightBaselines;
    const key = mb && mb.date;
    if (!key || key !== localDateKey()) return; // wacht tot de baselines van vandaag er zijn

    if (!appState.history || typeof appState.history !== 'object') appState.history = {};
    const entry = appState.history[key] || {};
    const prev = { ...entry };

    const priceNow = (() => { try { return Number(getEffectivePricesArray('today')[new Date().getHours()]) || 0; } catch (e) { return 0; } })();
    const newI = statRound(appState.kwhImport);
    if (newI > (entry.i || 0)) entry.ce = statRound((entry.ce || 0) + (newI - (entry.i || 0)) * priceNow, 3);

    const gasCost = (Number(appState.gasToday) || 0) * (Number(appState.gasPricePerM3) || 0);
    const waterCost = ((Number(appState.waterTodayLiters) || 0) / 1000) * (Number(appState.waterPricePerM3) || 0);
    const cost = (entry.ce || 0) + gasCost + waterCost + (Number(appState.fixedDailyCost) || 0);

    const maxOf = (k, v, d = 2) => { entry[k] = Math.max(Number(entry[k]) || 0, statRound(v, d)); };
    maxOf('i', appState.kwhImport);
    maxOf('e', appState.kwhExport);
    maxOf('s', appState.kwhSolar);
    maxOf('g', appState.gasToday);
    maxOf('w', appState.waterTodayLiters, 0);
    maxOf('c', cost);
    maxOf('p', appState.monthlyPeakW, 0);
    appState.history[key] = entry;

    const changed = JSON.stringify(prev) !== JSON.stringify(entry);
    if (changed) historyDirty = true;

    const rolledOver = historyLastKey !== null && historyLastKey !== key;
    historyLastKey = key;
    if (historyDirty && (rolledOver || Date.now() - historyLastPersistMs >= HISTORY_PERSIST_EVERY_MS)) {
        foldOldHistory();
        historyDirty = false;
        historyLastPersistMs = Date.now();
        persistStateToFirestore(false);
    }
}

// Dagen ouder dan HISTORY_KEEP_DAYS samenvatten per maand (houdt het document klein)
function foldOldHistory() {
    const h = appState.history;
    if (!h) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HISTORY_KEEP_DAYS);
    const cutoffKey = localDateKey(cutoff);
    const oldKeys = Object.keys(h).filter(k => k < cutoffKey);
    if (!oldKeys.length) return;
    if (!appState.historyArchive) appState.historyArchive = {};
    oldKeys.forEach(k => {
        const e = h[k];
        const m = k.slice(0, 7);
        const a = appState.historyArchive[m] || { i: 0, e: 0, s: 0, g: 0, w: 0, c: 0, p: 0, d: 0, u: 0, h: 0 };
        const self = Math.max(0, Math.min(e.s || 0, (e.s || 0) - (e.e || 0)));
        a.i = statRound(a.i + (e.i || 0)); a.e = statRound(a.e + (e.e || 0)); a.s = statRound(a.s + (e.s || 0));
        a.g = statRound(a.g + (e.g || 0)); a.w = Math.round(a.w + (e.w || 0)); a.c = statRound(a.c + (e.c || 0));
        a.p = Math.max(a.p, e.p || 0); a.d += 1;
        a.u = statRound(a.u + self);               // zelf gebruikte zonnestroom
        a.h = statRound(a.h + (e.i || 0) + self);  // geschat huisverbruik
        appState.historyArchive[m] = a;
        delete h[k];
    });
}

/* ---------- samenvoegen voor het Overzicht ---------- */
function emptyTotals() { return { i: 0, e: 0, s: 0, g: 0, w: 0, c: 0, p: 0, days: 0, self: 0, house: 0 }; }

function addEntryToTotals(t, e) {
    const self = Math.max(0, Math.min(e.s || 0, (e.s || 0) - (e.e || 0)));
    t.i += e.i || 0; t.e += e.e || 0; t.s += e.s || 0; t.g += e.g || 0; t.w += e.w || 0; t.c += e.c || 0;
    t.p = Math.max(t.p, e.p || 0); t.days += 1;
    t.self += self; t.house += (e.i || 0) + self;
    return t;
}

function finishTotals(t) {
    t.selfPct = t.s > 0.05 ? (t.self / t.s) * 100 : null;
    t.suffPct = t.house > 0.05 ? (t.self / t.house) * 100 : null;
    return t;
}

// Alle dagen van een maand (1-12) als [{ day, e }]
function historyDaysOfMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;
    const h = appState.history || {};
    return Object.keys(h).filter(k => k.startsWith(prefix)).sort().map(k => ({ day: parseInt(k.slice(8), 10), key: k, e: h[k] }));
}

function totalsForMonth(year, month) {
    const t = emptyTotals();
    historyDaysOfMonth(year, month).forEach(d => addEntryToTotals(t, d.e));
    const a = (appState.historyArchive || {})[`${year}-${String(month).padStart(2, '0')}`];
    if (a) {
        t.i += a.i; t.e += a.e; t.s += a.s; t.g += a.g; t.w += a.w; t.c += a.c;
        t.p = Math.max(t.p, a.p); t.days += a.d; t.self += a.u; t.house += a.h;
    }
    return finishTotals(t);
}

function totalsForYear(year) {
    const months = [];
    const total = emptyTotals();
    for (let m = 1; m <= 12; m++) {
        const mt = totalsForMonth(year, m);
        months.push(mt);
        total.i += mt.i; total.e += mt.e; total.s += mt.s; total.g += mt.g; total.w += mt.w; total.c += mt.c;
        total.p = Math.max(total.p, mt.p); total.days += mt.days; total.self += mt.self; total.house += mt.house;
    }
    return { months, total: finishTotals(total) };
}

// Jaren waarvoor er data is (nieuwste eerst), voor de keuzeknoppen
function historyYears() {
    const ys = new Set();
    Object.keys(appState.history || {}).forEach(k => ys.add(parseInt(k.slice(0, 4), 10)));
    Object.keys(appState.historyArchive || {}).forEach(k => ys.add(parseInt(k.slice(0, 4), 10)));
    ys.add(new Date().getFullYear());
    return Array.from(ys).filter(n => !isNaN(n)).sort((a, b) => b - a);
}
