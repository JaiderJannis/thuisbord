'use strict';
/* Google Agenda, agenda-items, taken en afval */

function normalizeGoogleCalendarEmbedUrl(rawInput) {
    const val = (rawInput || "").trim();
    if (!val) return "";
    // Als de gebruiker een volledige <iframe src="..."></iframe> code heeft geplakt, haal de src-link eruit!
    const iframeSrcMatch = val.match(/src\s*=\s*["']([^"']+)["']/i);
    let extracted = (iframeSrcMatch && iframeSrcMatch[1]) ? iframeSrcMatch[1] : val;
    extracted = extracted.replace(/&amp;/gi, '&').trim();

    if (extracted.startsWith("http://") || extracted.startsWith("https://")) {
        return extracted;
    }
    // Als de gebruiker een Google Agenda ID of e-mailadres plakt, maak er automatisch een nette maand-embed van
    if (extracted.includes("@") || extracted.includes("group.calendar.google.com")) {
        return `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(extracted)}&ctz=Europe%2FBrussels&mode=MONTH&showTitle=0&showPrint=0&showCalendars=0`;
    }
    return extracted;
}

window.saveQuickGoogleCalendarUrl = function() {
    const raw = document.getElementById('quickGcalInput').value.trim();
    if (!raw) return;
    appState.googleCalendarUrl = normalizeGoogleCalendarEmbedUrl(raw);
    document.getElementById('gcalQuickSetupCollapse')?.classList.add('hidden');
    populateAdminInputs();
    renderGoogleCalendarTab();
    persistStateToFirestore(true);
};

function renderGoogleCalendarTab() {
    const iframe = document.getElementById('googleCalendarIframe');
    const iframeWrap = document.getElementById('googleCalendarIframeWrap');
    const extLink = document.getElementById('googleCalendarExternalLink');
    const unlinkedBox = document.getElementById('calendarUnlinkedBox');
    const embedUrl = normalizeGoogleCalendarEmbedUrl(appState.googleCalendarUrl);

    if (embedUrl && embedUrl.startsWith("http")) {
        unlinkedBox.classList.add('hidden');
        if (iframeWrap) iframeWrap.classList.remove('hidden');
        if (extLink) extLink.href = embedUrl;
        if (iframe && iframe.getAttribute('data-loaded-url') !== embedUrl) {
            iframe.src = embedUrl;
            iframe.setAttribute('data-loaded-url', embedUrl);
        }
    } else {
        unlinkedBox.classList.remove('hidden');
        if (iframeWrap) iframeWrap.classList.add('hidden');
    }
}

function renderDisplayAgenda() {
    const container = document.getElementById('agendaContainer');
    const combinedToday = [...(appState.haTodayEvents || []), ...(appState.agendaItems || [])];

    if (combinedToday.length === 0) {
        container.innerHTML = `
            <p class="text-[15px] font-bold text-[#1c2520] leading-snug">
                Geen afspraken vandaag
            </p>
            <p class="text-xs text-[#68736d] mt-1 leading-relaxed">
                Bekijk het volledige maandoverzicht via het tabblad <strong>🗓️ Maandkalender</strong>.
            </p>
        `;
        return;
    }

    container.innerHTML = `<div class="space-y-2 mt-1">` + combinedToday.map(item => `
        <div class="flex items-center gap-3 p-2.5 rounded-xl bg-[#f4f7f4]">
            <span class="w-1.5 h-7 rounded-full bg-[#19975c] shrink-0"></span>
            <div>
                <p class="text-sm font-bold text-[#1c2520]">${item.time} – ${item.title}</p>
            </div>
        </div>
    `).join('') + `</div>`;
}

function renderDisplayTasks() {
    const listEl = document.getElementById('taskList');
    const counterEl = document.getElementById('taskCounter');
    const tasks = appState.tasks || [];
    const doneCount = tasks.filter(t => t.done).length;
    counterEl.textContent = `${doneCount} van ${tasks.length} gedaan`;

    if (tasks.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-[#68736d]">Geen openstaande taken vandaag.</p>`;
        return;
    }

    listEl.innerHTML = tasks.map((task, idx) => `
        <label class="flex items-center gap-2.5 text-sm text-[#38443d] cursor-pointer hover:bg-stone-50 p-1.5 -mx-1.5 rounded-xl transition">
            <input type="checkbox" ${task.done ? 'checked' : ''} onchange="window.toggleTaskDone(${idx})" class="w-4 h-4 rounded accent-[#152920] cursor-pointer">
            <span class="${task.done ? 'line-through text-stone-400' : ''}">${task.text}</span>
        </label>
    `).join('');
}

function renderDisplayWaste() {
    const unlinked = document.getElementById('wasteUnlinked');
    const linked = document.getElementById('wasteLinked');
    const liveItems = appState.liveWasteItems || [];

    if (liveItems.length > 0) {
        unlinked.classList.add('hidden');
        linked.classList.remove('hidden');
        linked.innerHTML = `
            <div class="flex items-center justify-between mb-2.5">
                <span class="text-xs font-bold uppercase tracking-wider text-[#1c2520]">♻️ Afvalkalender</span>
                <span class="text-[10px] font-bold bg-[#e8f2ec] text-[#197447] px-2 py-0.5 rounded-full">Live RecycleApp</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${liveItems.map(item => `
                    <div class="flex items-center gap-2.5 p-2 rounded-xl border ${item.border} bg-stone-50/50">
                        <div class="w-9 h-9 rounded-xl ${item.bg} ${item.text} flex items-center justify-center font-extrabold text-[10px] shrink-0">
                            ${item.short}
                        </div>
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-[#1c2520] truncate">${item.stateValue}</p>
                            <p class="text-[10px] text-[#68736d] truncate">${item.label}</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } else if (appState.wasteEnabled) {
        unlinked.classList.add('hidden');
        linked.classList.remove('hidden');
        linked.innerHTML = `
            <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-semibold uppercase tracking-wider text-[#68736d]">AFVALKALENDER</span>
                <span class="text-xs text-[#197447] font-medium">${appState.wastePostal || 'Gekoppeld'}</span>
            </div>
            <div class="flex items-center gap-3 mt-1">
                <div class="w-11 h-11 rounded-xl bg-[#dcece3] text-[#1c643f] flex items-center justify-center font-bold text-xs shrink-0">
                    ${appState.wasteType || 'GFT'}
                </div>
                <div>
                    <p class="text-sm font-bold text-[#1c2520]">${appState.wasteDate || ''}</p>
                    <p class="text-xs text-[#68736d]">${appState.wasteDesc || ''}</p>
                </div>
            </div>
        `;
    } else {
        unlinked.classList.remove('hidden');
        linked.classList.add('hidden');
    }
}

window.userAddAgendaItem = function() {
    const time = document.getElementById('userNewAgendaTime').value.trim() || 'Vandaag';
    const title = document.getElementById('userNewAgendaTitle').value.trim();
    if (!title) return;
    appState.agendaItems.push({ time, title });
    document.getElementById('userNewAgendaTime').value = '';
    document.getElementById('userNewAgendaTitle').value = '';
    renderAdminLists();
    renderAll();
    persistStateToFirestore(true);
};

window.userAddTaskItem = function() {
    const text = document.getElementById('userNewTaskText').value.trim();
    if (!text) return;
    appState.tasks.push({ id: Date.now().toString(), text, done: false });
    document.getElementById('userNewTaskText').value = '';
    renderAdminLists();
    renderAll();
    persistStateToFirestore(true);
};

window.adminAddAgendaItem = function() {
    const time = document.getElementById('newAgendaTime').value.trim() || 'Vandaag';
    const title = document.getElementById('newAgendaTitle').value.trim();
    if (!title) return;
    appState.agendaItems.push({ time, title });
    document.getElementById('newAgendaTime').value = '';
    document.getElementById('newAgendaTitle').value = '';
    renderAdminLists();
    renderAll();
    persistStateToFirestore(true);
};

window.adminRemoveAgendaItem = function(idx) {
    appState.agendaItems.splice(idx, 1);
    renderAdminLists();
    renderAll();
    persistStateToFirestore(true);
};

window.adminAddTaskItem = function() {
    const text = document.getElementById('newTaskText').value.trim();
    if (!text) return;
    appState.tasks.push({ id: Date.now().toString(), text, done: false });
    document.getElementById('newTaskText').value = '';
    renderAdminLists();
    renderAll();
    persistStateToFirestore(true);
};

window.adminRemoveTaskItem = function(idx) {
    appState.tasks.splice(idx, 1);
    renderAdminLists();
    renderAll();
    persistStateToFirestore(true);
};

window.toggleTaskDone = function(idx) {
    if (!appState.tasks[idx]) return;
    appState.tasks[idx].done = !appState.tasks[idx].done;
    renderAll();
    persistStateToFirestore(true);
};
