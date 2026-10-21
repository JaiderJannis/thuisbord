'use strict';
/* Wasserij: wasmachine en droger live volgen via Home Assistant (bv. de SmartThings-integratie voor Samsung).
   appState.laundry = { devices: [ { id, name, icon, kind:'washer'|'dryer', entities:{ state, job, completion, program, power }, extras:[entity_id,...] } ] }
   - extras:     willekeurige extra entiteiten (LocalThings: stroom, spanning, kinderslot, centrifuge...), getoond als tegels
   - state:      machinestatus (run / pause / stop)
   - job:        fase (wassen, spoelen, centrifugeren, drogen, afkoelen, klaar...)
   - completion: tijdstip waarop het programma klaar is (timestamp-sensor), of resterende minuten
   - program:    gekozen programma, als jouw integratie dat doorgeeft (bij SmartThings vaak niet)
   - power:      huidig vermogen in W (optioneel, helpt bij het herkennen van "bezig")
   Alles is te koppelen op de pagina zelf (⚙️ Instellen); het bord probeert de entiteiten zelf te herkennen. */

const LAUNDRY_ROLES = [
    ['state', 'Machinestatus', 'bv. sensor.wasmachine_machine_state'],
    ['job', 'Fase / cyclus', 'bv. sensor.wasmachine_job_state'],
    ['completion', 'Klaar om (tijdstip of minuten)', 'bv. sensor.wasmachine_completion_time'],
    ['program', 'Programma', 'bv. select.wasmachine_cycle (niet altijd beschikbaar)'],
    ['power', 'Vermogen (W)', 'bv. sensor.wasmachine_power']
];
const LAUNDRY_JOB_NL = {
    wash: 'Wassen', prewash: 'Voorwas', rinse: 'Spoelen', spin: 'Centrifugeren', drying: 'Drogen', cooling: 'Afkoelen',
    finish: 'Klaar', finished: 'Klaar', none: '', delaywash: 'Uitgesteld', delayed: 'Uitgesteld', weightsensing: 'Lading wegen',
    airwash: 'Verfrissen', ai: 'Slim wassen', aiwash: 'Slim wassen', airinse: 'Slim spoelen', aispin: 'Slim centrifugeren',
    predrain: 'Voorbereiden', wrinklePrevent: 'Kreukbeveiliging', wrinkleprevent: 'Kreukbeveiliging', freezeprotection: 'Vorstbeveiliging',
    sensing: 'Meten', fill: 'Vullen', drain: 'Afvoeren', steam: 'Stomen', soak: 'Weken', running: 'Bezig', run: 'Bezig'
};
const LAUNDRY_RUN = new Set(['run', 'running', 'on', 'active', 'washing', 'drying', 'in_progress', 'busy', 'working']);
const LAUNDRY_PAUSE = new Set(['pause', 'paused']);

const laundryRun = new Map();      // id -> { since, max }  (alleen in het geheugen)
let laundryEdit = false;
let laundryHtmlCache = '';
let laundrySaveTimer = null;

function ensureLaundry() {
    if (!appState.laundry || typeof appState.laundry !== 'object') appState.laundry = { devices: [] };
    if (!Array.isArray(appState.laundry.devices)) appState.laundry.devices = [];
    return appState.laundry;
}
const laEsc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function laundrySave(now) {
    clearTimeout(laundrySaveTimer);
    const go = () => { try { persistStateToFirestore(false); } catch (e) { /* negeren */ } };
    if (now) go(); else laundrySaveTimer = setTimeout(go, 600);
}
function laundryPretty(t) {
    const s = String(t || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/* ---------- status van één toestel ---------- */
// Mooi label voor een extra entiteit: friendly name zonder de naam van het toestel ervoor
function laundryExtraLabel(dev, st) {
    let n = String((st.attributes && st.attributes.friendly_name) || st.entity_id.split('.')[1].replace(/_/g, ' '));
    const dn = String(dev.name || '').trim();
    if (dn && n.toLowerCase().startsWith(dn.toLowerCase() + ' ') && n.length > dn.length + 1) n = n.slice(dn.length + 1);
    n = n.replace(/^((wasruimte|wasmachine|droger|plug)\s+)+(?=\S)/i, '');
    return n.charAt(0).toUpperCase() + n.slice(1);
}
function laundryStatus(dev, map, now = Date.now()) {
    const e = dev.entities || {};
    const val = (id) => { if (!id) return null; const st = haStateObj(map, id); return st && haIsUsable(st) ? st : null; };
    const sSt = val(e.state), jSt = val(e.job), cSt = val(e.completion), pSt = val(e.program), wSt = val(e.power);
    const state = sSt ? String(sSt.state).toLowerCase() : '';
    const jobRaw = jSt ? String(jSt.state) : '';
    const job = jobRaw.toLowerCase();
    // extra entiteiten (LocalThings e.d.): alles wat je erbij hangt als tegel tonen
    const extras = (Array.isArray(dev.extras) ? dev.extras : []).map(id => {
        const st = haStateObj(map, id);
        if (!st) return null;
        const attrs = st.attributes || {};
        const fv = haFriendlyValue(st, attrs.friendly_name || id);
        return { id, label: laundryExtraLabel(dev, st), text: id.startsWith('select.') && haIsUsable(st) ? laundryPretty(st.state) : fv.text, unit: attrs.unit_of_measurement || '', usable: haIsUsable(st), domain: id.split('.')[0], raw: st.state };
    }).filter(Boolean);
    let powerW = wSt ? haNumber(wSt) : null;
    if (powerW === null) {
        const px = extras.find(x => x.usable && /^(W|kW)$/.test(x.unit) && x.domain === 'sensor');
        if (px) { const n = parseFloat(String(px.raw).replace(',', '.')); if (!isNaN(n)) powerW = px.unit === 'kW' ? n * 1000 : n; }
    }
    const jobIdle = !job || ['none', 'finish', 'finished', 'unknown', 'off'].includes(job);

    let kind = 'unknown';
    if (sSt) {
        if (LAUNDRY_RUN.has(state)) kind = 'running';
        else if (LAUNDRY_PAUSE.has(state)) kind = 'paused';
        else if (['off', 'unavailable'].includes(state)) kind = 'off';
        else kind = 'idle';
    } else if (jSt) {
        kind = jobIdle ? 'idle' : 'running';
    } else if (powerW !== null) {
        kind = powerW > 5 ? 'running' : 'idle';
    }
    // sommige integraties blijven "run" tonen terwijl de fase al "finished" is
    if (kind === 'running' && jSt && ['finish', 'finished'].includes(job)) kind = 'idle';

    let finishAt = null, remaining = null;
    if (cSt) {
        const raw = String(cSt.state);
        const t = Date.parse(raw);
        if (!isNaN(t) && /\d{4}-\d{2}-\d{2}T/.test(raw)) finishAt = t;
        else { const n = haNumber(cSt); if (n !== null && n >= 0 && n < 1500) finishAt = now + n * 60000; }
    }
    if (finishAt !== null) remaining = Math.max(0, Math.round((finishAt - now) / 60000));

    let program = '';
    if (pSt) { const v = String(pSt.state); if (!['unknown', 'unavailable', 'none', ''].includes(v.toLowerCase())) program = laundryPretty(v); }

    const phase = jSt && !jobIdle ? (LAUNDRY_JOB_NL[job] !== undefined ? LAUNDRY_JOB_NL[job] : (LAUNDRY_JOB_NL[jobRaw] !== undefined ? LAUNDRY_JOB_NL[jobRaw] : laundryPretty(jobRaw))) : '';
    return { kind, phase, program, remaining, finishAt, powerW, hasAny: !!(sSt || jSt || cSt || pSt || wSt || extras.some(x => x.usable)), jobRaw, extras };
}

// Houdt per toestel bij sinds wanneer het draait en wat de langste resterende tijd was (voor de voortgangsbalk)
function laundryTrack(map, now = Date.now()) {
    ensureLaundry().devices.forEach(d => {
        const st = laundryStatus(d, map, now);
        const r = laundryRun.get(d.id);
        if (st.kind === 'running' || st.kind === 'paused') {
            if (!r) laundryRun.set(d.id, { since: now, max: st.remaining || 0 });
            else if (st.remaining !== null && st.remaining > r.max) r.max = st.remaining;
        } else if (r) laundryRun.delete(d.id);
    });
}

// Voor de meldingen: een toestel dat stopt na minstens 5 minuten draaien geeft "is klaar"
function laundryAsAppliances(map) {
    return ensureLaundry().devices.map(d => {
        const st = laundryStatus(d, map);
        return { id: 'ld_' + d.id, name: d.name || (d.kind === 'dryer' ? 'Droger' : 'Wasmachine'), icon: d.icon || (d.kind === 'dryer' ? '👕' : '🫧'),
            entityId: 'laundry', active: st.kind === 'running' || st.kind === 'paused', watts: 1, laundryDone: true };
    });
}

function laundryNotifItems(map) {
    const out = [];
    ensureLaundry().devices.forEach(d => {
        const st = laundryStatus(d, map);
        if (st.kind !== 'running' && st.kind !== 'paused') return;
        const name = d.name || (d.kind === 'dryer' ? 'Droger' : 'Wasmachine');
        const bits = [st.kind === 'paused' ? 'gepauzeerd' : (st.phase || 'bezig')];
        if (st.remaining !== null && st.kind === 'running') bits.push(`nog ${laundryDur(st.remaining)}`);
        out.push({ key: `laun_${d.id}`, icon: d.kind === 'dryer' ? '👕' : '🫧', anim: d.kind === 'dryer' ? 'ni-tumble' : 'ni-bubble', level: 'info', text: `${name}: ${bits.join(' · ')}` });
    });
    return out;
}

function laundryDur(min) {
    if (min < 1) return '<1 min';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} u ${m} min` : `${h} u`;
}
const laundryClock = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/* ---------- herkenning van entiteiten ---------- */
// Geeft per soort (wasmachine / droger) EEN gecentraliseerd voorstel: rollen + alle overige entiteiten als extra's.
function laundryRoleOf(id, name, st) {
    const dom = id.split('.')[0];
    const unit = (st && st.attributes && st.attributes.unit_of_measurement) || '';
    const t = `${id} ${name}`.toLowerCase();
    if (/(kinderslot|child_lock|socket|power_on_behavior|stopcontact)/.test(t)) return '';
    if (dom === 'binary_sensor') return /(vermogen|power|running|bezig|active)/.test(t) ? 'state_bin' : '';
    if (/(job_state|job state|cycle_phase|phase|fase)/.test(t)) return 'job';
    if (/(completion|finish|end_time|klaar om|remaining)/.test(t)) return 'completion';
    if (/(machine_state|machine state|washer_state|dryer_state|operating_state|status)/.test(t)) return 'state';
    if (dom === 'select' || /(program|programma|cycle|course)/.test(t)) {
        if (/(centrifuge|spin|temperature|temperatuur|water|soil|vuil|extra|rinse|spoel|option)/.test(t)) return '';
        return /(job|phase)/.test(t) ? 'job' : 'program';
    }
    if (dom === 'sensor' && /(power|vermogen)/.test(t) && !/(energy|energie|plug)/.test(t) && (!unit || /^k?W$/.test(unit))) return 'power';
    return '';
}
function laundryDetect() {
    const found = [];
    const list = (typeof discoveredHaEntities !== 'undefined' ? discoveredHaEntities : []) || [];
    const kinds = [['washer', /(washer|wasmachine|washing)/i, 'Wasmachine', '🫧'], ['dryer', /(dryer|droger|tumble)/i, 'Droger', '👕']];
    kinds.forEach(([kind, re, label, icon]) => {
        const ents = list.filter(s => s && /^(sensor|select|switch|binary_sensor|number|button)\./.test(s.entity_id) && re.test(`${s.entity_id} ${(s.attributes && s.attributes.friendly_name) || ''}`));
        if (!ents.length) return;
        const entities = {}, extras = [];
        let stateBin = '';
        ents.forEach(s => {
            const role = laundryRoleOf(s.entity_id, (s.attributes && s.attributes.friendly_name) || '', s);
            if (role === 'state_bin') { if (!stateBin) stateBin = s.entity_id; extras.push(s.entity_id); return; }
            if (role && !entities[role]) entities[role] = s.entity_id;
            else extras.push(s.entity_id);
        });
        if (!entities.state && stateBin) entities.state = stateBin;
        found.push({ kind, name: label, icon, entities, extras: extras.filter(id => !Object.values(entities).includes(id)), hint: kind });
    });
    return found;
}
// Alle entiteiten van een voorstel (rollen + extra's)
const laundryFoundIds = (f) => Object.values(f.entities).concat(f.extras || []);
// Wat ontbreekt er nog bij een bestaand toestel?
function laundryMissing(f, dev) {
    const have = new Set(Object.values(dev.entities || {}).concat(dev.extras || []));
    const entities = {};
    Object.keys(f.entities).forEach(r => { if (!(dev.entities || {})[r] && !have.has(f.entities[r])) entities[r] = f.entities[r]; });
    const taken = new Set(Object.values(entities));
    const extras = (f.extras || []).concat(Object.keys(f.entities).filter(r => (dev.entities || {})[r] && (dev.entities || {})[r] !== f.entities[r]).map(r => f.entities[r]))
        .filter(id => !have.has(id) && !taken.has(id));
    return { entities, extras: Array.from(new Set(extras)) };
}
// Voeg entiteiten toe aan een bestaand toestel (rollen invullen, rest als extra)
function laundryAttach(dev, entities, extras) {
    dev.entities = dev.entities || {};
    dev.extras = Array.isArray(dev.extras) ? dev.extras : [];
    let n = 0;
    Object.keys(entities || {}).forEach(r => {
        const id = entities[r];
        if (!dev.entities[r]) { dev.entities[r] = id; n++; }
        else if (!dev.extras.includes(id) && !Object.values(dev.entities).includes(id)) { dev.extras.push(id); n++; }
    });
    (extras || []).forEach(id => { if (!dev.extras.includes(id) && !Object.values(dev.entities).includes(id)) { dev.extras.push(id); n++; } });
    return n;
}

/* ---------- weergave ---------- */
function laundryCardHtml(d, map) {
    const st = laundryStatus(d, map);
    const run = laundryRun.get(d.id);
    const isDryer = d.kind === 'dryer';
    const chips = {
        running: ['Bezig', 'bg-[#dcece3] text-[#1c643f]'], paused: ['Gepauzeerd', 'bg-amber-100 text-amber-900'],
        idle: ['Klaar / uit', 'bg-stone-200 text-stone-600'], off: ['Uit', 'bg-stone-200 text-stone-600'], unknown: ['Onbekend', 'bg-stone-200 text-stone-600']
    }[st.kind];
    const running = st.kind === 'running';
    let pct = null;
    if (running && st.remaining !== null && run && run.max > 0) pct = Math.max(2, Math.min(100, (1 - st.remaining / run.max) * 100));
    const icon = d.icon || (isDryer ? '👕' : '🫧');

    let plan = '';
    if (st.kind === 'idle' && typeof plannerBest === 'function' && typeof plannerSlots === 'function') {
        try {
            const S = plannerSettings();
            const job = (S.jobs || []).find(j => new RegExp(isDryer ? 'droger|dryer' : 'was|wash', 'i').test(j.name) && !(isDryer === false && /droger|dryer/i.test(j.name)));
            const b = job && plannerBest(job, plannerSlots(), S.horizonHours);
            if (b) plan = `<div class="rounded-2xl bg-[#f1f7f3] border border-[#d7e9dd] px-3.5 py-2.5 text-xs text-[#1c2520]">🧠 ${b.isNow ? 'Nu is een goed moment om te starten.' : `Goedkoopste start: <b>${plannerWhen(b.start)}</b>${b.saving > 0.01 ? ` (bespaart ${plannerEuro(b.saving)})` : ''}`}</div>`;
        } catch (e) { /* planner niet beschikbaar */ }
    }
    const missing = !st.hasAny ? '<p class="text-xs text-[#9e4516] bg-[#fbf0e8] rounded-xl px-3 py-2">Nog geen entiteiten gekoppeld of ze zijn niet bereikbaar. Open ⚙️ Instellen.</p>' : '';

    return `
        <article class="bg-white rounded-[26px] p-5 shadow-sm border border-stone-200/80 space-y-4">
            <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                    <span class="ld-ico ${running ? (isDryer ? 'ld-dryer' : 'ld-washer') : ''} w-14 h-14 rounded-2xl bg-[#e8f2ec] flex items-center justify-center text-3xl shrink-0">${laEsc(icon)}</span>
                    <div class="min-w-0"><h3 class="text-lg font-extrabold text-[#1c2520] truncate">${laEsc(d.name || (isDryer ? 'Droger' : 'Wasmachine'))}</h3>
                    <p class="text-xs text-[#68736d]">${st.phase ? laEsc(st.phase) : (running ? 'Bezig' : '&nbsp;')}${st.program ? ` · ${laEsc(st.program)}` : ''}</p></div>
                </div>
                <span class="text-[11px] font-extrabold px-3 py-1.5 rounded-full whitespace-nowrap ${chips[1]}">${chips[0]}</span>
            </div>
            ${running || st.kind === 'paused' ? `
            <div class="space-y-2">
                ${st.remaining !== null ? `<div class="flex items-end justify-between"><p class="text-3xl font-extrabold text-[#1c2520] tabular-nums">${laundryDur(st.remaining)}</p><p class="text-xs font-bold text-[#68736d]">klaar rond ${laundryClock(st.finishAt)}</p></div>` : '<p class="text-sm text-[#68736d]">Resterende tijd is niet beschikbaar.</p>'}
                ${pct !== null ? `<div class="h-2 rounded-full bg-stone-200 overflow-hidden"><div class="h-full rounded-full bg-[#19975c] transition-all duration-700" style="width:${pct.toFixed(0)}%"></div></div>` : ''}
            </div>` : ''}
            <div class="grid grid-cols-3 gap-2 text-center">
                <div class="rounded-2xl bg-[#f6f8f5] px-2 py-2.5"><p class="text-[10px] font-bold uppercase text-[#68736d]">Fase</p><p class="text-xs font-extrabold text-[#1c2520] mt-0.5">${st.phase ? laEsc(st.phase) : '—'}</p></div>
                <div class="rounded-2xl bg-[#f6f8f5] px-2 py-2.5"><p class="text-[10px] font-bold uppercase text-[#68736d]">Programma</p><p class="text-xs font-extrabold text-[#1c2520] mt-0.5 truncate">${st.program ? laEsc(st.program) : (d.entities && d.entities.program ? '—' : 'niet gekoppeld')}</p></div>
                <div class="rounded-2xl bg-[#f6f8f5] px-2 py-2.5"><p class="text-[10px] font-bold uppercase text-[#68736d]">Vermogen</p><p class="text-xs font-extrabold text-[#1c2520] mt-0.5">${st.powerW !== null ? `${Math.round(st.powerW)} W` : '—'}</p></div>
            </div>
            ${st.extras && st.extras.length ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center">${st.extras.map(x => `<div class="rounded-2xl bg-[#f6f8f5] px-2 py-2"><p class="text-[10px] font-bold uppercase text-[#68736d] truncate">${laEsc(x.label)}</p><p class="text-xs font-extrabold text-[#1c2520] mt-0.5 truncate">${laEsc(x.text)}</p></div>`).join('')}</div>` : ''}
            ${plan}${missing}
        </article>`;
}

function laundryEditHtml() {
    const L = ensureLaundry();
    const L2 = L;
    // per soort een voorstel; alleen tonen wat er nog niet bij een toestel hoort
    const detected = laundryDetect().map(f => {
        const dev = L2.devices.find(d => d.kind === f.kind);
        const all = laundryFoundIds(f);
        const used = new Set(); L2.devices.forEach(d => Object.values(d.entities || {}).concat(d.extras || []).forEach(id => used.add(id)));
        const fresh = all.filter(id => !used.has(id));
        return Object.assign({}, f, { dev, fresh });
    }).filter(f => f.fresh.length);
    const list = (typeof discoveredHaEntities !== 'undefined' ? discoveredHaEntities : []) || [];
    const seen = list.filter(s => s && /(washer|wasmachine|dryer|droger|wasruimte|plug|power_meter)/i.test(`${s.entity_id} ${(s.attributes && s.attributes.friendly_name) || ''}`)).slice(0, 60);
    const devOptions = (sel) => L.devices.map((d, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${laEsc(d.name || (d.kind === 'dryer' ? 'Droger' : 'Wasmachine'))}</option>`).join('');
    const devRows = L.devices.map((d, i) => `
        <div class="rounded-2xl bg-[#f6f8f5] border border-stone-200/70 p-4 space-y-3">
            <div class="flex flex-wrap items-end gap-3">
                <div class="w-16"><label class="block text-[11px] font-bold text-[#38443d] mb-1">Icoon</label><input type="text" maxlength="4" value="${laEsc(d.icon || '')}" onchange="window.laundrySet(${i},'icon',this.value)" class="w-full px-2 py-2 rounded-xl border border-stone-200 text-center text-lg"></div>
                <div class="flex-1 min-w-[140px]"><label class="block text-[11px] font-bold text-[#38443d] mb-1">Naam</label><input type="text" value="${laEsc(d.name || '')}" onchange="window.laundrySet(${i},'name',this.value)" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm font-bold"></div>
                <div><label class="block text-[11px] font-bold text-[#38443d] mb-1">Soort</label><select onchange="window.laundrySet(${i},'kind',this.value)" class="px-3 py-2 rounded-xl border border-stone-200 text-sm font-bold bg-white"><option value="washer" ${d.kind !== 'dryer' ? 'selected' : ''}>Wasmachine</option><option value="dryer" ${d.kind === 'dryer' ? 'selected' : ''}>Droger</option></select></div>
                <button type="button" onclick="window.laundryRemove(${i})" class="px-3 h-10 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 cursor-pointer">🗑 Verwijder</button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${LAUNDRY_ROLES.map(([k, label, ph]) => `
                <div><label class="block text-[11px] font-bold text-[#38443d] mb-1">${label}</label>
                <input type="text" list="haEntitiesDatalist" value="${laEsc((d.entities || {})[k] || '')}" placeholder="${ph}" onchange="window.laundrySetEntity(${i},'${k}',this.value)" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-xs font-mono"></div>`).join('')}
            </div>
            <div class="space-y-2">
                <p class="text-[11px] font-bold text-[#38443d]">Extra entiteiten (stroom, spanning, kinderslot, centrifugesnelheid, watertemperatuur …) <span class="font-normal text-[#68736d]">· worden als tegels getoond</span></p>
                <div class="flex flex-wrap gap-2">${(d.extras || []).map((id, j) => `<span class="inline-flex items-center gap-1 rounded-full bg-white border border-stone-200 pl-3 pr-1 py-1 text-[11px] font-mono text-[#38443d]">${laEsc(id.split('.')[1])}<button type="button" onclick="window.laundryExtraRemove(${i},${j})" class="w-5 h-5 rounded-full hover:bg-red-50 text-red-600 font-bold cursor-pointer" aria-label="Verwijder">×</button></span>`).join('') || '<span class="text-[11px] text-[#68736d] italic">Nog geen extra\'s.</span>'}</div>
                <input type="text" list="haEntitiesDatalist" placeholder="Entiteit zoeken en toevoegen, bv. sensor.lsc_power_plug_stroom" onchange="window.laundryExtraAdd(${i},this.value);this.value=''" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-xs font-mono bg-white">
            </div>
        </div>`).join('');
    return `
        <div class="bg-white rounded-[26px] p-6 shadow-sm space-y-5 border-2 border-[#19975c]/40">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="max-w-2xl"><h3 class="text-lg font-bold text-[#1c2520]">Toestellen instellen</h3>
                <p class="text-xs text-[#68736d]">Koppel de entiteiten van je wasmachine en droger uit Home Assistant. Hoeft niet alles: status of fase is genoeg om "bezig" en "klaar" te herkennen. Het <b>programma</b> staat er alleen als jouw integratie dat doorgeeft.</p></div>
                <div class="flex gap-2"><button type="button" onclick="window.laundryAdd('washer')" class="px-4 py-2.5 rounded-xl bg-white border border-stone-200 text-sm font-bold cursor-pointer hover:bg-stone-50">+ Wasmachine</button>
                <button type="button" onclick="window.laundryAdd('dryer')" class="px-4 py-2.5 rounded-xl bg-white border border-stone-200 text-sm font-bold cursor-pointer hover:bg-stone-50">+ Droger</button>
                <button type="button" onclick="window.laundryToggleEdit()" class="px-5 py-2.5 rounded-xl bg-[#152920] text-white text-sm font-bold cursor-pointer">✓ Klaar</button></div>
            </div>
            ${detected.length ? `<div class="rounded-2xl bg-[#eef6f1] border border-[#cfe5d8] p-4 space-y-2"><p class="text-xs font-extrabold text-[#1c643f]">🔎 Automatisch herkend in Home Assistant</p>
                ${detected.map((f, i) => `<div class="flex flex-wrap items-center justify-between gap-2"><span class="text-xs text-[#1c2520]"><b>${laEsc(f.name)}</b>: ${f.fresh.length} ${f.fresh.length === 1 ? 'entiteit' : 'entiteiten'} <span class="text-[#68736d] font-mono">${laEsc(f.fresh.slice(0, 3).map(id => id.split('.')[1]).join(', '))}${f.fresh.length > 3 ? ' …' : ''}</span></span>
                    <button type="button" onclick="window.laundryAddDetected(${i})" class="px-3 py-1.5 rounded-lg bg-[#19975c] text-white text-xs font-bold cursor-pointer">${f.dev ? `+ Toevoegen aan ${laEsc(f.dev.name || f.name)}` : '+ Toevoegen als nieuw toestel'}</button></div>`).join('')}</div>` : ''}
            ${devRows || '<p class="text-xs text-[#68736d] italic">Nog geen toestellen.</p>'}
            <details class="rounded-2xl border border-stone-200/80 bg-[#f6f8f5]">
                <summary class="cursor-pointer select-none px-4 py-2.5 text-xs font-extrabold text-[#1c2520]">🧪 Wat ziet Home Assistant? (${seen.length} entiteiten met wasmachine, droger of plug in de naam: kies "+ aan toestel…" om er een bij te zetten)</summary>
                <div class="px-4 pb-4 pt-1 overflow-x-auto">${seen.length ? `<table class="w-full text-[11px]"><tbody>${seen.map(s => `<tr class="border-t border-stone-200/70"><td class="py-1.5 pr-3 font-mono text-[#38443d]">${laEsc(s.entity_id)}</td><td class="py-1.5 pr-3 font-bold text-[#1c2520]">${laEsc(s.state)}</td><td class="py-1.5">${L.devices.length ? `<select onchange="if(this.value!==''){window.laundryExtraAdd(Number(this.value),'${escJsAttr(s.entity_id)}');}this.value=''" class="px-2 py-1 rounded-lg border border-stone-200 text-[11px] bg-white cursor-pointer"><option value="">+ aan toestel…</option>${devOptions(-1)}</select>` : ''}</td></tr>`).join('')}</tbody></table>`
                    : '<p class="text-xs text-[#68736d]">Er zijn geen passende entiteiten gevonden. Haal eerst de entiteiten op bij Beheer → Home Assistant, of controleer of de SmartThings-integratie je toestellen toont.</p>'}
                <p class="text-[10.5px] text-[#68736d] mt-2">Zie je hier een entiteit met het gekozen programma (vaak een <code>select.</code> of <code>sensor.</code> met "cycle" of "course"), koppel die dan bij "Programma".</p></div>
            </details>
        </div>`;
}

function renderLaundryView() {
    const L = ensureLaundry();
    const map = haStatesMap();
    laundryTrack(map);
    const running = L.devices.filter(d => laundryStatus(d, map).kind === 'running').length;
    const badge = document.getElementById('menuLaundryBadge');
    if (badge) badge.textContent = running ? `▶ ${running}` : '';
    const eb = document.getElementById('laundryEditBtn');
    if (eb) eb.classList.toggle('hidden', !permAllowed('edit_laundry'));

    const container = document.getElementById('laundryContainer');
    const view = document.getElementById('viewLaundry');
    if (!container || (view && view.classList.contains('hidden'))) return;
    const ae = document.activeElement;
    if (laundryEdit && ae && container.contains && container.contains(ae) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(ae.tagName)) return;

    let html = '';
    if (laundryEdit && permAllowed('edit_laundry')) html += laundryEditHtml();
    if (!L.devices.length) {
        html += `<div class="bg-white rounded-[26px] p-8 text-center shadow-sm"><p class="text-5xl mb-3">🧺</p><h3 class="text-lg font-extrabold text-[#1c2520]">Nog geen toestellen</h3>
            <p class="text-sm text-[#68736d] mt-1 max-w-md mx-auto">Koppel je wasmachine en droger uit Home Assistant (bv. SmartThings). ${permAllowed('edit_laundry') ? 'Klik op ⚙️ Instellen.' : 'Vraag het aan de beheerder.'}</p></div>`;
    } else {
        html += `<div class="grid grid-cols-1 lg:grid-cols-2 gap-5">${L.devices.map(d => laundryCardHtml(d, map)).join('')}</div>`;
    }
    if (html === laundryHtmlCache) return;
    laundryHtmlCache = html;
    container.innerHTML = html;
}
function laundryViewActive(on) { if (on) laundryHtmlCache = ''; }

/* ---------- bewerken ---------- */
const laRerender = () => { laundryHtmlCache = ''; renderLaundryView(); laundrySave(false); };
window.laundryToggleEdit = function() {
    if (!permGuard('edit_laundry')) return;
    laundryEdit = !laundryEdit; laundryHtmlCache = ''; renderLaundryView();
    if (!laundryEdit) laundrySave(true);
};
window.laundryAdd = function(kind) {
    if (!permGuard('edit_laundry')) return;
    ensureLaundry().devices.push({ id: 'ld' + Date.now().toString(36), name: kind === 'dryer' ? 'Droger' : 'Wasmachine', icon: kind === 'dryer' ? '👕' : '🫧', kind: kind === 'dryer' ? 'dryer' : 'washer', entities: {} });
    laRerender();
};
window.laundryAddDetected = function(i) {
    if (!permGuard('edit_laundry')) return;
    const L = ensureLaundry();
    const used = new Set(); L.devices.forEach(d => Object.values(d.entities || {}).concat(d.extras || []).forEach(id => used.add(id)));
    const f = laundryDetect().map(x => Object.assign({}, x, { fresh: laundryFoundIds(x).filter(id => !used.has(id)) })).filter(x => x.fresh.length)[i];
    if (!f) return;
    const dev = L.devices.find(d => d.kind === f.kind);
    if (dev) {
        // gecentraliseerd: bij het bestaande toestel van dezelfde soort voegen, geen nieuwe machine maken
        const m = laundryMissing(f, dev);
        const n = laundryAttach(dev, m.entities, m.extras);
        showToast(n ? `${n} toegevoegd aan ${dev.name || f.name}.` : 'Alles stond er al bij.');
    } else {
        L.devices.push({ id: 'ld' + Date.now().toString(36), name: f.name, icon: f.icon, kind: f.kind, entities: Object.assign({}, f.entities), extras: f.extras.slice() });
    }
    laRerender();
};
window.laundryExtraAdd = function(i, value) {
    if (!permGuard('edit_laundry')) return;
    const d = ensureLaundry().devices[i];
    const v = String(value || '').trim();
    if (!d || !v) return;
    if (!/^[a-z_]+\.[a-z0-9_]+$/.test(v)) { showToast('Dat is geen geldige entiteit (bv. sensor.wasmachine_stroom).'); return; }
    if (laundryAttach(d, {}, [v]) === 0) { showToast('Die entiteit hoort al bij dit toestel.'); return; }
    laRerender();
};
window.laundryExtraRemove = function(i, j) {
    if (!permGuard('edit_laundry')) return;
    const d = ensureLaundry().devices[i];
    if (!d || !Array.isArray(d.extras)) return;
    d.extras.splice(j, 1);
    laRerender();
};
window.laundrySet = function(i, field, value) {
    if (!permGuard('edit_laundry')) return;
    const d = ensureLaundry().devices[i];
    if (!d || !['name', 'icon', 'kind'].includes(field)) return;
    d[field] = field === 'kind' ? (value === 'dryer' ? 'dryer' : 'washer') : String(value).trim().slice(0, 40);
    laRerender();
};
window.laundrySetEntity = function(i, role, value) {
    if (!permGuard('edit_laundry')) return;
    const d = ensureLaundry().devices[i];
    if (!d || !LAUNDRY_ROLES.some(r => r[0] === role)) return;
    const v = String(value).trim();
    if (v && !/^[a-z_]+\.[a-z0-9_]+$/.test(v)) { showToast('Dat is geen geldige entiteit (bv. sensor.wasmachine_state).'); return; }
    d.entities = d.entities || {};
    if (v) d.entities[role] = v; else delete d.entities[role];
    laRerender();
};
window.laundryRemove = function(i) {
    if (!permGuard('edit_laundry')) return;
    ensureLaundry().devices.splice(i, 1);
    laRerender();
};
