'use strict';
/* Opstart: window.onload en intervallen */

window.onload = function() {
    syncActiveHouseholdPointer();
    renderAll();
    populateAdminInputs();
    updateClock();
    window.switchView('login');

    window.fetchLiveEpexPrices(false);

    setInterval(updateClock, 1000);

    setInterval(async () => {
        if (appState.haUrl && appState.haToken) {
            if (!haWsConnected) {
                await window.fetchHomeAssistantEntities(true);
            }
        }
        updateConnectionBadgesForCloudBridge();
        // Alleen simuleren als er géén directe HA-verbinding is én er geen verse Cloud-Bridge data binnenkomt
        const bridgeFresh = appState.lastBridgeSyncAt && ((Date.now() - new Date(appState.lastBridgeSyncAt).getTime()) < 25000);
        if (liveTickerEnabled && !haWsConnected && !haDirectRestConnected && !bridgeFresh) {
            tickLiveEnergyMetrics();
        }
    }, 2000);

    setInterval(() => {
        if (appState.autoAdvice && appState.rotateAdvice) {
            const pool = buildLiveAdvicePool();
            if (pool.length > 1) {
                adviceRotationIndex = (adviceRotationIndex + 1) % pool.length;
                renderAdviceBanner();
            }
        }
    }, 10000);

    initFirebase();
};
