'use strict';
/* Achtergrondkleur: presets + eigen kleur, per huishouden opgeslagen */

const BG_DEFAULT_COLOR = '#eef2ed';
const BG_PRESETS = [
    { name: 'Salie groen', color: '#eef2ed' },
    { name: 'Mint',        color: '#e3f3ea' },
    { name: 'Zand',        color: '#f4efe6' },
    { name: 'Hemelblauw',  color: '#e6eff7' },
    { name: 'Lavendel',    color: '#eeeaf6' },
    { name: 'Perzik',      color: '#f8ebe6' },
    { name: 'Lichtgrijs',  color: '#eff0f1' },
    { name: 'Wit',         color: '#ffffff' }
];

let bgLastApplied = null;     // laatst toegepaste kleur (voorkomt onnodig hertekenen)
let bgPreviewActive = false;  // true terwijl de gebruiker in de kleurkiezer sleept

// Donkere variant van een gekozen achtergrondkleur: bijna zwart met een vleugje van de gekozen tint
function darkTintOf(hex) {
    const base = [8, 14, 11];
    const n = parseInt(String(hex).slice(1), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const out = rgb.map((v, i) => Math.round(base[i] + (v - base[i]) * 0.035));
    return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('');
}

function isValidHexColor(c) {
    return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
}

// Zet de achtergrond direct op de pagina (zonder op te slaan)
function applyBackgroundColor(color) {
    const c = isValidHexColor(color) ? color.toLowerCase() : BG_DEFAULT_COLOR;
    document.documentElement.style.setProperty('--bg-sage', c);
    document.documentElement.style.setProperty('--bg-dark', darkTintOf(c));
    document.body.style.backgroundColor = c;
    try { localStorage.setItem('thuisbord_bg', c); } catch (e) { /* negeren */ }
    bgLastApplied = c;
    renderBackgroundPicker(c);
}

// Past de opgeslagen kleur van het actieve huishouden toe
function applyBackgroundFromState() {
    if (bgPreviewActive) return; // niet overschrijven tijdens slepen
    // Een beheerder kan voor een persoon een eigen achtergrondkleur kiezen; die gaat voor op de gezinskleur
    const own = typeof themeOwnAccountDisplay === 'function' ? themeOwnAccountDisplay() : null;
    const wanted = own && isValidHexColor(own.bgColor) ? own.bgColor.toLowerCase()
        : (isValidHexColor(appState && appState.bgColor) ? appState.bgColor.toLowerCase() : BG_DEFAULT_COLOR);
    const box = document.getElementById('bgColorPicker');
    if (wanted === bgLastApplied && (!box || box.childElementCount > 0)) return;
    applyBackgroundColor(wanted);
}

function renderBackgroundPicker(activeColor) {
    const box = document.getElementById('bgColorPicker');
    if (!box) return;
    const current = (activeColor || (appState && appState.bgColor) || BG_DEFAULT_COLOR).toLowerCase();
    const swatches = BG_PRESETS.map(p => {
        const selected = p.color.toLowerCase() === current;
        return `
            <button type="button" onclick="setBackgroundColor('${p.color}')" title="${p.name}"
                class="flex flex-col items-center gap-1.5 cursor-pointer group">
                <span class="w-12 h-12 rounded-2xl border-2 ${selected ? 'border-[#152920] ring-2 ring-[#5cd69c]' : 'border-stone-300 group-hover:border-stone-500'} transition"
                      style="background:${p.color}"></span>
                <span class="text-[10px] font-bold ${selected ? 'text-[#152920]' : 'text-[#68736d]'}">${p.name}</span>
            </button>`;
    }).join('');
    box.innerHTML = `
        <div class="flex flex-wrap gap-3">${swatches}</div>
        <div class="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-stone-100">
            <label class="text-xs font-bold text-[#49544d]">Eigen kleur:</label>
            <input id="bgCustomColor" type="color" value="${current}"
                oninput="previewBackgroundColor(this.value)" onchange="setBackgroundColor(this.value)"
                class="w-12 h-9 rounded-lg border border-stone-200 cursor-pointer bg-white">
            <span class="text-[11px] text-[#68736d]">Kies liefst een lichte kleur, dan blijft alles goed leesbaar.</span>
            <button type="button" onclick="setBackgroundColor('${BG_DEFAULT_COLOR}')"
                class="ml-auto text-xs font-bold text-[#49544d] hover:text-[#152920] underline cursor-pointer">Standaard herstellen</button>
        </div>`;
}

// Live meekijken tijdens het slepen in de kleurkiezer (niet opslaan)
window.previewBackgroundColor = function(color) {
    if (!isValidHexColor(color)) return;
    bgPreviewActive = true;
    document.documentElement.style.setProperty('--bg-sage', color);
    document.documentElement.style.setProperty('--bg-dark', darkTintOf(color));
    document.body.style.backgroundColor = color;
};

// Kiezen + opslaan voor het actieve huishouden
window.setBackgroundColor = function(color) {
    if (!isValidHexColor(color)) return;
    bgPreviewActive = false;
    appState.bgColor = color.toLowerCase();
    applyBackgroundColor(appState.bgColor);
    persistStateToFirestore(true);
};
