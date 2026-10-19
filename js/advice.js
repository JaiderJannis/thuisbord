'use strict';
/* Advies-banner en eigen adviesberichten */

function buildLiveAdvicePool() {
    const pool = [];
    const effectiveToday = getEffectivePricesArray('today');
    const effectiveTomorrow = getEffectivePricesArray('tomorrow');
    const realNowHour = new Date().getHours();
    const currentPrice = effectiveToday[realNowHour] ?? 0.25;
    const { minHour, maxHour } = updateExtremePriceWindows('today');
    const pad = (n) => String(n).padStart(2, '0') + ':00';

    if (currentPrice <= effectiveToday[minHour] + 0.02) {
        pool.push({
            category: "SLIM TARIEF ADVIES • NU",
            text: `Stroom is nu goedkoop (${formatEuro(currentPrice)}/kWh), gunstig venster tot ${pad(minHour + 2)}. Zet de wasmachine of vaatwasser nu aan.`,
            badge: `Gunstig tot ${pad(minHour + 2)}`,
            theme: "green"
        });
    } else if (currentPrice >= effectiveToday[maxHour] - 0.03) {
        pool.push({
            category: "PIEKTARIEF WAARSCHUWING • NU",
            text: `Let op: stroom is op dit moment duur (${formatEuro(currentPrice)}/kWh). Stel grote verbruikers uit tot na ${pad(maxHour + 2)}.`,
            badge: `Piek tot ${pad(maxHour + 2)}`,
            theme: "orange"
        });
    } else {
        pool.push({
            category: "ADVIES VOOR NU",
            text: `Stroomprijs nu ${formatEuro(currentPrice)}/kWh. Goedkoopste blok vandaag: ${pad(minHour)} – ${pad(minHour + 2)} (${formatEuro(effectiveToday[minHour])}).`,
            badge: `Dal: ${pad(minHour)}`,
            theme: "green"
        });
    }

    if (effectiveTomorrow.length === 24) {
        let minTomIdx = 0;
        for (let h = 1; h < 24; h++) {
            if (effectiveTomorrow[h] < effectiveTomorrow[minTomIdx]) minTomIdx = h;
        }
        pool.push({
            category: "VOORSPELLING MORGEN",
            text: `Morgen is de stroom het goedkoopst rond ${pad(minTomIdx)} voor ${formatEuro(effectiveTomorrow[minTomIdx])}/kWh.`,
            badge: `Morgen ${pad(minTomIdx)}: ${formatEuro(effectiveTomorrow[minTomIdx])}`,
            theme: "green"
        });
    }

    if (Number(appState.solarW) > Number(appState.houseW)) {
        const surplusW = Number(appState.solarW) - Number(appState.houseW);
        pool.push({
            category: "ZONNE-ENERGIE LIVE",
            text: `Je zonnepanelen leveren nu ${surplusW} W méér dan het huis verbruikt! Batterij staat op ${appState.batteryPct}%.`,
            badge: `+${surplusW} W Zon-overschot`,
            theme: "green"
        });
    }

    const activeApps = (appState.appliances || []).filter(a => a.active && Number(a.watts) > 0);
    if (activeApps.length > 0) {
        const names = activeApps.map(a => `${a.icon} ${a.name} (${a.watts}W)`).join(', ');
        pool.push({
            category: "ACTIEVE APPARATEN IN HUIS",
            text: `Momenteel actief in huis: ${names}.`,
            badge: `${activeApps.length} apparaat actief`,
            theme: "green"
        });
    }

    (appState.customAdvices || []).forEach((ca) => {
        pool.push({
            category: "BERICHT VOOR HET GEZIN",
            text: ca.text,
            badge: ca.badge || "Melding",
            theme: "green"
        });
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
