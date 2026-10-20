'use strict';
/* Firestore – OUDE indeling: alles in één document (thuisbord_settings/main_dashboard).
   Wordt enkel nog gebruikt als FIRESTORE_LAYOUT = "legacy" of als terugval. */

function legacyConfigDocRef() {
    return doc(db, ...firestoreRootPath(), 'thuisbord_settings', 'main_dashboard');
}

// Zet de tekst-JSON uit het oude document om naar platformState (gedeeld met de v2-migratie)
function applyLegacyCloudData(cloudData) {
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
}

function startFirestoreLegacy(user, badge) {
    const unsub = onSnapshot(
        legacyConfigDocRef(),
        (snapshot) => {
            if (snapshot.exists()) {
                applyLegacyCloudData(snapshot.data());
                ensureSuperAdminAccount();
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
            if (badge) badge.textContent = isPermissionDenied(error)
                ? "🔒 Geen toegang: dit Google-account staat niet in de ledenlijst"
                : "⚠️ Cloud leesfout";
        }
    );
    cloudUnsubscribers.push(unsub);
}

async function persistFirestoreLegacy() {
    await setDoc(legacyConfigDocRef(), {
        accountsJson: JSON.stringify(platformState.accounts || []),
        householdsJson: JSON.stringify(platformState.households || {}),
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.uid
    });
}
