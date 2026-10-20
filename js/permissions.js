'use strict';
/* Rechtensysteem.
   De Super Admin bepaalt per rol (Gezinsbeheerder, Gezinslid) wat bekeken, bediend en beheerd mag worden.
   - De Super Admin mag altijd alles.
   - Een Gezinslid kan nooit instellingen beheren (zie ook firestore-stap4.rules): enkel "gebruik"-rechten.
   - Per rol instelbaar, en daarbovenop per persoon: een persoonlijke regel (toestaan/weigeren) gaat voor op de rol.
   - Opslag: één document thuisbord_meta/permissions (gelden voor alle gezinnen): { manager:{}, user:{}, users:[{email, perms:{}}] }.
     Zonder document gelden de standaardwaarden.
   - Afdwingen: de app verbergt knoppen/schermen en blokkeert de bedieningsfuncties. Firestore beschermt daarnaast de
     gevoelige velden (Home Assistant-token, instellingen, accounts). */

const PERM_ROLES = [
    { id: 'manager', label: 'Gezinsbeheerder', icon: '🏡' },
    { id: 'user',    label: 'Gezinslid',       icon: '👤' }
];

const PERM_GROUPS = [
    { id: 'gebruik', title: 'Bekijken en bedienen', sub: 'Wat mag er dagelijks gebruikt worden?' },
    { id: 'beheer',  title: 'Beheer en instellingen', sub: 'Welke tabbladen van het beheerpaneel mag een gezinsbeheerder openen? (Gezinsleden hebben nooit toegang tot het beheerpaneel.)' }
];

const PERM_BOTH = ['manager', 'user'];
const PERM_ITEMS = [
    // ----- gebruik -----
    { key: 'view_rooms',      group: 'gebruik', icon: '🏠', label: 'Ruimtes bekijken',              hint: 'Lampen, rolluiken en airco zien',                          roles: PERM_BOTH },
    { key: 'control_rooms',   group: 'gebruik', icon: '💡', label: 'Lampen, rolluiken & airco bedienen', hint: 'Aan/uit, openen/sluiten, temperatuur instellen',        roles: PERM_BOTH, requires: 'view_rooms' },
    { key: 'view_robots',     group: 'gebruik', icon: '🤖', label: 'Robots bekijken',               hint: 'Maaier en stofzuiger, status en onderhoud',                 roles: PERM_BOTH },
    { key: 'control_robots',  group: 'gebruik', icon: '▶️', label: 'Robots bedienen',               hint: 'Starten, pauzeren, terug naar basis, onderhoud afvinken',   roles: PERM_BOTH, requires: 'view_robots' },
    { key: 'edit_robots',     group: 'gebruik', icon: '🛠️', label: 'Robot-instellingen aanpassen',  hint: 'Extra entiteiten en onderhoudstaken toevoegen of wijzigen', roles: PERM_BOTH, requires: 'view_robots', defaultUser: false },
    { key: 'view_cars',       group: 'gebruik', icon: '🚗', label: "Auto's bekijken",               hint: 'Batterij, laden, bandendruk, portieren',                    roles: PERM_BOTH },
    { key: 'control_cars',    group: 'gebruik', icon: '🔐', label: "Auto's bedienen",               hint: 'Vergrendelen/ontgrendelen en schakelaars',                  roles: PERM_BOTH, requires: 'view_cars', defaultUser: false },
    { key: 'view_overview',   group: 'gebruik', icon: '📊', label: 'Overzicht maand & jaar',        hint: 'Verbruik, opbrengst en kosten per periode',                 roles: PERM_BOTH },
    { key: 'view_calendar',   group: 'gebruik', icon: '📅', label: 'Agenda & taken bekijken',       hint: 'Kalender, afspraken en takenlijst',                         roles: PERM_BOTH },
    { key: 'edit_calendar',   group: 'gebruik', icon: '✅', label: 'Taken en afspraken toevoegen',  hint: 'Nieuwe taken/afspraken maken en taken afvinken',            roles: PERM_BOTH, requires: 'view_calendar' },
    { key: 'view_evcc',       group: 'gebruik', icon: '🔌', label: 'Laden (evcc) bekijken',         hint: 'Laadpunten, laadvermogen en zonne-overschot',               roles: PERM_BOTH },
    { key: 'control_evcc',    group: 'gebruik', icon: '⚡', label: 'Laden (evcc) bedienen',         hint: 'Laadmodus kiezen (uit, zon, min+zon, snel) en laadlimiet',  roles: PERM_BOTH, requires: 'view_evcc', defaultUser: false },
    { key: 'view_music',      group: 'gebruik', icon: '🎵', label: 'Muziek bekijken',               hint: 'Wat speelt er, en waar',                                    roles: PERM_BOTH },
    { key: 'control_music',   group: 'gebruik', icon: '🎶', label: 'Muziek bedienen',               hint: 'Afspelen, pauzeren, volgende, volume, afspelen op een speler', roles: PERM_BOTH, requires: 'view_music' },
    { key: 'view_weather',    group: 'gebruik', icon: '🌦️', label: 'Weer & regenradar bekijken',    hint: 'Weer, voorspelling en regenradar (ook de weerregel op het display)', roles: PERM_BOTH },
    { key: 'view_scenes',     group: 'gebruik', icon: '🎬', label: 'Scènes bekijken',               hint: 'De scènes zien (bijv. Goedenacht, Film kijken)',            roles: PERM_BOTH },
    { key: 'control_scenes',  group: 'gebruik', icon: '▶️', label: 'Scènes uitvoeren',              hint: 'Een scène starten: lampen, rolluiken en airco volgen',      roles: PERM_BOTH, requires: 'view_scenes' },
    { key: 'view_planner',    group: 'gebruik', icon: '🧠', label: 'Slim advies & planner',         hint: 'Beste moment om wasmachine, droger of vaatwasser te starten', roles: PERM_BOTH },
    { key: 'choose_theme',    group: 'gebruik', icon: '🌙', label: 'Eigen weergave kiezen',         hint: 'Zelf licht/donker/automatisch kiezen. Uit = de beheerder bepaalt', roles: PERM_BOTH },
    // ----- beheer (enkel gezinsbeheerder) -----
    { key: 'manage_members',    group: 'beheer', icon: '👥', label: 'Gezinsleden',         hint: 'Leden toevoegen of verwijderen en hun weergave (kleur, donker) kiezen', roles: ['manager'] },
    { key: 'manage_ha',         group: 'beheer', icon: '🔌', label: 'Home Assistant',      hint: 'Verbinding, token en sensoren koppelen',               roles: ['manager'] },
    { key: 'manage_prices',     group: 'beheer', icon: '💶', label: 'Prijzen',             hint: 'Stroom-, gas- en watertarieven',                       roles: ['manager'] },
    { key: 'manage_appliances', group: 'beheer', icon: '🧺', label: 'Apparaten & water',   hint: 'Slimme apparaten en watermeting',                      roles: ['manager'] },
    { key: 'manage_advice',     group: 'beheer', icon: '💬', label: 'Advies & doelen',     hint: 'Adviesregels, planner-taken, budget en eigen berichten',                                roles: ['manager'] },
    { key: 'manage_agenda',     group: 'beheer', icon: '📅', label: 'Agenda & afval',      hint: 'Google Agenda, taken en afvalsensoren instellen',      roles: ['manager'] },
    { key: 'manage_rooms',      group: 'beheer', icon: '🪟', label: 'Rolluiken & airco',   hint: 'Ruimtes, lampen, rolluiken en airco\'s instellen',      roles: ['manager'] },
    { key: 'manage_cars',       group: 'beheer', icon: '🚗', label: "Auto's",              hint: 'Auto\'s en hun entiteiten instellen',                   roles: ['manager'] },
    { key: 'manage_evcc',       group: 'beheer', icon: '🔌', label: 'Laden (evcc)',        hint: 'Laadpunten en hun entiteiten instellen',               roles: ['manager'] },
    { key: 'manage_music',      group: 'beheer', icon: '🎵', label: 'Muziek',              hint: 'Muziekspelers kiezen en benoemen',                     roles: ['manager'] },
    { key: 'manage_weather',    group: 'beheer', icon: '🌦️', label: 'Weer',                hint: 'Locatie voor weer en regenradar kiezen',               roles: ['manager'] },
    { key: 'manage_scenes',     group: 'beheer', icon: '🎬', label: 'Scènes',              hint: 'Scènes maken, bewerken, ordenen en verwijderen',       roles: ['manager'] },
    { key: 'manage_display',    group: 'beheer', icon: '🎨', label: 'Weergave',            hint: 'Achtergrondkleur en meldingen',                        roles: ['manager'] },
    { key: 'manage_backup',     group: 'beheer', icon: '💾', label: 'Back-up',             hint: 'Back-up maken, herstellen en exporteren',              roles: ['manager'] }
];
const PERM_BY_KEY = {};
PERM_ITEMS.forEach(i => { PERM_BY_KEY[i.key] = i; });

// Welk beheertabblad hoort bij welk recht ('gezinnen' en 'rechten' zijn enkel voor de Super Admin)
const ADMIN_TAB_PERMISSION = {
    gebruikers: 'manage_members', ha_entiteiten: 'manage_ha', tarieven: 'manage_prices', apparaten: 'manage_appliances',
    advies: 'manage_advice', agenda: 'manage_agenda', rolluiken_airco: 'manage_rooms', autos: 'manage_cars',
    weergave: 'manage_display', backup: 'manage_backup', evcc: 'manage_evcc', muziek: 'manage_music', weer: 'manage_weather', scenes: 'manage_scenes'
};
const ADMIN_ONLY_TABS = ['gezinnen', 'rechten'];

const VIEW_PERMISSION = { shutters: 'view_rooms', robots: 'view_robots', cars: 'view_cars', overview: 'view_overview', calendar: 'view_calendar', evcc: 'view_evcc', music: 'view_music', weather: 'view_weather', scenes: 'view_scenes', planner: 'view_planner' };

function permDefault(key, role) {
    const item = PERM_BY_KEY[key];
    if (!item || !item.roles.includes(role)) return false;
    if (role === 'user' && item.defaultUser === false) return false;
    return true;
}

function permCleanEmail(email) {
    return String(email || '').trim().toLowerCase();
}

// Persoonlijke regel van een account voor één recht: true, false of undefined (volgt de rol)
function permUserOverride(email, key) {
    const e = permCleanEmail(email);
    if (!e) return undefined;
    const list = (platformState.permissions && platformState.permissions.users) || [];
    const entry = list.find(u => permCleanEmail(u.email) === e);
    return entry && entry.perms && typeof entry.perms[key] === 'boolean' ? entry.perms[key] : undefined;
}

// Mag deze rol (en eventueel deze persoon) dit? De Super Admin altijd.
// Volgorde: persoonlijke regel, dan de regel van de rol, dan de standaard. Een vervolgrecht vereist het bijhorende "bekijken"-recht.
// Zonder e-mailadres geldt (voor de eigen rol) de ingelogde persoon.
function permAllowed(key, role, email) {
    role = role || currentRole;
    if (!role) return false;
    if (role === 'admin') return true;
    if (email === undefined) email = (role === currentRole) ? currentLoggedUserEmail : '';
    const item = PERM_BY_KEY[key];
    if (!item || !item.roles.includes(role)) return false;
    if (item.requires && !permAllowed(item.requires, role, email)) return false;
    const own = permUserOverride(email, key);
    if (typeof own === 'boolean') return own;
    const stored = platformState.permissions && platformState.permissions[role];
    if (stored && typeof stored[key] === 'boolean') return stored[key];
    return permDefault(key, role);
}

function permHasAnyManage(role, email) {
    role = role || currentRole;
    if (role === 'admin') return true;
    return PERM_ITEMS.some(i => i.group === 'beheer' && permAllowed(i.key, role, email));
}

// Gebruik bovenaan een bedieningsfunctie: if (!permGuard('control_rooms')) return;
function permGuard(key) {
    if (permAllowed(key)) return true;
    if (typeof showToast === 'function') showToast("Je hebt hiervoor geen toestemming. Vraag het aan de beheerder.");
    return false;
}

function permSetShown(el, shown, display) {
    if (!el) return;
    el.style.display = shown ? (display || '') : 'none';
}

function permAdminTabAllowed(tab) {
    if (ADMIN_ONLY_TABS.includes(tab)) return currentRole === 'admin';
    const key = ADMIN_TAB_PERMISSION[tab];
    return !!key && permAllowed(key);
}

// Mag deze weergave getoond worden voor de ingelogde rol?
function permViewAllowed(view) {
    if (view === 'admin') return permHasAnyManage();
    const key = VIEW_PERMISSION[view];
    return !key || permAllowed(key);
}

// Past knoppen, menu-items en beheertabs aan de rechten van de ingelogde rol aan
function applyPermissionsToUI() {
    const get = id => document.getElementById(id);
    if (!currentRole) return;

    permSetShown(get('navBtnRooms'), permAllowed('view_rooms'), 'flex');
    permSetShown(get('navBtnRobots'), permAllowed('view_robots'), 'flex');
    permSetShown(get('navBtnCars'), permAllowed('view_cars'), 'flex');
    permSetShown(get('navBtnOverview'), permAllowed('view_overview'), 'flex');
    permSetShown(get('navBtnCalendar'), permAllowed('view_calendar'), 'flex');
    permSetShown(get('navBtnEvcc'), permAllowed('view_evcc'), 'flex');
    permSetShown(get('navBtnMusic'), permAllowed('view_music'), 'flex');
    permSetShown(get('navBtnWeather'), permAllowed('view_weather'), 'flex');
    permSetShown(get('navBtnScenes'), permAllowed('view_scenes'), 'flex');
    permSetShown(get('navBtnPlanner'), permAllowed('view_planner'), 'flex');
    permSetShown(get('headerWeatherBtn'), permAllowed('view_weather'), 'flex');
    if (typeof renderWeatherHeader === 'function') renderWeatherHeader();
    permSetShown(get('navBtnAdmin'), permHasAnyManage(), 'flex');

    const roomsBtn = get('headerRoomsBtn');
    permSetShown(roomsBtn, permAllowed('view_rooms'), 'flex');
    if (roomsBtn && roomsBtn.parentElement && roomsBtn.parentElement.style) roomsBtn.parentElement.style.display = permAllowed('view_rooms') ? '' : 'none';
    permSetShown(get('headerActiveLightsBtn'), permAllowed('view_rooms'), 'flex');
    permSetShown(get('headerRobotsBtn'), permAllowed('view_robots'), 'flex');

    // Formulieren om taken/afspraken toe te voegen
    ['userNewTaskText', 'userNewAgendaTitle'].forEach(id => {
        const box = get(id) && (get(id).closest ? get(id).closest('[data-perm-box]') : null);
        if (box) permSetShown(box, permAllowed('edit_calendar'));
    });

    // Beheertabs
    const tabs = ['gezinnen', 'gebruikers', 'rechten', 'ha_entiteiten', 'tarieven', 'apparaten', 'advies', 'agenda', 'rolluiken_airco', 'autos', 'evcc', 'muziek', 'weer', 'scenes', 'weergave', 'backup'];
    tabs.forEach(t => {
        const btn = get('adminTabBtn_' + t);
        if (btn) btn.classList.toggle('hidden', !permAdminTabAllowed(t));
        if (!permAdminTabAllowed(t)) {
            const body = get('adminTab_' + t);
            if (body) body.classList.add('hidden');
        }
    });
}

// Eerste toegestane beheertab (voor na het inloggen of als het huidige tabblad niet meer mag)
function permFirstAdminTab() {
    const order = ['gezinnen', 'gebruikers', 'ha_entiteiten', 'tarieven', 'apparaten', 'advies', 'agenda', 'rolluiken_airco', 'autos', 'evcc', 'muziek', 'weer', 'scenes', 'weergave', 'backup', 'rechten'];
    return order.find(t => permAdminTabAllowed(t)) || null;
}

/* ---------- Firestore: thuisbord_meta/permissions ---------- */
function normalizePermissions(raw) {
    const out = { manager: {}, user: {}, users: [] };
    PERM_ROLES.forEach(r => {
        const src = (raw && raw[r.id]) || {};
        PERM_ITEMS.forEach(item => {
            if (item.roles.includes(r.id) && typeof src[item.key] === 'boolean') out[r.id][item.key] = src[item.key];
        });
    });
    // Persoonlijke regels: enkel geldige e-mail + bekende rechten + echte booleans
    const seen = new Set();
    ((raw && Array.isArray(raw.users)) ? raw.users : []).slice(0, 500).forEach(u => {
        const email = permCleanEmail(u && u.email);
        if (!email || email.length > 200 || !/^[^\s@]+@[^\s@]+$/.test(email) || seen.has(email)) return;
        const perms = {};
        Object.keys((u && u.perms) || {}).forEach(k => { if (PERM_BY_KEY[k] && typeof u.perms[k] === 'boolean') perms[k] = u.perms[k]; });
        if (Object.keys(perms).length) { seen.add(email); out.users.push({ email, perms }); }
    });
    return out;
}

function startPermissionsListener() {
    try {
        const unsub = onSnapshot(fsDoc(FS_META_COL, 'permissions'), snap => {
            if (snap.metadata && snap.metadata.hasPendingWrites) return; // echo van onze eigen schrijfactie
            platformState.permissions = snap.exists() ? normalizePermissions(fromFirestoreData(snap.data())) : { manager: {}, user: {}, users: [] };
            permissionsChangedRefresh();
        }, err => {
            // Regels nog niet bijgewerkt (stap 4): standaardrechten blijven gelden
            console.warn("Rechten konden niet gelezen worden, standaardrechten gebruikt:", err && err.code);
        });
        cloudUnsubscribers.push(unsub);
    } catch (e) { console.warn("Rechten-listener niet gestart:", e); }
}

function permissionsChangedRefresh() {
    applyPermissionsToUI();
    if (typeof applyThemeMode === 'function') applyThemeMode();
    if (typeof renderPermissionsAdmin === 'function') renderPermissionsAdmin();
    // Staat de gebruiker op een scherm dat niet meer mag? Terug naar het wanddisplay.
    if (currentRole && window.currentViewName && !permViewAllowed(window.currentViewName) && window.currentViewName !== 'display' && window.currentViewName !== 'login') {
        window.switchView('display');
        showToast("Je rechten zijn gewijzigd.");
    }
}

async function savePermissions() {
    if (currentRole !== 'admin') return;
    if (typeof firestoreLayoutInUse !== 'undefined' && firestoreLayoutInUse !== 'v2') {
        showToast("Rechten opslaan werkt enkel met de nieuwe Firebase-indeling.");
        return;
    }
    try {
        await setDoc(fsDoc(FS_META_COL, 'permissions'), {
            ...toFirestoreData(normalizePermissions(platformState.permissions)),
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser ? currentUser.uid : ''
        });
        showToast("Rechten opgeslagen.");
    } catch (e) {
        console.error("Rechten opslaan mislukt:", e);
        showToast(isPermissionDenied(e) ? "Opslaan geweigerd: publiceer eerst firestore-stap4.rules." : "Rechten opslaan mislukt.");
    }
}

/* ---------- beheerscherm (tab "Rechten", enkel Super Admin) ---------- */
function permStoredValue(role, key) {
    const stored = platformState.permissions && platformState.permissions[role];
    return stored && typeof stored[key] === 'boolean' ? stored[key] : permDefault(key, role);
}

function renderPermissionsAdmin() {
    const box = document.getElementById('permissionsMatrix');
    if (!box) return;
    box.innerHTML = PERM_GROUPS.map(g => {
        const items = PERM_ITEMS.filter(i => i.group === g.id);
        return `
        <section class="space-y-2">
            <div>
                <h4 class="text-sm font-extrabold text-[#1c2520]">${g.title}</h4>
                <p class="text-xs text-[#68736d]">${g.sub}</p>
            </div>
            <div class="rounded-2xl border border-stone-200/80 overflow-hidden divide-y divide-stone-200/70">
                ${items.map(item => `
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 px-4 py-3 bg-white">
                    <div class="min-w-0">
                        <p class="text-sm font-bold text-[#1c2520]">${item.icon} ${item.label}</p>
                        <p class="text-xs text-[#68736d]">${item.hint}</p>
                    </div>
                    <div class="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:justify-end shrink-0">
                        ${PERM_ROLES.map(r => {
                            if (!item.roles.includes(r.id)) {
                                return `<span class="px-3 py-1.5 rounded-xl bg-stone-100 text-stone-400 text-[11px] font-bold">${r.icon} ${r.label}: n.v.t.</span>`;
                            }
                            const parentOk = !item.requires || permStoredValue(r.id, item.requires);
                            const on = parentOk && permStoredValue(r.id, item.key);
                            return `<label class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[12px] font-bold ${parentOk ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'} ${on ? 'bg-[#dcece3] border-[#b9d8c6] text-[#152920]' : 'bg-white border-stone-200 text-[#55605a]'}">
                                <input type="checkbox" class="w-4 h-4 accent-[#152920]" ${on ? 'checked' : ''} ${parentOk ? '' : 'disabled'} onchange="window.setPermission('${r.id}','${item.key}',this.checked)">
                                <span>${r.icon} ${r.label}</span>
                            </label>`;
                        }).join('')}
                    </div>
                </div>`).join('')}
            </div>
        </section>`;
    }).join('');
    renderPermissionsUsers();
}

function permEnsureStore() {
    if (!platformState.permissions) platformState.permissions = { manager: {}, user: {}, users: [] };
    if (!platformState.permissions.manager) platformState.permissions.manager = {};
    if (!platformState.permissions.user) platformState.permissions.user = {};
    if (!Array.isArray(platformState.permissions.users)) platformState.permissions.users = [];
    return platformState.permissions;
}

window.setPermission = function(role, key, value) {
    if (currentRole !== 'admin') return;
    const item = PERM_BY_KEY[key];
    if (!item || !item.roles.includes(role)) return;
    const store = permEnsureStore();
    if (!store[role]) store[role] = {};
    store[role][key] = !!value;
    // Een "bekijken"-recht uitzetten zet de bijhorende bedienrechten ook uit
    if (!value) {
        PERM_ITEMS.filter(i => i.requires === key && i.roles.includes(role)).forEach(i => { store[role][i.key] = false; });
    }
    renderPermissionsAdmin();
    applyPermissionsToUI();
    savePermissions();
};

window.resetPermissions = function() {
    if (currentRole !== 'admin') return;
    if (!window.confirm("Alle rechten terugzetten naar de standaardwaarden? Ook de persoonlijke regels worden gewist.")) return;
    platformState.permissions = { manager: {}, user: {}, users: [] };
    renderPermissionsAdmin();
    applyPermissionsToUI();
    savePermissions();
};

/* ---------- rechten per persoon ---------- */
let permUserSelected = '';

function permPeople() {
    return (platformState.accounts || []).filter(a => a && a.role !== 'admin' && permCleanEmail(a.email));
}

function renderPermissionsUsers() {
    const box = document.getElementById('permissionsUsers');
    if (!box) return;
    const people = permPeople();
    if (!people.length) {
        box.innerHTML = '<p class="text-xs text-[#68736d] italic">Er zijn nog geen gezinsleden of beheerders om rechten voor in te stellen.</p>';
        return;
    }
    if (!people.some(a => permCleanEmail(a.email) === permUserSelected)) permUserSelected = permCleanEmail(people[0].email);
    const acc = people.find(a => permCleanEmail(a.email) === permUserSelected);
    const roleInfo = PERM_ROLES.find(r => r.id === acc.role) || PERM_ROLES[1];
    const entry = ((platformState.permissions && platformState.permissions.users) || []).find(u => permCleanEmail(u.email) === permUserSelected);
    const nOverrides = entry ? Object.keys(entry.perms).length : 0;
    const options = people.map(a => {
        const e = permCleanEmail(a.email);
        const has = ((platformState.permissions && platformState.permissions.users) || []).some(u => permCleanEmail(u.email) === e);
        const r = PERM_ROLES.find(x => x.id === a.role);
        return `<option value="${haEscape(e)}" ${e === permUserSelected ? 'selected' : ''}>${haEscape(a.name || e)} · ${haEscape(a.household || '')} · ${r ? r.label : a.role}${has ? ' ●' : ''}</option>`;
    }).join('');

    const groups = PERM_GROUPS.map(g => {
        const items = PERM_ITEMS.filter(i => i.group === g.id && i.roles.includes(acc.role));
        if (!items.length) return '';
        return `
        <section class="space-y-2">
            <h5 class="text-xs font-extrabold uppercase tracking-wider text-[#68736d]">${g.title}</h5>
            <div class="rounded-2xl border border-stone-200/80 overflow-hidden divide-y divide-stone-200/70">
                ${items.map(item => {
                    const own = permUserOverride(acc.email, item.key);
                    const parentOk = !item.requires || permAllowed(item.requires, acc.role, acc.email);
                    const roleLevel = permAllowed(item.key, acc.role, '__geen__');
                    const effective = permAllowed(item.key, acc.role, acc.email);
                    const val = typeof own === 'boolean' ? String(own) : '';
                    return `
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 bg-white ${parentOk ? '' : 'opacity-60'}">
                        <div class="min-w-0">
                            <p class="text-sm font-bold text-[#1c2520]">${item.icon} ${item.label}</p>
                            <p class="text-xs text-[#68736d]">${item.hint}</p>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                            <span class="text-[11px] font-extrabold px-2 py-1 rounded-full ${effective ? 'bg-[#dcece3] text-[#1c643f]' : 'bg-stone-200 text-stone-600'}">${effective ? 'Mag' : 'Mag niet'}</span>
                            <select ${parentOk ? '' : 'disabled'} onchange="window.setUserPermission('${haEscape(permUserSelected)}','${item.key}',this.value)" class="px-2.5 py-1.5 rounded-xl border border-stone-200 bg-white text-xs font-bold text-[#1c2520]">
                                <option value="" ${val === '' ? 'selected' : ''}>Volgt rol (${roleLevel ? 'aan' : 'uit'})</option>
                                <option value="true" ${val === 'true' ? 'selected' : ''}>✅ Toestaan</option>
                                <option value="false" ${val === 'false' ? 'selected' : ''}>⛔ Weigeren</option>
                            </select>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </section>`;
    }).join('');

    box.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <select onchange="window.selectPermUser(this.value)" class="flex-1 px-3.5 py-2.5 rounded-xl border border-stone-200 bg-white text-sm font-bold text-[#1c2520]">${options}</select>
            <button onclick="window.clearUserPermissions('${haEscape(permUserSelected)}')" ${nOverrides ? '' : 'disabled'} class="px-4 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-[#1c2520] text-xs font-bold ${nOverrides ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}">Persoonlijke regels wissen${nOverrides ? ` (${nOverrides})` : ''}</button>
        </div>
        <p class="text-xs text-[#68736d]">${roleInfo.icon} ${haEscape(acc.name || acc.email)} is <strong>${roleInfo.label}</strong> in gezin <strong>${haEscape(acc.household || '')}</strong>. Een persoonlijke regel gaat voor op de regel van de rol. Personen met een persoonlijke regel staan met ● in de lijst.</p>
        ${groups}`;
}

window.selectPermUser = function(email) {
    permUserSelected = permCleanEmail(email);
    renderPermissionsUsers();
};

window.setUserPermission = function(email, key, value) {
    if (currentRole !== 'admin') return;
    const e = permCleanEmail(email);
    const acc = permPeople().find(a => permCleanEmail(a.email) === e);
    const item = PERM_BY_KEY[key];
    if (!acc || !item || !item.roles.includes(acc.role)) return;
    const store = permEnsureStore();
    let entry = store.users.find(u => permCleanEmail(u.email) === e);
    if (value === 'true' || value === 'false') {
        if (!entry) { entry = { email: e, perms: {} }; store.users.push(entry); }
        entry.perms[key] = value === 'true';
    } else if (entry) {
        delete entry.perms[key];
        if (!Object.keys(entry.perms).length) store.users = store.users.filter(u => u !== entry);
    }
    renderPermissionsUsers();
    applyPermissionsToUI();
    savePermissions();
};

window.clearUserPermissions = function(email) {
    if (currentRole !== 'admin') return;
    const e = permCleanEmail(email);
    const store = permEnsureStore();
    store.users = store.users.filter(u => permCleanEmail(u.email) !== e);
    renderPermissionsUsers();
    applyPermissionsToUI();
    savePermissions();
};
