'use strict';
/* Weer-gestuurde tips voor het adviesbord. Zuivere functie weatherTipsFrom(): krijgt de verwerkte voorspelling
   (zie weather.js) en de gegevens van het huis en geeft een lijst { category, text, badge, theme } terug. */

function weatherTipsFrom(w, ctx) {
    const tips = [];
    if (!w || !w.cur || !Array.isArray(w.daily) || !w.daily.length) return tips;
    ctx = ctx || {};
    const cur = w.cur, today = w.daily[0], tomorrow = w.daily[1];
    const hourly = Array.isArray(w.hourly) ? w.hourly : [];
    const rain = Array.isArray(w.rain) ? w.rain : [];
    const mowing = !!ctx.mowing, hasMower = !!ctx.hasMower, hasDryer = !!ctx.hasDryer;
    const add = (category, text, badge, theme) => tips.push({ category, text, badge, theme: theme || 'green' });

    // 1. Regen binnen het uur
    const wetIdx = rain.findIndex(r => r.mm >= 0.1);
    if (wetIdx > 0 && wetIdx <= 4) {
        const min = wetIdx * 15;
        add('REGEN OP KOMST', mowing ? `Over ongeveer ${min} min begint het te regenen en de robotmaaier is nog aan het werk. Stuur hem terug naar het dock.` : `Over ongeveer ${min} min begint het te regenen. Haal de was binnen en zet ramen en dakramen dicht.`, `Regen over ${min} min`, 'orange');
    } else if (wetIdx === 0 && mowing) {
        add('REGEN • ROBOTMAAIER', 'Het regent en de robotmaaier is nog bezig. Laat hem beter in het dock wachten tot het droog is.', 'Maaier terug', 'orange');
    }

    // 2. Droog en winderig: ideaal om buiten te drogen
    const dryDay = (today.pop || 0) <= 20 && (today.precip || 0) < 0.5;
    if (dryDay && cur.isDay && cur.wind >= 12 && cur.wind < 40 && cur.temp >= 8 && (cur.code === 0 || cur.code === 1 || cur.code === 2)) {
        add('WAS BUITEN DROGEN', `Droog, ${Math.round(cur.wind)} km/u wind en ${Math.round(cur.temp)}°: een prima dag om de was buiten te hangen in plaats van de droger te gebruiken.`, 'Droogweer');
    } else if (!dryDay && hasDryer && (today.pop || 0) >= 60) {
        add('REGENACHTIGE DAG', `Vandaag ${Math.round(today.pop)}% kans op regen. Gebruik de droger, liefst op een goedkoop uur, en hang de was niet buiten.`, 'Droger gebruiken', 'orange');
    }

    // 3. Vorst
    const frostTonight = Math.min(...hourly.slice(0, 14).map(h => Number(h.temp)).filter(n => !isNaN(n)), Infinity);
    const frostTomorrow = tomorrow ? Number(tomorrow.min) : Infinity;
    const minTemp = Math.min(isFinite(frostTonight) ? frostTonight : Infinity, isNaN(frostTomorrow) ? Infinity : frostTomorrow);
    if (isFinite(minTemp) && minTemp <= 0) {
        add('VORST', `Vannacht ${minTemp <= -3 ? 'strenge vorst' : 'vorst'} (${Math.round(minTemp)}°). Sluit de buitenkraan af, haal gevoelige planten binnen en trek de robotmaaier uit het gras.`, `${Math.round(minTemp)}° vannacht`, 'orange');
    } else if (isFinite(minTemp) && minTemp <= 3) {
        add('KANS OP NACHTVORST', `Het koelt af tot ${Math.round(minTemp)}°. Gevoelige planten buiten kunnen beter binnen of onder een doek.`, `${Math.round(minTemp)}° vannacht`, 'orange');
    }

    // 4. Hitte
    if (today.max >= 28) {
        add('HITTE', `Vandaag tot ${Math.round(today.max)}°. Houd de rolluiken aan de zonzijde dicht, lucht 's ochtends en 's avonds en laat de airco koelen waar het nodig is.`, `${Math.round(today.max)}° verwacht`, 'orange');
    } else if (tomorrow && tomorrow.max >= 28) {
        add('HITTE MORGEN', `Morgen tot ${Math.round(tomorrow.max)}°. Lucht vanavond goed en sluit morgenvroeg de rolluiken aan de zonzijde.`, `${Math.round(tomorrow.max)}° morgen`, 'orange');
    }

    // 5. Veel wind
    if (cur.wind >= 50) {
        add('STORMACHTIG', `Windkracht ${Math.round(cur.wind)} km/u. Zet parasols en tuinmeubelen vast en laat de rolluiken niet half open staan.`, `${Math.round(cur.wind)} km/u`, 'orange');
    }

    // 6. Veel regen vandaag of morgen: gras en maaier
    if (hasMower && !mowing && ((today.precip || 0) >= 8 || (tomorrow && (tomorrow.precip || 0) >= 8))) {
        add('NAT GRAS', 'Er komt veel regen. Nat gras maait slecht: laat de robotmaaier even rusten.', 'Maaier rust', 'orange');
    }
    return tips;
}

function weatherTipsLive() {
    if (typeof weatherData === 'undefined' || !weatherData) return [];
    const robots = (appState && appState.robots) || [];
    const mowers = robots.filter(r => r && (r.type === 'mower' || String(r.entityId || '').startsWith('lawn_mower.')));
    const dryer = ((appState && appState.laundry && appState.laundry.devices) || []).some(d => d && d.kind === 'dryer');
    return weatherTipsFrom(weatherData, { hasMower: mowers.length > 0, mowing: mowers.some(r => r.state === 'mowing'), hasDryer: dryer });
}
