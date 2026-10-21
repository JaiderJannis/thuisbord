'use strict';
/* Weer: huidige weer + voorspelling via Open-Meteo (gratis, geen sleutel), regenradar via RainViewer, kaart via Leaflet (maps.js).
   Locatie: uit Home Assistant (zone.home) of handmatig/zoeken op plaatsnaam (Beheer → Weer).
   appState.weather = { source: 'ha' | 'manual', lat, lon, name } */

const WEATHER_REFRESH_MS = 15 * 60 * 1000;
const RADAR_REFRESH_MS = 5 * 60 * 1000;
const RADAR_FRAME_MS = 650;

// Weercodes (WMO) -> [emoji dag, emoji nacht, tekst]
const WMO = {
    0: ['☀️', '🌙', 'Helder'], 1: ['🌤️', '🌙', 'Overwegend helder'], 2: ['⛅', '☁️', 'Licht bewolkt'], 3: ['☁️', '☁️', 'Bewolkt'],
    45: ['🌫️', '🌫️', 'Mist'], 48: ['🌫️', '🌫️', 'Rijpmist'],
    51: ['🌦️', '🌧️', 'Lichte motregen'], 53: ['🌦️', '🌧️', 'Motregen'], 55: ['🌧️', '🌧️', 'Dichte motregen'],
    56: ['🌧️', '🌧️', 'Ijzelmotregen'], 57: ['🌧️', '🌧️', 'Zware ijzelmotregen'],
    61: ['🌦️', '🌧️', 'Lichte regen'], 63: ['🌧️', '🌧️', 'Regen'], 65: ['🌧️', '🌧️', 'Zware regen'],
    66: ['🌧️', '🌧️', 'Ijzelregen'], 67: ['🌧️', '🌧️', 'Zware ijzelregen'],
    71: ['🌨️', '🌨️', 'Lichte sneeuw'], 73: ['🌨️', '🌨️', 'Sneeuw'], 75: ['❄️', '❄️', 'Zware sneeuw'], 77: ['🌨️', '🌨️', 'Sneeuwkorrels'],
    80: ['🌦️', '🌧️', 'Lichte buien'], 81: ['🌧️', '🌧️', 'Buien'], 82: ['⛈️', '⛈️', 'Zware buien'],
    85: ['🌨️', '🌨️', 'Sneeuwbuien'], 86: ['🌨️', '🌨️', 'Zware sneeuwbuien'],
    95: ['⛈️', '⛈️', 'Onweer'], 96: ['⛈️', '⛈️', 'Onweer met hagel'], 99: ['⛈️', '⛈️', 'Zwaar onweer met hagel']
};

let weatherData = null;           // verwerkte voorspelling
let weatherFetchedAt = 0;
let weatherFetchKey = '';
let weatherFetching = false;
let weatherError = '';
let weatherViewHtmlCache = '';
let weatherSearchResults = [];
let weatherSearchBusy = false;

function ensureWeather() {
    if (!appState.weather || typeof appState.weather !== 'object') appState.weather = { source: 'ha', lat: '', lon: '', name: '' };
    if (appState.weather.source !== 'manual') appState.weather.source = 'ha';
    return appState.weather;
}

/* ============================ LOCATIE ============================ */

// Locatie van het huis volgens Home Assistant (zone.home)
function weatherHomeFromHA() {
    const z = (discoveredHaEntities || []).find(s => s && s.entity_id === 'zone.home');
    const a = z && z.attributes;
    if (a && mapsValidCoord(a.latitude, a.longitude)) {
        return { lat: Number(a.latitude), lon: Number(a.longitude), name: a.friendly_name || 'Thuis' };
    }
    return null;
}

// De locatie die nu geldt: handmatig als gekozen, anders Home Assistant
function weatherLocation() {
    const cfg = ensureWeather();
    if (cfg.source === 'manual' && mapsValidCoord(cfg.lat, cfg.lon)) {
        return { lat: Number(cfg.lat), lon: Number(cfg.lon), name: cfg.name || 'Gekozen locatie', from: 'manual' };
    }
    const ha = weatherHomeFromHA();
    return ha ? { ...ha, from: 'ha' } : null;
}

// Wordt ook door de autokaart gebruikt om het huis aan te geven
function weatherHomeLocation() { return weatherLocation(); }

/* ============================ GEGEVENS ============================ */

function weatherCodeInfo(code, isDay = true) {
    const row = WMO[Number(code)] || ['🌡️', '🌡️', 'Onbekend weer'];
    return { icon: isDay ? row[0] : row[1], text: row[2] };
}

function weatherCompass(deg) {
    const names = ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW'];
    const d = Number(deg);
    return isNaN(d) ? '' : names[Math.round(((d % 360) + 360) % 360 / 45) % 8];
}

// Zet het antwoord van Open-Meteo om naar wat de schermen nodig hebben. Zuivere functie (testbaar).
function weatherParse(j) {
    if (!j || !j.current || !j.hourly || !j.daily) return null;
    const c = j.current;
    const nowStr = String(c.time || '');
    const isDayNow = c.is_day === 1 || c.is_day === true;
    const cur = {
        time: nowStr, temp: Number(c.temperature_2m), feels: Number(c.apparent_temperature), humidity: Number(c.relative_humidity_2m),
        precip: Number(c.precipitation) || 0, code: Number(c.weather_code), isDay: isDayNow,
        wind: Number(c.wind_speed_10m), windDir: Number(c.wind_direction_10m)
    };
    const h = j.hourly;
    const hourly = [];
    const hourStart = nowStr.slice(0, 13); // "YYYY-MM-DDTHH"
    (h.time || []).forEach((t, i) => {
        if (String(t).slice(0, 13) < hourStart || hourly.length >= 24) return;
        const hh = Number(String(t).slice(11, 13));
        hourly.push({ time: t, hour: hh, temp: Number(h.temperature_2m[i]), code: Number(h.weather_code[i]), pop: Number(h.precipitation_probability ? h.precipitation_probability[i] : 0) || 0, precip: Number(h.precipitation ? h.precipitation[i] : 0) || 0, isDay: hh >= 7 && hh < 20 });
    });
    const d = j.daily;
    const daily = (d.time || []).map((t, i) => ({
        date: t, code: Number(d.weather_code[i]), max: Number(d.temperature_2m_max[i]), min: Number(d.temperature_2m_min[i]),
        precip: Number(d.precipitation_sum ? d.precipitation_sum[i] : 0) || 0, pop: Number(d.precipitation_probability_max ? d.precipitation_probability_max[i] : 0) || 0,
        sunrise: d.sunrise ? d.sunrise[i] : '', sunset: d.sunset ? d.sunset[i] : ''
    }));
    const m = j.minutely_15;
    const rain = [];
    if (m && Array.isArray(m.time)) {
        m.time.forEach((t, i) => { if (String(t) >= nowStr.slice(0, 16) || rain.length) { if (rain.length < 8) rain.push({ time: t, mm: Number(m.precipitation[i]) || 0 }); } });
    }
    return { cur, hourly, daily, rain };
}

// Korte tekst over de regen van de komende 2 uur
function weatherRainSummary(rain) {
    if (!rain || !rain.length) return null;
    const idx = rain.findIndex(r => r.mm >= 0.1);
    if (idx === -1) return { text: 'Droog de komende 2 uur', wet: false };
    if (idx === 0) {
        const dry = rain.findIndex(r => r.mm < 0.1);
        return { text: dry === -1 ? 'Het regent nu, en dat blijft de komende 2 uur zo' : `Het regent nu, droog over ongeveer ${dry * 15} min`, wet: true };
    }
    return { text: `Regen over ongeveer ${idx * 15} min`, wet: true };
}

async function weatherFetch(force = false) {
    const loc = weatherLocation();
    if (!loc || weatherFetching) return;
    const key = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
    if (!force && key === weatherFetchKey && Date.now() - weatherFetchedAt < WEATHER_REFRESH_MS) return;
    weatherFetching = true;
    try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon
            + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day'
            + '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code'
            + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset'
            + '&minutely_15=precipitation&forecast_minutely_15=12&forecast_days=7&timezone=auto&wind_speed_unit=kmh';
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), 12000) : null;
        const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const parsed = weatherParse(await res.json());
        if (!parsed) throw new Error('Onverwacht antwoord');
        weatherData = parsed;
        weatherFetchKey = key;
        weatherFetchedAt = Date.now();
        weatherError = '';
    } catch (e) {
        weatherError = 'Weer kon niet worden opgehaald.';
    } finally {
        weatherFetching = false;
    }
    renderWeatherHeader();
    renderWeatherView();
}

// Elke halve minuut: locatie nagaan en zo nodig vernieuwen (locatie uit HA is er pas als de entiteiten geladen zijn)
function weatherTick() {
    const loc = weatherLocation();
    if (!loc) { renderWeatherHeader(); return; }
    const key = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
    if (key !== weatherFetchKey || Date.now() - weatherFetchedAt >= WEATHER_REFRESH_MS) weatherFetch(key !== weatherFetchKey);
}

/* ============================ HEADER ============================ */

function renderWeatherHeader() {
    const allowed = typeof permAllowed !== 'function' || !currentRole || permAllowed('view_weather');
    const line = document.getElementById('liveWeather');
    const icon = document.getElementById('headerWeatherIcon');
    const badge = document.getElementById('menuWeatherBadge');
    if (!weatherData || !allowed) {
        if (line) { line.classList.add('hidden'); line.textContent = ''; }
        if (badge) badge.textContent = '';
        return;
    }
    const c = weatherData.cur;
    const info = weatherCodeInfo(c.code, c.isDay);
    const t = Math.round(c.temp);
    if (line) { line.textContent = `${info.icon} ${t}° ${info.text}`; line.classList.remove('hidden'); }
    if (icon) icon.textContent = info.icon;
    if (badge) badge.textContent = `${t}°`;
}

/* ============================ SCHERM ============================ */

function weatherDayLabel(dateStr, i) {
    if (i === 0) return 'Vandaag';
    if (i === 1) return 'Morgen';
    const d = new Date(dateStr + 'T12:00:00');
    return new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric' }).format(d);
}

function renderWeatherView() {
    const container = document.getElementById('weatherContainer');
    const view = document.getElementById('viewWeather');
    if (!container || (view && view.classList.contains('hidden'))) return;
    const loc = weatherLocation();
    let html;
    if (!loc) {
        html = `<p class="text-sm text-[#68736d] bg-white rounded-2xl p-6">Er is nog geen locatie. ${(discoveredHaEntities || []).length ? 'Home Assistant heeft geen locatie van het huis (zone.home) doorgegeven.' : 'Koppel Home Assistant, of kies zelf een plaats'} via Beheer → 🌦️ Weer.</p>`;
    } else if (!weatherData) {
        html = `<p class="text-sm text-[#68736d] bg-white rounded-2xl p-6">${weatherError || 'Weer laden…'}</p>${weatherRadarCardHtml(loc)}`;
    } else {
        const { cur, hourly, daily, rain } = weatherData;
        const info = weatherCodeInfo(cur.code, cur.isDay);
        const today = daily[0] || {};
        const sun = (s) => String(s || '').slice(11, 16);
        const lo = Math.min(...daily.map(d => d.min)), hi = Math.max(...daily.map(d => d.max));
        const span = Math.max(1, hi - lo);
        html = `
            <section class="bg-white rounded-[26px] p-6 shadow-sm flex flex-col sm:flex-row sm:items-center gap-5">
                <div class="text-7xl leading-none">${info.icon}</div>
                <div class="flex-1 min-w-0">
                    <p class="text-5xl font-extrabold text-[#1c2520] leading-none">${Math.round(cur.temp)}°<span class="text-xl sm:text-2xl font-semibold text-[#68736d] ml-3">${haEscape(info.text)}</span></p>
                    <p class="text-sm text-[#68736d] mt-2">Voelt als ${Math.round(cur.feels)}° · wind ${Math.round(cur.wind)} km/u ${weatherCompass(cur.windDir)} · luchtvochtigheid ${Math.round(cur.humidity)}%</p>
                    <p class="text-xs font-semibold text-[#68736d] mt-1">${loc ? '📍 ' + haEscape(loc.name) : ''}${today.max !== undefined ? ` · ↑ ${Math.round(today.max)}° ↓ ${Math.round(today.min)}°` : ''}${today.sunrise ? ` · 🌅 ${sun(today.sunrise)} · 🌇 ${sun(today.sunset)}` : ''}</p>
                </div>
            </section>

            ${weatherRadarCardHtml(loc)}

            <section class="bg-white rounded-[26px] p-6 shadow-sm">
                <h3 class="text-base font-bold text-[#1c2520] mb-3">Komende 24 uur</h3>
                <div class="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">${hourly.map((h, i) => {
                    const hi2 = weatherCodeInfo(h.code, h.isDay);
                    return `<div class="shrink-0 w-14 text-center rounded-2xl bg-[#f6f8f5] py-2.5 px-1">
                        <p class="text-[11px] font-bold text-[#68736d]">${i === 0 ? 'nu' : String(h.hour).padStart(2, '0') + 'u'}</p>
                        <p class="text-xl my-1">${hi2.icon}</p>
                        <p class="text-sm font-extrabold text-[#1c2520]">${Math.round(h.temp)}°</p>
                        <p class="text-[10px] font-bold ${h.pop >= 30 ? 'text-[#2b6fb5]' : 'text-[#a3aca7]'}">${h.pop >= 10 ? h.pop + '%' : '·'}</p>
                    </div>`;
                }).join('')}</div>
            </section>

            <section class="bg-white rounded-[26px] p-6 shadow-sm">
                <h3 class="text-base font-bold text-[#1c2520] mb-3">Komende 7 dagen</h3>
                <div class="divide-y divide-stone-100">${daily.map((d, i) => {
                    const di = weatherCodeInfo(d.code, true);
                    const left = Math.round((d.min - lo) / span * 100), width = Math.max(6, Math.round((d.max - d.min) / span * 100));
                    return `<div class="flex items-center gap-3 py-2.5">
                        <span class="w-20 text-sm font-bold text-[#1c2520] capitalize">${haEscape(weatherDayLabel(d.date, i))}</span>
                        <span class="text-xl w-8 text-center" title="${haEscape(di.text)}">${di.icon}</span>
                        <span class="w-10 text-[11px] font-bold ${d.pop >= 30 ? 'text-[#2b6fb5]' : 'text-[#a3aca7]'}">${d.pop >= 10 ? d.pop + '%' : ''}</span>
                        <span class="w-8 text-right text-sm text-[#68736d]">${Math.round(d.min)}°</span>
                        <span class="flex-1 h-1.5 rounded-full bg-stone-200 relative"><span class="absolute h-full rounded-full bg-gradient-to-r from-[#7fb4e6] to-[#f0a030]" style="left:${left}%;width:${width}%"></span></span>
                        <span class="w-8 text-sm font-extrabold text-[#1c2520]">${Math.round(d.max)}°</span>
                    </div>`;
                }).join('')}</div>
            </section>
            <p class="text-[10.5px] text-[#8a958f] px-1">Weer: <a href="https://open-meteo.com/" target="_blank" rel="noopener" class="underline">Open-Meteo</a>${weatherFetchedAt ? ` · bijgewerkt ${new Date(weatherFetchedAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` : ''}${weatherError ? ' · ' + haEscape(weatherError) : ''}</p>`;
    }
    if (html !== weatherViewHtmlCache) {
        weatherViewHtmlCache = html;
        container.innerHTML = html;
    }
    weatherMountRadar();
}

/* ============================ REGENRADAR ============================ */

const radar = { frames: [], host: '', idx: 0, playing: true, timer: null, fetchedAt: 0, layers: [], active: false, loading: false, error: '', holder: null };
// Voorspelling (KNMI, via je pushserver): kaartbeelden van nu tot +2 uur
const radarFc = { on: false, times: [], layers: [], urls: [], busy: false, again: false, fetchedAt: 0, moveTimer: null };

function radarFcProject(lat, lon) {
    const R = 6378137, la = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
    return [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + la / 2))];
}
// Kaartvenster -> GetMap-vraag in meters (EPSG:3857) en een beeldgrootte met dezelfde verhouding (max 800 px)
function radarFcRequest(b, wPx, hPx) {
    const sw = radarFcProject(b.south, b.west), ne = radarFcProject(b.north, b.east);
    const k = Math.min(1, 800 / Math.max(wPx, hPx, 1));
    return { bbox: [sw[0], sw[1], ne[0], ne[1]].map(Math.round), w: Math.max(64, Math.round(wPx * k)), h: Math.max(64, Math.round(hPx * k)) };
}
function radarFcLabel(iso, now) {
    const t = Date.parse(iso);
    if (isNaN(t)) return '';
    const min = Math.round((t - (now === undefined ? Date.now() : now)) / 60000);
    if (Math.abs(min) <= 5) return 'nu';
    const a = Math.abs(min), txt = a >= 60 ? `${Math.floor(a / 60)} u${a % 60 ? ' ' + (a % 60) + ' min' : ''}` : `${a} min`;
    return (min > 0 ? '+' : '−') + txt;
}
// Het beeldenstel dat nu getoond wordt: verleden (RainViewer) of voorspelling (KNMI)
function radarSet() {
    if (radarFc.on) return { fc: true, layers: radarFc.layers, times: radarFc.times };
    return { fc: false, layers: radar.layers, times: radar.frames.map(f => f.time) };
}

// Verwachting voor de komende 2 uur (Open-Meteo, per kwartier). De radar zelf toont enkel het verleden: RainViewer stopte de voorspelling op 1 januari 2026.
function weatherRainForecastHtml() {
    const rain = weatherData && weatherData.rain, summary = weatherRainSummary(rain);
    if (!summary) return '';
    const maxMm = Math.max(1, ...rain.map(r => r.mm));
    return `
        <div class="mt-4 pt-4 border-t border-stone-100">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h4 class="text-sm font-bold text-[#1c2520]">☔ Verwachting komende 2 uur</h4>
                <span class="text-xs font-bold ${summary.wet ? 'text-[#2b6fb5]' : 'text-[#197447]'}">${haEscape(summary.text)}</span>
            </div>
            <div class="flex items-end gap-1.5 h-16 mt-3">${rain.map(r => `
                <div class="flex-1 flex flex-col justify-end h-full" title="${haEscape(String(r.time).slice(11, 16))}: ${r.mm.toFixed(1)} mm">
                    <div class="rounded-t-md ${r.mm >= 0.1 ? 'bg-[#4a90d9]' : 'bg-stone-200'}" style="height:${r.mm >= 0.1 ? Math.max(12, Math.round(r.mm / maxMm * 100)) : 6}%"></div>
                </div>`).join('')}</div>
            <div class="flex justify-between text-[10px] font-semibold text-[#68736d] mt-1"><span>nu</span><span>+30 min</span><span>+1 u</span><span>+2 u</span></div>
        </div>`;
}

function weatherRadarCardHtml(loc) {
    return `
        <section class="bg-white rounded-[26px] p-6 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h3 class="text-base font-bold text-[#1c2520]">🛰️ Regenradar <span class="text-xs font-semibold text-[#68736d]">· afgelopen 2 uur</span></h3>
                <div class="flex items-center gap-2">
                    <span id="radarTimeLabel" class="text-xs font-extrabold text-[#2b6fb5] min-w-[4.5rem] text-right"></span>
                    ${typeof pushServerCfg === 'function' && pushServerCfg() ? `<button type="button" id="radarModeBtn" onclick="window.weatherRadarMode()" class="px-3 h-9 rounded-full bg-white border border-stone-200 text-xs font-bold text-[#152920] cursor-pointer">${radarFc.on ? '⏪ Verleden' : '🔮 Voorspelling'}</button>` : ''}
                    <button type="button" id="radarPlayBtn" onclick="window.weatherRadarToggle()" class="w-9 h-9 rounded-full bg-[#152920] text-white text-sm cursor-pointer" aria-label="Afspelen of pauzeren">${radar.playing ? '⏸' : '▶'}</button>
                </div>
            </div>
            <div id="weatherRadarMap" class="weather-map w-full h-[320px] sm:h-[440px] rounded-2xl overflow-hidden bg-[#e8f2ec] flex items-center justify-center text-xs text-[#68736d]">Kaart laden…</div>
            <input id="radarSlider" type="range" min="0" max="0" value="0" oninput="window.weatherRadarSeek(this.value)" class="w-full mt-3 accent-[#152920]" aria-label="Radarbeeld kiezen">
            <p class="text-[10.5px] text-[#8a958f] mt-1.5"><span id="radarSourceNote">${radarFc.on ? 'Voorspelling: KNMI (neerslagverwachting tot +2 uur, via je pushserver)' : 'Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener" class="underline">RainViewer</a>, de afgelopen 2 uur'}</span> · ${loc ? '🏠 ' + haEscape(loc.name) : ''}</p>
            ${weatherRainForecastHtml()}
        </section>`;
}

async function weatherRadarLoadFrames() {
    if (radar.loading || (radar.frames.length && Date.now() - radar.fetchedAt < RADAR_REFRESH_MS)) return false;
    radar.loading = true;
    try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        const past = (j && j.radar && j.radar.past) || [];
        if (!past.length) throw new Error('Geen radarbeelden');
        radar.host = j.host || 'https://tilecache.rainviewer.com';
        radar.frames = past.map(f => ({ time: f.time, path: f.path }));
        radar.idx = radar.frames.length - 1;
        radar.fetchedAt = Date.now();
        radar.error = '';
        return true;
    } catch (e) {
        radar.error = 'Radarbeelden niet beschikbaar.';
        return false;
    } finally { radar.loading = false; }
}

function weatherRadarBuildLayers(h, L) {
    (radar.layers || []).forEach(l => { try { h.map.removeLayer(l); } catch (e) { /* weg */ } });
    radar.layers = radar.frames.map(f => L.tileLayer(`${radar.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
        { opacity: 0, maxNativeZoom: 7, maxZoom: 19, pane: 'radarPane', attribution: 'Radar © RainViewer' }).addTo(h.map));
}

function weatherRadarShow(i) {
    const set = radarSet();
    if (!set.layers.length) return;
    const other = set.fc ? radar.layers : radarFc.layers;
    other.forEach(l => { try { l.setOpacity(0); } catch (e) { /* weg */ } });
    radar.idx = ((i % set.layers.length) + set.layers.length) % set.layers.length;
    set.layers.forEach((l, k) => l.setOpacity(k === radar.idx ? 0.72 : 0));
    const label = document.getElementById('radarTimeLabel');
    if (label) {
        if (set.fc) label.textContent = radarFcLabel(set.times[radar.idx]);
        else if (set.times[radar.idx] !== undefined) label.textContent = radar.idx === set.times.length - 1 ? 'nu' : new Date(set.times[radar.idx] * 1000).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    }
    const slider = document.getElementById('radarSlider');
    if (slider) { slider.max = String(set.layers.length - 1); slider.value = String(radar.idx); }
}

function weatherRadarStopTimer() { if (radar.timer !== null) { clearInterval(radar.timer); radar.timer = null; } }

function weatherRadarStartTimer() {
    weatherRadarStopTimer();
    const n = radarSet().layers.length;
    if (!radar.active || !radar.playing || n < 2) return;
    radar.timer = setInterval(() => {
        const set = radarSet();
        // aan het einde even blijven staan, daarna opnieuw
        weatherRadarShow(radar.idx >= set.layers.length - 1 ? 0 : radar.idx + 1);
    }, RADAR_FRAME_MS);
}

function radarFcClear(h) {
    radarFc.layers.forEach(l => { try { (h || radar.holder).map.removeLayer(l); } catch (e) { /* weg */ } });
    radarFc.urls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { /* weg */ } });
    radarFc.layers = []; radarFc.urls = [];
}

function radarModeUi() {
    const b = document.getElementById('radarModeBtn');
    if (b) b.textContent = radarFc.on ? '⏪ Verleden' : '🔮 Voorspelling';
    const n = document.getElementById('radarSourceNote');
    if (n) n.innerHTML = radarFc.on ? 'Voorspelling: <a href="https://dataplatform.knmi.nl/" target="_blank" rel="noopener" class="underline">KNMI</a> (neerslagverwachting tot +2 uur, via je pushserver)' : 'Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener" class="underline">RainViewer</a>, de afgelopen 2 uur';
}

async function radarFcLoad(reloadImagesOnly) {
    const h = radar.holder, c = typeof pushServerCfg === 'function' ? pushServerCfg() : null, L = window.L;
    if (!h || !c || !L) return;
    if (radarFc.busy) { radarFc.again = true; return; }
    radarFc.busy = true;
    const label = document.getElementById('radarTimeLabel');
    const hdr = { 'X-Key': c.key };
    try {
        if (label) label.textContent = 'KNMI laden…';
        if (!reloadImagesOnly || !radarFc.times.length) {
            const r = await fetch(c.url + '/knmi/times', { headers: hdr });
            const j = await r.json().catch(() => ({}));
            if (r.status === 401) throw new Error('sleutel van de pushserver klopt niet');
            if (r.status === 404) throw new Error('KNMI_KEY staat nog niet in .env op de server (of de server is niet bijgewerkt)');
            if (!r.ok) throw new Error(j.error || 'server antwoordde ' + r.status);
            radarFc.times = j.times || [];
            if (!radarFc.times.length) throw new Error('KNMI gaf geen voorspellingsbeelden');
        }
        const b = h.map.getBounds(), sz = h.map.getSize();
        const rq = radarFcRequest({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, sz.x, sz.y);
        const bounds = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
        const urls = [], layers = [];
        const times = radarFc.times.slice();
        for (let i = 0; i < times.length; i += 4) {
            const part = await Promise.all(times.slice(i, i + 4).map(async t => {
                const r = await fetch(`${c.url}/knmi/map?bbox=${rq.bbox.join(',')}&w=${rq.w}&h=${rq.h}&time=${encodeURIComponent(t)}`, { headers: hdr });
                if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'beeld ophalen mislukt (' + r.status + ')'); }
                return URL.createObjectURL(await r.blob());
            }));
            part.forEach(u => urls.push(u));
        }
        urls.forEach(u => layers.push(L.imageOverlay(u, bounds, { pane: 'radarPane', opacity: 0, interactive: false }).addTo(h.map)));
        radarFcClear(h);
        radarFc.layers = layers; radarFc.urls = urls; radarFc.fetchedAt = Date.now();
        if (radarFc.on) { radar.idx = 0; weatherRadarShow(0); weatherRadarStartTimer(); }
    } catch (e) {
        radarFc.on = false; radarModeUi();
        if (label) label.textContent = '';
        showToast('Voorspelling lukt niet: ' + (e && e.message ? e.message : 'pushserver niet bereikbaar (staat Tailscale aan?)'));
        radar.idx = Math.max(0, radar.layers.length - 1); weatherRadarShow(radar.idx); weatherRadarStartTimer();
    } finally {
        radarFc.busy = false;
        if (radarFc.again) { radarFc.again = false; if (radarFc.on) radarFcLoad(true); }
    }
}

window.weatherRadarMode = async function() {
    if (typeof pushServerCfg !== 'function' || !pushServerCfg()) { showToast('Stel eerst de pushserver in (menu → Pushserver).'); return; }
    if (radarFc.on) {
        radarFc.on = false; radarFcClear(); radarModeUi();
        radar.idx = Math.max(0, radar.layers.length - 1); weatherRadarShow(radar.idx); weatherRadarStartTimer();
        return;
    }
    radarFc.on = true; radarModeUi();
    await radarFcLoad(false);
};

async function weatherMountRadar() {
    const loc = weatherLocation();
    if (!loc || !document.getElementById('weatherRadarMap')) return;
    await weatherRadarLoadFrames();
    const h = await mapsMount('weather-radar', 'weatherRadarMap', (holder, L) => {
        holder.map.setView([loc.lat, loc.lon], 8);
        holder.map.createPane('radarPane');
        holder.map.getPane('radarPane').style.zIndex = 450;
        holder.map.getPane('radarPane').style.pointerEvents = 'none';
        holder.home = L.marker([loc.lat, loc.lon], { icon: mapsPinIcon(L, '🏠') }).addTo(holder.map);
        holder.locKey = `${loc.lat},${loc.lon}`;
    });
    if (!h) return;
    radar.holder = h;
    if (!h.fcBound) { h.fcBound = true; h.map.on('moveend', () => { if (!radarFc.on) return; clearTimeout(radarFc.moveTimer); radarFc.moveTimer = setTimeout(() => radarFcLoad(true), 900); }); }
    const L = window.L;
    if (h.locKey !== `${loc.lat},${loc.lon}`) { h.locKey = `${loc.lat},${loc.lon}`; h.home.setLatLng([loc.lat, loc.lon]); h.map.setView([loc.lat, loc.lon], 8); }
    if (radar.frames.length && h.radarKey !== radar.fetchedAt) { h.radarKey = radar.fetchedAt; weatherRadarBuildLayers(h, L); }
    if (radarFc.on && !radarFc.layers.length && !radarFc.busy) radarFcLoad(false);
    else if (radarFc.on && Date.now() - radarFc.fetchedAt > 5 * 60000 && !radarFc.busy) radarFcLoad(false);
    if (radarSet().layers.length) { weatherRadarShow(radar.idx); weatherRadarStartTimer(); }
    else if (radar.error) { const label = document.getElementById('radarTimeLabel'); if (label) label.textContent = radar.error; }
}

window.weatherRadarToggle = function() {
    radar.playing = !radar.playing;
    const b = document.getElementById('radarPlayBtn');
    if (b) b.textContent = radar.playing ? '⏸' : '▶';
    if (radar.playing) weatherRadarStartTimer(); else weatherRadarStopTimer();
};

window.weatherRadarSeek = function(v) {
    radar.playing = false;
    weatherRadarStopTimer();
    const b = document.getElementById('radarPlayBtn');
    if (b) b.textContent = '▶';
    weatherRadarShow(parseInt(v, 10) || 0);
};

// Door switchView aangeroepen: de animatie loopt alleen als het weerscherm open staat
function weatherViewActive(on) {
    radar.active = !!on;
    if (on) { weatherFetch(false); renderWeatherView(); } else weatherRadarStopTimer();
}

/* ============================ BEHEER ============================ */

function renderAdminWeather() {
    const container = document.getElementById('adminWeatherContainer');
    if (!container) return;
    const cfg = ensureWeather();
    const ha = weatherHomeFromHA();
    const manual = cfg.source === 'manual';
    const active = weatherLocation();
    container.innerHTML = `
        <div class="bg-white rounded-[26px] p-6 shadow-sm space-y-5">
            <div class="max-w-2xl">
                <h3 class="text-lg font-bold text-[#1c2520]">Weer en regenradar</h3>
                <p class="text-xs text-[#68736d]">Kies waar het weer voor wordt getoond. Het weer komt van Open-Meteo en de regenradar van RainViewer; beide zijn gratis.</p>
            </div>

            <div class="grid sm:grid-cols-2 gap-3">
                <label class="flex items-start gap-3 p-4 rounded-2xl border ${manual ? 'border-stone-200 bg-[#f6f8f5]' : 'border-[#19975c] bg-[#f1faf5]'} cursor-pointer">
                    <input type="radio" name="weatherSource" ${manual ? '' : 'checked'} onchange="window.setWeatherSource('ha')" class="mt-1 accent-[#152920]">
                    <span><span class="block text-sm font-bold text-[#1c2520]">🏡 Locatie van Home Assistant</span>
                    <span class="block text-[11px] text-[#68736d]">${ha ? `Gevonden: ${haEscape(ha.name)} (${ha.lat.toFixed(4)}, ${ha.lon.toFixed(4)})` : 'Nog niet gevonden. Haal eerst de entiteiten op bij Home Assistant.'}</span></span>
                </label>
                <label class="flex items-start gap-3 p-4 rounded-2xl border ${manual ? 'border-[#19975c] bg-[#f1faf5]' : 'border-stone-200 bg-[#f6f8f5]'} cursor-pointer">
                    <input type="radio" name="weatherSource" ${manual ? 'checked' : ''} onchange="window.setWeatherSource('manual')" class="mt-1 accent-[#152920]">
                    <span><span class="block text-sm font-bold text-[#1c2520]">📍 Zelf een plaats kiezen</span>
                    <span class="block text-[11px] text-[#68736d]">${manual && mapsValidCoord(cfg.lat, cfg.lon) ? `${haEscape(cfg.name || 'Gekozen locatie')} (${Number(cfg.lat).toFixed(4)}, ${Number(cfg.lon).toFixed(4)})` : 'Zoek een plaats of vul coördinaten in.'}</span></span>
                </label>
            </div>

            <div class="space-y-3 ${manual ? '' : 'opacity-60'}">
                <div class="flex flex-wrap gap-2">
                    <input id="weatherSearchInput" type="text" placeholder="Zoek een plaats, bv. Gent" onkeydown="if(event.key==='Enter')window.searchWeatherPlace()" class="flex-1 min-w-[200px] px-3.5 py-2.5 rounded-xl border border-stone-200 text-sm">
                    <button onclick="window.searchWeatherPlace()" class="bg-white border border-stone-200 hover:bg-stone-100 text-[#38443d] font-bold px-4 py-2.5 rounded-xl text-sm cursor-pointer">${weatherSearchBusy ? 'Zoeken…' : '🔎 Zoeken'}</button>
                </div>
                ${weatherSearchResults.length ? `<div class="flex flex-wrap gap-2">${weatherSearchResults.map((r, i) => `
                    <button onclick="window.pickWeatherPlace(${i})" class="px-3 py-1.5 rounded-xl bg-[#e8f2ec] hover:bg-[#dcece3] text-[#152920] text-xs font-bold cursor-pointer">${haEscape(r.name)}${r.admin1 ? ', ' + haEscape(r.admin1) : ''} <span class="font-medium text-[#68736d]">${haEscape(r.country || '')}</span></button>`).join('')}</div>` : ''}
                <div class="grid grid-cols-2 gap-3 max-w-md">
                    <div><label class="block text-[11px] font-bold text-[#38443d] mb-1">Breedtegraad</label>
                        <input type="text" inputmode="decimal" value="${haEscape(cfg.lat)}" onchange="window.updateWeatherCoord('lat', this.value)" placeholder="51.0543" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm font-mono"></div>
                    <div><label class="block text-[11px] font-bold text-[#38443d] mb-1">Lengtegraad</label>
                        <input type="text" inputmode="decimal" value="${haEscape(cfg.lon)}" onchange="window.updateWeatherCoord('lon', this.value)" placeholder="3.7174" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm font-mono"></div>
                </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p class="text-xs font-semibold text-[#68736d]">${active ? `Nu in gebruik: 📍 ${haEscape(active.name)} (${active.lat.toFixed(3)}, ${active.lon.toFixed(3)})` : 'Nu is er geen locatie.'}</p>
                <button onclick="window.saveWeatherAdmin()" class="bg-[#152920] hover:bg-[#233f31] text-white font-bold px-5 py-2.5 rounded-xl text-sm cursor-pointer">💾 Opslaan</button>
            </div>
        </div>`;
}

window.setWeatherSource = function(src) {
    if (!permGuard('manage_weather')) return;
    ensureWeather().source = src === 'manual' ? 'manual' : 'ha';
    renderAdminWeather();
    weatherTick();
};

window.updateWeatherCoord = function(field, value) {
    if (!permGuard('manage_weather')) return;
    if (field !== 'lat' && field !== 'lon') return;
    const cfg = ensureWeather();
    cfg[field] = String(value).trim().replace(',', '.');
    cfg.source = 'manual';
    renderAdminWeather();
};

window.searchWeatherPlace = async function() {
    if (!permGuard('manage_weather')) return;
    const input = document.getElementById('weatherSearchInput');
    const q = String((input && input.value) || '').trim();
    if (q.length < 2) { showToast("Typ minstens 2 letters."); return; }
    weatherSearchBusy = true;
    try {
        const res = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&language=nl&format=json&name=' + encodeURIComponent(q));
        const j = await res.json();
        weatherSearchResults = Array.isArray(j.results) ? j.results.filter(r => mapsValidCoord(r.latitude, r.longitude)) : [];
        if (!weatherSearchResults.length) showToast("Geen plaats gevonden.");
    } catch (e) {
        weatherSearchResults = [];
        showToast("Zoeken is mislukt. Controleer de internetverbinding.");
    }
    weatherSearchBusy = false;
    renderAdminWeather();
};

window.pickWeatherPlace = function(i) {
    if (!permGuard('manage_weather')) return;
    const r = weatherSearchResults[i];
    if (!r) return;
    const cfg = ensureWeather();
    cfg.source = 'manual';
    cfg.lat = String(Number(r.latitude).toFixed(5));
    cfg.lon = String(Number(r.longitude).toFixed(5));
    cfg.name = r.name + (r.admin1 ? `, ${r.admin1}` : '');
    weatherSearchResults = [];
    renderAdminWeather();
};

window.saveWeatherAdmin = function() {
    if (!permGuard('manage_weather')) return;
    const cfg = ensureWeather();
    if (cfg.source === 'manual' && !mapsValidCoord(cfg.lat, cfg.lon)) { showToast("Vul een geldige breedte- en lengtegraad in, of kies een plaats."); return; }
    weatherFetchKey = '';
    persistStateToFirestore(true);
    renderAdminWeather();
    weatherFetch(true);
    showToast("Weerlocatie opgeslagen.");
};

setInterval(() => { try { weatherTick(); } catch (e) { /* volgende ronde */ } }, 30000);
setTimeout(() => { try { weatherTick(); } catch (e) { /* negeren */ } }, 4000);
