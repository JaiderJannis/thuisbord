'use strict';
/* Maandrapport: netjes overzicht van één maand (energie, kosten, gas, water, vergelijking, beste en duurste dag, budget).
   Afdrukken of opslaan als pdf (browser), kopiëren als tekst of mailen. Gegevens uit appState.history (zie stats.js). */

const rp = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
let rpHtmlCache = '';
const rpEsc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RP_NUM = (n, d = 1) => (Number(n) || 0).toLocaleString('nl-BE', { minimumFractionDigits: d, maximumFractionDigits: d });
const RP_PCT = (cur, prev) => (prev > 0.0001 && cur >= 0) ? Math.round(((cur - prev) / prev) * 100) : null;

// Zuivere functie: alle cijfers van een maand
function reportBuild(year, month) {
    const t = totalsForMonth(year, month);
    let py = year, pm = month - 1; if (pm < 1) { pm = 12; py--; }
    const prev = totalsForMonth(py, pm), last = totalsForMonth(year - 1, month);
    const days = historyDaysOfMonth(year, month).map(d => ({ day: d.day, i: d.e.i || 0, s: d.e.s || 0, e: d.e.e || 0, c: d.e.c || 0 }));
    const dim = new Date(year, month, 0).getDate();
    const keyC = days.some(d => d.c > 0) ? 'c' : 'i';
    let best = null, worst = null;
    if (days.length >= 2) {
        best = days.reduce((a, b) => b[keyC] < a[keyC] ? b : a);
        worst = days.reduce((a, b) => b[keyC] > a[keyC] ? b : a);
    }
    const b = appState.budget || {};
    const budget = {};
    if (Number(b.monthEuro) > 0) budget.euro = { goal: Number(b.monthEuro), used: t.c };
    if (Number(b.monthKwh) > 0) budget.kwh = { goal: Number(b.monthKwh), used: t.i };
    const label = OV_MONTHS[month - 1].charAt(0).toUpperCase() + OV_MONTHS[month - 1].slice(1) + ' ' + year;
    const story = typeof energyStoryFrom === 'function' ? energyStoryFrom(t, prev, 'In ' + OV_MONTHS[month - 1], {
        best: best ? { label: best.day + ' ' + OV_MONTHS_SHORT[month - 1] } : null, worst: worst ? { label: worst.day + ' ' + OV_MONTHS_SHORT[month - 1] } : null }) : null;
    return { year, month, label, dim, t, prev, last, days, best, worst, keyC, budget, story,
        cmp: { prevLabel: OV_MONTHS[pm - 1], lastLabel: OV_MONTHS[month - 1] + ' ' + (year - 1) }, house: (appState && appState.householdName) || '' };
}

function reportText(d) {
    const t = d.t, L = [];
    L.push(`Maandrapport ${d.label}${d.house ? ' · ' + d.house : ''}`);
    if (!(t.days > 0)) { L.push('Voor deze maand zijn geen gegevens.'); return L.join('\n'); }
    L.push(`Gegevens van ${t.days} van ${d.dim} dagen.`, '');
    L.push(`Afname van het net: ${RP_NUM(t.i)} kWh`, `Zon opgewekt: ${RP_NUM(t.s)} kWh`, `Teruglevering: ${RP_NUM(t.e)} kWh`);
    if (t.selfPct != null) L.push(`Zelfverbruik van de zon: ${Math.round(t.selfPct)}%`);
    if (t.suffPct != null) L.push(`Zelfvoorzienendheid: ${Math.round(t.suffPct)}%`);
    L.push(`Gas: ${RP_NUM(t.g, 2)} m³`, `Water: ${RP_NUM(t.w, 0)} L`, `Kosten (schatting): € ${RP_NUM(t.c, 2)}`);
    const cp = RP_PCT(t.c, d.prev.c), ci = RP_PCT(t.i, d.prev.i);
    if (cp !== null) L.push('', `Kosten ${Math.abs(cp)}% ${cp <= 0 ? 'lager' : 'hoger'} dan ${d.cmp.prevLabel}.`);
    if (ci !== null) L.push(`Afname ${Math.abs(ci)}% ${ci <= 0 ? 'lager' : 'hoger'} dan ${d.cmp.prevLabel}.`);
    if (d.best && d.worst) L.push(`Zuinigste dag: ${d.best.day} ${OV_MONTHS_SHORT[d.month - 1]}. Duurste dag: ${d.worst.day} ${OV_MONTHS_SHORT[d.month - 1]}.`);
    if (d.story) L.push('', ...d.story.lines);
    return L.join('\n');
}

/* ---------- weergave ---------- */
function reportBars(days, dim, key, color, label, unit, dec) {
    if (!days.length) return '';
    const W = 640, H = 150, L = 34, R = 6, T = 8, B = 20, slot = (W - L - R) / dim;
    const max = Math.max(...days.map(d => d[key]), 0.0001);
    const bars = days.map(d => { const h = (d[key] / max) * (H - T - B), x = L + (d.day - 1) * slot + slot * 0.15, y = H - B - h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(slot * 0.7).toFixed(1)}" height="${Math.max(h, 0.5).toFixed(1)}" rx="2" fill="${color}"><title>${d.day}: ${RP_NUM(d[key], dec)} ${unit}</title></rect>`; }).join('');
    const ticks = [1, Math.ceil(dim / 2), dim].map(n => `<text x="${(L + (n - 1) * slot + slot / 2).toFixed(1)}" y="${H - 5}" font-size="10" text-anchor="middle" fill="#68736d">${n}</text>`).join('');
    return `<figure class="rp-fig"><figcaption class="text-[11px] font-extrabold uppercase tracking-wider text-[#68736d] mb-1">${rpEsc(label)} per dag (${rpEsc(unit)})</figcaption>
        <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="${rpEsc(label)} per dag"><line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#d9dfda"/>
        <text x="${L - 4}" y="${T + 8}" font-size="10" text-anchor="end" fill="#68736d">${RP_NUM(max, max < 10 ? 1 : 0)}</text>${bars}${ticks}</svg></figure>`;
}

function reportHtml(d) {
    const t = d.t;
    const tile = (lb, v, sub) => `<div class="rp-tile"><p class="text-[10px] font-bold uppercase tracking-wider text-[#68736d]">${lb}</p><p class="text-xl font-extrabold text-[#1c2520] mt-0.5">${v}</p>${sub ? `<p class="text-[11px] mt-0.5">${sub}</p>` : ''}</div>`;
    const delta = (cur, prev, lower) => { const p = RP_PCT(cur, prev); if (p === null) return ''; if (Math.abs(p) < 1) return '<span class="text-[#68736d]">≈ vorige maand</span>'; const good = lower ? p < 0 : p > 0; return `<span class="${good ? 'text-[#197447]' : 'text-[#9e4516]'} font-bold">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% t.o.v. ${rpEsc(d.cmp.prevLabel)}</span>`; };
    if (!(t.days > 0)) return `<div class="bg-white rounded-[26px] p-8 text-center shadow-sm"><p class="text-4xl mb-2">📄</p><p class="text-base font-extrabold text-[#1c2520]">Geen gegevens voor ${rpEsc(d.label)}</p><p class="text-sm text-[#68736d] mt-1">Kies een andere maand.</p></div>`;
    const bud = (name, o, fmt) => { const pct = Math.round((o.used / o.goal) * 100); const over = o.used > o.goal; return `<div><div class="flex justify-between text-xs font-bold"><span>${name}</span><span class="${over ? 'text-[#9e4516]' : 'text-[#197447]'}">${fmt(o.used)} van ${fmt(o.goal)} (${pct}%)</span></div><div class="h-2 rounded-full bg-stone-200 overflow-hidden mt-1"><div class="h-full ${over ? 'bg-[#eda100]' : 'bg-[#19975c]'}" style="width:${Math.min(100, pct)}%"></div></div></div>`; };
    const budgetHtml = (d.budget.euro || d.budget.kwh) ? `<section class="rp-card space-y-3"><h3 class="rp-h">🎯 Budget</h3>${d.budget.euro ? bud('Kosten', d.budget.euro, v => '€ ' + RP_NUM(v, 0)) : ''}${d.budget.kwh ? bud('Afname', d.budget.kwh, v => RP_NUM(v, 0) + ' kWh') : ''}</section>` : '';
    const dayRows = d.days.slice().sort((a, b) => a.day - b.day).map(x => `<tr><td>${x.day}</td><td>${RP_NUM(x.i)}</td><td>${RP_NUM(x.s)}</td><td>${RP_NUM(x.e)}</td><td>€ ${RP_NUM(x.c, 2)}</td></tr>`).join('');
    return `<article id="reportSheet" class="space-y-4">
        <header class="rp-card flex flex-wrap items-end justify-between gap-2"><div><p class="text-[11px] font-bold uppercase tracking-wider text-[#68736d]">Maandrapport${d.house ? ' · ' + rpEsc(d.house) : ''}</p><h2 class="text-3xl font-extrabold text-[#1c2520]">${rpEsc(d.label)}</h2></div>
            <p class="text-xs text-[#68736d]">Gegevens van ${t.days} van ${d.dim} dagen</p></header>
        ${d.story ? `<section class="rp-card"><h3 class="rp-h">🗣️ In gewone taal</h3><div class="space-y-1 text-sm text-[#38443d] leading-relaxed">${d.story.lines.map(l => `<p>${rpEsc(l)}</p>`).join('')}</div></section>` : ''}
        <section class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            ${tile('Afname', RP_NUM(t.i) + ' kWh', delta(t.i, d.prev.i, true))}
            ${tile('Zon opgewekt', RP_NUM(t.s) + ' kWh', delta(t.s, d.prev.s, false))}
            ${tile('Teruglevering', RP_NUM(t.e) + ' kWh', '')}
            ${tile('Kosten (schatting)', '€ ' + RP_NUM(t.c, 2), delta(t.c, d.prev.c, true))}
            ${tile('Zelfverbruik zon', t.selfPct == null ? '—' : Math.round(t.selfPct) + '%', '')}
            ${tile('Zelfvoorzienend', t.suffPct == null ? '—' : Math.round(t.suffPct) + '%', '')}
            ${tile('Gas', RP_NUM(t.g, 2) + ' m³', delta(t.g, d.prev.g, true))}
            ${tile('Water', RP_NUM(t.w, 0) + ' L', delta(t.w, d.prev.w, true))}
        </section>
        ${d.best && d.worst ? `<section class="grid grid-cols-2 gap-2.5"><div class="rp-tile bg-[#e8f2ec]"><p class="text-[10px] font-bold uppercase text-[#197447]">Zuinigste dag</p><p class="text-lg font-extrabold">${d.best.day} ${OV_MONTHS_SHORT[d.month - 1]}</p></div><div class="rp-tile bg-[#fbe9dc]"><p class="text-[10px] font-bold uppercase text-[#9e4516]">Duurste dag</p><p class="text-lg font-extrabold">${d.worst.day} ${OV_MONTHS_SHORT[d.month - 1]}</p></div></section>` : ''}
        ${budgetHtml}
        <section class="rp-card space-y-4"><h3 class="rp-h">📈 Verloop per dag</h3>
            ${reportBars(d.days, d.dim, 'i', '#2a78d6', 'Afname', 'kWh', 1)}
            ${reportBars(d.days, d.dim, 's', '#eb6834', 'Zon opgewekt', 'kWh', 1)}</section>
        <section class="rp-card"><h3 class="rp-h">🧮 Vergelijking</h3>
            <table class="rp-table"><thead><tr><th></th><th>${rpEsc(d.label)}</th><th>${rpEsc(d.cmp.prevLabel)}</th><th>${rpEsc(d.cmp.lastLabel)}</th></tr></thead><tbody>
            ${[['Afname (kWh)', 'i', 1], ['Zon (kWh)', 's', 1], ['Teruglevering (kWh)', 'e', 1], ['Gas (m³)', 'g', 2], ['Water (L)', 'w', 0], ['Kosten (€)', 'c', 2]].map(([lb, k, dec]) => `<tr><td>${lb}</td><td><b>${RP_NUM(t[k], dec)}</b></td><td>${d.prev.days ? RP_NUM(d.prev[k], dec) : '—'}</td><td>${d.last.days ? RP_NUM(d.last[k], dec) : '—'}</td></tr>`).join('')}</tbody></table></section>
        <section class="rp-card rp-nobreak"><h3 class="rp-h">🗓️ Per dag</h3><table class="rp-table"><thead><tr><th>Dag</th><th>Afname</th><th>Zon</th><th>Terug</th><th>Kosten</th></tr></thead><tbody>${dayRows}</tbody></table></section>
        <p class="text-[10px] text-[#8a958f]">Kosten zijn een schatting: afname × uurprijs, plus gas, water en vaste kosten. Gemaakt op ${new Date().toLocaleDateString('nl-BE')}.</p>
    </article>`;
}

function renderReportView() {
    const box = document.getElementById('reportContainer'), view = document.getElementById('viewReport');
    if (!box || (view && view.classList.contains('hidden'))) return;
    const ae = document.activeElement;
    if (ae && box.contains && box.contains(ae) && ae.tagName === 'SELECT') return;
    if (typeof totalsForMonth !== 'function') { box.innerHTML = ''; return; }
    const d = reportBuild(rp.year, rp.month);
    const years = (typeof historyYears === 'function' ? historyYears() : []).slice();
    const cy = new Date().getFullYear(); if (!years.includes(cy)) years.unshift(cy); if (!years.includes(rp.year)) years.push(rp.year);
    years.sort((a, b) => b - a);
    const html = `<div class="rp-toolbar bg-white rounded-[22px] p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
            <button type="button" onclick="window.reportShift(-1)" aria-label="Vorige maand" class="w-9 h-9 rounded-xl bg-stone-100 hover:bg-stone-200 cursor-pointer font-bold">‹</button>
            <select onchange="window.reportSet('month',this.value)" class="px-3 py-2 rounded-xl border border-stone-200 text-sm font-bold">${OV_MONTHS.map((m, i) => `<option value="${i + 1}" ${rp.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>
            <select onchange="window.reportSet('year',this.value)" class="px-3 py-2 rounded-xl border border-stone-200 text-sm font-bold">${years.map(y => `<option value="${y}" ${rp.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select>
            <button type="button" onclick="window.reportShift(1)" aria-label="Volgende maand" class="w-9 h-9 rounded-xl bg-stone-100 hover:bg-stone-200 cursor-pointer font-bold">›</button>
        </div>
        <div class="flex flex-wrap gap-2">
            <button type="button" onclick="window.reportPrint()" class="px-4 py-2 rounded-xl bg-[#152920] text-white text-xs font-extrabold cursor-pointer">🖨️ Afdrukken / pdf</button>
            <button type="button" onclick="window.reportCopy()" class="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-xs font-bold cursor-pointer">📋 Kopieer tekst</button>
            <button type="button" onclick="window.reportMail()" class="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-xs font-bold cursor-pointer">✉️ Mail</button>
        </div></div>` + reportHtml(d);
    if (html === rpHtmlCache) return;
    rpHtmlCache = html; box.innerHTML = html;
}
function reportViewActive(on) { if (on) { rpHtmlCache = ''; renderReportView(); } }

window.reportSet = function(k, v) { const n = parseInt(v, 10); if (!n) return; rp[k] = n; rpHtmlCache = ''; renderReportView(); };
window.reportShift = function(dir) { let m = rp.month + dir, y = rp.year; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } rp.month = m; rp.year = y; rpHtmlCache = ''; renderReportView(); };
window.reportPrint = function() {
    const root = document.documentElement, wasDark = root.classList.contains('dark');
    document.body.classList.add('printing-report');
    if (wasDark) root.classList.remove('dark');          // op papier altijd licht
    const done = () => { document.body.classList.remove('printing-report'); if (wasDark) root.classList.add('dark'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try { window.print(); } catch (e) { done(); }
};
window.reportCopy = async function() {
    const txt = reportText(reportBuild(rp.year, rp.month));
    try { await navigator.clipboard.writeText(txt); showToast('Rapport gekopieerd.'); }
    catch (e) { showToast('Kopiëren is niet gelukt. Gebruik Afdrukken of Mail.'); }
};
window.reportMail = function() {
    const d = reportBuild(rp.year, rp.month);
    const body = encodeURIComponent(reportText(d)).slice(0, 1800);
    window.location.href = 'mailto:?subject=' + encodeURIComponent('Maandrapport ' + d.label) + '&body=' + body;
};
