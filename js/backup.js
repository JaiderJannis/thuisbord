'use strict';
/* Back-up en export.
   - Back-up van het actieve gezin (alle instellingen + dagcijfers) als JSON-bestand; admins kunnen ook alles back-uppen.
   - Herstel uit zo'n bestand: voegt toe of overschrijft, verwijdert nooit iets.
   - Alle dagcijfers als CSV.
   De Home Assistant-token wordt standaard NIET in het bestand gezet. */

const BACKUP_FORMAT = 1;
const BACKUP_MAX_BYTES = 10 * 1024 * 1024;
const BACKUP_LAST_KEY = 'thuisbord_last_backup';

function downloadTextFile(name, text, mime = 'application/json') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

// Diepe kopie zonder gevaarlijke sleutelnamen (bescherming tegen een kwaadaardig bestand)
function sanitizeImported(value, depth = 0) {
    if (depth > 30) return null;
    if (Array.isArray(value)) return value.map(v => sanitizeImported(v, depth + 1));
    if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).forEach(k => {
            if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
            out[k] = sanitizeImported(value[k], depth + 1);
        });
        return out;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
}

function backupStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function backupSlug(text) {
    return String(text || 'gezin').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'gezin';
}

function buildBackupObject(scope, includeToken) {
    const clean = (cfg) => {
        const copy = sanitizeImported(cfg);
        if (!includeToken) delete copy.haToken;
        return copy;
    };
    const obj = {
        app: 'thuisbord',
        format: BACKUP_FORMAT,
        createdAt: new Date().toISOString(),
        createdBy: currentLoggedUserEmail || '',
        includesToken: !!includeToken,
        type: scope,
        households: {}
    };
    if (scope === 'platform') {
        Object.keys(platformState.households || {}).forEach(n => { obj.households[n] = clean(platformState.households[n]); });
        obj.accounts = sanitizeImported(platformState.accounts || []);
        obj.permissions = sanitizeImported(platformState.permissions || { manager: {}, user: {} });
    } else {
        obj.households[activeHouseholdName] = clean(platformState.households[activeHouseholdName]);
    }
    return obj;
}

window.downloadBackup = function(scope) {
    if (currentRole !== 'manager' && currentRole !== 'admin') { showToast("Alleen beheerders kunnen een back-up maken."); return; }
    if (!permGuard('manage_backup')) return;
    if (scope === 'platform' && currentRole !== 'admin') { showToast("Een volledige back-up is enkel voor de Super Admin."); return; }
    const tokenBox = document.getElementById('bkIncludeToken');
    const includeToken = !!(tokenBox && tokenBox.checked);
    const obj = buildBackupObject(scope, includeToken);
    const name = scope === 'platform' ? `thuisbord-alles_${backupStamp()}.json` : `thuisbord-${backupSlug(activeHouseholdName)}_${backupStamp()}.json`;
    downloadTextFile(name, JSON.stringify(obj, null, 2), 'application/json');
    try { localStorage.setItem(BACKUP_LAST_KEY, new Date().toISOString()); } catch (e) { /* negeren */ }
    renderBackupTab();
    showToast(`Back-up gedownload${includeToken ? ' (mét token, bewaar het veilig!)' : ''}.`);
};

// Leest en controleert een back-upbestand; geeft { ok, error, data }
function parseBackupText(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: "Dit is geen geldig back-upbestand (JSON kon niet gelezen worden)." }; }
    if (!data || data.app !== 'thuisbord') return { ok: false, error: "Dit bestand komt niet van Thuisbord." };
    if (data.format !== BACKUP_FORMAT) return { ok: false, error: `Onbekende bestandsversie (${data.format}).` };
    if (!data.households || typeof data.households !== 'object' || Array.isArray(data.households)) return { ok: false, error: "Het bestand bevat geen gezinnen." };
    const names = Object.keys(data.households);
    if (!names.length) return { ok: false, error: "Het bestand bevat geen gezinnen." };
    if (names.length > 50) return { ok: false, error: "Te veel gezinnen in het bestand." };
    for (const n of names) {
        if (!n.trim() || n.length > 100 || n.includes('/')) return { ok: false, error: `Ongeldige gezinsnaam: "${n}".` };
        const cfg = data.households[n];
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { ok: false, error: `Gezin "${n}" heeft ongeldige gegevens.` };
    }
    return { ok: true, data: sanitizeImported(data) };
}

function mergeHouseholdFromBackup(name, cfg, keepCurrent) {
    const defaults = createDefaultHouseholdConfig(name);
    const merged = { ...defaults, ...cfg, householdName: name, entityMap: { ...defaults.entityMap, ...(cfg.entityMap || {}) } };
    if (keepCurrent) {
        // Een back-up zonder token mag de bestaande verbinding niet wissen
        if (!cfg.haToken && keepCurrent.haToken) merged.haToken = keepCurrent.haToken;
        if (!cfg.haUrl && keepCurrent.haUrl) merged.haUrl = keepCurrent.haUrl;
    }
    return merged;
}

window.restoreBackupFile = function(input) {
    const file = input && input.files && input.files[0];
    if (input) input.value = '';
    if (!file) return;
    if (currentRole !== 'manager' && currentRole !== 'admin') { showToast("Alleen beheerders kunnen een back-up herstellen."); return; }
    if (!permGuard('manage_backup')) return;
    if (file.size > BACKUP_MAX_BYTES) { showToast("Dit bestand is te groot voor een back-up."); return; }
    const reader = new FileReader();
    reader.onerror = () => showToast("Het bestand kon niet gelezen worden.");
    reader.onload = () => {
        const parsed = parseBackupText(String(reader.result || ''));
        if (!parsed.ok) { showToast(parsed.error); return; }
        applyBackup(parsed.data);
    };
    reader.readAsText(file);
};

function applyBackup(data) {
    const names = Object.keys(data.households);
    const created = data.createdAt ? new Date(data.createdAt).toLocaleString('nl-BE') : 'onbekend';

    if (currentRole === 'admin' && data.type === 'platform') {
        const accCount = Array.isArray(data.accounts) ? data.accounts.length : 0;
        const msg = `Volledige back-up van ${created} herstellen?\n\n• ${names.length} gezin(nen): ${names.join(', ')}\n• ${accCount} account(s)\n\nBestaande gezinnen met dezelfde naam worden overschreven. Er wordt niets verwijderd.`;
        if (!window.confirm(msg)) return;
        names.forEach(n => { platformState.households[n] = mergeHouseholdFromBackup(n, data.households[n], platformState.households[n]); });
        if (Array.isArray(data.accounts)) {
            if (!platformState.accounts) platformState.accounts = [];
            data.accounts.forEach(a => {
                const email = String((a && a.email) || '').trim().toLowerCase();
                if (!email || !['admin', 'manager', 'user'].includes(a.role) || !a.household) return;
                const idx = platformState.accounts.findIndex(x => String(x.email || '').toLowerCase() === email);
                const acc = { id: a.id || ('u_' + Date.now() + Math.random().toString(36).slice(2, 5)), name: String(a.name || email), email, role: a.role, household: a.household };
                if (idx >= 0) platformState.accounts[idx] = acc; else platformState.accounts.push(acc);
            });
            ensureSuperAdminAccount();
        }
        if (data.permissions && typeof normalizePermissions === 'function') {
            platformState.permissions = normalizePermissions(data.permissions);
            if (typeof savePermissions === 'function') savePermissions();
        }
    } else {
        // Eén gezin terugzetten op het actieve gezin
        const fromName = names.includes(activeHouseholdName) ? activeHouseholdName : (names.length === 1 ? names[0] : null);
        if (!fromName) { showToast(`Het bestand bevat meerdere gezinnen en geen daarvan heet "${activeHouseholdName}".`); return; }
        const differs = fromName !== activeHouseholdName ? `\n\nLet op: de back-up is van gezin "${fromName}" en wordt toegepast op "${activeHouseholdName}".` : '';
        const msg = `Back-up van ${created} terugzetten voor "${activeHouseholdName}"?\n\nAlle instellingen en dagcijfers van dit gezin worden vervangen door die uit het bestand.${differs}`;
        if (!window.confirm(msg)) return;
        platformState.households[activeHouseholdName] = mergeHouseholdFromBackup(activeHouseholdName, data.households[fromName], platformState.households[activeHouseholdName]);
    }
    syncActiveHouseholdPointer();
    renderAll();
    populateAdminInputs();
    persistStateToFirestore(true);
    renderBackupTab();
    showToast("Back-up hersteld.");
}

window.exportAllHistoryCsv = function() {
    const nl = (v, d) => (Number(v) || 0).toFixed(d).replace('.', ',');
    const lines = ['Periode;Afname kWh;Zon kWh;Teruglevering kWh;Gas m3;Water L;Kosten EUR;Piek W'];
    const arch = appState.historyArchive || {};
    Object.keys(arch).sort().forEach(m => {
        const a = arch[m];
        lines.push([`${m} (maandtotaal)`, nl(a.i, 2), nl(a.s, 2), nl(a.e, 2), nl(a.g, 2), nl(a.w, 0), nl(a.c, 2), nl(a.p, 0)].join(';'));
    });
    const h = appState.history || {};
    Object.keys(h).sort().forEach(k => {
        const e = h[k];
        lines.push([k, nl(e.i, 2), nl(e.s, 2), nl(e.e, 2), nl(e.g, 2), nl(e.w, 0), nl(e.c, 2), nl(e.p, 0)].join(';'));
    });
    if (lines.length === 1) { showToast("Er zijn nog geen dagcijfers om te exporteren."); return; }
    downloadTextFile(`thuisbord-dagcijfers-${backupSlug(activeHouseholdName)}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
};

function renderBackupTab() {
    const info = document.getElementById('bkLastInfo');
    if (info) {
        let last = null;
        try { last = localStorage.getItem(BACKUP_LAST_KEY); } catch (e) { /* negeren */ }
        if (!last) {
            info.textContent = 'Nog geen back-up gemaakt op dit apparaat.';
            info.className = 'text-xs font-bold text-amber-700';
        } else {
            const days = Math.floor((Date.now() - Date.parse(last)) / 86400000);
            info.textContent = `Laatste back-up op dit apparaat: ${new Date(last).toLocaleString('nl-BE')}${days >= 30 ? ' (meer dan een maand geleden)' : ''}.`;
            info.className = `text-xs font-bold ${days >= 30 ? 'text-amber-700' : 'text-[#197447]'}`;
        }
    }
    const platformWrap = document.getElementById('bkPlatformWrap');
    if (platformWrap) platformWrap.classList.toggle('hidden', currentRole !== 'admin');
    const days = document.getElementById('bkHistoryCount');
    if (days) days.textContent = String(Object.keys(appState.history || {}).length);
}
