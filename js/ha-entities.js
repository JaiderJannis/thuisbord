'use strict';
/* Home Assistant: entiteiten ophalen, auto-detectie en mapping */

function populateHaDatalist(states) {
    const countBadge = document.getElementById('haEntitiesCountBadge');
    if (countBadge) countBadge.textContent = `${states.length} entiteiten geladen`;

    const datalist = document.getElementById('haEntitiesDatalist');
    if (datalist) {
        datalist.innerHTML = states
            .filter(s =>
                s.entity_id.startsWith('sensor.') ||
                s.entity_id.startsWith('light.') ||
                s.entity_id.startsWith('switch.') ||
                s.entity_id.startsWith('cover.') ||
                s.entity_id.startsWith('climate.') ||
                s.entity_id.startsWith('vacuum.') ||
                s.entity_id.startsWith('lawn_mower.') ||
                s.entity_id.startsWith('calendar.') ||
                s.entity_id.startsWith('input_number.')
            )
            .map(s => {
                const friendly = s.attributes?.friendly_name || s.entity_id;
                const unit = s.attributes?.unit_of_measurement || '';
                return `<option value="${s.entity_id}">${friendly} (${s.state} ${unit})</option>`;
            }).join('');
    }
}

window.autoDetectShuttersAndClimate = function(silent = false) {
    if (!discoveredHaEntities || !discoveredHaEntities.length) {
        if (!silent) showToast("Verbind eerst met Home Assistant in Tabblad 2.");
        return;
    }
    const coverEntities = discoveredHaEntities.filter(s => s.entity_id.startsWith('cover.'));
    const climateEntities = discoveredHaEntities.filter(s => s.entity_id.startsWith('climate.'));
    const lightEntities = discoveredHaEntities.filter(s => s.entity_id.startsWith('light.'));

    const guessRoom = (friendlyName) => {
        const lower = (friendlyName || '').toLowerCase();
        if (!appState.rooms) appState.rooms = ["Woonkamer", "Keuken", "Slaapkamer"];
        for (const r of appState.rooms) {
            if (lower.includes(r.toLowerCase())) return r;
        }
        if (lower.includes('living') || lower.includes('woon') || lower.includes('zit')) return 'Woonkamer';
        if (lower.includes('keuken') || lower.includes('eet')) return 'Keuken';
        if (lower.includes('slaap') || lower.includes('bed')) return 'Slaapkamer';
        return appState.rooms[0] || 'Woonkamer';
    };

    if (lightEntities.length > 0) {
        appState.roomLights = lightEntities.map((lt, idx) => {
            const fname = lt.attributes?.friendly_name || lt.entity_id;
            const bri255 = lt.attributes?.brightness;
            const briPct = bri255 !== undefined ? Math.round((Number(bri255) / 255) * 100) : (lt.state === 'on' ? 100 : 0);
            return {
                id: 'lt_ha_' + idx,
                name: fname,
                room: guessRoom(fname),
                entityId: lt.entity_id,
                state: lt.state === 'on' ? 'on' : 'off',
                brightnessPct: briPct
            };
        });
    }

    if (coverEntities.length > 0) {
        appState.shutters = coverEntities.map((c, idx) => {
            const fname = c.attributes?.friendly_name || c.entity_id;
            return {
                id: 'sh_ha_' + idx,
                name: fname,
                room: guessRoom(fname),
                entityId: c.entity_id,
                state: c.state || 'open',
                position: c.attributes?.current_position ?? (c.state === 'closed' ? 0 : 100)
            };
        });
    }
    if (climateEntities.length > 0) {
        appState.climates = climateEntities.map((cl, idx) => {
            const fname = cl.attributes?.friendly_name || cl.entity_id;
            return {
                id: 'cl_ha_' + idx,
                name: fname,
                room: guessRoom(fname),
                entityId: cl.entity_id,
                hvacMode: cl.state || 'off',
                currentTemp: cl.attributes?.current_temperature ?? 21,
                targetTemp: cl.attributes?.temperature ?? 20,
                fanMode: cl.attributes?.fan_mode || 'auto',
                swingMode: cl.attributes?.swing_mode || 'off',
                hvacModes: cl.attributes?.hvac_modes || ["off", "cool", "heat", "heat_cool", "dry", "fan_only"],
                fanModes: cl.attributes?.fan_modes || ["auto", "low", "medium", "high"],
                swingModes: cl.attributes?.swing_modes || ["off", "vertical", "horizontal", "both"]
            };
        });
    }

    populateAdminInputs();
    renderAll();
    if (!silent) {
        showToast(`${lightEntities.length} lampen, ${coverEntities.length} rolluiken en ${climateEntities.length} airco's gevonden!`);
    }
};

window.autoDetectAndMapHaEntities = function(silent = false) {
    if (!discoveredHaEntities || discoveredHaEntities.length === 0) {
        if (!silent) showToast("Haal eerst je entiteiten op met knop 1.");
        return;
    }
    if (!appState.entityMap) appState.entityMap = {};
    const em = appState.entityMap;

    const findEntity = (domainPrefix, keywords, unitFilter = null) => {
        for (const kw of keywords) {
            const match = discoveredHaEntities.find(s => {
                if (domainPrefix && !s.entity_id.startsWith(domainPrefix)) return false;
                const idAndName = (s.entity_id + ' ' + (s.attributes?.friendly_name || '')).toLowerCase();
                const unit = (s.attributes?.unit_of_measurement || '').toLowerCase();
                const unitOk = !unitFilter || unitFilter.some(u => unit === u.toLowerCase());
                return unitOk && kw.every(word => idAndName.includes(word));
            });
            if (match) return match.entity_id;
        }
        return "";
    };

    if (!em.solarW) em.solarW = findEntity('sensor.', [['solar', 'power'], ['zon', 'vermogen'], ['pv', 'power'], ['inverter', 'power'], ['zonnepanelen']], ['w', 'kw']);
    if (!em.gridImportW) em.gridImportW = findEntity('sensor.', [['power_import'], ['import_power'], ['afname', 'vermogen'], ['grid_import']], ['w', 'kw']);
    if (!em.gridExportW) em.gridExportW = findEntity('sensor.', [['power_export'], ['export_power'], ['injectie', 'vermogen'], ['teruglevering', 'vermogen'], ['grid_export']], ['w', 'kw']);
    // HomeWizard P1 active_power hoort bij Net (gridW), zodat Huisverbruik netjes positief wordt berekend!
    if (!em.gridW) em.gridW = findEntity('sensor.', [['p1', 'active_power'], ['active_power'], ['grid', 'power'], ['net', 'vermogen']], ['w', 'kw']);
    if (!em.batteryW) em.batteryW = findEntity('sensor.', [['battery', 'power'], ['batterij', 'vermogen'], ['thuisbatterij', 'power']], ['w', 'kw']);
    if (!em.batteryPct) em.batteryPct = findEntity('sensor.', [['battery', 'soc'], ['battery', 'level'], ['batterij', 'percentage'], ['thuisbatterij']], ['%']);

    // HomeWizard Totaal-sensoren (Import T1/T2, Export T1/T2, Gas en Water) automatisch herkennen!
    if (!em.kwhImport) em.kwhImport = findEntity('sensor.', [['energie_import_vandaag'], ['import_today'], ['total_power_import_kwh'], ['total_power_import_t1']], ['kwh']);
    if (!em.kwhImportT2) em.kwhImportT2 = findEntity('sensor.', [['total_power_import_t2']], ['kwh']);
    if (!em.kwhExport) em.kwhExport = findEntity('sensor.', [['energie_export_vandaag'], ['export_today'], ['total_power_export_kwh'], ['total_power_export_t1']], ['kwh']);
    if (!em.kwhExportT2) em.kwhExportT2 = findEntity('sensor.', [['total_power_export_t2']], ['kwh']);
    if (!em.gasToday) em.gasToday = findEntity('sensor.', [['gas', 'today'], ['gas', 'vandaag'], ['total_gas'], ['gas']], ['m³', 'm3']);
    if (!em.waterRate) em.waterRate = findEntity('sensor.', [['water', 'active'], ['water', 'flow'], ['water', 'liter_per_minute']], ['l/min', 'l/m']);
    if (!em.waterTodayLiters) em.waterTodayLiters = findEntity('sensor.', [['water', 'today'], ['water', 'vandaag'], ['total_water'], ['watermeter_total']], ['l', 'm³', 'm3']);
    if (!em.kwhSolar) em.kwhSolar = findEntity('sensor.', [['solar', 'today'], ['zon', 'vandaag'], ['pv', 'daily'], ['energy_production_today']], ['kwh']);
    if (!em.monthlyPeakW) em.monthlyPeakW = findEntity('sensor.', [['peak', 'demand', 'month'], ['monthly', 'power', 'peak'], ['peak_demand_current_month'], ['piek', 'maand'], ['maandpiek'], ['capacity', 'peak']], ['w', 'kw']);
    if (!em.priceSensor) em.priceSensor = findEntity('sensor.', [['nordpool'], ['entsoe'], ['epex'], ['electricity_price'], ['stroomprijs']], null);

    if (!em.statusLamp) {
        em.statusLamp = findEntity('light.', [['pulse'], ['energie'], ['glow'], ['status'], ['woonkamer'], ['living'], ['lamp'], ['led']], null);
        if (!em.statusLamp) {
            const anyLight = discoveredHaEntities.find(s => s.entity_id.startsWith('light.'));
            if (anyLight) em.statusLamp = anyLight.entity_id;
        }
    }

    if (!em.waste_pmd) em.waste_pmd = findEntity('sensor.', [['pmd']], null);
    if (!em.waste_gft) em.waste_gft = findEntity('sensor.', [['gft'], ['groente']], null);
    if (!em.waste_papier) em.waste_papier = findEntity('sensor.', [['papier'], ['karton'], ['paper']], null);
    if (!em.waste_rest) em.waste_rest = findEntity('sensor.', [['restafval'], ['rest'], ['residual']], null);

    if (!em.calendarEntity) {
        const anyCal = discoveredHaEntities.find(s => s.entity_id.startsWith('calendar.'));
        if (anyCal) em.calendarEntity = anyCal.entity_id;
    }

    populateAdminInputs();
    window.syncHomeWizardMidnightBaselines(false);
    applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    if (!silent) showToast("HomeWizard, Energie-, Lamp- en Recycle-sensoren automatisch gekoppeld!");
};

window.fetchHomeAssistantEntities = async function(silent = false, autoMapIfEmpty = false) {
    const baseUrl = getCleanHaUrl();
    const token = (appState.haToken || "").trim();
    const statusBadge = document.getElementById('haConnectionBadge');

    if (!baseUrl || !token) {
        if (!silent) showToast("Vul eerst de Home Assistant URL én je Long-Lived Access Token in.");
        return;
    }

    connectHomeAssistantWebSocket();

    if (!silent && statusBadge) statusBadge.textContent = "⏳ Verbinden met Home Assistant...";

    try {
        const res = await fetch(`${baseUrl}/api/states`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const states = await res.json();
        discoveredHaEntities = states;
        haDirectRestConnected = true;

        populateHaDatalist(states);

        if (statusBadge) {
            statusBadge.textContent = haWsConnected ? "🟢 Realtime WebSocket + REST Actief" : "🟢 Live Verbonden met HA";
            statusBadge.className = "text-xs font-bold text-[#197447]";
        }

        const em = appState.entityMap || {};
        const hasAnyMapped = Object.values(em).some(v => v && v.trim() !== "");
        if (!hasAnyMapped || autoMapIfEmpty) {
            window.autoDetectAndMapHaEntities(true);
        }

        applyLiveStatesFromHomeAssistant(states);
        window.syncHomeWizardMidnightBaselines(false);

        if (!silent) showToast(`${states.length} Home Assistant entiteiten geladen & live gekoppeld!`);
    } catch (err) {
        haDirectRestConnected = false;
        console.warn("Home Assistant fetch error:", err);
        updateConnectionBadgesForCloudBridge();
        if (!silent) {
            if (isMobileOrHttpsMixedContentBlocked()) {
                showToast("iPhone blokkeert http:// op een https:// site. Gebruik de automatische Cloud-Bridge (via je pc) of een https:// HA-link!");
            } else {
                showToast("Kon Home Assistant niet direct bereiken. Controleer de verbinding.");
            }
        }
    }
};

window.saveEntityMapping = function() {
    if (!appState.entityMap) appState.entityMap = {};
    const keys = [
        'solarW','houseW','gridW','gridImportW','gridExportW','batteryW','batteryPct',
        'gasRate','gasToday','waterRate','waterTodayLiters','kwhImport','kwhImportT2','kwhExport','kwhExportT2',
        'kwhSolar','monthlyPeakW','priceSensor','statusLamp','waste_pmd','waste_gft','waste_papier','waste_rest','calendarEntity'
    ];
    keys.forEach(k => {
        const el = document.getElementById('map_' + k);
        if (el) appState.entityMap[k] = el.value.trim();
    });
    if (discoveredHaEntities.length > 0) {
        window.syncHomeWizardMidnightBaselines(false);
        applyLiveStatesFromHomeAssistant(discoveredHaEntities);
    }
};
