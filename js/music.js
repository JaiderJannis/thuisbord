'use strict';
/* Muziek (Music Assistant): bedient de media_player-entiteiten die Music Assistant in Home Assistant aanmaakt.
   appState.music = { players: [ { id, name, icon, entityId } ] }. Zonder gekozen spelers worden alle media_player-entiteiten getoond.
   Alles loopt via standaard Home Assistant-services (media_player.*), dus het werkt ook met andere spelers. */

const MUSIC_MAX_AUTO_PLAYERS = 12;
const MUSIC_MEDIA_TYPES = [
    ['playlist', 'Afspeellijst'], ['radio', 'Radio'], ['artist', 'Artiest'], ['album', 'Album'], ['track', 'Nummer']
];

function ensureMusic() {
    if (!appState.music || typeof appState.music !== 'object') appState.music = { players: [] };
    if (!Array.isArray(appState.music.players)) appState.music.players = [];
    return appState.music;
}

/* ============================ HULPFUNCTIES ============================ */

function musicAllMediaPlayers() {
    return (discoveredHaEntities || []).filter(s => s && String(s.entity_id).startsWith('media_player.'));
}

// Spelers om te tonen: de gekozen spelers, of anders alle gevonden media_player-entiteiten
function musicPlayersToShow() {
    const cfg = ((appState.music && appState.music.players) || []).filter(p => p && p.entityId);
    if (cfg.length) return { configured: true, players: cfg };
    const auto = musicAllMediaPlayers().slice(0, MUSIC_MAX_AUTO_PLAYERS).map(s => ({
        id: s.entity_id, name: (s.attributes && s.attributes.friendly_name) || s.entity_id, icon: '🔊', entityId: s.entity_id
    }));
    return { configured: false, players: auto };
}

function musicStateKind(st) {
    if (!st || !haIsUsable(st)) return 'unavailable';
    const s = String(st.state).toLowerCase();
    if (s === 'playing') return 'playing';
    if (s === 'paused') return 'paused';
    if (s === 'buffering') return 'playing';
    if (s === 'idle' || s === 'on' || s === 'standby') return 'idle';
    if (s === 'off') return 'off';
    return 'idle';
}

function musicArtUrl(st) {
    const pic = st && st.attributes && st.attributes.entity_picture;
    if (!pic) return '';
    const p = String(pic);
    if (/^https?:\/\//i.test(p)) return p;
    const base = typeof getCleanHaUrl === 'function' ? getCleanHaUrl() : '';
    return base && p.startsWith('/') ? base + p : '';
}

function musicFormatTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Huidige positie in seconden (houdt rekening met de tijd sinds de laatste update)
function musicPosition(st) {
    const a = (st && st.attributes) || {};
    const pos = Number(a.media_position);
    if (isNaN(pos)) return null;
    let p = pos;
    if (String(st.state).toLowerCase() === 'playing' && a.media_position_updated_at) {
        const t = Date.parse(a.media_position_updated_at);
        if (!isNaN(t)) p = pos + Math.max(0, (Date.now() - t) / 1000);
    }
    const dur = Number(a.media_duration);
    return !isNaN(dur) && dur > 0 ? Math.min(p, dur) : p;
}

function musicAttr(st, name) { return (st && st.attributes && st.attributes[name]) || ''; }

/* ============================ WEERGAVE ============================ */

function musicPlayerCardHtml(pl, idx, map, allPlayers) {
    const st = haStateObj(map, pl.entityId);
    const kind = musicStateKind(st);
    const a = (st && st.attributes) || {};
    const canControl = permAllowed('control_music');
    const eid = haEscape(pl.entityId);
    const art = musicArtUrl(st);
    const title = musicAttr(st, 'media_title');
    const artist = musicAttr(st, 'media_artist');
    const album = musicAttr(st, 'media_album_name');
    const dur = Number(a.media_duration);
    const pos = musicPosition(st);
    const vol = typeof a.volume_level === 'number' ? Math.round(a.volume_level * 100) : null;
    const muted = a.is_volume_muted === true;
    const shuffle = a.shuffle === true;
    const repeat = String(a.repeat || 'off');
    const sources = Array.isArray(a.source_list) ? a.source_list : [];
    const members = Array.isArray(a.group_members) ? a.group_members : [];
    const others = allPlayers.filter(o => o.entityId !== pl.entityId);
    const dis = canControl ? '' : 'disabled';
    const cls = canControl ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed';

    const chip = {
        playing: { t: '<span class="eq"><i></i><i></i><i></i><i></i></span> Speelt', c: 'bg-[#dcece3] text-[#1c643f]' },
        paused: { t: '⏸ Gepauzeerd', c: 'bg-amber-100 text-amber-900' },
        idle: { t: 'Stil', c: 'bg-stone-200 text-stone-600' },
        off: { t: 'Uit', c: 'bg-stone-200 text-stone-600' },
        unavailable: { t: 'Niet beschikbaar', c: 'bg-red-50 text-red-700' }
    }[kind];

    const btn = (icon, label, onclick, extra = '') => `<button type="button" ${dis} title="${label}" aria-label="${label}" onclick="${onclick}" class="w-11 h-11 rounded-full flex items-center justify-center text-lg transition ${extra || 'bg-stone-100 hover:bg-stone-200 text-[#1c2520]'} ${cls}">${icon}</button>`;

    const progress = (pos !== null && dur > 0) ? `
        <div>
            <div class="h-1.5 rounded-full bg-stone-200 overflow-hidden"><div class="h-full rounded-full bg-[#19975c]" style="width:${Math.max(0, Math.min(100, (pos / dur) * 100)).toFixed(1)}%"></div></div>
            <div class="flex justify-between text-[10px] font-semibold text-[#68736d] mt-1"><span>${musicFormatTime(pos)}</span><span>${musicFormatTime(dur)}</span></div>
        </div>` : '';

    const groupHtml = others.length ? `
        <details class="rounded-2xl border border-stone-200/80 bg-[#f6f8f5]">
            <summary class="cursor-pointer select-none px-3.5 py-2 text-xs font-extrabold text-[#1c2520]">🔗 Groeperen ${members.length > 1 ? `(${members.length} spelers)` : ''}</summary>
            <div class="px-3.5 pb-3 pt-1 space-y-1.5">
                ${others.map(o => {
                    const inGroup = members.includes(o.entityId);
                    return `<label class="flex items-center gap-2 text-xs font-semibold text-[#1c2520] ${cls}">
                        <input type="checkbox" ${dis} ${inGroup ? 'checked' : ''} onchange="window.musicToggleGroup('${eid}', '${haEscape(o.entityId)}', this.checked)" class="w-4 h-4 accent-[#152920]">
                        <span>${haEscape(o.name || o.entityId)}</span></label>`;
                }).join('')}
            </div>
        </details>` : '';

    return `
        <article class="bg-white rounded-[26px] p-5 shadow-sm border border-stone-200/80 space-y-4">
            <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2.5 min-w-0">
                    <span class="w-10 h-10 rounded-2xl bg-[#e8f2ec] flex items-center justify-center text-lg shrink-0">${haEscape(pl.icon || '🔊')}</span>
                    <h3 class="text-base font-bold text-[#1c2520] truncate">${haEscape(pl.name || pl.entityId)}</h3>
                </div>
                <span class="text-[11px] font-extrabold px-3 py-1.5 rounded-full whitespace-nowrap ${chip.c}">${chip.t}</span>
            </div>

            <div class="flex items-center gap-4">
                <div class="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-[#e8f2ec] overflow-hidden shrink-0 flex items-center justify-center text-3xl">
                    ${art ? `<img src="${haEscape(art)}" alt="" class="w-full h-full object-cover" loading="lazy" onerror="this.remove()">` : '🎵'}
                </div>
                <div class="min-w-0 flex-1">
                    ${title ? `<p class="text-base font-extrabold text-[#1c2520] leading-snug line-clamp-2">${haEscape(title)}</p>
                    <p class="text-sm text-[#55605a] truncate">${haEscape(artist)}${artist && album ? ' · ' : ''}${haEscape(album)}</p>`
                    : `<p class="text-sm font-semibold text-[#68736d]">${kind === 'unavailable' ? 'Speler niet bereikbaar' : 'Er speelt niets'}</p>`}
                </div>
            </div>
            ${progress}

            <div class="flex items-center justify-center gap-2.5">
                ${btn('⏮', 'Vorige', `window.musicCommand('${eid}', 'media_previous_track')`)}
                ${btn(kind === 'playing' ? '⏸' : '▶', kind === 'playing' ? 'Pauzeer' : 'Speel', `window.musicCommand('${eid}', 'media_play_pause')`, 'bg-[#152920] hover:bg-[#233f31] text-white w-14 h-14 text-xl')}
                ${btn('⏭', 'Volgende', `window.musicCommand('${eid}', 'media_next_track')`)}
                ${btn('🔀', 'Willekeurig', `window.musicShuffle('${eid}', ${!shuffle})`, shuffle ? 'bg-[#dcece3] text-[#1c643f]' : 'bg-stone-100 hover:bg-stone-200 text-[#1c2520]')}
                ${btn(repeat === 'one' ? '🔂' : '🔁', 'Herhalen', `window.musicRepeat('${eid}', '${repeat}')`, repeat !== 'off' ? 'bg-[#dcece3] text-[#1c643f]' : 'bg-stone-100 hover:bg-stone-200 text-[#1c2520]')}
            </div>

            ${vol !== null ? `
            <div class="flex items-center gap-3">
                <button type="button" ${dis} onclick="window.musicMute('${eid}', ${!muted})" title="Dempen" aria-label="Dempen" class="text-lg ${cls}">${muted ? '🔇' : (vol < 35 ? '🔈' : '🔊')}</button>
                <input type="range" min="0" max="100" step="1" value="${vol}" ${dis} aria-label="Volume"
                    oninput="document.getElementById('musicVol_${idx}').textContent = this.value + '%'"
                    onchange="window.musicVolume('${eid}', this.value)" class="flex-1 accent-[#152920] ${cls}">
                <span id="musicVol_${idx}" class="w-10 text-right text-xs font-bold text-[#38443d]">${vol}%</span>
            </div>` : ''}

            ${sources.length ? `
            <div>
                <select ${dis} onchange="window.musicSource('${eid}', this.value)" class="w-full px-3 py-2 rounded-xl border border-stone-200 bg-white text-xs font-bold text-[#1c2520]">
                    ${sources.map(s => `<option value="${haEscape(s)}" ${String(a.source || '') === String(s) ? 'selected' : ''}>${haEscape(s)}</option>`).join('')}
                </select>
            </div>` : ''}

            <button type="button" onclick="window.musicLibOpen('${eid}')" class="w-full px-4 py-2.5 rounded-2xl bg-[#152920] hover:bg-[#233f31] text-white text-xs font-extrabold cursor-pointer">🎧 Spotify, afspeellijsten &amp; wachtrij</button>
            <details class="rounded-2xl border border-stone-200/80 bg-[#f6f8f5]">
                <summary class="cursor-pointer select-none px-3.5 py-2 text-xs font-extrabold text-[#1c2520]">🎶 Iets afspelen</summary>
                <div class="px-3.5 pb-3 pt-1 space-y-2">
                    <div class="flex gap-2">
                        <select id="musicType_${idx}" class="px-2.5 py-2 rounded-xl border border-stone-200 bg-white text-xs font-bold text-[#1c2520]">
                            ${MUSIC_MEDIA_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                        </select>
                        <input id="musicQuery_${idx}" type="text" placeholder="Naam, bv. Radio 1 of Daily Mix" class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-stone-200 bg-white text-xs"
                            onkeydown="if(event.key==='Enter'){window.musicPlay('${eid}', ${idx});}">
                        <button type="button" ${dis} onclick="window.musicPlay('${eid}', ${idx})" class="px-3.5 py-2 rounded-xl bg-[#152920] text-white text-xs font-bold ${cls}">Speel</button>
                    </div>
                    <p class="text-[10.5px] text-[#68736d]">Music Assistant zoekt de naam op in je bibliotheek en streamingdiensten.</p>
                </div>
            </details>
            ${groupHtml}
        </article>`;
}

function renderMusicView() {
    const map = haStatesMap();
    const { configured, players } = musicPlayersToShow();
    const playingNow = players.filter(p => musicStateKind(haStateObj(map, p.entityId)) === 'playing').length;
    const badge = document.getElementById('menuMusicBadge');
    if (badge) badge.textContent = playingNow ? `▶ ${playingNow}` : '';

    const container = document.getElementById('musicContainer');
    const view = document.getElementById('viewMusic');
    if (!container || (view && view.classList.contains('hidden'))) return;
    // Niet hertekenen terwijl iemand in een invoerveld typt of de volumeknop vasthoudt
    const ae = document.activeElement;
    if (ae && container.contains && container.contains(ae) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(ae.tagName)) return;

    if (!players.length) {
        container.innerHTML = `<p class="text-sm text-[#68736d] bg-white rounded-2xl p-6 col-span-full">${(discoveredHaEntities || []).length
            ? 'Er zijn geen media_player-entiteiten gevonden in Home Assistant. Installeer Music Assistant of voeg een speler toe.'
            : 'Nog geen verbinding met Home Assistant. Koppel Home Assistant en kies je spelers via Beheer → 🎵 Muziek.'}</p>`;
        return;
    }
    const pb = document.getElementById('musicPauseAllBtn');
    if (pb) {
        pb.classList.toggle('hidden', !playingNow);
        pb.textContent = `⏸ Pauzeer alles (${playingNow})`;
        pb.classList.toggle('opacity-60', !permAllowed('control_music'));
    }
    const pauseAll = '';
    const hint = configured ? '' : `<p class="col-span-full text-xs text-[#68736d]">Je ziet nu alle spelers uit Home Assistant. Kies er een paar bij Beheer → 🎵 Muziek om de lijst op te schonen.</p>`;
    container.innerHTML = hint + pauseAll + players.map((p, i) => musicPlayerCardHtml(p, i, map, players)).join('');
}

/* ============================ BEDIENING ============================ */

async function musicCall(service, data) {
    const ok = await window.callHomeAssistantService('media_player', service, data);
    if (ok === false) showToast("Opdracht niet verzonden (geen verbinding met Home Assistant).");
    return ok;
}

function musicValidEntity(entityId) {
    return typeof entityId === 'string' && /^media_player\.[a-z0-9_]+$/.test(entityId);
}

window.musicCommand = function(entityId, service) {
    if (!permGuard('control_music')) return;
    if (!musicValidEntity(entityId) || !['media_play_pause', 'media_next_track', 'media_previous_track'].includes(service)) return;
    return musicCall(service, { entity_id: entityId });
};

window.musicVolume = function(entityId, pct) {
    if (!permGuard('control_music')) return;
    const n = Math.max(0, Math.min(100, parseInt(pct, 10)));
    if (!musicValidEntity(entityId) || isNaN(n)) return;
    return musicCall('volume_set', { entity_id: entityId, volume_level: n / 100 });
};

window.musicMute = function(entityId, mute) {
    if (!permGuard('control_music')) return;
    if (!musicValidEntity(entityId)) return;
    return musicCall('volume_mute', { entity_id: entityId, is_volume_muted: !!mute });
};

window.musicShuffle = function(entityId, on) {
    if (!permGuard('control_music')) return;
    if (!musicValidEntity(entityId)) return;
    return musicCall('shuffle_set', { entity_id: entityId, shuffle: !!on });
};

window.musicRepeat = function(entityId, current) {
    if (!permGuard('control_music')) return;
    if (!musicValidEntity(entityId)) return;
    const next = { off: 'all', all: 'one', one: 'off' }[String(current)] || 'all';
    return musicCall('repeat_set', { entity_id: entityId, repeat: next });
};

window.musicSource = function(entityId, source) {
    if (!permGuard('control_music')) return;
    if (!musicValidEntity(entityId) || !source) return;
    return musicCall('select_source', { entity_id: entityId, source: String(source) });
};

window.musicPlay = function(entityId, idx) {
    if (!permGuard('control_music')) return;
    if (!musicValidEntity(entityId)) return;
    const q = document.getElementById('musicQuery_' + idx);
    const t = document.getElementById('musicType_' + idx);
    const text = String((q && q.value) || '').trim();
    const type = String((t && t.value) || 'playlist');
    if (!text) { showToast("Typ eerst wat je wil afspelen."); return; }
    if (!MUSIC_MEDIA_TYPES.some(m => m[0] === type)) return;
    if (q) q.value = '';
    showToast(`Afspelen: ${text}`);
    return musicCall('play_media', { entity_id: entityId, media_content_id: text, media_content_type: type, enqueue: 'replace' });
};

window.musicToggleGroup = function(entityId, otherId, join) {
    if (!permGuard('control_music')) return;
    if (!musicValidEntity(entityId) || !musicValidEntity(otherId)) return;
    return join
        ? musicCall('join', { entity_id: entityId, group_members: [otherId] })
        : musicCall('unjoin', { entity_id: otherId });
};

window.musicPauseAll = function() {
    if (!permGuard('control_music')) return;
    const map = haStatesMap();
    const playing = musicPlayersToShow().players.filter(p => musicValidEntity(p.entityId) && musicStateKind(haStateObj(map, p.entityId)) === 'playing');
    if (!playing.length) return;
    return musicCall('media_pause', { entity_id: playing.map(p => p.entityId) });
};

/* ============================ BEHEER ============================ */

function renderAdminMusicList() {
    const container = document.getElementById('adminMusicContainer');
    if (!container) return;
    const players = ensureMusic().players;
    const found = musicAllMediaPlayers();
    const chosen = new Set(players.map(p => p.entityId));

    const rows = players.map((p, i) => {
        const exists = typeof carEntityExists === 'function' ? carEntityExists(p.entityId) : null;
        const dot = !p.entityId ? '' : (exists === null ? '' : (exists ? '<span title="Gevonden in Home Assistant" class="text-[#19975c]">●</span>' : '<span title="Niet gevonden in Home Assistant" class="text-red-500">●</span>'));
        return `
            <div class="flex flex-wrap items-end gap-3 bg-[#f6f8f5] p-3.5 rounded-2xl border border-stone-200/70">
                <div class="w-16"><label class="block text-[11px] font-bold text-[#38443d] mb-1">Icoon</label>
                    <input type="text" value="${haEscape(p.icon || '🔊')}" maxlength="4" onchange="window.updateMusicPlayer(${i}, 'icon', this.value)" class="w-full px-2 py-2 rounded-xl border border-stone-200 text-center text-lg"></div>
                <div class="flex-1 min-w-[150px]"><label class="block text-[11px] font-bold text-[#38443d] mb-1">Naam</label>
                    <input type="text" value="${haEscape(p.name || '')}" onchange="window.updateMusicPlayer(${i}, 'name', this.value)" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm font-bold"></div>
                <div class="flex-1 min-w-[220px]"><label class="block text-[11px] font-bold text-[#38443d] mb-1">Entiteit ${dot}</label>
                    <input type="text" list="haEntitiesDatalist" value="${haEscape(p.entityId || '')}" placeholder="media_player.woonkamer" onchange="window.updateMusicPlayer(${i}, 'entityId', this.value)" class="w-full px-3 py-2 rounded-xl border border-stone-200 text-xs font-mono"></div>
                <div class="flex gap-1">
                    <button onclick="window.moveMusicPlayer(${i}, -1)" title="Omhoog" class="w-9 h-9 rounded-xl bg-white border border-stone-200 hover:bg-stone-100 cursor-pointer">↑</button>
                    <button onclick="window.moveMusicPlayer(${i}, 1)" title="Omlaag" class="w-9 h-9 rounded-xl bg-white border border-stone-200 hover:bg-stone-100 cursor-pointer">↓</button>
                    <button onclick="window.removeMusicPlayer(${i})" class="px-3 h-9 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 cursor-pointer">🗑</button>
                </div>
            </div>`;
    }).join('');

    const available = found.filter(s => !chosen.has(s.entity_id));
    container.innerHTML = `
        <div class="bg-white rounded-[26px] p-6 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="max-w-2xl">
                    <h3 class="text-lg font-bold text-[#1c2520]">Muziek met Music Assistant</h3>
                    <p class="text-xs text-[#68736d]">Kies welke spelers op het muziekscherm staan. Music Assistant maakt voor elke speler een <code>media_player</code>-entiteit aan in Home Assistant. Kies je niets, dan worden alle spelers getoond.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button onclick="window.addMusicPlayer('')" class="bg-white border border-stone-200 hover:bg-stone-100 text-[#38443d] font-bold px-4 py-2.5 rounded-xl text-sm cursor-pointer">+ Speler</button>
                    <button onclick="window.saveMusicAdmin()" class="bg-[#152920] hover:bg-[#233f31] text-white font-bold px-5 py-2.5 rounded-xl text-sm cursor-pointer">💾 Opslaan</button>
                </div>
            </div>
            ${rows ? `<div class="space-y-2.5">${rows}</div>` : '<p class="text-xs text-[#68736d] italic">Nog geen spelers gekozen: nu worden alle spelers getoond.</p>'}
            <div>
                <p class="text-[11px] font-extrabold uppercase tracking-wider text-[#68736d] mb-2">Gevonden in Home Assistant (${found.length})</p>
                ${available.length ? `<div class="flex flex-wrap gap-2">${available.map(s => `<button onclick="window.addMusicPlayer('${haEscape(s.entity_id)}')" class="px-3 py-1.5 rounded-xl bg-[#e8f2ec] hover:bg-[#dcece3] text-[#152920] text-xs font-bold cursor-pointer">+ ${haEscape((s.attributes && s.attributes.friendly_name) || s.entity_id)}</button>`).join('')}</div>`
                    : `<p class="text-xs text-[#68736d] italic">${found.length ? 'Alle gevonden spelers staan al in de lijst.' : ((discoveredHaEntities || []).length ? 'Geen media_player-entiteiten gevonden.' : 'Haal eerst de entiteiten op bij Home Assistant (tab Home Assistant).')}</p>`}
            </div>
        </div>`;
}

window.addMusicPlayer = function(entityId) {
    if (!permGuard('manage_music')) return;
    const players = ensureMusic().players;
    const st = entityId ? haStateObj(haStatesMap(), entityId) : null;
    if (entityId && !musicValidEntity(entityId)) return;
    if (entityId && players.some(p => p.entityId === entityId)) return;
    players.push({ id: 'mp_' + Date.now() + '_' + players.length, name: (st && st.attributes && st.attributes.friendly_name) || '', icon: '🔊', entityId: entityId || '' });
    renderAdminMusicList();
    renderMusicView();
};

window.updateMusicPlayer = function(i, field, value) {
    if (!permGuard('manage_music')) return;
    const p = ensureMusic().players[i];
    if (!p || !['name', 'icon', 'entityId'].includes(field)) return;
    p[field] = String(value).trim();
    renderAdminMusicList();
    renderMusicView();
};

window.moveMusicPlayer = function(i, dir) {
    if (!permGuard('manage_music')) return;
    const arr = ensureMusic().players;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    renderAdminMusicList();
    renderMusicView();
};

window.removeMusicPlayer = function(i) {
    if (!permGuard('manage_music')) return;
    ensureMusic().players.splice(i, 1);
    renderAdminMusicList();
    renderMusicView();
    persistStateToFirestore(true);
};

window.saveMusicAdmin = function() {
    if (!permGuard('manage_music')) return;
    ensureMusic().players = appState.music.players.filter(p => musicValidEntity(p.entityId));
    renderAdminMusicList();
    renderMusicView();
    persistStateToFirestore(true);
    showToast("Muziekspelers opgeslagen.");
};
