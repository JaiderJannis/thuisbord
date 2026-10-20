'use strict';
/* Levendig bord: schermwissel-animatie, cijfers die doorrollen, zon die draait zolang er opbrengst is */
(function () {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    // 1. Schermwissel: nieuw scherm schuift zacht in, de kaarten verschijnen na elkaar
    const CARD_SEL = '.rounded-\\[24px\\],.rounded-\\[26px\\],.rounded-\\[28px\\],.rounded-3xl';
    function animateView() {
        const views = Array.from(document.querySelectorAll('div[id^="view"]')).filter(v => v.className.indexOf('flex-1') > -1 && !v.classList.contains('hidden'));
        const v = views[0];
        if (!v) return;
        v.classList.remove('view-enter');
        void v.offsetWidth;
        v.classList.add('view-enter');
        Array.from(v.querySelectorAll(CARD_SEL)).slice(0, 14).forEach((c, i) => {
            c.style.setProperty('--d', (60 + i * 45) + 'ms');
            c.classList.add('pop-in');
        });
        setTimeout(() => {
            v.classList.remove('view-enter');
            v.querySelectorAll('.pop-in').forEach(c => c.classList.remove('pop-in'));
        }, 1400);
    }
    if (typeof window.switchView === 'function') {
        const orig = window.switchView;
        window.switchView = function () {
            const before = window.currentViewName;
            const r = orig.apply(this, arguments);
            if (window.currentViewName !== before) { try { (window.requestAnimationFrame || setTimeout)(animateView); } catch (e) {} }
            return r;
        };
    }

    // 2. Cijfers rollen zacht naar de nieuwe waarde (alleen hele getallen)
    const TWEEN_IDS = ['valSolar', 'valHouse', 'valGrid', 'valGridImportSub', 'valGridExportSub', 'valBatteryW', 'valBatteryPct'];
    const ease = t => 1 - Math.pow(1 - t, 3);
    function watch(el) {
        el.setAttribute('data-tween', '1');
        el._last = el.textContent.trim();
        let raf = 0, timer = 0;
        const mo = new MutationObserver(() => {
            const nv = el.textContent.trim(), ov = el._last;
            if (nv === ov) return;
            el._last = nv;
            if (!(/^\d+$/.test(nv) && /^\d+$/.test(ov)) || Math.abs(nv - ov) < 2) return;
            cancelAnimationFrame(raf); clearTimeout(timer);
            const from = Number(ov), to = Number(nv), t0 = performance.now(), dur = 700;
            const step = (now) => {
                const k = Math.min(1, (now - t0) / dur);
                el.textContent = String(Math.round(from + (to - from) * ease(k)));
                mo.takeRecords();
                if (k < 1) raf = requestAnimationFrame(step);
            };
            raf = requestAnimationFrame(step);
            timer = setTimeout(() => { cancelAnimationFrame(raf); el.textContent = String(to); mo.takeRecords(); }, dur + 150);
        });
        mo.observe(el, { childList: true, characterData: true, subtree: true });
    }
    TWEEN_IDS.forEach(id => { const el = document.getElementById(id); if (el) watch(el); });

    // 3. Zon draait en gloeit alleen als er opbrengst is
    function syncSun() {
        let w = 0;
        try { w = Number(appState.solarW) || 0; } catch (e) {}
        ['solarNode', 'solarIcon'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('is-idle', w < 15);
        });
    }
    syncSun();
    setInterval(syncSun, 2000);

    // 4. Bolletjes die een lijn volgen (extra stroomdeeltjes) verdwijnen samen met hun hoofdbolletje
    function syncFollowDots() {
        document.querySelectorAll('.follow-dot').forEach(d => {
            const main = document.getElementById(d.getAttribute('data-follow'));
            const off = !main || main.classList.contains('hidden') || main.style.display === 'none';
            d.setAttribute('display', off ? 'none' : 'inline');
        });
    }
    syncFollowDots();
    setInterval(syncFollowDots, 1000);
})();
