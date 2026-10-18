'use strict';
/* Home Assistant: WebSocket, service-calls en live states verwerken */

function getCleanHaUrl() {
    return (appState.haUrl || "").trim().replace(/\/+$/, "");
}

function connectHomeAssistantWebSocket() {
    const baseUrl = getCleanHaUrl();
    const token = (appState.haToken || "").trim();
    if (!baseUrl || !token) return;

    const wsUrl = baseUrl.replace(/^http/i, 'ws') + '/api/websocket';
    if (haWebSocket && haWsConnected && lastHaWsUrl === wsUrl) return;

    if (haWebSocket) {
        try { haWebSocket.close(); } catch (e) {}
    }

    try {
        haWebSocket = new WebSocket(wsUrl);
        lastHaWsUrl = wsUrl;

        haWebSocket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'auth_required') {
                    haWebSocket.send(JSON.stringify({
                        type: 'auth',
                        access_token: token
                    }));
                } else if (msg.type === 'auth_ok') {
                    haWsConnected = true;
                    const statusBadge = document.getElementById('haConnectionBadge');
                    if (statusBadge) {
                        statusBadge.textContent = "🟢 Realtime WebSocket Stream Actief";
                        statusBadge.className = "text-xs font-bold text-[#197447]";
                    }
                    const sourceText = document.getElementById('liveSensorSourceText');
                    if (sourceText) sourceText.textContent = "⚡ Realtime HA Stream";
                    haWebSocket.send(JSON.stringify({ id: 1, type: 'get_states' }));
                    haWebSocket.send(JSON.stringify({ id: 2, type: 'subscribe_events', event_type: 'state_changed' }));
                } else if (msg.type === 'result' && msg.id === 1 && Array.isArray(msg.result)) {
                    discoveredHaEntities = msg.result;
                    populateHaDatalist(discoveredHaEntities);
                    applyLiveStatesFromHomeAssistant(discoveredHaEntities);
                } else if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
                    const newState = msg.event.data?.new_state;
                    if (newState && newState.entity_id) {
                        const idx = discoveredHaEntities.findIndex(e => e.entity_id === newState.entity_id);
                        if (idx >= 0) {
                            discoveredHaEntities[idx] = newState;
                        } else {
                            discoveredHaEntities.push(newState);
                        }
                        applyLiveStatesFromHomeAssistant(discoveredHaEntities);
                    }
                }
            } catch (parseErr) {
                console.warn("HA WS parse error:", parseErr);
            }
        };

        haWebSocket.onclose = () => { haWsConnected = false; };
        haWebSocket.onerror = () => { haWsConnected = false; };
    } catch (e) {
        haWsConnected = false;
    }
}

window.callHomeAssistantService = async function(domain, service, serviceData = {}) {
    // 1. Als WebSocket open staat, stuur direct razendsnel via WebSocket
    if (haWebSocket && haWsConnected) {
        try {
            wsServiceCallId++;
            haWebSocket.send(JSON.stringify({
                id: wsServiceCallId,
                type: 'call_service',
                domain,
                service,
                service_data: serviceData
            }));
            return true;
        } catch (e) {
            console.warn("WS call_service fout:", e);
        }
    }

    // 2. Anders via REST API POST /api/services/<domain>/<service>
    const baseUrl = getCleanHaUrl();
    const token = (appState.haToken || "").trim();
    if (!baseUrl || !token) return false;

    try {
        const res = await fetch(`${baseUrl}/api/services/${domain}/${service}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(serviceData)
        });
        if (res.ok) {
            setTimeout(() => window.fetchHomeAssistantEntities(true), 600);
            return true;
        }
    } catch (err) {
        console.warn("HA REST service call error:", err);
    }
    return false;
};

function readNumericEntity(statesMap, entityId) {
    if (!entityId) return null;
    const found = statesMap.get(entityId.trim());
    if (!found) return null;
    const num = parseFloat(String(found.state).replace(',', '.'));
    if (isNaN(num)) return null;
    const unit = (found.attributes?.unit_of_measurement || '').toLowerCase();
    if (unit === 'kw') return num * 1000;
    return num;
}

// Leest een dag- of HomeWizard totaal-sensor uit (inclusief optionele T2 sensor en m³ -> Liter conversie voor water)
function readDailyOrTotalMeterValue(statesMap, entityId1, entityId2 = "", isWaterLiters = false) {
    if (!entityId1) return null;
    const st1 = statesMap.get(entityId1.trim());
    if (!st1) return null;
    let val1 = parseFloat(String(st1.state).replace(',', '.'));
    if (isNaN(val1)) return null;
    const unit1 = (st1.attributes?.unit_of_measurement || '').toLowerCase();
    if (isWaterLiters && (unit1 === 'm³' || unit1 === 'm3')) {
        val1 = val1 * 1000; // HomeWizard Watermeter geeft m³ -> omrekenen naar Liters!
    }

    let val2 = 0;
    if (entityId2 && statesMap.has(entityId2.trim())) {
        const st2 = statesMap.get(entityId2.trim());
        const parsed2 = parseFloat(String(st2.state).replace(',', '.'));
        if (!isNaN(parsed2)) val2 = parsed2;
    }

    const rawCombined = val1 + val2;
    const stateClass = (st1.attributes?.state_class || '').toLowerCase();
    const idLower = entityId1.toLowerCase();
    // Bepaal of dit een HomeWizard levenslange totaal-meterstand is (total_increasing / total) ipv een dag-sensor
    const isLifetimeCounter =
        (stateClass === 'total_increasing' || stateClass === 'total' || idLower.includes('total')) &&
        !idLower.includes('today') && !idLower.includes('vandaag') && !idLower.includes('daily');

    return { rawCombined, isLifetimeCounter, unit: unit1 };
}

// Haalt automatisch via Home Assistant /api/history/period de meterstand van vannacht 00:00 op voor HomeWizard totaal-sensoren!
window.syncHomeWizardMidnightBaselines = async function(showMsg = false) {
    const baseUrl = getCleanHaUrl();
    const token = (appState.haToken || "").trim();
    if (!baseUrl || !token) return;

    const todayStr = new Date().toISOString().slice(0, 10);
    if (!appState.midnightBaselines || appState.midnightBaselines.date !== todayStr) {
        appState.midnightBaselines = {
            date: todayStr,
            kwhImport: null,
            kwhExport: null,
            gasToday: null,
            waterToday: null
        };
    }

    const em = appState.entityMap || {};
    const entitiesToQuery = [em.kwhImport, em.kwhImportT2, em.kwhExport, em.kwhExportT2, em.gasToday, em.waterTodayLiters]
        .map(x => (x || "").trim())
        .filter(Boolean);

    if (entitiesToQuery.length === 0) return;

    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const isoStart = startOfDay.toISOString();
        const filterIds = entitiesToQuery.join(',');

        const res = await fetch(`${baseUrl}/api/history/period/${encodeURIComponent(isoStart)}?filter_entity_id=${encodeURIComponent(filterIds)}&minimal_response&no_attributes`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const historyArrays = await res.json();
            const firstValMap = new Map();
            if (Array.isArray(historyArrays)) {
                historyArrays.forEach(arr => {
                    if (Array.isArray(arr) && arr.length > 0) {
                        const eid = arr[0].entity_id;
                        const firstValid = arr.find(item => !isNaN(parseFloat(item.state)));
                        if (eid && firstValid) {
                            firstValMap.set(eid, parseFloat(firstValid.state));
                        }
                    }
                });
            }

            if (firstValMap.has(em.kwhImport?.trim())) {
                appState.midnightBaselines.kwhImport = firstValMap.get(em.kwhImport.trim()) + (firstValMap.get(em.kwhImportT2?.trim()) || 0);
            }
            if (firstValMap.has(em.kwhExport?.trim())) {
                appState.midnightBaselines.kwhExport = firstValMap.get(em.kwhExport.trim()) + (firstValMap.get(em.kwhExportT2?.trim()) || 0);
            }
            if (firstValMap.has(em.gasToday?.trim())) {
                appState.midnightBaselines.gasToday = firstValMap.get(em.gasToday.trim());
            }
            if (firstValMap.has(em.waterTodayLiters?.trim())) {
                let wBase = firstValMap.get(em.waterTodayLiters.trim());
                const stObj = discoveredHaEntities.find(s => s.entity_id === em.waterTodayLiters.trim());
                const unit = (stObj?.attributes?.unit_of_measurement || '').toLowerCase();
                if (unit === 'm³' || unit === 'm3') wBase = wBase * 1000;
                appState.midnightBaselines.waterToday = wBase;
            }

            lastMidnightHistorySyncDate = todayStr;
            if (discoveredHaEntities.length > 0) {
                applyLiveStatesFromHomeAssistant(discoveredHaEntities);
            }
            if (showMsg) showToast("00:00 meterstanden voor HomeWizard opgehaald! Dagverbruik klopt nu exact.");
        }
    } catch (e) {
        console.warn("Kon 00:00 history niet ophalen, gebruikt lokale start-baseline:", e);
    }
};

function hsToRgb(h, s) {
    const sNorm = s / 100;
    const c = sNorm;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
    else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
    else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
    else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
    else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const m = 1 - c;
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function applyLiveStatesFromHomeAssistant(statesArray) {
    if (!Array.isArray(statesArray) || statesArray.length === 0) return;
    const statesMap = new Map(statesArray.map(s => [s.entity_id, s]));
    const em = appState.entityMap || {};
    let anyUpdated = false;

    // 1. LIVE PULSE LAMP KLEUR & STATUS UITLEZEN
    if (em.statusLamp && statesMap.has(em.statusLamp.trim())) {
        const lampObj = statesMap.get(em.statusLamp.trim());
        const isOn = lampObj.state === 'on';
        appState.lampIsOn = isOn;
        appState.lampFriendlyName = lampObj.attributes?.friendly_name || em.statusLamp;

        if (isOn) {
            const rgb = lampObj.attributes?.rgb_color;
            const hs = lampObj.attributes?.hs_color;
            if (Array.isArray(rgb) && rgb.length === 3) {
                appState.lampColorHex = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            } else if (Array.isArray(hs) && hs.length === 2) {
                const [r, g, b] = hsToRgb(hs[0], hs[1]);
                appState.lampColorHex = `rgb(${r}, ${g}, ${b})`;
            } else {
                // Warm geel/groen als de lamp geen kleur-attribuut meestuurt maar wel AAN staat
                appState.lampColorHex = '#34d399';
            }
        } else {
            appState.lampColorHex = '#9ca3af'; // Grijs wanneer de lamp uit staat
        }
        anyUpdated = true;
    }

    // 2. LIVE RECYCLE / AFVALBEHEER SENSOREN UITLEZEN (PMD, GFT, Papier, Rest)
    const wasteDefinitions = [
        { key: 'waste_pmd', label: 'PMD (Plastic, Metaal & Drankkartons)', short: 'PMD', bg: 'bg-[#e0f2fe]', text: 'text-[#0369a1]', border: 'border-[#bae6fd]' },
        { key: 'waste_gft', label: 'Groente-, Fruit- en Tuinafval', short: 'GFT', bg: 'bg-[#dcece3]', text: 'text-[#1c643f]', border: 'border-[#bce3ce]' },
        { key: 'waste_papier', label: 'Papier & Karton', short: 'PAPIER', bg: 'bg-[#fef9c3]', text: 'text-[#854d0e]', border: 'border-[#fef08a]' },
        { key: 'waste_rest', label: 'Restafval', short: 'REST', bg: 'bg-stone-200', text: 'text-stone-700', border: 'border-stone-300' }
    ];
    const collectedWaste = [];
    wasteDefinitions.forEach(def => {
        const entityId = (em[def.key] || '').trim();
        if (entityId && statesMap.has(entityId)) {
            const stObj = statesMap.get(entityId);
            if (stObj.state && stObj.state !== 'unknown' && stObj.state !== 'unavailable') {
                const daysUntil = stObj.attributes?.Days_until ?? stObj.attributes?.days_until ?? null;
                collectedWaste.push({
                    ...def,
                    stateValue: stObj.state,
                    friendlyName: stObj.attributes?.friendly_name || def.label,
                    daysUntil
                });
            }
        }
    });
    if (collectedWaste.length > 0) {
        appState.liveWasteItems = collectedWaste;
        anyUpdated = true;
    }

    // 3. LIVE CALENDAR ENTITEIT VOOR AGENDA VANDAAG
    if (em.calendarEntity && statesMap.has(em.calendarEntity.trim())) {
        const calObj = statesMap.get(em.calendarEntity.trim());
        const msg = calObj.attributes?.message;
        const startTime = calObj.attributes?.start_time;
        if (msg && startTime) {
            const startDt = new Date(startTime);
            const nowDt = new Date();
            if (startDt.toDateString() === nowDt.toDateString()) {
                const timeFormatted = `${String(startDt.getHours()).padStart(2, '0')}:${String(startDt.getMinutes()).padStart(2, '0')}`;
                appState.haTodayEvents = [{ time: timeFormatted, title: msg }];
                anyUpdated = true;
            } else {
                appState.haTodayEvents = [];
            }
        }
    }

    // 4. ENERGIE, WATER, GAS & BATTERIJ UITLEZEN
    const solarVal = readNumericEntity(statesMap, em.solarW);
    if (solarVal !== null) {
        const cleanSolar = Math.max(0, Math.round(solarVal));
        if (appState.solarW !== cleanSolar) flashElementOnUpdate('valSolar');
        appState.solarW = cleanSolar;
        anyUpdated = true;
    }

    const gridImpVal = readNumericEntity(statesMap, em.gridImportW);
    const gridExpVal = readNumericEntity(statesMap, em.gridExportW);
    const gridCombVal = readNumericEntity(statesMap, em.gridW);

    if (gridImpVal !== null || gridExpVal !== null) {
        const newImp = gridImpVal !== null ? Math.max(0, Math.round(gridImpVal)) : 0;
        const newExp = gridExpVal !== null ? Math.max(0, Math.round(gridExpVal)) : 0;
        if (appState.gridImportW !== newImp || appState.gridExportW !== newExp) flashElementOnUpdate('valGrid');
        appState.gridImportW = newImp;
        appState.gridExportW = newExp;
        appState.gridW = newExp > newImp ? newExp : newImp;
        anyUpdated = true;
    } else if (gridCombVal !== null) {
        if (gridCombVal >= 0) {
            appState.gridImportW = Math.round(gridCombVal);
            appState.gridExportW = 0;
        } else {
            appState.gridImportW = 0;
            appState.gridExportW = Math.round(Math.abs(gridCombVal));
        }
        if (appState.gridW !== Math.round(Math.abs(gridCombVal))) flashElementOnUpdate('valGrid');
        appState.gridW = Math.round(Math.abs(gridCombVal));
        anyUpdated = true;
    }

    const batWVal = readNumericEntity(statesMap, em.batteryW);
    if (batWVal !== null) {
        const absBatW = Math.round(Math.abs(batWVal));
        if (appState.batteryW !== absBatW) flashElementOnUpdate('valBatteryW');
        appState.batteryW = absBatW;

        const convention = appState.batterySignConvention || 'negative_discharge';
        if (batWVal < 0) {
            appState.batteryMode = (convention === 'negative_discharge') ? 'discharging' : 'charging';
        } else if (batWVal > 0) {
            appState.batteryMode = (convention === 'positive_discharge') ? 'discharging' : 'charging';
        }
        anyUpdated = true;
    }

    // HUIS VERBRUIK (W): Altijd een positief getal, berekend zoals Home Assistant Energie-dashboard of uit eigen sensor
    const rawHouseSensorVal = readNumericEntity(statesMap, em.houseW);
    const calcMode = appState.houseCalcMode || 'ha_formula';
    // Als dezelfde P1-sensor per ongeluk bij Huis én Net staat, of als 'ha_formula' actief is, bereken het effectieve huisverbruik:
    // Huis = Zon + Net Import - Net Export + Batterij Ontladen - Batterij Laden
    const isSameAsGridSensor = em.houseW && (em.houseW === em.gridW || em.houseW.includes('active_power'));
    if (calcMode === 'ha_formula' || !em.houseW || isSameAsGridSensor || rawHouseSensorVal === null) {
        const batNetToHouse = (appState.batteryMode === 'discharging')
            ? Number(appState.batteryW || 0)
            : -Number(appState.batteryW || 0);
        const gridNetToHouse = Number(appState.gridImportW || 0) - Number(appState.gridExportW || 0);
        let computedHouseW = Math.round(Number(appState.solarW || 0) + gridNetToHouse + batNetToHouse);
        if (computedHouseW < 0 && rawHouseSensorVal !== null) {
            computedHouseW = Math.round(Math.abs(rawHouseSensorVal));
        }
        computedHouseW = Math.max(0, computedHouseW);
        if (appState.houseW !== computedHouseW) flashElementOnUpdate('valHouse');
        appState.houseW = computedHouseW;
        anyUpdated = true;
    } else if (rawHouseSensorVal !== null) {
        const posHouse = Math.round(Math.abs(rawHouseSensorVal));
        if (appState.houseW !== posHouse) flashElementOnUpdate('valHouse');
        appState.houseW = posHouse;
        anyUpdated = true;
    }

    const batPctVal = readNumericEntity(statesMap, em.batteryPct);
    if (batPctVal !== null) { appState.batteryPct = Math.round(batPctVal); anyUpdated = true; }

    const gasRateVal = readNumericEntity(statesMap, em.gasRate);
    if (gasRateVal !== null) { appState.gasRate = Math.max(0, gasRateVal); anyUpdated = true; }

    const waterRateVal = readNumericEntity(statesMap, em.waterRate);
    if (waterRateVal !== null) {
        if (appState.waterRate !== waterRateVal) flashElementOnUpdate('valWaterRate');
        appState.waterRate = Math.max(0, waterRateVal);
        anyUpdated = true;
    }

    // HOMEWIZARD DAGVERBRUIK BEREKENING (Afname vandaag, Export vandaag, Gas vandaag, Water vandaag)
    const todayStr = new Date().toISOString().slice(0, 10);
    if (!appState.midnightBaselines || appState.midnightBaselines.date !== todayStr) {
        appState.midnightBaselines = { date: todayStr, kwhImport: null, kwhExport: null, gasToday: null, waterToday: null };
        if (lastMidnightHistorySyncDate !== todayStr) {
            window.syncHomeWizardMidnightBaselines(false);
        }
    }
    const mb = appState.midnightBaselines;

    // 1. Afname vandaag (kWh) (ondersteunt T1 + T2 van HomeWizard)
    const impObj = readDailyOrTotalMeterValue(statesMap, em.kwhImport, em.kwhImportT2, false);
    if (impObj !== null) {
        if (impObj.isLifetimeCounter || impObj.rawCombined > 150) {
            if (mb.kwhImport === null || mb.kwhImport > impObj.rawCombined) mb.kwhImport = impObj.rawCombined;
            appState.kwhImport = Number(Math.max(0, impObj.rawCombined - mb.kwhImport).toFixed(2));
        } else {
            appState.kwhImport = Number(Math.max(0, impObj.rawCombined).toFixed(2));
        }
        anyUpdated = true;
    }

    // 2. Export vandaag (kWh) (ondersteunt T1 + T2 van HomeWizard)
    const expObj = readDailyOrTotalMeterValue(statesMap, em.kwhExport, em.kwhExportT2, false);
    if (expObj !== null) {
        if (expObj.isLifetimeCounter || expObj.rawCombined > 150) {
            if (mb.kwhExport === null || mb.kwhExport > expObj.rawCombined) mb.kwhExport = expObj.rawCombined;
            appState.kwhExport = Number(Math.max(0, expObj.rawCombined - mb.kwhExport).toFixed(2));
        } else {
            appState.kwhExport = Number(Math.max(0, expObj.rawCombined).toFixed(2));
        }
        anyUpdated = true;
    }

    // 3. Gas vandaag (m³) (berekent dagverbruik als HomeWizard total_gas bijv. 3065.48 m³ doorgeeft)
    const gasObj = readDailyOrTotalMeterValue(statesMap, em.gasToday, "", false);
    if (gasObj !== null) {
        if (gasObj.isLifetimeCounter || gasObj.rawCombined > 80) {
            if (mb.gasToday === null || mb.gasToday > gasObj.rawCombined) mb.gasToday = gasObj.rawCombined;
            appState.gasToday = Number(Math.max(0, gasObj.rawCombined - mb.gasToday).toFixed(2));
        } else {
            appState.gasToday = Number(Math.max(0, gasObj.rawCombined).toFixed(2));
        }
        anyUpdated = true;
    }

    // 4. Water vandaag (Liters) (rekent HomeWizard m³ automatisch × 1000 om naar Liters én trekt 00:00 stand eraf!)
    const waterObj = readDailyOrTotalMeterValue(statesMap, em.waterTodayLiters, "", true);
    if (waterObj !== null) {
        if (waterObj.isLifetimeCounter || waterObj.rawCombined > 2500) {
            if (mb.waterToday === null || mb.waterToday > waterObj.rawCombined) mb.waterToday = waterObj.rawCombined;
            appState.waterTodayLiters = Math.round(Math.max(0, waterObj.rawCombined - mb.waterToday));
        } else {
            appState.waterTodayLiters = Math.round(Math.max(0, waterObj.rawCombined));
        }
        anyUpdated = true;
    }

    const monthlyPeakVal = readNumericEntity(statesMap, em.monthlyPeakW);
    if (monthlyPeakVal !== null) { appState.monthlyPeakW = Math.max(0, Math.round(monthlyPeakVal)); anyUpdated = true; }

    const kwhSolarVal = readNumericEntity(statesMap, em.kwhSolar);
    if (kwhSolarVal !== null) { appState.kwhSolar = kwhSolarVal; anyUpdated = true; }

    (appState.appliances || []).forEach(app => {
        if (app.entityId) {
            const w = readNumericEntity(statesMap, app.entityId);
            if (w !== null) {
                app.watts = Math.round(w);
                app.active = app.watts > 2;
                anyUpdated = true;
            }
        }
    });

    // 5. LIVE ROLLUIKEN (COVER.*) UITLEZEN
    (appState.shutters || []).forEach(sh => {
        if (sh.entityId && statesMap.has(sh.entityId.trim())) {
            const stObj = statesMap.get(sh.entityId.trim());
            sh.state = stObj.state;
            if (stObj.attributes?.current_position !== undefined) {
                sh.position = Number(stObj.attributes.current_position);
            } else {
                sh.position = stObj.state === 'closed' ? 0 : 100;
            }
            anyUpdated = true;
        }
    });

    // 6. LIVE AIRCO'S (CLIMATE.*) UITLEZEN
    (appState.climates || []).forEach(cl => {
        if (cl.entityId && statesMap.has(cl.entityId.trim())) {
            const stObj = statesMap.get(cl.entityId.trim());
            cl.hvacMode = stObj.state;
            if (stObj.attributes?.current_temperature !== undefined) {
                cl.currentTemp = Number(stObj.attributes.current_temperature);
            }
            if (stObj.attributes?.temperature !== undefined) {
                cl.targetTemp = Number(stObj.attributes.temperature);
            }
            if (stObj.attributes?.fan_mode) cl.fanMode = stObj.attributes.fan_mode;
            if (stObj.attributes?.swing_mode) cl.swingMode = stObj.attributes.swing_mode;
            if (Array.isArray(stObj.attributes?.hvac_modes)) cl.hvacModes = stObj.attributes.hvac_modes;
            if (Array.isArray(stObj.attributes?.fan_modes)) cl.fanModes = stObj.attributes.fan_modes;
            if (Array.isArray(stObj.attributes?.swing_modes)) cl.swingModes = stObj.attributes.swing_modes;
            anyUpdated = true;
        }
    });

    // 7. LIVE KAMER-LAMPEN (LIGHT.*) UITLEZEN
    (appState.roomLights || []).forEach(lt => {
        if (lt.entityId && statesMap.has(lt.entityId.trim())) {
            const stObj = statesMap.get(lt.entityId.trim());
            lt.state = stObj.state === 'on' ? 'on' : 'off';
            if (stObj.attributes?.brightness !== undefined) {
                lt.brightnessPct = Math.round((Number(stObj.attributes.brightness) / 255) * 100);
            } else if (lt.state === 'on' && !lt.brightnessPct) {
                lt.brightnessPct = 100;
            }
            anyUpdated = true;
        }
    });

    // 8. LIVE ROBOTSTOFZUIGER & ROBOTMAAIER UITLEZEN
    (appState.robots || []).forEach(rob => {
        if (rob.entityId && statesMap.has(rob.entityId.trim())) {
            const stObj = statesMap.get(rob.entityId.trim());
            rob.state = stObj.state;
            const bat = stObj.attributes?.battery_level ?? stObj.attributes?.battery;
            if (bat !== undefined && !isNaN( parseFloat(bat) )) {
                rob.batteryPct = Math.round(parseFloat(bat));
            }
            anyUpdated = true;
        }
    });

    if (em.priceSensor && statesMap.has(em.priceSensor.trim())) {
        const priceStateObj = statesMap.get(em.priceSensor.trim());
        const attrs = priceStateObj.attributes || {};
        if (Array.isArray(attrs.today) && attrs.today.length >= 24) {
            appState.hourlyPrices = attrs.today.slice(0, 24).map(v => Number(v) || 0);
            anyUpdated = true;
        } else if (Array.isArray(attrs.prices_today) && attrs.prices_today.length >= 24) {
            appState.hourlyPrices = attrs.prices_today.slice(0, 24).map(v => Number(v.price ?? v) || 0);
            anyUpdated = true;
        }
        if (Array.isArray(attrs.tomorrow) && attrs.tomorrow.length >= 24) {
            appState.tomorrowPrices = attrs.tomorrow.slice(0, 24).map(v => Number(v) || 0);
            anyUpdated = true;
        } else if (Array.isArray(attrs.prices_tomorrow) && attrs.prices_tomorrow.length >= 24) {
            appState.tomorrowPrices = attrs.prices_tomorrow.slice(0, 24).map(v => Number(v.price ?? v) || 0);
            anyUpdated = true;
        }
    }

    if (anyUpdated) {
        const sourceText = document.getElementById('liveSensorSourceText');
        if (sourceText) sourceText.textContent = haWsConnected ? "⚡ Realtime HA Stream" : "🟢 Live HA Sensoren";
        pushLivePowerPoint(appState.solarW, appState.houseW);
        renderAll();
        // Stuur deze echte Home Assistant waardes direct door naar Firebase zodat smartphones (iPhone/Android) ze live ontvangen!
        pushLiveTelemetryToCloudBridge();
    }
}
