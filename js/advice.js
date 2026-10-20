'use strict';
/* Advies-banner en eigen adviesberichten */

// Budget-voortgang van de huidige maand (ook gebruikt door het Overzicht)
function budgetStatus(now = new Date()) {
    const b = appState.budget || {};
    if (!(Number(b.monthEuro) > 0 || Number(b.monthKwh) > 0)) return null;
    if (typeof totalsForMonth !== 'function') return null;
    const t = totalsForMonth(now.getFullYear(), now.getMonth() + 1);
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const day = Math.max(1, now.getDate());
    const out = { day, dim, t };
    if (Number(b.monthEuro) > 0) { out.euro = { used: t.c, goal: Number(b.monthEuro), proj: (t.c / day) * dim }; }
    if (Number(b.monthKwh) > 0) { out.kwh = { used: t.i, goal: Number(b.monthKwh), proj: (t.i / day) * dim }; }
    return out;
}

function buildLiveAdvicePool() {
    const pool = [];
    const S = (typeof plannerSettings === 'function') ? plannerSettings() : defaultPlannerSettings();
    const R = S.rules || {};
    const on = (k) => R[k] !== false;
    const now = new Date();
    const effectiveToday = getEffectivePricesArray('today');
    const effectiveTomorrow = getEffectivePricesArray('tomorrow');
    const realNowHour = now.getHours();
    const currentPrice = effectiveToday[realNowHour] ?? 0.25;
    const { minHour, maxHour } = updateExtremePriceWindows('today');
    const pad = (n) => String(n % 24).padStart(2, '0') + ':00';
    const cheapM = Number(S.cheapMargin), peakM = Number(S.peakMargin);

    if (on('negativePrice') && currentPrice < 0) {
        pool.push({ category: "NEGATIEVE STROOMPRIJS • NU", text: `Je krijgt nu geld bij voor verbruik (${formatEuro(currentPrice)}/kWh). Start alles wat kan: wasmachine, droger, laadpaal, boiler.`, badge: "Gratis stroom", theme: "green" });
    } else if (currentPrice <= effectiveToday[minHour] + cheapM) {
        if (on('cheapNow')) pool.push({
            category: "SLIM TARIEF ADVIES • NU",
            text: `Stroom is nu goedkoop (${formatEuro(currentPrice)}/kWh), gunstig venster tot ${pad(minHour + 2)}. Zet de wasmachine of vaatwasser nu aan.`,
            badge: `Gunstig tot ${pad(minHour + 2)}`, theme: "green"
        });
    } else if (currentPrice >= effectiveToday[maxHour] - peakM) {
        if (on('peakNow')) pool.push({
            category: "PIEKTARIEF WAARSCHUWING • NU",
            text: `Let op: stroom is op dit moment duur (${formatEuro(currentPrice)}/kWh). Stel grote verbruikers uit tot na ${pad(maxHour + 2)}.`,
            badge: `Piek tot ${pad(maxHour + 2)}`, theme: "orange"
        });
    } else {
        pool.push({
            category: "ADVIES VOOR NU",
            text: `Stroomprijs nu ${formatEuro(currentPrice)}/kWh. Goedkoopste blok vandaag: ${pad(minHour)} – ${pad(minHour + 2)} (${formatEuro(effectiveToday[minHour])}).`,
            badge: `Dal: ${pad(minHour)}`, theme: "green"
        });
    }

    // Beste starttijd per taak (planner)
    if (on('bestStart') && typeof plannerSlots === 'function') {
        try {
            const slots = plannerSlots(now);
            const tips = (S.jobs || []).map(j => plannerBest(j, slots, S.horizonHours)).filter(b => b && b.saving > 0.01 && !b.isNow)
                .sort((a, b) => b.saving - a.saving).slice(0, Math.max(0, Number(S.maxBestStartTips) || 0));
            tips.forEach(b => pool.push({
                category: "SLIMSTE STARTTIJD",
                text: `${b.job.icon || ''} ${b.job.name}: start om ${plannerWhen(b.start, now)} en bespaar ${plannerEuro(b.saving)} (${Math.round(b.savingPct)}%) t.o.v. nu.`,
                badge: `Start ${pad(b.start.getHours())}`, theme: "green"
            }));
            const nowOk = (S.jobs || []).map(j => plannerBest(j, slots, S.horizonHours)).find(b => b && b.isNow && b.worstCost - b.cost > 0.05);
            if (nowOk && currentPrice > 0 && !pool.some(p => p.category === "SLIMSTE STARTTIJD")) {
                pool.push({ category: "SLIMSTE STARTTIJD", text: `${nowOk.job.icon || ''} ${nowOk.job.name} starten kan nu: dit is het goedkoopste moment van de komende uren.`, badge: "Nu is best", theme: "green" });
            }
        } catch (e) { /* planner niet beschikbaar */ }
    }

    if (on('tomorrow') && effectiveTomorrow.length === 24) {
        let minTomIdx = 0;
        for (let h = 1; h < 24; h++) if (effectiveTomorrow[h] < effectiveTomorrow[minTomIdx]) minTomIdx = h;
        pool.push({
            category: "VOORSPELLING MORGEN",
            text: `Morgen is de stroom het goedkoopst rond ${pad(minTomIdx)} voor ${formatEuro(effectiveTomorrow[minTomIdx])}/kWh.`,
            badge: `Morgen ${pad(minTomIdx)}: ${formatEuro(effectiveTomorrow[minTomIdx])}`, theme: "green"
        });
    }

    const surplusW = Number(appState.solarW) - Number(appState.houseW);
    if (on('solarSurplus') && surplusW > Number(S.solarSurplusW)) {
        pool.push({
            category: "ZONNE-ENERGIE LIVE",
            text: `Je zonnepanelen leveren nu ${Math.round(surplusW)} W méér dan het huis verbruikt! Batterij staat op ${appState.batteryPct}%. Ideaal moment voor wasmachine of droger.`,
            badge: `+${Math.round(surplusW)} W Zon-overschot`, theme: "green"
        });
    }

    // Maandpiek (capaciteitstarief)
    const peak = Number(appState.monthlyPeakW) || 0;
    const imp = Number(appState.gridImportW ?? appState.gridW ?? 0);
    if (on('capacityPeak') && peak > 0 && imp >= peak * (Number(S.capacityPct) / 100)) {
        pool.push({
            category: "MAANDPIEK • LET OP",
            text: `Je afname (${formatNum(imp / 1000, 2)} kW) zit dicht bij je maandpiek van ${formatNum(peak / 1000, 2)} kW. Zet even iets uit om de piek niet te verhogen.`,
            badge: `Piek ${formatNum(peak / 1000, 2)} kW`, theme: "orange"
        });
    }

    // Batterij tijdens dure uren
    if (on('batteryPeak') && currentPrice >= effectiveToday[maxHour] - peakM && Number(appState.batteryPct) >= 40) {
        pool.push({ category: "BATTERIJ INZETTEN", text: `Het is duur en de batterij staat op ${appState.batteryPct}%: laat het huis nu op de batterij draaien.`, badge: `${appState.batteryPct}% beschikbaar`, theme: "green" });
    }

    // Weer: zon of grijs morgen
    if (on('sunTomorrow') && typeof weatherData !== 'undefined' && weatherData && Array.isArray(weatherData.daily) && weatherData.daily[1]) {
        const d = weatherData.daily[1];
        if (d.code <= 2 && d.pop < 30) pool.push({ category: "ZON MORGEN", text: `Morgen wordt zonnig (${Math.round(d.max)}°). Plan de was en andere grote verbruikers overdag, dan draaien ze op eigen zonnestroom.`, badge: "Zonnige dag", theme: "green" });
        else if (d.code >= 61 || d.pop >= 70) pool.push({ category: "WEER MORGEN", text: `Morgen wordt het grijs en nat. Verwacht weinig zonnestroom en doe de was vandaag of op een goedkoop uur.`, badge: "Weinig zon", theme: "orange" });
    }

    // Budget en doelen
    if (on('budget')) {
        const bs = budgetStatus(now);
        if (bs && bs.euro && bs.t.days >= 3) {
            const { used, goal, proj } = bs.euro;
            if (used >= goal) pool.push({ category: "BUDGET OVERSCHREDEN", text: `Je maandbudget van € ${Math.round(goal)} is op (€ ${used.toFixed(0)} verbruikt). Let op de komende dagen.`, badge: "Over budget", theme: "orange" });
            else if (proj > goal * 1.05) pool.push({ category: "BUDGET WAARSCHUWING", text: `Aan dit tempo kom je uit op ongeveer € ${Math.round(proj)} deze maand, boven je budget van € ${Math.round(goal)}.`, badge: `Prognose € ${Math.round(proj)}`, theme: "orange" });
            else pool.push({ category: "BUDGET OP KOERS", text: `Je zit op koers: € ${used.toFixed(0)} verbruikt, prognose € ${Math.round(proj)} van € ${Math.round(goal)}.`, badge: `${Math.round(used / goal * 100)}% gebruikt`, theme: "green" });
        } else if (bs && bs.kwh && bs.t.days >= 3 && bs.kwh.proj > bs.kwh.goal * 1.05) {
            pool.push({ category: "AFNAME DOEL", text: `Aan dit tempo haal je ${Math.round(bs.kwh.proj)} kWh afname deze maand, boven je doel van ${Math.round(bs.kwh.goal)} kWh.`, badge: "Boven doel", theme: "orange" });
        }
    }

    const activeApps = (appState.appliances || []).filter(a => a.active && Number(a.watts) > 0);
    if (activeApps.length > 0) {
        const names = activeApps.map(a => `${a.icon} ${a.name} (${a.watts}W)`).join(', ');
        pool.push({ category: "ACTIEVE APPARATEN IN HUIS", text: `Momenteel actief in huis: ${names}.`, badge: `${activeApps.length} apparaat actief`, theme: "green" });
    }

    (appState.customAdvices || []).forEach((ca) => {
        pool.push({ category: "BERICHT VOOR HET GEZIN", text: ca.text, badge: ca.badge || "Melding", theme: "green" });
    });

    return pool;
}

function renderAdviceBanner() {
    const banner = document.getElementById('adviceBanner');
    const catLabel = document.getElementById('adviceCategoryLabel');
    const counterBadge = document.getElementById('adviceLiveCounter');
    const titleEl = document.getElementById('adviceTitle');
    const badgeEl = document.getElementById('adviceBadge');

    if (!appState.autoAdvice) {
        catLabel.textContent = "ADVIES VOOR NU";
        counterBadge.textContent = "Handmatig ingesteld";
        titleEl.textContent = appState.adviceText || "Stroom is nu goedkoop.";
        badgeEl.textContent = appState.adviceBadge || "Gunstig";
        return;
    }

    const pool = buildLiveAdvicePool();
    if (adviceRotationIndex >= pool.length) adviceRotationIndex = 0;
    const currentItem = pool[adviceRotationIndex] || pool[0];

    catLabel.textContent = currentItem.category;
    counterBadge.textContent = `Live Bericht ${adviceRotationIndex + 1}/${pool.length}`;
    titleEl.textContent = currentItem.text;
    badgeEl.textContent = currentItem.badge;

    if (currentItem.theme === "orange") {
        banner.className = "bg-[#432312] text-white rounded-[22px] px-6 py-5 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm transition-all duration-500";
        badgeEl.className = "bg-[#faeae1] text-[#9e4516] font-semibold px-5 py-2.5 rounded-full text-sm sm:text-base whitespace-nowrap";
    } else {
        banner.className = "bg-[#152920] text-white rounded-[22px] px-6 py-5 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm transition-all duration-500";
        badgeEl.className = "bg-[#dcece3] text-[#173828] font-semibold px-5 py-2.5 rounded-full text-sm sm:text-base whitespace-nowrap";
    }
}

function renderPulseLampBadges() {
    const color = appState.lampColorHex || '#19975c';
    const isOn = appState.lampIsOn !== false;
    const lampEntity = appState.entityMap?.statusLamp || '';
    const shortName = lampEntity
        ? (appState.lampFriendlyName || lampEntity.replace('light.', ''))
        : 'Pulse Lamp';

    // Enkel de ronde badge naast 'Nu' in Kolom 1 krijgt de live kleur van de Pulse Lamp
    const nuDot = document.getElementById('nuLampColorDot');
    const nuText = document.getElementById('nuLampStateText');
    const nuBadge = document.getElementById('nuCardLampBadge');
    if (nuDot) {
        nuDot.style.backgroundColor = color;
        nuDot.style.boxShadow = isOn ? `0 0 8px ${color}` : 'none';
        nuDot.classList.toggle('animate-pulse', isOn);
    }
    if (nuText) {
        nuText.textContent = isOn ? shortName : 'Uit';
    }
    if (nuBadge) {
        nuBadge.style.borderColor = isOn ? color : '#e5e7eb';
    }
}

window.cycleNextAdviceMessage = function() {
    appState.autoAdvice = true;
    const pool = buildLiveAdvicePool();
    adviceRotationIndex = (adviceRotationIndex + 1) % pool.length;
    renderAdviceBanner();
};

function renderCustomAdviceList() {
    const container = document.getElementById('customAdviceListContainer');
    if (!container) return;
    const list = appState.customAdvices || [];
    if (list.length === 0) {
        container.innerHTML = `<p class="text-xs text-[#68736d] italic">Geen extra eigen berichten toegevoegd.</p>`;
        return;
    }
    container.innerHTML = list.map((item, idx) => `
        <div class="flex items-center justify-between gap-2 bg-[#f6f8f5] px-3.5 py-2.5 rounded-xl border border-stone-200/70">
            <div>
                <p class="text-xs font-bold text-[#1c2520]">${item.text}</p>
                <span class="text-[10px] font-semibold text-[#197447] bg-[#dcece3] px-2 py-0.5 rounded-full">${item.badge}</span>
            </div>
            <button onclick="window.removeCustomAdviceMessage(${idx})" class="text-xs font-bold text-red-600 hover:underline cursor-pointer shrink-0">Verwijder</button>
        </div>
    `).join('');
}

window.addCustomAdviceMessage = function() {
    const text = document.getElementById('newCustomAdviceText').value.trim();
    const badge = document.getElementById('newCustomAdviceBadge').value.trim() || 'Gezinsadvies';
    if (!text) return;
    if (!appState.customAdvices) appState.customAdvices = [];
    appState.customAdvices.push({ id: 'ca_' + Date.now(), text, badge });
    document.getElementById('newCustomAdviceText').value = '';
    document.getElementById('newCustomAdviceBadge').value = '';
    renderCustomAdviceList();
    renderAll();
    persistStateToFirestore(true);
};

window.removeCustomAdviceMessage = function(idx) {
    appState.customAdvices.splice(idx, 1);
    renderCustomAdviceList();
    renderAll();
    persistStateToFirestore(true);
};
