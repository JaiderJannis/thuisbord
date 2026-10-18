'use strict';
/* Firebase Auth/Firestore + cloud-bridge telemetrie */

const {
    initializeApp,
    getAuth, signInAnonymously, signInWithCustomToken, GoogleAuthProvider,
    signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
    getFirestore, doc, setDoc, onSnapshot
} = window.FirebaseSDK;

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

        onAuthStateChanged(auth, (user) => {
            currentUser = user;
            if (!user) return;

            const uidEl = document.getElementById('firebaseUidBadge');
            if (uidEl) uidEl.textContent = `Cloud ID: ${user.uid.substring(0, 8)}`;
            if (badge) badge.textContent = "☁️ Live verbonden met Firebase";

            const configDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'thuisbord_settings', 'main_dashboard');

            onSnapshot(
                configDocRef,
                (snapshot) => {
                    if (snapshot.exists()) {
                        const cloudData = snapshot.data();
                        if (cloudData.accountsJson) {
                            platformState.accounts = JSON.parse(cloudData.accountsJson);
                        }
                        if (cloudData.householdsJson) {
                            const parsedHouseholds = JSON.parse(cloudData.householdsJson);
                            platformState.households = {};
                            Object.keys(parsedHouseholds).forEach(hName => {
                                platformState.households[hName] = {
                                    ...createDefaultHouseholdConfig(hName),
                                    ...parsedHouseholds[hName],
                                    entityMap: {
                                        ...createDefaultHouseholdConfig(hName).entityMap,
                                        ...(parsedHouseholds[hName].entityMap || {})
                                    }
                                };
                            });
                        }
                        const hasSuperAdmin = (platformState.accounts || []).some(a => (a.email || "").toLowerCase() === EIGENAAR_SUPER_ADMIN_EMAIL.toLowerCase());
                        if (!hasSuperAdmin) {
                            const firstHousehold = Object.keys(platformState.households)[0] || "Jannis - Bellens";
                            platformState.accounts.unshift({
                                id: "u_super",
                                name: "Jaider Jannis",
                                email: EIGENAAR_SUPER_ADMIN_EMAIL.toLowerCase(),
                                role: "admin",
                                household: firstHousehold
                            });
                        }
                        syncActiveHouseholdPointer();
                        updateConnectionBadgesForCloudBridge();
                        renderAll();
                        populateAdminInputs();
                    } else {
                        persistStateToFirestore(false);
                    }

                    if (user.email && !currentRole) {
                        completeGoogleSignInWithEmail(user.email, user.displayName);
                    }
                },
                (error) => {
                    console.error("Firestore Listener Error:", error);
                    if (badge) badge.textContent = "⚠️ Cloud leesfout";
                }
            );
        });
    } catch (err) {
        console.error("Firebase init error:", err);
        if (badge) badge.textContent = "Offline Modus";
    }
}

async function persistStateToFirestore(notify = true) {
    syncActiveHouseholdPointer();
    if (!db || !currentUser) {
        if (notify) showToast("Opgeslagen!");
        return;
    }
    try {
        const configDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'thuisbord_settings', 'main_dashboard');
        const payload = {
            accountsJson: JSON.stringify(platformState.accounts || []),
            householdsJson: JSON.stringify(platformState.households || {}),
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser.uid
        };
        await setDoc(configDocRef, payload);
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
