'use strict';
/* Kaarten (Leaflet) voor het weer en de auto's. Leaflet wordt pas geladen als er echt een kaart nodig is.
   Elke kaart leeft in een blijvend element (holder) dat na het hertekenen van het scherm weer op de juiste plek wordt gezet,
   zodat de kaart niet telkens opnieuw laadt of flikkert. Achtergrond: CARTO (licht of donker) met OpenStreetMap-gegevens. */

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const MAP_TILES_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const MAP_TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const MAP_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

let leafletPromise = null;
const mapHolders = new Map(); // sleutel -> { el, map, base, dark, ... }

function mapsEnsureLeaflet() {
    if (typeof window !== 'undefined' && window.L && window.L.map) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
        try {
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = LEAFLET_CSS;
            document.head.appendChild(css);
            const js = document.createElement('script');
            js.src = LEAFLET_JS;
            js.onload = () => (window.L && window.L.map) ? resolve(window.L) : (leafletPromise = null, reject(new Error('Leaflet ontbreekt')));
            js.onerror = () => { leafletPromise = null; reject(new Error('Leaflet laden mislukt')); };
            document.head.appendChild(js);
        } catch (e) { leafletPromise = null; reject(e); }
    });
    return leafletPromise;
}

function mapsIsDark() {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

function mapsPinIcon(L, emoji, extraClass = '') {
    return L.divIcon({ className: 'map-pin-wrap', html: `<div class="map-pin ${extraClass}">${emoji}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] });
}

function mapsValidCoord(lat, lon) {
    const a = Number(lat), b = Number(lon);
    return lat !== '' && lat !== null && lon !== '' && lon !== null && isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0);
}

// Geeft de blijvende kaart terug en zet hem in het element met dit id. init(holder, L) loopt eenmalig bij het maken.
async function mapsMount(key, placeholderId, init) {
    if (!document.getElementById(placeholderId)) return null;
    let L;
    try { L = await mapsEnsureLeaflet(); }
    catch (e) {
        const ph = document.getElementById(placeholderId);
        if (ph && !mapHolders.has(key)) ph.innerHTML = '<p class="h-full flex items-center justify-center text-center text-xs text-[#68736d] p-4">De kaart kon niet laden. Controleer de internetverbinding van dit apparaat.</p>';
        return null;
    }
    const ph = document.getElementById(placeholderId); // kan tijdens het laden vervangen zijn
    if (!ph) return mapHolders.get(key) || null;
    let h = mapHolders.get(key);
    if (!h) {
        const el = document.createElement('div');
        el.style.cssText = 'width:100%;height:100%';
        h = { el, map: L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }), dark: mapsIsDark() };
        h.base = L.tileLayer(h.dark ? MAP_TILES_DARK : MAP_TILES_LIGHT, { maxZoom: 19, subdomains: 'abcd', attribution: MAP_ATTRIBUTION }).addTo(h.map);
        mapHolders.set(key, h);
        init(h, L);
    }
    if (h.el.parentNode !== ph) { ph.innerHTML = ''; ph.appendChild(h.el); }
    if (h.dark !== mapsIsDark()) { h.dark = mapsIsDark(); h.base.setUrl(h.dark ? MAP_TILES_DARK : MAP_TILES_LIGHT); }
    setTimeout(() => { try { h.map.invalidateSize(); } catch (e) { /* kaart al weg */ } }, 0);
    return h;
}

// Bij wisselen van licht/donker de achtergrondtegels van alle kaarten omzetten
function mapsSyncTheme() {
    const dark = mapsIsDark();
    mapHolders.forEach(h => {
        if (h.dark !== dark && h.base) { h.dark = dark; h.base.setUrl(dark ? MAP_TILES_DARK : MAP_TILES_LIGHT); }
    });
}
