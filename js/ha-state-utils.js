'use strict';
/* Hulpfuncties om live Home Assistant-waarden leesbaar weer te geven (gedeeld door Robots en Auto's) */

const HA_STATE_LABELS = {
    on: 'Aan', off: 'Uit', full: 'Vol', empty: 'Leeg', ok: 'OK',
    locked: 'Vergrendeld', unlocked: 'Ontgrendeld', open: 'Open', closed: 'Dicht',
    home: 'Thuis', not_home: 'Weg', true: 'Ja', false: 'Nee'
};

function haEscape(text) {
    return String(text == null ? '' : text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function haStatesMap() {
    return new Map((discoveredHaEntities || []).map(s => [s.entity_id, s]));
}

function haStateObj(map, entityId) {
    if (!entityId) return null;
    return map.get(String(entityId).trim()) || null;
}

function haIsUsable(st) {
    return !!st && st.state !== 'unavailable' && st.state !== 'unknown' && st.state !== '' && st.state != null;
}

function haNumber(st) {
    if (!haIsUsable(st)) return null;
    const n = parseFloat(String(st.state).replace(',', '.'));
    return isNaN(n) ? null : n;
}

function haPrettify(raw) {
    const key = String(raw).toLowerCase();
    if (HA_STATE_LABELS[key]) return HA_STATE_LABELS[key];
    const spaced = String(raw).replace(/_/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Zet een HA-state om naar { text, kind, value, unit }; kind: none | good | warn | bad | number | text | neutral
function haFriendlyValue(st, labelHint = '') {
    if (!haIsUsable(st)) return { text: '—', kind: 'none' };
    const attrs = st.attributes || {};
    const unit = attrs.unit_of_measurement || '';
    const dc = attrs.device_class || '';
    const raw = String(st.state);
    const domain = String(st.entity_id || '').split('.')[0];
    const isBinLabel = /stofbak|\bbin\b|dust|vuil|container|afval/i.test(labelHint);

    if (domain === 'binary_sensor' || domain === 'switch' || domain === 'input_boolean') {
        const on = raw === 'on';
        if (dc === 'problem' || dc === 'safety') return { text: on ? 'Probleem' : 'OK', kind: on ? 'bad' : 'good' };
        if (dc === 'door' || dc === 'opening' || dc === 'window' || dc === 'garage_door') return { text: on ? 'Open' : 'Dicht', kind: on ? 'warn' : 'good' };
        if (dc === 'battery') return { text: on ? 'Laag' : 'OK', kind: on ? 'warn' : 'good' };
        if (dc === 'lock') return { text: on ? 'Ontgrendeld' : 'Vergrendeld', kind: on ? 'warn' : 'good' };
        if (isBinLabel && domain === 'binary_sensor') return { text: on ? 'Vol' : 'OK', kind: on ? 'warn' : 'good' };
        return { text: on ? 'Aan' : 'Uit', kind: 'neutral' };
    }
    if (dc === 'timestamp') {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
            return { text: d.toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), kind: 'neutral' };
        }
    }
    if (/^-?\d+([.,]\d+)?$/.test(raw.trim())) {
        const n = parseFloat(raw.replace(',', '.'));
        const decimals = Number.isInteger(n) ? 0 : (Math.abs(n) < 10 ? 2 : 1);
        const shown = n.toLocaleString('nl-BE', { maximumFractionDigits: decimals });
        return { text: unit ? `${shown} ${unit}` : shown, kind: 'number', value: n, unit };
    }
    return { text: haPrettify(raw), kind: 'text' };
}
