'use strict';
/* Slim advies en planner: wanneer start je de wasmachine, droger of vaatwasser het goedkoopst?

   Instellingen: appState.planner = { horizonHours, jobs:[{id,name,icon,hours,kwh}], rules:{...}, solarSurplusW, capacityPct,
                                      cheapMargin, peakMargin, maxBestStartTips }   (standaardwaarden: defaultPlannerSettings in config.js)
   Doelen:       appState.budget  = { monthEuro, monthKwh, yearEuro }
   Rechten:      view_planner (bekijken), manage_advice (instellingen en doelen, enkel gezinsbeheerder).
   Herinneringen: lokaal per apparaat (localStorage), werken zolang het bord open staat. */

let plannerSelectedJob = '';
let plannerHtmlCache = '';
let plannerSaveTimer = null;

function plannerEsc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- instellingen ---------- */
function plannerSettings() {
    const def = defaultPlannerSettings();
    const cur = (appState.planner && typeof appState.planner === 'object') ? appState.planner : {};
    const out = Object.assign({}, def, cur);
    out.rules = Object.assign({}, def.rules, cur.rules || {});
    out.jobs = Array.isArray(cur.jobs) ? cur.jobs : def.jobs;
    appState.planner = out;
    return out;
}
function plannerSave() {
    clearTimeout(plannerSaveTimer);
    plannerSaveTimer = setTimeout(() => { try { persistStateToFirestore(false); } catch (e) { /* negeren */ } }, 500);
}

/* ---------- prijsuren vanaf het huidige uur ---------- */
function plannerSlots(now = new Date()) {
    let today = [], tomorrow = [];
    try { today = getEffectivePricesArray('today'); tomorrow = getEffectivePricesArray('tomorrow'); } catch (e) { /* geen prijzen */ }
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate(), h0 = now.getHours();
    const slots = [];
    today.forEach((p, h) => { if (h >= h0 && isFinite(p)) slots.push({ ts: new Date(y, m, d, h), hour: h, day: 0, price: Number(p) }); });
    if (tomorrow.length === 24) tomorrow.forEach((p, h) => { if (isFinite(p)) slots.push({ ts: new Date(y, m, d + 1, h), hour: h, day: 1, price: Number(p) }); });
    return slots;
}

const plannerPad = (h) => String(h).padStart(2, '0') + ':00';
function plannerWhen(ts, now = new Date()) {
    const dayDiff = Math.round((new Date(ts.getFullYear(), ts.getMonth(), ts.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    return `${plannerPad(ts.getHours())} ${dayDiff === 0 ? 'vandaag' : dayDiff === 1 ? 'morgen' : ts.toLocaleDateString('nl-BE', { weekday: 'long' })}`;
}

// Beste aaneengesloten blok voor een taak. Geeft null als er te weinig prijsuren zijn.
function plannerBest(job, slots, horizonHours) {
    const d = Math.max(1, Math.ceil(Number(job.hours) || 1));
    const kwh = Math.max(0, Number(job.kwh) || 0);
    const lim = Math.min(slots.length, Math.max(d, Number(horizonHours) || 24));
    if (lim < d) return null;
    let best = null, nowSum = null, worst = null;
    for (let i = 0; i + d <= lim; i++) {
        let sum = 0;
        for (let k = 0; k < d; k++) sum += slots[i + k].price;
        if (i === 0) nowSum = sum;
        if (!best || sum < best.sum - 1e-9) best = { i, sum };
        if (!worst || sum > worst.sum) worst = { i, sum };
    }
    const per = kwh / d;
    const cost = best.sum * per, nowCost = nowSum * per, worstCost = worst.sum * per;
    const start = slots[best.i].ts;
    return {
        job, d, kwh, i: best.i, start, end: new Date(start.getTime() + d * 3600000),
        cost, nowCost, worstCost, saving: nowCost - cost, savingPct: nowCost > 0.0001 ? ((nowCost - cost) / nowCost) * 100 : 0,
        avgPrice: best.sum / d, isNow: best.i === 0
    };
}

// Hoe duur is dit uur vergeleken met de rest van de beschikbare uren?
function plannerLevel(price, slots) {
    const prices = slots.map(s => s.price).sort((a, b) => a - b);
    if (price < 0) return { key: 'negative', label: 'Negatief', theme: 'green', pct: 0 };
    if (!prices.length) return { key: 'normal', label: 'Normaal', theme: 'neutral', pct: 50 };
    const rank = prices.filter(p => p < price - 1e-9).length / Math.max(1, prices.length - 1);
    const pct = Math.round(rank * 100);
    if (rank <= 0.15) return { key: 'verycheap', label: 'Zeer goedkoop', theme: 'green', pct };
    if (rank <= 0.4) return { key: 'cheap', label: 'Goedkoop', theme: 'green', pct };
    if (rank < 0.7) return { key: 'normal', label: 'Normaal', theme: 'neutral', pct };
    if (rank < 0.9) return { key: 'expensive', label: 'Duur', theme: 'orange', pct };
    return { key: 'veryexpensive', label: 'Zeer duur', theme: 'orange', pct };
}

function plannerEuro(n) { return `€ ${(Number(n) || 0).toFixed(2).replace('.', ',')}`; }
function plannerEuro3(n) { return `€ ${(Number(n) || 0).toFixed(3).replace('.', ',')}`; }

/* ---------- herinneringen ---------- */
function plannerReminders() { try { return JSON.parse(localStorage.getItem('thuisbord_planner_rem') || '[]') || []; } catch (e) { return []; } }
function plannerSetReminders(list) { try { localStorage.setItem('thuisbord_planner_rem', JSON.stringify(list)); } catch (e) { /* negeren */ } }

window.plannerRemind = function(jobId) {
    const S = plannerSettings();
    const job = S.jobs.find(j => j.id === jobId);
    const best = job && plannerBest(job, plannerSlots(), S.horizonHours);
    if (!best) { showToast("Er zijn nog geen prijzen om een moment te kiezen."); return; }
    const ts = best.isNow ? Date.now() + 60000 : best.start.getTime() - 5 * 60000;
    const list = plannerReminders().filter(r => r.jobId !== jobId);
    list.push({ id: 'r' + Date.now(), jobId, label: `${job.icon || '🔌'} ${job.name}`, ts, at: best.start.getTime() });
    plannerSetReminders(list);
    plannerHtmlCache = '';
    showToast(`Herinnering gezet voor ${job.name} (${plannerWhen(best.start)}). Werkt zolang dit bord open staat.`);
    renderPlannerView();
};
window.plannerCancelReminder = function(id) {
    plannerSetReminders(plannerReminders().filter(r => r.id !== id));
    plannerHtmlCache = '';
    renderPlannerView();
};
function plannerCheckReminders() {
    const list = plannerReminders();
    if (!list.length) return;
    const now = Date.now();
    const due = list.filter(r => r.ts <= now);
    if (!due.length) return;
    plannerSetReminders(list.filter(r => r.ts > now));
    due.forEach(r => {
        const text = `${r.label}: nu starten is het goedkoopst!`;
        if (typeof showToast === 'function') showToast(`⏰ ${text}`);
        try { if (typeof pushActive === 'function' && pushActive()) pushShow('Thuisbord', `⏰ ${text}`, 'planner_' + r.id); } catch (e) { /* negeren */ }
    });
    plannerHtmlCache = '';
    renderPlannerView();
}
setInterval(plannerCheckReminders, 20000);

/* ---------- grafiek ---------- */
function plannerChartSvg(slots, best) {
    const n = slots.length;
    if (n < 2) return '';
    const W = 720, H = 230, L = 40, R = 8, T = 22, B = 30;
    const pw = W - L - R, ph = H - T - B;
    const prices = slots.map(s => s.price);
    const vmin = Math.min(0, ...prices), vmax = Math.max(0.05, ...prices);
    const y = v => T + ph - ((v - vmin) / (vmax - vmin)) * ph;
    const slot = pw / n, bw = Math.max(4, slot * 0.72);
    const sorted = prices.slice().sort((a, b) => a - b);
    const lo = sorted[Math.floor((n - 1) / 3)], hi = sorted[Math.floor(2 * (n - 1) / 3)];
    const color = v => v <= lo ? '#19975c' : v >= hi ? '#e07a2d' : '#9fb0a6';

    let grid = '';
    const step = vmax - vmin > 0.4 ? 0.1 : 0.05;
    for (let v = Math.ceil(vmin / step) * step; v <= vmax + 1e-9; v += step) {
        grid += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${Math.abs(v) < 1e-9 ? '#9fb0a6' : '#e4e8e5'}" stroke-width="1"/>` +
                `<text x="${L - 5}" y="${(y(v) + 3.5).toFixed(1)}" font-size="10" text-anchor="end" fill="#68736d">${v.toFixed(2).replace('.', ',')}</text>`;
    }
    let band = '';
    if (best) {
        const x0 = L + best.i * slot, w = best.d * slot;
        band = `<rect x="${x0.toFixed(1)}" y="${T - 6}" width="${w.toFixed(1)}" height="${ph + 6}" rx="8" fill="rgba(25,151,92,.13)" stroke="#19975c" stroke-width="1.5" stroke-dasharray="4 3"/>` +
               `<text x="${(x0 + w / 2).toFixed(1)}" y="${T - 9}" font-size="10" font-weight="800" text-anchor="middle" fill="#197447">beste start</text>`;
    }
    let bars = '', labels = '', dividers = '';
    slots.forEach((s, i) => {
        const x = L + i * slot + (slot - bw) / 2;
        const y0 = y(Math.max(0, s.price)), y1 = y(Math.min(0, s.price));
        const h = Math.max(1.5, y1 - y0);
        const isNow = i === 0;
        bars += `<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 2).toFixed(1)}" fill="${color(s.price)}" ${isNow ? 'stroke="#152920" stroke-width="2"' : ''}><title>${plannerPad(s.hour)}${s.day ? ' (morgen)' : ''}: ${plannerEuro3(s.price)}/kWh</title></rect>`;
        if (s.hour % 3 === 0 || n <= 12) labels += `<text x="${(L + i * slot + slot / 2).toFixed(1)}" y="${H - 10}" font-size="10" text-anchor="middle" fill="#68736d">${String(s.hour).padStart(2, '0')}</text>`;
        if (isNow) labels += `<text x="${(L + slot / 2).toFixed(1)}" y="${(y0 - 4).toFixed(1)}" font-size="10" font-weight="800" text-anchor="middle" fill="#152920">nu</text>`;
        if (s.hour === 0 && i > 0) dividers += `<line x1="${(L + i * slot).toFixed(1)}" x2="${(L + i * slot).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="#9fb0a6" stroke-dasharray="3 3"/><text x="${(L + i * slot + 4).toFixed(1)}" y="${T + 10}" font-size="10" font-weight="700" fill="#68736d">morgen</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="Stroomprijs per uur">${grid}${band}${dividers}${bars}${labels}<text x="${L}" y="10" font-size="10" fill="#68736d">€/kWh</text></svg>`;
}

/* ---------- scherm ---------- */
function plannerThemeClasses(theme) {
    return theme === 'green' ? 'bg-[#dcece3] text-[#197447]' : theme === 'orange' ? 'bg-[#fbe9dc] text-[#9e4516]' : 'bg-stone-100 text-stone-600';
}

function renderPlannerView() {
    const container = document.getElementById('plannerContainer');
    const view = document.getElementById('viewPlanner');
    if (!container || (view && view.classList.contains('hidden'))) return;
    const manageBtn = document.getElementById('plannerManageBtn');
    if (manageBtn) manageBtn.classList.toggle('hidden', !permAllowed('manage_advice'));

    const S = plannerSettings();
    const now = new Date();
    const slots = plannerSlots(now);
    let html;
    if (slots.length < 2) {
        html = `<div class="bg-white rounded-[26px] p-8 text-center shadow-sm"><p class="text-5xl mb-3">🧠</p><h3 class="text-lg font-extrabold text-[#1c2520]">Nog geen uurprijzen</h3>
            <p class="text-sm text-[#68736d] mt-1 max-w-md mx-auto">De planner heeft de stroomprijzen per uur nodig. Koppel de prijssensor bij Beheer → Prijzen of vul de uurprijzen in.</p></div>`;
    } else {
        if (!S.jobs.find(j => j.id === plannerSelectedJob)) plannerSelectedJob = S.jobs.length ? S.jobs[0].id : '';
        const level = plannerLevel(slots[0].price, slots);
        const all = slots.slice(0, 24);
        const mn = all.reduce((a, s) => s.price < a.price ? s : a, all[0]);
        const mx = all.reduce((a, s) => s.price > a.price ? s : a, all[0]);
        const range = Math.max(0.0001, mx.price - mn.price);
        const gaugePos = Math.max(0, Math.min(100, ((slots[0].price - mn.price) / range) * 100));
        const results = S.jobs.map(j => ({ job: j, best: plannerBest(j, slots, S.horizonHours) }));
        const sel = results.find(r => r.job.id === plannerSelectedJob) || results[0];
        const rems = plannerReminders();
        const selRem = sel && rems.find(r => r.jobId === sel.job.id);

        const nowCard = `
            <div class="bg-white rounded-[26px] p-6 shadow-sm flex flex-col gap-4">
                <div>
                    <p class="text-xs font-bold uppercase tracking-wider text-[#68736d]">Stroomprijs nu</p>
                    <p class="text-4xl font-extrabold text-[#1c2520] mt-1">${plannerEuro3(slots[0].price)}<span class="text-base font-semibold text-[#68736d]"> /kWh</span></p>
                    <span class="inline-block mt-2 px-3 py-1 rounded-full text-xs font-extrabold ${plannerThemeClasses(level.theme)}">${level.label}</span>
                </div>
                <div>
                    <div class="relative h-3 rounded-full" style="background:linear-gradient(90deg,#19975c,#d6dccf 50%,#e07a2d)">
                        <span class="absolute top-1/2 w-5 h-5 rounded-full bg-white border-4 border-[#152920] shadow" style="left:${gaugePos.toFixed(0)}%;transform:translate(-50%,-50%)"></span>
                    </div>
                    <div class="flex justify-between text-[10px] font-bold text-[#68736d] mt-1.5"><span>goedkoopst ${plannerEuro3(mn.price)}</span><span>duurst ${plannerEuro3(mx.price)}</span></div>
                </div>
                <div class="grid grid-cols-2 gap-2.5">
                    <div class="rounded-2xl bg-[#e8f2ec] p-3"><p class="text-[10px] font-bold uppercase text-[#197447]">Goedkoopst</p><p class="text-base font-extrabold text-[#1c2520]">${plannerPad(mn.hour)}</p><p class="text-[11px] text-[#68736d]">${plannerEuro3(mn.price)}</p></div>
                    <div class="rounded-2xl bg-[#fbe9dc] p-3"><p class="text-[10px] font-bold uppercase text-[#9e4516]">Duurst</p><p class="text-base font-extrabold text-[#1c2520]">${plannerPad(mx.hour)}</p><p class="text-[11px] text-[#68736d]">${plannerEuro3(mx.price)}</p></div>
                </div>
                ${slots.length > (24 - now.getHours()) ? '' : '<p class="text-[11px] text-[#8a958f]">De prijzen van morgen zijn nog niet binnen. Zodra ze er zijn, plant de app ook voor morgen.</p>'}
            </div>`;

        const chips = S.jobs.map(j => `<button type="button" onclick="window.plannerSelectJob('${j.id}')" class="px-3.5 py-2 rounded-full text-xs font-extrabold cursor-pointer flex items-center gap-1.5 ${j.id === (sel && sel.job.id) ? 'bg-[#152920] text-white' : 'bg-white border border-stone-200 text-[#38443d] hover:bg-stone-100'}"><span>${plannerEsc(j.icon || '🔌')}</span>${plannerEsc(j.name)}</button>`).join('');

        let resultHtml = '<p class="text-sm text-[#68736d]">Voeg taken toe bij Beheer → Advies &amp; doelen.</p>';
        if (sel && sel.best) {
            const b = sel.best;
            resultHtml = `
                <div class="rounded-2xl bg-[#152920] text-white p-5 flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <p class="text-[11px] font-bold uppercase tracking-wider text-[#a3b8ae]">Beste moment voor ${plannerEsc(sel.job.name)} (${b.d} u, ${plannerEsc(sel.job.kwh)} kWh)</p>
                        <p class="text-2xl sm:text-3xl font-extrabold mt-1">${b.isNow ? 'Nu starten' : `Start om ${plannerWhen(b.start, now)}`}</p>
                        <p class="text-xs text-[#b3c7bd] mt-0.5">Klaar rond ${plannerPad(b.end.getHours())}${b.end.getDate() !== now.getDate() ? ' (morgen)' : ''} · gemiddeld ${plannerEuro3(b.avgPrice)}/kWh</p>
                    </div>
                    <div class="text-right">
                        <p class="text-[11px] text-[#a3b8ae]">Kosten dan</p>
                        <p class="text-2xl font-extrabold">${plannerEuro(b.cost)}</p>
                        <p class="text-xs ${b.saving > 0.005 ? 'text-[#7ee0ad]' : 'text-[#b3c7bd]'} font-bold">${b.saving > 0.005 ? `bespaart ${plannerEuro(b.saving)} (${Math.round(b.savingPct)}%) t.o.v. nu` : 'nu is al het goedkoopst'}</p>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    ${selRem ? `<span class="px-3 py-1.5 rounded-xl bg-[#dcece3] text-[#197447] text-xs font-bold">⏰ Herinnering voor ${new Date(selRem.at).getHours()}:00 staat aan</span>
                        <button type="button" onclick="window.plannerCancelReminder('${selRem.id}')" class="px-3 py-1.5 rounded-xl bg-white border border-stone-200 hover:bg-stone-100 text-xs font-bold cursor-pointer">Annuleren</button>`
                      : `<button type="button" onclick="window.plannerRemind('${sel.job.id}')" class="px-4 py-2 rounded-xl bg-[#19975c] hover:bg-[#157a4a] text-white text-xs font-extrabold cursor-pointer">⏰ Herinner mij</button>`}
                    <span class="text-[11px] text-[#8a958f]">De herinnering werkt zolang dit bord open staat.</span>
                </div>
                <div id="plannerChartWrap">${plannerChartSvg(slots.slice(0, Math.min(slots.length, Math.max(S.horizonHours, b.i + b.d + 2))), b)}</div>
                <p class="text-[10px] text-[#8a958f]">Groene balken zijn goedkoop, oranje duur. Prijzen zijn inclusief jouw tarief-instellingen. De kosten zijn een schatting op basis van het ingestelde verbruik van de taak.</p>`;
        } else if (sel) {
            resultHtml = '<p class="text-sm text-[#68736d]">Er zijn niet genoeg prijsuren om dit te plannen.</p>';
        }

        const table = `
            <div class="bg-white rounded-[26px] p-6 shadow-sm">
                <h3 class="text-base font-extrabold text-[#1c2520] mb-3">Alle taken in één overzicht</h3>
                <div class="overflow-x-auto"><table class="w-full text-xs">
                    <thead><tr class="text-left text-[#68736d]"><th class="py-1.5 pr-3 font-bold">Taak</th><th class="py-1.5 pr-3 font-bold">Beste start</th><th class="py-1.5 pr-3 font-bold text-right">Kosten dan</th><th class="py-1.5 pr-3 font-bold text-right">Nu starten</th><th class="py-1.5 font-bold text-right">Besparing</th></tr></thead>
                    <tbody>${results.map(({ job, best }) => `<tr class="border-t border-stone-100 cursor-pointer hover:bg-[#f6f8f5]" onclick="window.plannerSelectJob('${job.id}')">
                        <td class="py-2 pr-3 font-bold text-[#1c2520]">${plannerEsc(job.icon || '🔌')} ${plannerEsc(job.name)} <span class="font-normal text-[#68736d]">${job.hours} u · ${job.kwh} kWh</span></td>
                        ${best ? `<td class="py-2 pr-3 font-extrabold ${best.isNow ? 'text-[#197447]' : 'text-[#1c2520]'}">${best.isNow ? 'Nu' : plannerWhen(best.start, now)}</td>
                        <td class="py-2 pr-3 text-right tabular-nums">${plannerEuro(best.cost)}</td><td class="py-2 pr-3 text-right tabular-nums text-[#68736d]">${plannerEuro(best.nowCost)}</td>
                        <td class="py-2 text-right tabular-nums font-extrabold ${best.saving > 0.005 ? 'text-[#197447]' : 'text-[#68736d]'}">${best.saving > 0.005 ? '− ' + plannerEuro(best.saving) : '–'}</td>` : '<td colspan="4" class="py-2 text-[#8a958f]">Te weinig prijsuren</td>'}</tr>`).join('')}</tbody>
                </table></div>
            </div>`;

        const tips = (typeof buildLiveAdvicePool === 'function' ? buildLiveAdvicePool() : []);
        const tipsHtml = tips.length ? `
            <div class="bg-white rounded-[26px] p-6 shadow-sm">
                <h3 class="text-base font-extrabold text-[#1c2520] mb-3">Slimme tips op dit moment</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${tips.map(t => `
                    <div class="rounded-2xl p-4 ${t.theme === 'orange' ? 'bg-[#fbf0e8] border border-[#f4d9c5]' : 'bg-[#f1f7f3] border border-[#d7e9dd]'}">
                        <p class="text-[10px] font-extrabold uppercase tracking-wider ${t.theme === 'orange' ? 'text-[#9e4516]' : 'text-[#197447]'}">${plannerEsc(t.category)}</p>
                        <p class="text-sm font-semibold text-[#1c2520] mt-1 leading-snug">${plannerEsc(t.text)}</p>
                        <span class="inline-block mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${t.theme === 'orange' ? 'bg-[#faeae1] text-[#9e4516]' : 'bg-[#dcece3] text-[#173828]'}">${plannerEsc(t.badge)}</span>
                    </div>`).join('')}</div>
            </div>` : '';

        html = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
                ${nowCard}
                <div class="lg:col-span-2 bg-white rounded-[26px] p-6 shadow-sm space-y-4">
                    <div class="flex flex-wrap gap-2">${chips || '<span class="text-sm text-[#68736d]">Nog geen taken ingesteld.</span>'}</div>
                    ${resultHtml}
                </div>
            </div>
            ${table}
            ${tipsHtml}`;
    }
    if (html === plannerHtmlCache) return;
    plannerHtmlCache = html;
    container.innerHTML = html;
}

window.plannerSelectJob = function(id) { plannerSelectedJob = id; plannerHtmlCache = ''; renderPlannerView(); };
window.openPlannerAdmin = function() {
    if (!permAllowed('manage_advice')) { permGuard('manage_advice'); return; }
    switchView('admin');
    switchAdminTab('advies');
};

/* =====================================================================
   BEHEER: adviesregels, planner-taken en doelen (tabblad Advies)
   ===================================================================== */
const PLANNER_RULES = [
    ['cheapNow', '🟢 Goedkoop moment nu', 'Meldt als de stroom nu (bijna) het goedkoopst van de dag is'],
    ['peakNow', '🔴 Piekprijs nu', 'Waarschuwt als de stroom nu (bijna) het duurst van de dag is'],
    ['negativePrice', '➖ Negatieve prijs', 'Meldt als je stroom krijgt bij te verbruiken'],
    ['bestStart', '🧠 Beste starttijd per taak', 'Tips zoals "Wasmachine: start om 13:00 en bespaar € 0,18"'],
    ['solarSurplus', '☀️ Zonne-overschot', 'Meldt als er veel meer zon is dan het huis verbruikt'],
    ['capacityPeak', '📈 Maandpiek (capaciteitstarief)', 'Waarschuwt als je afname de hoogste piek van de maand nadert'],
    ['batteryPeak', '🔋 Batterij inzetten', 'Tip om de batterij te gebruiken tijdens dure uren'],
    ['tomorrow', '🔮 Voorspelling morgen', 'Goedkoopste uur van morgen, zodra de prijzen er zijn'],
    ['sunTomorrow', '🌤️ Zon morgen', 'Meldt een zonnige of grijze dag (via de weervoorspelling)'],
    ['weatherTips', '🌦️ Weertips', 'Regen op komst, vorst, hitte, wind en droogweer: tips voor de was, tuin en robotmaaier'],
    ['weeklyStory', '🗣️ Vorige week in gewone taal', 'Op maandag tot woensdag een korte samenvatting van je energieverbruik van vorige week'],
    ['budget', '🎯 Budget en doelen', 'Waarschuwt als je op het maandbudget afstevent']
];

window.plannerSetRule = function(key, on) {
    if (!permGuard('manage_advice')) return;
    plannerSettings().rules[key] = !!on;
    plannerSave(); plannerHtmlCache = '';
    if (typeof renderAdviceBanner === 'function') renderAdviceBanner();
};
window.plannerSetNum = function(field, value) {
    if (!permGuard('manage_advice')) return;
    const n = Number(String(value).replace(',', '.'));
    if (!isFinite(n)) return;
    plannerSettings()[field] = n;
    plannerSave(); plannerHtmlCache = '';
};
window.plannerJobSet = function(id, field, value) {
    if (!permGuard('manage_advice')) return;
    const j = plannerSettings().jobs.find(x => x.id === id);
    if (!j) return;
    if (field === 'hours' || field === 'kwh') {
        const n = Number(String(value).replace(',', '.'));
        if (!isFinite(n) || n <= 0) return;
        j[field] = field === 'hours' ? Math.min(24, n) : n;
    } else j[field] = String(value).slice(0, 40);
    plannerSave(); plannerHtmlCache = '';
};
window.plannerJobAdd = function() {
    if (!permGuard('manage_advice')) return;
    const name = (document.getElementById('plannerNewJobName') || {}).value || '';
    if (!name.trim()) { showToast('Geef de taak een naam.'); return; }
    const icon = ((document.getElementById('plannerNewJobIcon') || {}).value || '🔌').trim() || '🔌';
    const hours = Number(String((document.getElementById('plannerNewJobHours') || {}).value || '2').replace(',', '.')) || 2;
    const kwh = Number(String((document.getElementById('plannerNewJobKwh') || {}).value || '1').replace(',', '.')) || 1;
    plannerSettings().jobs.push({ id: 'job_' + Date.now().toString(36), name: name.trim().slice(0, 40), icon, hours: Math.min(24, hours), kwh });
    plannerSave(); plannerHtmlCache = '';
    renderAdminAdviceAdvanced();
};
window.plannerJobRemove = function(id) {
    if (!permGuard('manage_advice')) return;
    const S = plannerSettings();
    S.jobs = S.jobs.filter(j => j.id !== id);
    plannerSave(); plannerHtmlCache = '';
    renderAdminAdviceAdvanced();
};
window.plannerResetJobs = function() {
    if (!permGuard('manage_advice')) return;
    plannerSettings().jobs = defaultPlannerSettings().jobs;
    plannerSave(); plannerHtmlCache = '';
    renderAdminAdviceAdvanced();
};
window.budgetSet = function(field, value) {
    if (!permGuard('manage_advice')) return;
    if (!appState.budget || typeof appState.budget !== 'object') appState.budget = { monthEuro: 0, monthKwh: 0, yearEuro: 0 };
    const n = Number(String(value).replace(',', '.'));
    appState.budget[field] = isFinite(n) && n > 0 ? n : 0;
    plannerSave();
    if (typeof renderOverviewView === 'function') renderOverviewView();
};

function renderAdminAdviceAdvanced() {
    const el = document.getElementById('adminAdviceAdvanced');
    if (!el) return;
    const S = plannerSettings();
    const b = appState.budget || {};
    const num = (label, hint, field, value, step, unit) => `
        <label class="block">
            <span class="block text-[11px] font-bold text-[#38443d] mb-1">${label}</span>
            <span class="flex items-center gap-1.5"><input type="number" step="${step}" min="0" value="${plannerEsc(value)}" onchange="window.plannerSetNum('${field}', this.value)" class="w-24 px-2.5 py-2 rounded-xl border border-stone-200 text-sm font-bold"><span class="text-xs text-[#68736d]">${unit}</span></span>
            <span class="block text-[10px] text-[#8a958f] mt-0.5">${hint}</span>
        </label>`;
    el.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="bg-white rounded-[26px] p-6 shadow-sm space-y-4">
                <div>
                    <span class="inline-block bg-[#e8f2ec] text-[#197447] text-[11px] font-extrabold px-2.5 py-1 rounded-full">🧠 Adviesregels</span>
                    <h3 class="text-lg font-bold text-[#1c2520] mt-1">Wat mag het bord adviseren?</h3>
                    <p class="text-xs text-[#68736d]">Zet regels aan of uit. Dit bepaalt de berichten in de adviesbalk en de planner.</p>
                </div>
                <div class="space-y-1.5">${PLANNER_RULES.map(([k, label, hint]) => `
                    <label class="flex items-center justify-between gap-3 p-3 rounded-2xl bg-[#f4f7f4] cursor-pointer">
                        <span><span class="block text-sm font-bold text-[#1c2520]">${label}</span><span class="block text-[11px] text-[#68736d]">${hint}</span></span>
                        <input type="checkbox" ${S.rules[k] !== false ? 'checked' : ''} onchange="window.plannerSetRule('${k}', this.checked)" class="w-5 h-5 accent-[#152920] shrink-0">
                    </label>`).join('')}</div>
                <div class="pt-3 border-t border-stone-100 grid grid-cols-2 gap-4">
                    ${num('Zonne-overschot vanaf', 'Zon min. huisverbruik', 'solarSurplusW', S.solarSurplusW, 50, 'W')}
                    ${num('Piekwaarschuwing vanaf', 'Aandeel van de maandpiek', 'capacityPct', S.capacityPct, 1, '%')}
                    ${num('"Goedkoop" tot', 'Marge boven het dalmoment', 'cheapMargin', S.cheapMargin, 0.01, '€/kWh')}
                    ${num('"Duur" vanaf', 'Marge onder het piekmoment', 'peakMargin', S.peakMargin, 0.01, '€/kWh')}
                    ${num('Planner kijkt vooruit', 'Maximum aantal uren', 'horizonHours', S.horizonHours, 1, 'uur')}
                    ${num('Start-tips tegelijk', 'In de roterende adviesbalk', 'maxBestStartTips', S.maxBestStartTips, 1, 'tips')}
                </div>
            </div>

            <div class="space-y-6">
                <div class="bg-white rounded-[26px] p-6 shadow-sm space-y-4">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <span class="inline-block bg-[#e8f2ec] text-[#197447] text-[11px] font-extrabold px-2.5 py-1 rounded-full">⏱ Planner-taken</span>
                            <h3 class="text-lg font-bold text-[#1c2520] mt-1">Taken die je wilt plannen</h3>
                            <p class="text-xs text-[#68736d]">Duur en verbruik per beurt. Hiermee rekent de planner de beste starttijd en de besparing uit.</p>
                        </div>
                        <button type="button" onclick="window.plannerResetJobs()" class="text-[11px] font-bold text-[#68736d] hover:underline cursor-pointer shrink-0">Standaard herstellen</button>
                    </div>
                    <div class="space-y-2">${S.jobs.map(j => `
                        <div class="grid grid-cols-[44px_1fr_70px_70px_32px] gap-2 items-center">
                            <input type="text" maxlength="4" value="${plannerEsc(j.icon || '')}" onchange="window.plannerJobSet('${j.id}', 'icon', this.value)" class="px-1 py-2 rounded-xl border border-stone-200 text-center text-lg">
                            <input type="text" value="${plannerEsc(j.name)}" onchange="window.plannerJobSet('${j.id}', 'name', this.value)" class="px-2.5 py-2 rounded-xl border border-stone-200 text-sm font-bold min-w-0">
                            <label class="flex items-center gap-1 text-[10px] font-bold text-[#68736d]"><input type="number" step="0.5" min="0.5" max="24" value="${plannerEsc(j.hours)}" onchange="window.plannerJobSet('${j.id}', 'hours', this.value)" class="w-full px-1.5 py-2 rounded-xl border border-stone-200 text-xs font-bold">u</label>
                            <label class="flex items-center gap-1 text-[10px] font-bold text-[#68736d]"><input type="number" step="0.1" min="0.1" value="${plannerEsc(j.kwh)}" onchange="window.plannerJobSet('${j.id}', 'kwh', this.value)" class="w-full px-1.5 py-2 rounded-xl border border-stone-200 text-xs font-bold">kWh</label>
                            <button type="button" onclick="window.plannerJobRemove('${j.id}')" aria-label="Verwijder" class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold cursor-pointer">✕</button>
                        </div>`).join('') || '<p class="text-xs text-[#68736d] italic">Nog geen taken.</p>'}</div>
                    <div class="grid grid-cols-[44px_1fr_70px_70px_auto] gap-2 items-center pt-3 border-t border-stone-100">
                        <input id="plannerNewJobIcon" type="text" maxlength="4" value="🔌" class="px-1 py-2 rounded-xl border border-stone-200 text-center text-lg">
                        <input id="plannerNewJobName" type="text" placeholder="Nieuwe taak (bv. Laadpaal)" class="px-2.5 py-2 rounded-xl border border-stone-200 text-sm min-w-0">
                        <input id="plannerNewJobHours" type="number" step="0.5" min="0.5" value="2" title="Uren" class="px-1.5 py-2 rounded-xl border border-stone-200 text-xs font-bold">
                        <input id="plannerNewJobKwh" type="number" step="0.1" min="0.1" value="1" title="kWh" class="px-1.5 py-2 rounded-xl border border-stone-200 text-xs font-bold">
                        <button type="button" onclick="window.plannerJobAdd()" class="bg-[#152920] text-white font-bold px-3 py-2 rounded-xl text-xs cursor-pointer">+ Toevoegen</button>
                    </div>
                </div>

                <div class="bg-white rounded-[26px] p-6 shadow-sm space-y-4">
                    <div>
                        <span class="inline-block bg-[#e8f2ec] text-[#197447] text-[11px] font-extrabold px-2.5 py-1 rounded-full">🎯 Doelen &amp; budget</span>
                        <h3 class="text-lg font-bold text-[#1c2520] mt-1">Maandbudget en jaardoel</h3>
                        <p class="text-xs text-[#68736d]">Laat leeg of 0 om uit te schakelen. De voortgang zie je in het Overzicht en in de adviesbalk.</p>
                    </div>
                    <div class="grid grid-cols-3 gap-3">
                        <label class="block"><span class="block text-[11px] font-bold text-[#38443d] mb-1">Budget per maand</span><span class="flex items-center gap-1.5"><input type="number" min="0" step="5" value="${plannerEsc(b.monthEuro || '')}" onchange="window.budgetSet('monthEuro', this.value)" class="w-full px-2.5 py-2 rounded-xl border border-stone-200 text-sm font-bold"><span class="text-xs text-[#68736d]">€</span></span></label>
                        <label class="block"><span class="block text-[11px] font-bold text-[#38443d] mb-1">Afname per maand</span><span class="flex items-center gap-1.5"><input type="number" min="0" step="10" value="${plannerEsc(b.monthKwh || '')}" onchange="window.budgetSet('monthKwh', this.value)" class="w-full px-2.5 py-2 rounded-xl border border-stone-200 text-sm font-bold"><span class="text-xs text-[#68736d]">kWh</span></span></label>
                        <label class="block"><span class="block text-[11px] font-bold text-[#38443d] mb-1">Budget per jaar</span><span class="flex items-center gap-1.5"><input type="number" min="0" step="50" value="${plannerEsc(b.yearEuro || '')}" onchange="window.budgetSet('yearEuro', this.value)" class="w-full px-2.5 py-2 rounded-xl border border-stone-200 text-sm font-bold"><span class="text-xs text-[#68736d]">€</span></span></label>
                    </div>
                </div>
            </div>
        </div>`;
}
