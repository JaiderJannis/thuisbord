'use strict';
/* Inloggen, rollen en accountbeheer */

function updateNavigationAndRoleVisibility() {
    const navBtnAdmin = document.getElementById('navBtnAdmin');
    const adminNavIcon = document.getElementById('adminNavIcon');
    const adminNavLabel = document.getElementById('adminNavLabel');
    const adminNavSub = document.getElementById('adminNavSub');
    const roleBadge = document.getElementById('activeRoleBadge');
    const householdSwitcherWrap = document.getElementById('superAdminHouseholdSwitcherWrap');

    if (!currentRole) {
        if (roleBadge) roleBadge.classList.add('hidden');
        if (householdSwitcherWrap) householdSwitcherWrap.classList.add('hidden');
        return;
    }

    if (roleBadge) roleBadge.classList.remove('hidden');

    if (currentRole === 'user') {
        if (roleBadge) roleBadge.textContent = `${currentLoggedUserName} (${activeHouseholdName})`;
        if (householdSwitcherWrap) householdSwitcherWrap.classList.add('hidden');
    } else if (currentRole === 'manager') {
        if (roleBadge) roleBadge.textContent = `${currentLoggedUserName} (${activeHouseholdName})`;
        if (adminNavIcon) adminNavIcon.textContent = '🏡';
        if (adminNavLabel) adminNavLabel.textContent = 'Beheer';
        if (adminNavSub) adminNavSub.textContent = 'Instellingen & gezinsleden';
        if (householdSwitcherWrap) householdSwitcherWrap.classList.add('hidden');
    } else if (currentRole === 'admin') {
        if (roleBadge) roleBadge.textContent = `👑 ${currentLoggedUserName}`;
        if (adminNavIcon) adminNavIcon.textContent = '👑';
        if (adminNavLabel) adminNavLabel.textContent = 'Platform & beheer';
        if (adminNavSub) adminNavSub.textContent = 'Gezinnen, leden en rechten';
        if (householdSwitcherWrap) {
            householdSwitcherWrap.classList.remove('hidden');
            householdSwitcherWrap.classList.add('flex');
        }
    }
    if (typeof applyPermissionsToUI === 'function') applyPermissionsToUI();
}

function updateAdminRolePermissionsUI() {
    const isSuperAdmin = currentRole === 'admin';
    const headerBanner = document.getElementById('adminHeaderBanner');
    const rolePill = document.getElementById('adminHeaderRolePill');
    const headerTitle = document.getElementById('adminHeaderTitle');
    const headerSubtitle = document.getElementById('adminHeaderSubtitle');
    const gezinnenTabBtn = document.getElementById('adminTabBtn_gezinnen');
    const userTabBtn = document.getElementById('adminTabBtn_gebruikers');
    const roleSelectWrapper = document.getElementById('roleSelectWrapper');

    if (isSuperAdmin) {
        headerBanner.className = "bg-[#152920] text-white rounded-[26px] p-4 sm:p-6 mb-4 sm:mb-6 flex flex-wrap items-center justify-between gap-4 shadow-sm";
        rolePill.textContent = "👑 Super Admin";
        headerTitle.textContent = "Multi-Gezin, Home Assistant Entiteiten & Energiebeheer";
        headerSubtitle.textContent = "Beheer alle gezinnen, bekijk welke leden in welk gezin zitten, koppel Home Assistant entiteiten en beheer de live prijzen.";
        userTabBtn.innerHTML = '<span>👥</span><span>Alle leden</span>';
        roleSelectWrapper.classList.remove('hidden');
    } else {
        headerBanner.className = "bg-[#1e4631] text-white rounded-[26px] p-4 sm:p-6 mb-4 sm:mb-6 flex flex-wrap items-center justify-between gap-4 shadow-sm";
        rolePill.textContent = `🏡 ${activeHouseholdName}`;
        headerTitle.textContent = `Beheer ${activeHouseholdName} & Wanddisplay`;
        headerSubtitle.textContent = `Koppel jullie Home Assistant token & sensoren, bekijk de live stroomprijzen van vandaag/morgen en nodig gezinsleden uit.`;
        userTabBtn.innerHTML = '<span>👥</span><span>Gezinsleden</span>';
        roleSelectWrapper.classList.add('hidden');
    }
}

function renderAccountsManagementTable() {
    const container = document.getElementById('accountsTableContainer');
    const countBadge = document.getElementById('totalUsersCountBadge');
    if (!container) return;

    const isSuperAdmin = currentRole === 'admin';
    const allAccounts = platformState.accounts || [];

    const visibleAccounts = isSuperAdmin
        ? allAccounts
        : allAccounts.filter(a => a.role !== 'admin' && a.household === activeHouseholdName);

    countBadge.textContent = isSuperAdmin
        ? `${visibleAccounts.length} accounts totaal`
        : `${visibleAccounts.length} gezinsleden in ${activeHouseholdName}`;

    container.innerHTML = visibleAccounts.map((acc) => {
        const realIdx = allAccounts.findIndex(a => a.id === acc.id);
        let roleBadge = '';
        if (isSuperAdmin) {
            roleBadge = acc.role === 'admin'
                ? `<span class="bg-amber-100 text-amber-900 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full">👑 Super Admin</span>`
                : acc.role === 'manager'
                ? `<span class="bg-[#dcece3] text-[#152920] text-[11px] font-extrabold px-2.5 py-0.5 rounded-full">🏡 Gezinsbeheerder</span>`
                : `<span class="bg-stone-200 text-stone-700 text-[11px] font-bold px-2.5 py-0.5 rounded-full">👤 Gezinslid</span>`;
        } else {
            roleBadge = acc.role === 'manager'
                ? `<span class="bg-[#dcece3] text-[#152920] text-[11px] font-extrabold px-2.5 py-0.5 rounded-full">Beheerder</span>`
                : `<span class="bg-stone-200 text-stone-700 text-[11px] font-bold px-2.5 py-0.5 rounded-full">Gezinslid</span>`;
        }

        const canDelete = (isSuperAdmin && acc.email !== EIGENAAR_SUPER_ADMIN_EMAIL.toLowerCase()) || (!isSuperAdmin && acc.role === 'user');
        const householdNames = Object.keys(platformState.households || {});

        const canStyle = isSuperAdmin || (acc.role !== 'admin' && acc.household === activeHouseholdName);
        const hasDisplay = !!(acc.display && (acc.display.mode || acc.display.bgColor));
        return `
            <div class="space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-3 bg-[#f6f8f5] p-3.5 rounded-2xl border border-stone-200/70">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-white border border-stone-200 flex items-center justify-center font-bold text-sm text-[#152920]">
                        ${(acc.name || 'G').charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <p class="text-sm font-bold text-[#1c2520]">${acc.name}</p>
                            ${roleBadge}
                            <span class="bg-white border border-stone-200 text-[#152920] text-[11px] font-bold px-2 py-0.5 rounded-full">🏡 ${acc.household || activeHouseholdName}</span>
                        </div>
                        <p class="text-xs text-[#68736d] mt-0.5">Google: <strong>${acc.email}</strong></p>
                    </div>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                    ${canStyle ? `
                        <button onclick="window.toggleMemberDisplay('${acc.id}')" title="Weergave voor ${haEscape(acc.name || acc.email)} kiezen" class="px-3 py-1.5 rounded-xl ${hasDisplay ? 'bg-[#dcece3] text-[#152920]' : 'bg-white border border-stone-200 text-[#1c2520]'} hover:bg-stone-100 text-xs font-bold cursor-pointer">🎨 Weergave${hasDisplay ? ' ●' : ''}</button>
                    ` : ''}
                    ${isSuperAdmin ? `
                        <select onchange="window.changeAccountHousehold(${realIdx}, this.value)" class="px-2.5 py-1.5 rounded-xl bg-white border border-stone-200 text-xs font-bold text-[#1c2520]">
                            ${householdNames.map(h => `<option value="${h}" ${acc.household === h ? 'selected' : ''}>🏡 ${h}</option>`).join('')}
                        </select>
                        <select onchange="window.changeAccountRole(${realIdx}, this.value)" class="px-2.5 py-1.5 rounded-xl bg-white border border-stone-200 text-xs font-bold text-[#1c2520]">
                            <option value="user" ${acc.role === 'user' ? 'selected' : ''}>Gezinslid</option>
                            <option value="manager" ${acc.role === 'manager' ? 'selected' : ''}>Gezinsbeheerder</option>
                            <option value="admin" ${acc.role === 'admin' ? 'selected' : ''}>Super Admin</option>
                        </select>
                    ` : ''}
                    ${canDelete ? `
                        <button onclick="window.removeAccountMember(${realIdx})" class="px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold cursor-pointer">
                            Verwijder
                        </button>
                    ` : ''}
                </div>
            </div>
            ${memberDisplayOpenId === acc.id ? renderMemberDisplayPanel(acc, realIdx) : ''}
            </div>
        `;
    }).join('');
}

/* ---------- weergave per persoon (kleur + licht/donker), door admin of gezinsbeheerder ---------- */
let memberDisplayOpenId = null;

window.toggleMemberDisplay = function(id) {
    memberDisplayOpenId = memberDisplayOpenId === id ? null : id;
    renderAccountsManagementTable();
};

function renderMemberDisplayPanel(acc, idx) {
    const d = acc.display || {};
    const modes = [['', 'Eigen keuze'], ['light', '☀️ Licht'], ['dark', '🌙 Donker'], ['auto', '🖥️ Auto']];
    const colorBtn = (color, label) => {
        const selected = (d.bgColor || '') === (color || '');
        return `<button type="button" onclick="window.setMemberDisplay(${idx}, 'bgColor', '${color}')" title="${label}" class="flex flex-col items-center gap-1 cursor-pointer">
            <span class="w-10 h-10 rounded-xl border-2 ${selected ? 'border-[#152920] ring-2 ring-[#5cd69c]' : 'border-stone-300'}" style="background:${color || 'repeating-linear-gradient(45deg,#fff,#fff 4px,#e5e7e5 4px,#e5e7e5 8px)'}"></span>
            <span class="text-[10px] font-bold text-[#68736d]">${label}</span></button>`;
    };
    const presets = (typeof BG_PRESETS !== 'undefined' ? BG_PRESETS : []);
    return `
        <div class="ml-2 sm:ml-12 p-4 rounded-2xl bg-white border border-stone-200 space-y-3">
            <p class="text-xs text-[#68736d]">Weergave voor <strong>${haEscape(acc.name || acc.email)}</strong>. Zonder keuze volgt deze persoon de gezinskleur en kiest hij of zij zelf licht of donker.</p>
            <div>
                <p class="text-[11px] font-extrabold uppercase tracking-wider text-[#68736d] mb-1.5">Licht of donker</p>
                <div class="flex flex-wrap gap-1.5">
                    ${modes.map(([v, l]) => `<button type="button" onclick="window.setMemberDisplay(${idx}, 'mode', '${v}')" class="px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${(d.mode || '') === v ? 'bg-[#152920] text-white' : 'bg-stone-100 text-[#1c2520] hover:bg-stone-200'}">${l}</button>`).join('')}
                </div>
            </div>
            <div>
                <p class="text-[11px] font-extrabold uppercase tracking-wider text-[#68736d] mb-1.5">Achtergrondkleur</p>
                <div class="flex flex-wrap gap-2.5">
                    ${colorBtn('', 'Gezin')}
                    ${presets.map(p => colorBtn(p.color, p.name)).join('')}
                </div>
            </div>
        </div>`;
}

window.setMemberDisplay = function(idx, field, value) {
    if (!permGuard('manage_members')) return;
    const acc = platformState.accounts[idx];
    if (!acc) return;
    if (currentRole !== 'admin' && (acc.role === 'admin' || acc.household !== activeHouseholdName)) return;
    if (field === 'mode' && value !== '' && !['light', 'dark', 'auto'].includes(value)) return;
    if (field === 'bgColor' && value !== '' && !/^#[0-9a-f]{6}$/i.test(value)) return;
    if (field !== 'mode' && field !== 'bgColor') return;
    const d = { ...(acc.display || {}) };
    if (value === '') delete d[field]; else d[field] = value;
    if (Object.keys(d).length) acc.display = d; else delete acc.display;
    renderAccountsManagementTable();
    persistStateToFirestore(true);
    // Eigen account aangepast? Meteen zichtbaar
    if (String(acc.email || '').toLowerCase() === String(currentLoggedUserEmail || '').toLowerCase()) {
        if (typeof applyThemeMode === 'function') applyThemeMode();
        if (typeof applyBackgroundFromState === 'function') applyBackgroundFromState();
    }
};

window.addAccountMember = function() {
    if (!permGuard('manage_members')) return;
    const name = document.getElementById('newMemberName').value.trim();
    const email = document.getElementById('newMemberEmail').value.trim().toLowerCase();
    let role = document.getElementById('newMemberRole').value;
    const selectedHousehold = document.getElementById('newMemberHouseholdSelect').value || activeHouseholdName;

    if (!name || !email) {
        showToast("Vul zowel een naam als een Google e-mailadres in.");
        return;
    }
    if (currentRole !== 'admin') {
        role = 'user';
    }

    platformState.accounts.push({
        id: 'acc_' + Date.now(),
        name,
        email,
        role,
        household: selectedHousehold
    });

    document.getElementById('newMemberName').value = '';
    document.getElementById('newMemberEmail').value = '';
    renderAccountsManagementTable();
    renderHouseholdsOverview();
    persistStateToFirestore(true);
};

window.changeAccountRole = function(idx, newRole) {
    if (currentRole !== 'admin' || !platformState.accounts[idx]) return;
    platformState.accounts[idx].role = newRole;
    renderAccountsManagementTable();
    renderHouseholdsOverview();
    persistStateToFirestore(true);
};

window.changeAccountHousehold = function(idx, newHousehold) {
    if (currentRole !== 'admin' || !platformState.accounts[idx]) return;
    platformState.accounts[idx].household = newHousehold;
    renderAccountsManagementTable();
    renderHouseholdsOverview();
    persistStateToFirestore(true);
};

window.removeAccountMember = function(idx) {
    if (!permGuard('manage_members')) return;
    if (!platformState.accounts[idx]) return;
    platformState.accounts.splice(idx, 1);
    renderAccountsManagementTable();
    renderHouseholdsOverview();
    persistStateToFirestore(true);
};

window.openAuthorizedPortalOrLogin = function(preferredSection = null) {
    if (!currentRole) {
        const errEl = document.getElementById('loginErrorMsg');
        if (errEl) errEl.classList.add('hidden');
        window.switchView('login');
        return;
    }
    if ((preferredSection === 'shutters_admin' || preferredSection === 'climate_admin') && (currentRole === 'manager' || currentRole === 'admin')) {
        updateAdminRolePermissionsUI();
        window.switchAdminTab('rolluiken_airco');
        window.switchView('admin');
        return;
    }
    if (preferredSection === 'agenda' || currentRole === 'user' || !permHasAnyManage()) {
        renderAdminLists();
        window.switchView('calendar');
    } else if (currentRole === 'manager' || currentRole === 'admin') {
        updateAdminRolePermissionsUI();
        window.switchView('admin');
    }
};

function completeGoogleSignInWithEmail(email, displayName = "") {
    const cleanEmail = (email || "").trim().toLowerCase();
    const errEl = document.getElementById('loginErrorMsg');
    const matchedAccount = (platformState.accounts || []).find(
        a => (a.email || "").toLowerCase() === cleanEmail
    );

    if (!matchedAccount) {
        if (errEl) errEl.classList.remove('hidden');
        return;
    }

    if (errEl) errEl.classList.add('hidden');
    currentRole = matchedAccount.role;
    currentLoggedUserName = matchedAccount.name || displayName || cleanEmail;
    currentLoggedUserEmail = matchedAccount.email;

    if (matchedAccount.household && platformState.households[matchedAccount.household]) {
        activeHouseholdName = matchedAccount.household;
    }
    syncActiveHouseholdPointer();

    updateNavigationAndRoleVisibility();
    populateAdminInputs();

    applyPermissionsToUI();
    if (typeof applyThemeMode === 'function') applyThemeMode();
    if (currentRole === 'admin') {
        window.switchAdminTab('gezinnen');
    } else if (currentRole === 'manager') {
        window.switchAdminTab(permFirstAdminTab() || 'gebruikers');
    }

    renderAdminLists();
    window.switchView('display');
    showToast(`Ingelogd als ${currentLoggedUserName}`);

    if (appState.haUrl && appState.haToken) {
        window.fetchHomeAssistantEntities(true);
    }
}

window.triggerGoogleSignIn = async function() {
    if (!auth) {
        showToast("Firebase verbinding wordt gestart, probeer het over een seconde opnieuw.");
        return;
    }
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
        const result = await signInWithPopup(auth, provider);
        if (result && result.user && result.user.email) {
            completeGoogleSignInWithEmail(result.user.email, result.user.displayName);
        }
    } catch (popupErr) {
        console.warn("Popup geblokkeerd of geannuleerd, probeer redirect:", popupErr);
        if (popupErr.code === 'auth/popup-blocked') {
            await signInWithRedirect(auth, provider);
        } else if (popupErr.code === 'auth/unauthorized-domain') {
            showToast("Voeg dit domein toe bij Firebase Console -> Authentication -> Settings -> Authorized domains");
        } else {
            showToast("Google inloggen geannuleerd of mislukt.");
        }
    }
};

window.logoutSession = async function() {
    if (auth) {
        try { await signOut(auth); } catch (e) {}
    }
    currentRole = null;
    currentLoggedUserName = "";
    currentLoggedUserEmail = "";
    updateNavigationAndRoleVisibility();
    if (typeof applyThemeMode === 'function') applyThemeMode();
    window.switchView('login');
    showToast("Je bent uitgelogd");
};
