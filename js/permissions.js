'use strict';
/* Rechtensysteem.
   De Super Admin bepaalt per rol (Gezinsbeheerder, Gezinslid) wat bekeken, bediend en beheerd mag worden.
   - De Super Admin mag altijd alles.
   - Een Gezinslid kan nooit instellingen beheren (zie ook firestore-stap4.rules): enkel "gebruik"-rechten.
   - Opslag: één document thuisbord_meta/permissions (gelden voor alle gezinnen). Zonder document gelden de standaardwaarden.
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
    // ----- beheer (enkel gezinsbeheerder) -----
    { key: 'manage_members',    group: 'beheer', icon: '👥', label: 'Gezinsleden',         hint: 'Leden toevoegen of verwijderen',                      roles: ['manager'] },
    { key: 'manage_ha',         group: 'beheer', icon: '🔌', label: 'Home Assistant',      hint: 'Verbinding, token en sensoren koppelen',               roles: ['manager'] },
    { key: 'manage_prices',     group: 'beheer', icon: '💶', label: 'Prijzen',             hint: 'Stroom-, gas- en watertarieven',                       roles: ['manager'] },
    { key: 'manage_appliances', group: 'beheer', icon: '🧺', label: 'Apparaten & water',   hint: 'Slimme apparaten en watermeting',                      roles: ['manager'] },
    { key: 'manage_advice',     group: 'beheer', icon: '💬', label: 'Advies',              hint: 'Eigen adviesberichten',                                roles: ['manager'] },
    { key: 'manage_agenda',     group: 'beheer', icon: '📅', label: 'Agenda & afval',      hint: 'Google Agenda, taken en afvalsensoren instellen',      roles: ['manager'] },
    { key: 'manage_rooms',      group: 'beheer', icon: '🪟', label: 'Rolluiken & airco',   hint: 'Ruimtes, lampen, rolluiken en airco\'s instellen',      roles: ['manager'] },
    { key: 'manage_cars',       group: 'beheer', icon: '🚗', label: "Auto's",              hint: 'Auto\'s en hun entiteiten instellen',                   roles: ['manager'] },
    { key: 'manage_display',    group: 'beheer', icon: '🎨', label: 'Weergave',            hint: 'Achtergrondkleur en meldingen',                        roles: ['manager'] },
    { key: 'manage_backup',     group: 'beheer', icon: '💾', label: 'Back-up',             hint: 'Back-up maken, herstellen en exporteren',              roles: ['manager'] }
];
const PERM_BY_KEY = {};
PERM_ITEMS.forEach(i => { PERM_BY_KEY[i.key] = i; });

// Welk beheertabblad hoort bij welk recht ('gezinnen' en 'rechten' zijn enkel voor de Super Admin)
const ADMIN_TAB_PERMISSION = {
    gebruikers: 'manage_members', ha_entiteiten: 'manage_ha', tarieven: 'manage_prices', apparaten: 'manage_appliances',
    advies: 'manage_advice', agenda: 'manage_agenda', rolluiken_airco: 'manage_rooms', autos: 'manage_cars',
    weergave: 'manage_display', backup: 'manage_backup'
};
const ADMIN_ONLY_TABS = ['gezinnen', 'rechten'];

const VIEW_PERMISSION = { shutters: 'view_rooms', robots: 'view_robots', cars: 'view_cars', overview: 'view_overview', calendar: 'view_calendar' };

function permDefault(key, role) {
    const item = PERM_BY_KEY[key];
    if (!item || !item.roles.includes(role)) return false;
    if (role === 'user' && item.defaultUser === false) return false;
    return true;
}

// Mag deze rol dit? De Super Admin altijd; anders opgeslagen waarde of standaard. Een vervolgrecht vereist het bijhorende "bekijken"-recht.
function permAllowed(key, role) {
    role = role || currentRole;
    if (!role) return false;
    if (role === 'admin') return true;
    const item = PERM_BY_KEY[key];
    if (!item || !item.roles.includes(role)) return false;
    if (item.requires && !permAllowed(item.requires, role)) return false;
    const stored = platformState.permissions && platformState.permissions[role];
    if (stored && typeof stored[key] === 'boolean') return stored[key];
    return permDefault(key, role);
}

function permHasAnyManage(role) {
    role = role || currentRole;
    if (role === 'admin') return true;
    return PERM_ITEMS.some(i => i.group === 'beheer' && permAllowed(i.key, role));
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
    permSetShown(get('navBtnAdmin'), permHasAnyManage(), 'flex');

    permSetShown(get('headerRoomsBtn'), permAllowed('view_rooms'), 'flex');
    permSetShown(get('headerActiveLightsBtn'), permAllowed('view_rooms'), 'flex');
    permSetShown(get('headerRobotsBtn'), permAllowed('view_robots'), 'flex');

    // Formulieren om taken/afspraken toe te voegen
    ['userNewTaskText', 'userNewAgendaTitle'].forEach(id => {
        const box = get(id) && (get(id).closest ? get(id).closest('[data-perm-box]') : null);
        if (box) permSetShown(box, permAllowed('edit_calendar'));
    });

    // Beheertabs
    const tabs = ['gezinnen', 'gebruikers', 'rechten', 'ha_entiteiten', 'tarieven', 'apparaten', 'advies', 'agenda', 'rolluiken_airco', 'autos', 'weergave', 'backup'];
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
    const order = ['gezinnen', 'gebruikers', 'ha_entiteiten', 'tarieven', 'apparaten', 'advies', 'agenda', 'rolluiken_airco', 'autos', 'weergave', 'backup', 'rechten'];
    return order.find(t => permAdminTabAllowed(t)) || null;
}

/* ---------- Firestore: thuisbord_meta/permissions ---------- */
function normalizePermissions(raw) {
    const out = { manager: {}, user: {} };
    PERM_ROLES.forEach(r => {
        const src = (raw && raw[r.id]) || {};
        PERM_ITEMS.forEach(item => {
            if (item.roles.includes(r.id) && typeof src[item.key] === 'boolean') out[r.id][item.key] = src[item.key];
        });
    });
    return out;
}

function startPermissionsListener() {
    try {
        const unsub = onSnapshot(fsDoc(FS_META_COL, 'permissions'), snap => {
            if (snap.metadata && snap.metadata.hasPendingWrites) return; // echo van onze eigen schrijfactie
            platformState.permissions = snap.exists() ? normalizePermissions(fromFirestoreData(snap.data())) : { manager: {}, user: {} };
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
}

window.setPermission = function(role, key, value) {
    if (currentRole !== 'admin') return;
    const item = PERM_BY_KEY[key];
    if (!item || !item.roles.includes(role)) return;
    if (!platformState.permissions) platformState.permissions = { manager: {}, user: {} };
    if (!platformState.permissions[role]) platformState.permissions[role] = {};
    platformState.permissions[role][key] = !!value;
    // Een "bekijken"-recht uitzetten zet de bijhorende bedienrechten ook uit
    if (!value) {
        PERM_ITEMS.filter(i => i.requires === key && i.roles.includes(role)).forEach(i => { platformState.permissions[role][i.key] = false; });
    }
    renderPermissionsAdmin();
    applyPermissionsToUI();
    savePermissions();
};

window.resetPermissions = function() {
    if (currentRole !== 'admin') return;
    if (!window.confirm("Alle rechten terugzetten naar de standaardwaarden?")) return;
    platformState.permissions = { manager: {}, user: {} };
    renderPermissionsAdmin();
    applyPermissionsToUI();
    savePermissions();
};
