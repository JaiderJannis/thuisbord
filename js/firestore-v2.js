'use strict';
/* Firestore – NIEUWE indeling: één document per gezin en per account.

   artifacts/{appId}/public/data/
     ├─ thuisbord_households/{gezin-id}   configuratie van één gezin (echte velden, geen JSON-tekst)
     ├─ thuisbord_accounts/{e-mail}       één account (naam, rol, gezin)
     ├─ thuisbord_meta/migration          markering: eenmalige overzetting is gedaan
     └─ thuisbord_settings/main_dashboard OUDE document (blijft ongemoeid als back-up)

   Twee modi:
     - VOLLEDIG  (eigenaar en accounts met rol "admin"): luistert naar alle gezinnen en accounts.
     - BEPERKT   (rol "manager" of "user"): haalt enkel het eigen account en het eigen gezin op
                 (een manager ook de accounts van het eigen gezin). Dit past bij firestore-stap2.rules.

   Voordelen: kleine documenten (geen 1 MB-limiet), alleen gewijzigde documenten worden
   geschreven (minder writes) en twee gezinnen overschrijven elkaar niet meer. */

const FS_HOUSEHOLDS_COL = 'thuisbord_households';
const FS_ACCOUNTS_COL = 'thuisbord_accounts';
const FS_META_COL = 'thuisbord_meta';
const FS_META_MIGRATION_DOC = 'migration';
const FS_BATCH_SIZE = 400;

let v2Saved = new Map();                               // "col/id" -> stabiele JSON van het laatst bekende serverdocument
let v2Loaded = { accounts: false, households: false }; // eerste data van beide collecties binnen?
let v2Seeded = false;
let v2Scope = null;  // null = volledige modus; anders { email, household, householdId, role } (beperkte modus)

/* ---------- paden ---------- */
function fsCol(name) { return collection(db, ...firestoreRootPath(), name); }
function fsDoc(name, id) { return doc(db, ...firestoreRootPath(), name, id); }

/* ---------- id's ---------- */
function slugify(text) {
    return String(text || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'gezin';
}

function shortHash(text) {
    let h = 5381;
    for (const ch of String(text)) h = ((h << 5) + h + ch.codePointAt(0)) >>> 0;
    return h.toString(36);
}

// "Jannis - Bellens" -> "jannis-bellens-1x2y3z"
function householdDocId(name) {
    return `${slugify(name)}-${shortHash(name)}`;
}

function accountDocId(acc) {
    const email = String((acc && acc.email) || '').trim().toLowerCase().replace(/\//g, '_');
    return email || `id-${String((acc && acc.id) || shortHash(JSON.stringify(acc || {})))}`.replace(/\//g, '_');
}

/* ---------- omzetten van/naar Firestore-data ---------- */
// Firestore weigert geneste arrays en undefined: die worden hier veilig gemaakt.
function toFirestoreData(value) {
    if (Array.isArray(value)) {
        return value.map(v => Array.isArray(v) ? { _nestedJson: JSON.stringify(v) } : toFirestoreData(v));
    }
    if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).forEach(k => {
            const v = value[k];
            if (v === undefined || typeof v === 'function') return;
            out[k] = toFirestoreData(v);
        });
        return out;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
}

function fromFirestoreData(value) {
    if (Array.isArray(value)) return value.map(fromFirestoreData);
    if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === '_nestedJson') return JSON.parse(value._nestedJson);
        const out = {};
        keys.forEach(k => { out[k] = fromFirestoreData(value[k]); });
        return out;
    }
    return value;
}

// Vaste volgorde van sleutels, zodat twee gelijke documenten altijd dezelfde tekst geven
function stableStringify(v) {
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (v && typeof v === 'object') {
        return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    }
    const s = JSON.stringify(v);
    return s === undefined ? 'null' : s;
}

function v2Strip(data) {
    const copy = { ...data };
    delete copy.updatedAt;
    delete copy.updatedBy;
    return copy;
}

/* ---------- lokale staat -> gewenste documenten ---------- */
function v2ScopeAllowsAccount(acc) {
    if (!v2Scope) return true;
    if (accountDocId(acc) === v2Scope.email) return true;
    return v2Scope.role === 'manager' && acc.household === v2Scope.household;
}

function v2BuildDesiredDocs() {
    const out = new Map();
    (platformState.accounts || []).filter(v2ScopeAllowsAccount).forEach(acc => {
        out.set(`${FS_ACCOUNTS_COL}/${accountDocId(acc)}`,
            toFirestoreData({ ...acc, email: String(acc.email || '').toLowerCase() }));
    });
    Object.keys(platformState.households || {}).forEach(name => {
        if (v2Scope && name !== v2Scope.household) return;
        out.set(`${FS_HOUSEHOLDS_COL}/${householdDocId(name)}`,
            toFirestoreData({ ...platformState.households[name], name }));
    });
    return out;
}

function v2HouseholdFromDoc(raw) {
    const data = fromFirestoreData(v2Strip(raw));
    const name = data.name;
    delete data.name;
    const defaults = createDefaultHouseholdConfig(name);
    return {
        name,
        config: { ...defaults, ...data, entityMap: { ...defaults.entityMap, ...(data.entityMap || {}) } }
    };
}

/* ---------- opslaan: alleen wat gewijzigd is ---------- */
async function persistFirestoreV2() {
    // Nooit schrijven vóór de serverdata binnen is: anders overschrijf je echte data met standaardwaarden
    if (!v2Loaded.accounts || !v2Loaded.households) return 'not-ready';

    const desired = v2BuildDesiredDocs();
    const ops = [];
    desired.forEach((data, key) => {
        if (v2Saved.get(key) !== stableStringify(data)) ops.push({ type: 'set', key, data });
    });
    v2Saved.forEach((_, key) => {
        if (!desired.has(key)) ops.push({ type: 'delete', key });
    });
    if (ops.length === 0) return 'unchanged';

    const stamp = new Date().toISOString();
    for (let i = 0; i < ops.length; i += FS_BATCH_SIZE) {
        const batch = writeBatch(db);
        ops.slice(i, i + FS_BATCH_SIZE).forEach(op => {
            const slash = op.key.indexOf('/');
            const ref = fsDoc(op.key.slice(0, slash), op.key.slice(slash + 1));
            if (op.type === 'set') batch.set(ref, { ...op.data, updatedAt: stamp, updatedBy: currentUser.uid });
            else batch.delete(ref);
        });
        await batch.commit();
    }
    ops.forEach(op => {
        if (op.type === 'set') v2Saved.set(op.key, stableStringify(op.data));
        else v2Saved.delete(op.key);
    });
    return 'saved';
}

/* ---------- eenmalige overzetting van het oude document ---------- */
async function v2MigrateLegacyIfNeeded() {
    const marker = await getDoc(fsDoc(FS_META_COL, FS_META_MIGRATION_DOC));
    if (marker.exists()) return 'already';

    const legacy = await getDoc(legacyConfigDocRef());
    if (!legacy.exists()) return 'fresh';

    applyLegacyCloudData(legacy.data());
    ensureSuperAdminAccount();

    const entries = Array.from(v2BuildDesiredDocs().entries());
    const stamp = new Date().toISOString();
    for (let i = 0; i < entries.length; i += FS_BATCH_SIZE) {
        const batch = writeBatch(db);
        entries.slice(i, i + FS_BATCH_SIZE).forEach(([key, data]) => {
            const slash = key.indexOf('/');
            batch.set(fsDoc(key.slice(0, slash), key.slice(slash + 1)), { ...data, updatedAt: stamp, updatedBy: currentUser.uid });
        });
        await batch.commit();
    }
    // De markering komt als allerlaatste: bij een onderbreking wordt de overzetting gewoon opnieuw gedaan
    await setDoc(fsDoc(FS_META_COL, FS_META_MIGRATION_DOC), {
        migratedFrom: 'thuisbord_settings/main_dashboard',
        migratedAt: stamp,
        migratedBy: currentUser.uid,
        households: Object.keys(platformState.households || {}).length,
        accounts: (platformState.accounts || []).length
    });
    return 'migrated';
}

/* ---------- live meeluisteren ---------- */
function v2AfterRemoteApply() {
    if (!(v2Loaded.accounts && v2Loaded.households)) return;

    if (!v2Scope) ensureSuperAdminAccount();  // in beperkte modus mag je nooit andermans account aanmaken
    syncActiveHouseholdPointer();
    updateConnectionBadgesForCloudBridge();
    renderAll();
    populateAdminInputs();

    // Nieuw (leeg) project: standaardgegevens eenmalig wegschrijven (enkel volledige modus)
    if (!v2Scope && !v2Seeded && v2Saved.size === 0) {
        v2Seeded = true;
        persistFirestoreV2().catch(err => console.error("Eerste opslag mislukt:", err));
    }
    if (currentUser && currentUser.email && !currentRole) {
        completeGoogleSignInWithEmail(currentUser.email, currentUser.displayName);
    }
}

function v2ApplyAccountDoc(id, raw, own) {
    v2Saved.set(`${FS_ACCOUNTS_COL}/${id}`, stableStringify(v2Strip(raw)));
    if (own) return; // echo van onze eigen schrijfactie: lokale staat is al up-to-date
    const acc = fromFirestoreData(v2Strip(raw));
    if (!platformState.accounts) platformState.accounts = [];
    const idx = platformState.accounts.findIndex(a => accountDocId(a) === id);
    if (idx >= 0) platformState.accounts[idx] = acc;
    else platformState.accounts.push(acc);
}

function v2RemoveAccountDoc(id, own) {
    v2Saved.delete(`${FS_ACCOUNTS_COL}/${id}`);
    if (!own) platformState.accounts = (platformState.accounts || []).filter(a => accountDocId(a) !== id);
}

function v2ApplyHouseholdDoc(id, raw, own) {
    v2Saved.set(`${FS_HOUSEHOLDS_COL}/${id}`, stableStringify(v2Strip(raw)));
    if (own) return;
    const { name, config } = v2HouseholdFromDoc(raw);
    if (name) platformState.households[name] = config;
}

function v2RemoveHouseholdDoc(id, raw, own) {
    v2Saved.delete(`${FS_HOUSEHOLDS_COL}/${id}`);
    if (own) return;
    const oldName = (raw && raw.name)
        || Object.keys(platformState.households || {}).find(n => householdDocId(n) === id);
    if (oldName) delete platformState.households[oldName];
}

// Collectie-listener op accounts (volledige modus, of een manager met filter op het eigen gezin)
function v2HandleAccountsSnapshot(snapshot) {
    if (v2Scope && !v2Loaded.accounts) platformState.accounts = []; // standaard-placeholder weg
    snapshot.docChanges().forEach(change => {
        const own = change.doc.metadata.hasPendingWrites;
        if (change.type === 'removed') v2RemoveAccountDoc(change.doc.id, own);
        else v2ApplyAccountDoc(change.doc.id, change.doc.data(), own);
    });
    v2Loaded.accounts = true;
    v2AfterRemoteApply();
}

// Collectie-listener op gezinnen (enkel volledige modus)
function v2HandleHouseholdsSnapshot(snapshot) {
    let received = false;
    snapshot.docChanges().forEach(change => {
        const own = change.doc.metadata.hasPendingWrites;
        if (change.type === 'removed') {
            v2RemoveHouseholdDoc(change.doc.id, change.doc.data(), own);
            return;
        }
        if (!received && !v2Loaded.households) {
            // Eerste echte gezin van de server: weg met de lokale standaard-placeholder
            platformState.households = {};
        }
        received = true;
        v2ApplyHouseholdDoc(change.doc.id, change.doc.data(), own);
    });
    v2Loaded.households = true;
    v2AfterRemoteApply();
}

// Document-listener op het eigen account (beperkte modus, rol "user")
function v2HandleOwnAccountDocSnapshot(snapshot) {
    if (!v2Loaded.accounts) platformState.accounts = [];
    const own = snapshot.metadata.hasPendingWrites;
    if (snapshot.exists()) v2ApplyAccountDoc(snapshot.id, snapshot.data(), own);
    else v2RemoveAccountDoc(snapshot.id, own);
    v2Loaded.accounts = true;
    v2AfterRemoteApply();
}

// Document-listener op het eigen gezin (beperkte modus)
function v2HandleOwnHouseholdDocSnapshot(snapshot) {
    const own = snapshot.metadata.hasPendingWrites;
    if (!v2Loaded.households) platformState.households = {};
    if (snapshot.exists()) {
        v2ApplyHouseholdDoc(snapshot.id, snapshot.data(), own);
    } else {
        // Gezinsdocument bestaat (nog) niet: toon een lege standaardconfiguratie, schrijf niets weg
        v2Saved.delete(`${FS_HOUSEHOLDS_COL}/${snapshot.id}`);
        if (!Object.keys(platformState.households).length) {
            platformState.households[v2Scope.household] = createDefaultHouseholdConfig(v2Scope.household);
        }
    }
    v2Loaded.households = true;
    v2AfterRemoteApply();
}

function v2ListenerError(err, badge) {
    console.error("Firestore Listener Error:", err);
    if (badge) badge.textContent = isPermissionDenied(err)
        ? "🔒 Geen toegang: dit Google-account staat niet in de ledenlijst"
        : "⚠️ Cloud leesfout";
}

function v2NoAccountError() {
    const err = new Error("Geen account gevonden voor dit e-mailadres");
    err.code = 'permission-denied';
    return err;
}

// Beperkte modus: enkel eigen account + eigen gezin (manager: ook de accounts van het eigen gezin)
function startFirestoreV2Scoped(badge, ownAccount) {
    v2Scope = {
        email: accountDocId(ownAccount),
        household: ownAccount.household,
        householdId: householdDocId(ownAccount.household),
        role: ownAccount.role
    };
    if (v2Scope.role === 'manager') {
        const q = query(fsCol(FS_ACCOUNTS_COL), where('household', '==', v2Scope.household));
        cloudUnsubscribers.push(onSnapshot(q, v2HandleAccountsSnapshot, err => {
            if (!isPermissionDenied(err)) { v2ListenerError(err, badge); return; }
            // Vangnet: ledenlijst van het gezin niet toegestaan -> enkel het eigen account volgen
            console.warn("Ledenlijst-query geweigerd, enkel eigen account geladen:", err);
            showToast("De ledenlijst van het gezin kon niet geladen worden; enkel je eigen account is geladen.");
            cloudUnsubscribers.push(onSnapshot(fsDoc(FS_ACCOUNTS_COL, v2Scope.email), v2HandleOwnAccountDocSnapshot, e2 => v2ListenerError(e2, badge)));
        }));
    } else {
        cloudUnsubscribers.push(onSnapshot(fsDoc(FS_ACCOUNTS_COL, v2Scope.email), v2HandleOwnAccountDocSnapshot, err => v2ListenerError(err, badge)));
    }
    cloudUnsubscribers.push(onSnapshot(fsDoc(FS_HOUSEHOLDS_COL, v2Scope.householdId), v2HandleOwnHouseholdDocSnapshot, err => v2ListenerError(err, badge)));
}

async function startFirestoreV2(user, badge) {
    const email = String(user.email || '').trim().toLowerCase();
    const isOwner = email === EIGENAAR_SUPER_ADMIN_EMAIL.toLowerCase();
    v2Saved = new Map();
    v2Loaded = { accounts: false, households: false };
    v2Seeded = false;
    v2Scope = null;

    // 1. Toegang en rol bepalen. De eigenaar is altijd volledig; anderen worden bepaald door hun eigen accountdocument.
    //    Een fout 'permission-denied' laat startCloudSync terugvallen op de oude opslag.
    let ownAccount = null;
    if (!isOwner) {
        const ownSnap = await getDoc(fsDoc(FS_ACCOUNTS_COL, accountDocId({ email })));
        if (!ownSnap.exists()) throw v2NoAccountError();
        ownAccount = fromFirestoreData(v2Strip(ownSnap.data()));
    } else {
        await Promise.all([getDocs(fsCol(FS_HOUSEHOLDS_COL)), getDocs(fsCol(FS_ACCOUNTS_COL))]);
    }
    firestoreLayoutInUse = 'v2';

    // 2a. Beperkte modus (manager / user)
    if (ownAccount && ownAccount.role !== 'admin') {
        startFirestoreV2Scoped(badge, ownAccount);
        return;
    }

    // 2b. Volledige modus (eigenaar / admin): eenmalig het oude document omzetten
    //     (fouten stoppen de start, zodat er nooit lege data wordt weggeschreven)
    const migration = await v2MigrateLegacyIfNeeded();
    if (migration === 'migrated') showToast("Gegevens overgezet naar de nieuwe Firebase-indeling.");

    cloudUnsubscribers.push(onSnapshot(fsCol(FS_ACCOUNTS_COL), v2HandleAccountsSnapshot, err => v2ListenerError(err, badge)));
    cloudUnsubscribers.push(onSnapshot(fsCol(FS_HOUSEHOLDS_COL), v2HandleHouseholdsSnapshot, err => v2ListenerError(err, badge)));
}
