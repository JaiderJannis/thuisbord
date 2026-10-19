'use strict';
/* Gedeelde applicatiestatus (globale variabelen) */

// Geen nep-accounts meer: enkel jouw eigen Super Admin account als basis, de rest komt live uit Firebase!
let platformState = {
    accounts: [
        { id: "u_super", name: "Jaider Jannis", email: EIGENAAR_SUPER_ADMIN_EMAIL.toLowerCase(), role: "admin", household: "Jannis - Bellens" }
    ],
    households: {
        "Jannis - Bellens": createDefaultHouseholdConfig("Jannis - Bellens")
    }
};

platformState.permissions = { manager: {}, user: {} }; // rechten per rol (zie permissions.js)

let activeHouseholdName = "Jannis - Bellens";

let appState = platformState.households[activeHouseholdName];

let currentSelectedHour = new Date().getHours();

let activePriceDayView = 'today';

let adminEditPriceDay = 'today';

let currentRole = null;

let currentLoggedUserName = "";

let currentLoggedUserEmail = "";

let adviceRotationIndex = 0;

let discoveredHaEntities = [];

let haWebSocket = null;

let haWsConnected = false;

let haDirectRestConnected = false;

let lastHaWsUrl = "";

let lastCloudBridgePushMs = 0;

let lastMidnightHistorySyncDate = "";

let activeRoomsFilter = "all"; // 'all' | 'lights' | 'shutters' | 'climate'

let expandedRoomsSet = new Set(); // Standaard leeg = Alle ruimtes standaard dichtgeklapt!

let dragItemPayload = null;

let liveTickerEnabled = true;

let db = null;

let auth = null;

let currentUser = null;

const appId = typeof __app_id !== 'undefined' ? __app_id : 'thuisbord-default-app';

let wsServiceCallId = 100;
