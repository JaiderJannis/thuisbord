'use strict';
/* Donkere modus. Iedereen kan zelf kiezen (licht / donker / automatisch) in het menu.
   - De keuze wordt op het apparaat bewaard (localStorage) en geldt voor deze persoon op dit toestel.
   - Heeft een beheerder een weergave voor jouw account ingesteld, dan geldt die zolang je zelf niets koos
     (of als je het recht "Eigen weergave kiezen" niet hebt).
   - Zonder keuze: licht (zoals voorheen). */

const THEME_MODE_KEY = 'thuisbord_theme_mode';
let themeSwitcherCache = '';
const THEME_MODES = [
    { id: 'light', icon: '☀️', label: 'Licht' },
    { id: 'dark',  icon: '🌙', label: 'Donker' },
    { id: 'auto',  icon: '🖥️', label: 'Auto' }
];

function themeLocalMode() {
    try {
        const m = localStorage.getItem(THEME_MODE_KEY);
        return THEME_MODES.some(x => x.id === m) ? m : null;
    } catch (e) { return null; }
}

// Weergave die een beheerder voor het ingelogde account instelde: { mode, bgColor } of null
function themeOwnAccountDisplay() {
    const email = String(currentLoggedUserEmail || '').toLowerCase();
    if (!email) return null;
    const acc = (platformState.accounts || []).find(a => String(a.email || '').toLowerCase() === email);
    return (acc && acc.display && typeof acc.display === 'object') ? acc.display : null;
}

// Welke modus geldt nu: licht, donker of auto?
function themeCanChoose() {
    return !currentRole || typeof permAllowed !== 'function' || permAllowed('choose_theme');
}

function themeEffectiveMode() {
    const own = themeLocalMode();
    if (themeCanChoose() && own) return own;
    const adminSet = themeOwnAccountDisplay();
    if (adminSet && THEME_MODES.some(x => x.id === adminSet.mode)) return adminSet.mode;
    return 'light';
}

function themeIsDarkNow() {
    const mode = themeEffectiveMode();
    if (mode === 'dark') return true;
    if (mode === 'auto') {
        try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; }
    }
    return false;
}

function applyThemeMode() {
    const dark = themeIsDarkNow();
    const root = document.documentElement;
    const was = root.classList.contains('dark');
    root.classList.toggle('dark', dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && meta.setAttribute) meta.setAttribute('content', dark ? '#0d1712' : '#18261f');
    if (was !== dark && typeof applyBackgroundColor === 'function' && typeof bgLastApplied !== 'undefined' && bgLastApplied) {
        applyBackgroundColor(bgLastApplied);
    }
    if (typeof mapsSyncTheme === 'function') mapsSyncTheme();
    renderThemeSwitcher();
}

window.setThemeMode = function(mode) {
    if (!THEME_MODES.some(x => x.id === mode)) return;
    if (!themeCanChoose()) {
        showToast("De beheerder heeft de weergave voor jouw account vastgezet.");
        return;
    }
    try { localStorage.setItem(THEME_MODE_KEY, mode); } catch (e) { /* negeren */ }
    applyThemeMode();
};

function renderThemeSwitcher() {
    const box = document.getElementById('themeSwitcher');
    if (!box) return;
    const canChoose = themeCanChoose();
    const active = themeEffectiveMode();
    const html = `
        <p class="text-[11px] font-bold uppercase tracking-wider text-[#a3b8ae] px-1 mb-2">Weergave</p>
        <div class="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-white/5 border border-white/10">
            ${THEME_MODES.map(m => `
                <button type="button" ${canChoose ? `onclick="setThemeMode('${m.id}')"` : 'disabled'} aria-pressed="${active === m.id}"
                    class="theme-mode-btn flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition ${active === m.id ? 'is-active' : 'is-idle'} ${canChoose ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}">
                    <span>${m.icon}</span><span>${m.label}</span>
                </button>`).join('')}
        </div>
        ${canChoose ? '' : '<p class="text-[10.5px] text-[#a3b8ae] mt-1.5 px-1">Vastgezet door de beheerder.</p>'}`;
    if (html === themeSwitcherCache) return;
    themeSwitcherCache = html;
    box.innerHTML = html;
}

// Bij "Auto" meebewegen met het systeem
try {
    if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => { if (themeEffectiveMode() === 'auto') applyThemeMode(); };
        if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
} catch (e) { /* oude browsers */ }
