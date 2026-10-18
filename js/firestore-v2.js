'use strict';
/* Firestore – NIEUWE indeling: één document per gezin en per account.

   artifacts/{appId}/public/data/
     ├─ thuisbord_households/{gezin-id}   configuratie van één gezin (echte velden, geen JSON-tekst)
     ├─ thuisbord_accounts/{e-mail}       één account (naam, rol, gezin)
     ├─ thuisbord_meta/migration          markering: eenmalige overzetting is gedaan
     └─ thuisbord_settings/main_dashboard OUDE document (blijft ongemoeid als back-up)

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
function v2BuildDesiredDocs() {
    const out = new Map();
    (platformState.accounts || []).forEach(acc => {
        out.set(`${FS_ACCOUNTS_COL}/${accountDocId(acc)}`,
            toFirestoreData({ ...acc, email: String(acc.email || '').toLowerCase() }));
    });
    Object.keys(platformState.households || {}).forEach(name => {
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

    ensureSuperAdminAccount();
    syncActiveHouseholdPointer();
    updateConnectionBadgesForCloudBridge();
    renderAll();
    populateAdminInputs();

    // Nieuw (leeg) project: standaardgegevens eenmalig wegschrijven
    if (!v2Seeded && v2Saved.size === 0) {
        v2Seeded = true;
        persistFirestoreV2().catch(err => console.error("Eerste opslag mislukt:", err));
    }
    if (currentUser && currentUser.email && !currentRole) {
        completeGoogleSignInWithEmail(currentUser.email, currentUser.displayName);
    }
}

function v2HandleAccountsSnapshot(snapshot) {
    snapshot.docChanges().forEach(change => {
        const id = change.doc.id;
        const key = `${FS_ACCOUNTS_COL}/${id}`;
        const own = change.doc.metadata.hasPendingWrites; // echo van onze eigen schrijfactie

        if (change.type === 'removed') {
            v2Saved.delete(key);
            if (!own) platformState.accounts = (platformState.accounts || []).filter(a => accountDocId(a) !== id);
            return;
        }
        const raw = change.doc.data();
        v2Saved.set(key, stableStringify(v2Strip(raw)));
        if (own) return;

        const acc = fromFirestoreData(v2Strip(raw));
        if (!platformState.accounts) platformState.accounts = [];
        const idx = platformState.accounts.findIndex(a => accountDocId(a) === id);
        if (idx >= 0) platformState.accounts[idx] = acc;
        else platformState.accounts.push(acc);
    });
    v2Loaded.accounts = true;
    v2AfterRemoteApply();
}

function v2HandleHouseholdsSnapshot(snapshot) {
    let received = false;
    snapshot.docChanges().forEach(change => {
        const id = change.doc.id;
        const key = `${FS_HOUSEHOLDS_COL}/${id}`;
        const own = change.doc.metadata.hasPendingWrites;

        if (change.type === 'removed') {
            v2Saved.delete(key);
            if (!own) {
                const oldName = (change.doc.data() || {}).name
                    || Object.keys(platformState.households || {}).find(n => householdDocId(n) === id);
                if (oldName) delete platformState.households[oldName];
            }
            return;
        }
        const raw = change.doc.data();
        v2Saved.set(key, stableStringify(v2Strip(raw)));
        if (own) return;

        const { name, config } = v2HouseholdFromDoc(raw);
        if (!name) return;
        if (!received) {
            // Eerste echte gezin van de server: weg met de lokale standaard-placeholder
            if (!v2Loaded.households) platformState.households = {};
            received = true;
        }
        platformState.households[name] = config;
    });
    v2Loaded.households = true;
    v2AfterRemoteApply();
}

function v2ListenerError(err, badge) {
    console.error("Firestore Listener Error:", err);
    if (badge) badge.textContent = "⚠️ Cloud leesfout";
}

async function startFirestoreV2(user, badge) {
    // 1. Toegang testen: gooit 'permission-denied' als de Firestore-regels de nieuwe collecties blokkeren
    await Promise.all([getDocs(fsCol(FS_HOUSEHOLDS_COL)), getDocs(fsCol(FS_ACCOUNTS_COL))]);
    firestoreLayoutInUse = 'v2';
    v2Saved = new Map();
    v2Loaded = { accounts: false, households: false };
    v2Seeded = false;

    // 2. Eenmalig het oude document omzetten (fouten stoppen de start, zodat er nooit lege data wordt weggeschreven)
    const migration = await v2MigrateLegacyIfNeeded();
    if (migration === 'migrated') showToast("Gegevens overgezet naar de nieuwe Firebase-indeling.");

    // 3. Live meeluisteren
    cloudUnsubscribers.push(onSnapshot(fsCol(FS_ACCOUNTS_COL), v2HandleAccountsSnapshot, err => v2ListenerError(err, badge)));
    cloudUnsubscribers.push(onSnapshot(fsCol(FS_HOUSEHOLDS_COL), v2HandleHouseholdsSnapshot, err => v2ListenerError(err, badge)));
}
