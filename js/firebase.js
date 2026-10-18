'use strict';
/* Firebase: initialisatie, inloggen en keuze van de opslag-indeling (v2 of legacy) */

const {
    initializeApp,
    getAuth, signInAnonymously, signInWithCustomToken, GoogleAuthProvider,
    signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
    getFirestore, doc, setDoc, onSnapshot, collection, getDocs, getDoc, writeBatch
} = window.FirebaseSDK;

let firestoreLayoutInUse = null;  // 'v2' | 'legacy' (null = cloud nog niet gestart)
let cloudUnsubscribers = [];      // actieve Firestore-listeners (worden opgeruimd bij herstart)

// Basispad van alle data: artifacts/{appId}/public/data/...
function firestoreRootPath() {
    return ['artifacts', appId, 'public', 'data'];
}

function isMobileOrHttpsMixedContentBlocked() {
    const url = (appState.haUrl || "").trim().toLowerCase();
    return window.location.protocol === 'https:' && url.startsWith('http://');
}

function pushLiveTelemetryToCloudBridge() {
    // Uitgeschakeld voor het gratis Firebase Spark-plan (max 20.000 writes/dag).
    // Gebruik de directe Home Assistant WebSocket (via Tailscale HTTPS) voor onbeperkte realtime updates!
    return;
}

function updateConnectionBadgesForCloudBridge() {
    const statusBadge = document.getElementById('haConnectionBadge');
    const sourceText = document.getElementById('liveSensorSourceText');
    if (haWsConnected || haDirectRestConnected) return;

    if (appState.lastBridgeSyncAt) {
        const ageSec = Math.round((Date.now() - new Date(appState.lastBridgeSyncAt).getTime()) / 1000);
        if (ageSec < 60) {
            if (statusBadge) {
                statusBadge.textContent = "🟢 Live via Smartphone Cloud-Bridge (Gesynchroniseerd)";
                statusBadge.className = "text-xs font-bold text-[#197447]";
            }
            if (sourceText) {
                sourceText.textContent = "📱 Live via Cloud-Bridge";
            }
            return;
        }
    }

    if (isMobileOrHttpsMixedContentBlocked() && statusBadge) {
        statusBadge.textContent = "📱 Wacht op Cloud-Bridge (Open dashboard op pc of gebruik https:// HA-link)";
        statusBadge.className = "text-xs font-bold text-[#0369a1]";
    }
}

function isPermissionDenied(err) {
    return !!err && (err.code === 'permission-denied' || /permission|insufficient/i.test(err.message || ''));
}

// Zorgt dat de eigenaar altijd als Super Admin in de accountlijst staat
function ensureSuperAdminAccount() {
    if (!platformState.accounts) platformState.accounts = [];
    const hasSuperAdmin = platformState.accounts.some(a => (a.email || "").toLowerCase() === EIGENAAR_SUPER_ADMIN_EMAIL.toLowerCase());
    if (!hasSuperAdmin) {
        const firstHousehold = Object.keys(platformState.households || {})[0] || "Jannis - Bellens";
        platformState.accounts.unshift({
            id: "u_super",
            name: "Jaider Jannis",
            email: EIGENAAR_SUPER_ADMIN_EMAIL.toLowerCase(),
            role: "admin",
            household: firstHousehold
        });
    }
}

async function initFirebase() {
    const badge = document.getElementById('cloudSyncBadge');
    try {
        let firebaseConfig = null;
        const hasCustomConfig = MIJN_EIGEN_FIREBASE_CONFIG.apiKey && MIJN_EIGEN_FIREBASE_CONFIG.projectId;

        if (hasCustomConfig) {
            firebaseConfig = MIJN_EIGEN_FIREBASE_CONFIG;
        } else if (typeof __firebase_config !== 'undefined' && __firebase_config) {
            firebaseConfig = JSON.parse(__firebase_config);
        }

        if (!firebaseConfig) {
            if (badge) badge.textContent = "Lokale Modus";
            syncActiveHouseholdPointer();
            renderAll();
            populateAdminInputs();
            return;
        }

        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        // Verwerk eventuele Google Redirect-login (bijv. vanaf iPhone Safari)
        try {
            const redirectRes = await getRedirectResult(auth);
            if (redirectRes && redirectRes.user && redirectRes.user.email) {
                completeGoogleSignInWithEmail(redirectRes.user.email, redirectRes.user.displayName);
            }
        } catch (redirErr) {
            console.warn("Redirect result check:", redirErr);
        }

        if (!hasCustomConfig && typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else if (!hasCustomConfig && !auth.currentUser) {
            await signInAnonymously(auth);
        }

        onAuthStateChanged(auth, async (user) => {
            currentUser = user;
            if (!user) return;

            const uidEl = document.getElementById('firebaseUidBadge');
            if (uidEl) uidEl.textContent = `Cloud ID: ${user.uid.substring(0, 8)}`;
            if (badge) badge.textContent = "☁️ Live verbonden met Firebase";

            await startCloudSync(user, badge);
        });
    } catch (err) {
        console.error("Firebase init error:", err);
        if (badge) badge.textContent = "Offline Modus";
    }
}

// Start de synchronisatie met de gekozen indeling; valt terug op 'legacy' als de regels v2 blokkeren
async function startCloudSync(user, badge) {
    cloudUnsubscribers.forEach(unsub => { try { unsub(); } catch (e) { /* negeren */ } });
    cloudUnsubscribers = [];

    if (FIRESTORE_LAYOUT === 'v2') {
        try {
            await startFirestoreV2(user, badge);
            return;
        } catch (err) {
            console.error("Firestore v2 start mislukt:", err);
            cloudUnsubscribers.forEach(unsub => { try { unsub(); } catch (e) { /* negeren */ } });
            cloudUnsubscribers = [];
            if (!isPermissionDenied(err)) {
                firestoreLayoutInUse = null;
                if (badge) badge.textContent = "⚠️ Cloud niet bereikbaar (ververs de pagina)";
                return;
            }
            showToast("Firestore-regels blokkeren de nieuwe opslag. Tijdelijk de oude opslag gebruikt.");
        }
    }
    firestoreLayoutInUse = 'legacy';
    startFirestoreLegacy(user, badge);
}

async function persistStateToFirestore(notify = true) {
    syncActiveHouseholdPointer();
    if (!db || !currentUser) {
        if (notify) showToast("Opgeslagen!");
        return;
    }
    if (!firestoreLayoutInUse) {
        if (notify) showToast("Cloud is nog aan het verbinden, probeer het zo opnieuw.");
        return;
    }
    try {
        if (firestoreLayoutInUse === 'v2') {
            const result = await persistFirestoreV2();
            if (result === 'not-ready') {
                if (notify) showToast("Cloud is nog aan het laden, probeer het zo opnieuw.");
                return;
            }
        } else {
            await persistFirestoreLegacy();
        }
        if (notify) showToast(`Wijzigingen voor ${activeHouseholdName} opgeslagen!`);
    } catch (err) {
        console.error("Save error:", err);
        showToast("Fout bij opslaan naar Firebase");
    }
}

window.saveAllToFirebase = function() {
    window.applyAdminChangesLive();
    persistStateToFirestore(true);
};
