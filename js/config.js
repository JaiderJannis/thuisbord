'use strict';
/* Firebase-configuratie, super-admin e-mail en standaard huishouden-template */

// Datum van vandaag in LOKALE tijd (YYYY-MM-DD). Niet toISOString() gebruiken: dat is UTC,
// waardoor de dag-tellers om 02:00 in plaats van om middernacht zouden herstarten.
function localDateKey(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// JOUW FIREBASE CONFIGURATIE
const MIJN_EIGEN_FIREBASE_CONFIG = {
    apiKey: "AIzaSyCmbMbBxrTX1TG0u6ujbWhROhgxO_qoHwk",
    authDomain: "thuisbord-d1b46.firebaseapp.com",
    projectId: "thuisbord-d1b46",
    storageBucket: "thuisbord-d1b46.firebasestorage.app",
    messagingSenderId: "974977360408",
    appId: "1:974977360408:web:59464b6b219d4e6597d96d"
};

// URL van je Cloudflare Worker voor de EPEX-prijzen (zie ../cloudflare-worker/README.md).
// Voorbeeld: "https://thuisbord-prijzen.jouwnaam.workers.dev"  (zonder slash op het einde)
// Leeg laten = direct bij Energy-Charts ophalen (wordt door de browser geblokkeerd via CORS).
const EPEX_PROXY_URL = "";

// Opslag-indeling in Firestore:
//   "v2"     = aparte documenten per gezin en per account (aanbevolen, zie FIREBASE.md)
//   "legacy" = alles in één document (oude manier, enkel als terugvaloptie)
const FIRESTORE_LAYOUT = "v2";

// Voorbeeld-entiteiten van "Smart Jaider" (uit de Home Assistant smart-ev-card).
// Sleutels = de velden van de kaart zonder het achtervoegsel "_entity".
const DEFAULT_SMART_EV_ENTITIES = {
    status: "sensor.smart_jaider_charger_connected",
    charge_status: "sensor.smart_jaider_charging_status",
    time_remaining: "sensor.smart_jaider_charging_time_remaining",
    battery: "sensor.smart_jaider_battery",
    range: "sensor.smart_jaider_range",
    odometer: "sensor.smart_jaider_odometer",
    interior_temp: "sensor.smart_jaider_interior_temperature",
    motor: "sensor.smart_jaider_motor",
    lock: "lock.smart_jaider_door_lock",
    defrost: "switch.smart_jaider_front_defrost",
    charge_control: "switch.smart_jaider_charging_control",
    power: "sensor.smart_jaider_charging_power",
    charge_current: "sensor.smart_jaider_charging_current",
    service: "sensor.smart_days_to_service",
    central_lock: "binary_sensor.smart_jaider_central_locking_status",
    door_df: "binary_sensor.smart_door_lock_status_driver",
    door_pf: "binary_sensor.smart_door_lock_status_passenger",
    door_dr: "binary_sensor.smart_door_lock_status_driver_rear",
    door_pr: "binary_sensor.smart_door_lock_status_passenger_rear",
    door_open_df: "binary_sensor.smart_door_open_status_driver",
    door_open_pf: "binary_sensor.smart_door_open_status_passenger",
    door_open_dr: "binary_sensor.smart_door_open_status_driver_rear",
    door_open_pr: "binary_sensor.smart_door_open_status_passenger_rear",
    tp_df: "sensor.smart_jaider_tire_pressure_driver_front",
    tp_pf: "sensor.smart_jaider_tire_pressure_passenger_front",
    tp_dr: "sensor.smart_jaider_tire_pressure_driver_rear",
    tp_pr: "sensor.smart_jaider_tire_pressure_passenger_rear",
    tt_df: "sensor.smart_tire_temperature_driver_front",
    tt_pf: "sensor.smart_tire_temperature_passenger_front",
    tt_dr: "sensor.smart_tire_temperature_driver_rear",
    tt_pr: "sensor.smart_tire_temperature_passenger_rear"
};

function createDefaultCars(householdName) {
    // De voorbeeld-entiteiten horen bij het eerste gezin van de eigenaar; andere gezinnen starten leeg.
    const prefill = householdName === "Jannis - Bellens";
    return [
        { id: "car1", name: "Smart Jaider", model: "Smart #1", lockOnMeans: "unlocked", entities: prefill ? { ...DEFAULT_SMART_EV_ENTITIES } : {} },
        { id: "car2", name: "Smart Partner", model: "Smart #1", lockOnMeans: "unlocked", entities: {} }
    ];
}

const EIGENAAR_SUPER_ADMIN_EMAIL = "jaiderjannis@gmail.com";

// Standaard template voor een Gezin / Huishouden
// Standaardinstellingen van het slimme advies en de planner (alles per gezin aanpasbaar in Beheer → Advies & doelen)
function defaultPlannerSettings() {
    return {
        horizonHours: 24,                 // zoek de beste start binnen zoveel uur
        jobs: [
            { id: 'job_wasmachine', name: 'Wasmachine', icon: '🫧', hours: 2, kwh: 1.0 },
            { id: 'job_droger', name: 'Droger', icon: '👕', hours: 2, kwh: 2.5 },
            { id: 'job_vaatwasser', name: 'Vaatwasser', icon: '🍽️', hours: 2, kwh: 1.2 }
        ],
        rules: {
            cheapNow: true, peakNow: true, negativePrice: true, bestStart: true, solarSurplus: true,
            capacityPeak: true, tomorrow: true, batteryPeak: true, budget: true, sunTomorrow: true
        },
        solarSurplusW: 500,               // vanaf hoeveel zonne-overschot (W) adviseren
        capacityPct: 90,                  // waarschuwen vanaf % van de maandpiek
        cheapMargin: 0.02,                // € boven het dalmoment dat nog als goedkoop telt
        peakMargin: 0.03,                 // € onder het piekmoment dat nog als duur telt
        maxBestStartTips: 2               // aantal "beste start"-tips tegelijk in de rotatie
    };
}

const createDefaultHouseholdConfig = (name = "Jannis - Bellens") => ({
    householdName: name,
    statusText: "Live via Home Assistant",
    haUrl: "",
    haToken: "",
    bznZone: "BE",
    googleCalendarUrl: "",
    lampColorHex: "#19975c",
    lampIsOn: true,
    lampFriendlyName: "Pulse Lamp",
    liveWasteItems: [],
    haTodayEvents: [],
    houseCalcMode: "ha_formula", // 'ha_formula' | 'sensor_positive'
    batterySignConvention: "negative_discharge",
    batteryMode: "discharging",
    midnightBaselines: {
        date: localDateKey(),
        kwhImport: null,
        kwhExport: null,
        gasToday: null,
        waterToday: null
    },
    rooms: ["Woonkamer", "Keuken", "Slaapkamer"],
    cars: createDefaultCars(name),
    evcc: { loadpoints: [] },
    music: { players: [] },
    scenes: [],
    planner: defaultPlannerSettings(),
    budget: { monthEuro: 0, monthKwh: 0, yearEuro: 0 },
    weather: { source: 'ha', lat: '', lon: '', name: '' },
    history: {},
    historyArchive: {},
    notifSettings: { appliances: true, cars: true, robots: true, waste: true, connection: true },
    entityMap: {
        solarW: "",
        houseW: "",
        gridW: "",
        gridImportW: "",
        gridExportW: "",
        batteryW: "",
        batteryPct: "",
        gasRate: "",
        gasToday: "",
        waterRate: "",
        waterTodayLiters: "",
        kwhImport: "",
        kwhImportT2: "",
        kwhExport: "",
        kwhExportT2: "",
        kwhSolar: "",
        monthlyPeakW: "",
        priceSensor: "",
        statusLamp: "",
        waste_pmd: "",
        waste_gft: "",
        waste_papier: "",
        waste_rest: "",
        calendarEntity: ""
    },
    autoAdvice: true,
    rotateAdvice: true,
    adviceText: "Stroom is nu goedkoop. Zet de wasmachine of vaatwasser aan.",
    adviceBadge: "Gunstig tarief",
    customAdvices: [
        { id: "ca1", text: "Zonnepanelen wekken nu gratis stroom op. Ideaal moment voor de vaatwasser!", badge: "Zon-overschot" }
    ],
    solarW: 224,
    houseW: 367,
    gridW: 8,
    gridImportW: 8,
    gridExportW: 0,
    batteryW: 143,
    batteryPct: 100,
    batteryCap: 15.0,
    gasRate: 0.06,
    gasToday: 0.42,
    monthlyPeakW: 0,
    gasPricePerM3: 1.32,
    waterRate: 4.5,
    waterTodayLiters: 118,
    waterPricePerM3: 1.25,
    vatPercent: 21,
    fixedDailyCost: 0.75,
    taxPerKwh: 0.108,
    markupPerKwh: 0.02,
    applyFormulaToHours: true,
    costElec: 0.00,
    costGas: 0.02,
    kwhImport: 0.01,
    kwhSolar: 10.2,
    kwhExport: 5.9,
    hourlyPrices: [
        0.08, 0.07, 0.07, 0.06, 0.06, 0.08,
        0.11, 0.14, 0.13, 0.09, 0.06, 0.04,
        0.02, 0.01, 0.02, 0.06, 0.11, 0.16,
        0.21, 0.23, 0.17, 0.12, 0.09, 0.08
    ],
    tomorrowPrices: [
        0.07, 0.06, 0.06, 0.05, 0.05, 0.07,
        0.10, 0.13, 0.12, 0.08, 0.05, 0.03,
        0.01, 0.00, 0.01, 0.05, 0.10, 0.15,
        0.19, 0.21, 0.16, 0.11, 0.08, 0.07
    ],
    appliances: [
        { id: "app1", icon: "🧺", name: "Wasmachine", watts: 65, active: true, entityId: "" },
        { id: "app2", icon: "🍽️", name: "Vaatwasser", watts: 0, active: false, entityId: "" },
        { id: "app3", icon: "🚗", name: "Laadpaal EV", watts: 0, active: false, entityId: "" }
    ],
    roomLights: [
        { id: "lt1", name: "Plafondlamp Zithoek", room: "Woonkamer", entityId: "", state: "on", brightnessPct: 80 },
        { id: "lt2", name: "Sfeerverlichting TV", room: "Woonkamer", entityId: "", state: "on", brightnessPct: 45 },
        { id: "lt3", name: "Werkblad Verlichting", room: "Keuken", entityId: "", state: "off", brightnessPct: 100 },
        { id: "lt4", name: "Nachtlampje", room: "Slaapkamer", entityId: "", state: "off", brightnessPct: 30 }
    ],
    shutters: [
        { id: "sh1", name: "Rolluik Woonkamer Voor", room: "Woonkamer", entityId: "", state: "open", position: 100 },
        { id: "sh2", name: "Rolluik Keuken / Tuin", room: "Keuken", entityId: "", state: "open", position: 80 },
        { id: "sh3", name: "Rolluik Grote Slaapkamer", room: "Slaapkamer", entityId: "", state: "closed", position: 0 }
    ],
    climates: [
        {
            id: "cl1",
            name: "Airco Woonkamer",
            room: "Woonkamer",
            entityId: "",
            hvacMode: "cool",
            currentTemp: 21.5,
            targetTemp: 20.0,
            fanMode: "auto",
            swingMode: "off",
            hvacModes: ["off", "cool", "heat", "heat_cool", "dry", "fan_only"],
            fanModes: ["auto", "low", "medium", "high"],
            swingModes: ["off", "vertical", "horizontal", "both"]
        },
        {
            id: "cl2",
            name: "Airco Slaapkamer",
            room: "Slaapkamer",
            entityId: "",
            hvacMode: "off",
            currentTemp: 19.5,
            targetTemp: 18.5,
            fanMode: "low",
            swingMode: "off",
            hvacModes: ["off", "cool", "heat", "heat_cool", "dry", "fan_only"],
            fanModes: ["auto", "low", "medium", "high"],
            swingModes: ["off", "vertical", "horizontal", "both"]
        }
    ],
    robots: [
        {
            id: "rob_vacuum",
            type: "vacuum",
            icon: "🧹",
            name: "Robotstofzuiger",
            entityId: "",
            extras: [
                { id: "rx_bin", icon: "🗑️", label: "Stofbak", entityId: "" }
            ],
            state: "docked",
            batteryPct: null,
            lastRun: "Vandaag 09:15",
            tasks: [
                { id: "rt1", name: "Stofbak & Filter reinigen", usedHours: 8, maxHours: 15, lastReset: "12 okt" },
                { id: "rt2", name: "Zijborstel & Hoofdborstel nakijken", usedHours: 24, maxHours: 40, lastReset: "1 okt" },
                { id: "rt3", name: "Sensoren & Laadcontacten afvegen", usedHours: 14, maxHours: 30, lastReset: "5 okt" }
            ]
        },
        {
            id: "rob_mower",
            type: "mower",
            icon: "🌱",
            name: "Robotmaaier",
            entityId: "",
            state: "docked",
            batteryPct: null,
            lastRun: "Gisteren 16:30",
            tasks: [
                { id: "rm1", name: "Maaimesjes vervangen / draaien", usedHours: 38, maxHours: 50, lastReset: "28 sep" },
                { id: "rm2", name: "Onderkant & Maaidek grasvrij maken", usedHours: 12, maxHours: 20, lastReset: "10 okt" },
                { id: "rm3", name: "Wielen & Laadstation reinigen", usedHours: 19, maxHours: 35, lastReset: "3 okt" }
            ]
        }
    ],
    agendaItems: [],
    tasks: [
        { id: "t1", text: "Wasmachine aanzetten tijdens daluren", done: false }
    ],
    wasteEnabled: false,
    wasteType: "GFT",
    wastePostal: "3460 Bekkevoort",
    wasteDate: "Dinsdag 20 oktober",
    wasteDesc: "Groente-, fruit- en tuinafval",
    powerHistory: [
        { s: 40, h: 60 }, { s: 85, h: 75 }, { s: 140, h: 90 }, { s: 190, h: 110 },
        { s: 210, h: 95 }, { s: 245, h: 80 }, { s: 195, h: 120 }, { s: 224, h: 89 }
    ]
});
