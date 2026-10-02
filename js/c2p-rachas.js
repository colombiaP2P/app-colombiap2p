// ColombiaP2P — Módulo Rachas + Referidos (FASE 7)

const C2P_Rachas = (function () {

    const STORAGE_KEY_LAST   = 'c2p_last_activity_date';
    const STORAGE_KEY_STREAK = 'c2p_current_streak';
    const STORAGE_KEY_MAX    = 'c2p_max_streak';
    const STORAGE_KEY_FIRST  = 'c2p_first_activity_date'; // fecha primer uso (nunca se borra)
    const STORAGE_KEY_USER   = 'c2p_streak_user';         // pubkey dueño del caché local
    const STORAGE_KEY_REF_BY = 'c2p_referred_by';
    const STORAGE_KEY_REQ    = 'c2p_streak_req';           // último día registrado en el servidor

    // Recompensas de racha (1/día, 5 cada 7 días) y de referido (50): las emite
    // el servidor en api/merits/streak.js y api/merits/checkin.js

    function _getPB() {
        const pb = (typeof C2P_PB !== 'undefined') ? C2P_PB.getClient() : null;
        return pb;
    }

    function _myPubkey() {
        if (typeof LBW_Nostr !== 'undefined' && LBW_Nostr.isLoggedIn()) {
            return LBW_Nostr.getPubkey();
        }
        // Fallback: leer de la sesión en localStorage antes de que Nostr inicialice
        try {
            const s = JSON.parse(localStorage.getItem('lbw_nostr_session') || '{}');
            if (s.pubkey && /^[0-9a-f]{64}$/.test(s.pubkey)) return s.pubkey;
        } catch (_) {}
        return (typeof currentUser !== 'undefined' && currentUser?.pubkey) ? currentUser.pubkey : '';
    }

    function _today() {
        return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    }

    function _dayDiff(a, b) {
        // días entre dos fechas YYYY-MM-DD
        const msA = new Date(a).getTime();
        const msB = new Date(b).getTime();
        return Math.round(Math.abs(msA - msB) / 86400000);
    }

    // ── Streak local (fallback sin PocketBase) ────────────────
    function _readLocal() {
        try {
            const storedUser  = localStorage.getItem(STORAGE_KEY_USER) || '';
            const currentUser = _myPubkey();
            // Si hay un usuario activo y los datos no le pertenecen (incluye storedUser vacío),
            // descartar — pueden ser de una sesión anterior de otro usuario
            // Solo descartar si AMBOS usuarios son conocidos y son distintos (multi-user device)
            if (currentUser && storedUser && storedUser !== currentUser) {
                return { last: '', current: 0, max: 0, firstDate: '' };
            }
            return {
                last:      localStorage.getItem(STORAGE_KEY_LAST)   || '',
                current:   parseInt(localStorage.getItem(STORAGE_KEY_STREAK) || '0', 10),
                max:       parseInt(localStorage.getItem(STORAGE_KEY_MAX)    || '0', 10),
                firstDate: localStorage.getItem(STORAGE_KEY_FIRST)  || '',
            };
        } catch (_) { return { last: '', current: 0, max: 0, firstDate: '' }; }
    }

    function _writeLocal(last, current, max, firstDate) {
        try {
            const pubkey = _myPubkey();
            if (pubkey) localStorage.setItem(STORAGE_KEY_USER, pubkey);
            localStorage.setItem(STORAGE_KEY_LAST,   last);
            localStorage.setItem(STORAGE_KEY_STREAK, String(current));
            localStorage.setItem(STORAGE_KEY_MAX,    String(max));
            if (firstDate) {
                const stored = localStorage.getItem(STORAGE_KEY_FIRST);
                // Guardar si no existe o si la nueva fecha es anterior (PB puede corregir datos)
                if (!stored || firstDate < stored) {
                    localStorage.setItem(STORAGE_KEY_FIRST, firstDate);
                }
            }
        } catch (_) {}
    }

    // ── Días como miembro (antigüedad) ────────────────────────
    // Usa la fecha del primer uso registrada en localStorage o PocketBase.
    function getMemberDays() {
        try {
            const firstDate = localStorage.getItem(STORAGE_KEY_FIRST);
            if (!firstDate) return 1;
            const ms = Date.now() - new Date(firstDate).getTime();
            return Math.max(1, Math.floor(ms / 86400000) + 1);
        } catch (_) { return 1; }
    }

    // ── Registrar actividad ───────────────────────────────────
    // [C2P Fase 2] La racha la calcula el servidor (api/merits/streak) con la
    // fecha de Bogotá y el Emisor ColombiaP2P acredita los méritos (1/día, 5 cada
    // 7 días). La app solo guarda en caché lo que responde el servidor.
    async function recordActivity() {
        const local = _readLocal();
        const pubkey = _myPubkey();
        if (!pubkey || typeof LBW_Nostr === 'undefined' || !LBW_Nostr.nip98Auth) {
            return { current: local.current, max: local.max, xpEarned: 0 };
        }
        // Una petición por día y navegador (el servidor es idempotente igualmente)
        let lastReq = '';
        try { lastReq = localStorage.getItem(STORAGE_KEY_REQ) || ''; } catch (_) {}
        if (lastReq === `${pubkey}:${_today()}`) return { current: local.current, max: local.max, xpEarned: 0 };

        try {
            const path = '/api/merits/streak';
            const auth = await LBW_Nostr.nip98Auth(path, 'POST', { action: 'streak' });
            const res = await fetch(path, { method: 'POST', headers: { 'Authorization': auth } });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
            _writeLocal(data.last || data.today, data.current || 0, data.max || 0, data.firstDate || local.firstDate);
            try { localStorage.setItem(STORAGE_KEY_REQ, `${pubkey}:${_today()}`); } catch (_) {}
            return { current: data.current || 0, max: data.max || 0, xpEarned: data.earned || 0 };
        } catch (e) {
            console.warn('[C2P Rachas] No se pudo registrar la racha:', e.message);
            return { current: local.current, max: local.max, xpEarned: 0 };
        }
    }

    // ── Leer racha (local + PB si disponible) ─────────────────
    async function getStreak() {
        const local = _readLocal();
        const pb    = _getPB();
        const pubkey = _myPubkey();
        if (!pb || !pubkey) return local;
        try {
            const rec = await pb.collection('user_streaks')
                .getFirstListItem(`user_pubkey = "${pubkey}"`);
            // PocketBase es fuente autoritativa para first_activity_date.
            // Si PB tiene la fecha, siempre gana sobre localStorage
            // (permite que el admin corrija fechas erróneas).
            const pbFirstDate = rec.first_activity_date ? rec.first_activity_date.slice(0, 10) : '';
            const firstDate = pbFirstDate || local.firstDate;
            if (pbFirstDate && pbFirstDate !== local.firstDate) {
                try { localStorage.setItem(STORAGE_KEY_FIRST, pbFirstDate); } catch (_) {}
            }
            _writeLocal(rec.last_activity_date?.slice(0, 10) || local.last,
                        rec.current_streak, rec.max_streak, firstDate);
            return { last: rec.last_activity_date?.slice(0, 10), current: rec.current_streak, max: rec.max_streak, firstDate };
        } catch (_) {
            return local;
        }
    }

    // ── Referidos ─────────────────────────────────────────────

    // Guardar quién refirió al usuario actual (llamado al cargar la app si hay ?ref=)
    function captureReferrer(refPubkeyShort) {
        if (!refPubkeyShort) return;
        try {
            if (!localStorage.getItem(STORAGE_KEY_REF_BY)) {
                localStorage.setItem(STORAGE_KEY_REF_BY, refPubkeyShort);
            }
        } catch (_) {}
    }

    // Registrar la referencia cuando el usuario inicia sesión por primera vez.
    // [C2P] La escribe el servidor (api/merits/referral) con la firma NIP-98 del
    // propio referido; la colección referrals ya no acepta escrituras de la app.
    async function registerReferral() {
        const pubkey = _myPubkey();
        if (!pubkey || typeof LBW_Nostr === 'undefined' || !LBW_Nostr.nip98Auth) return;

        let refBy = '';
        try { refBy = (localStorage.getItem(STORAGE_KEY_REF_BY) || '').trim().toLowerCase(); } catch (_) {}
        if (!refBy) return;
        const forget = () => { try { localStorage.removeItem(STORAGE_KEY_REF_BY); } catch (_) {} };
        if (!/^[0-9a-f]{64}$/.test(refBy) || refBy === pubkey) { forget(); return; }

        try {
            const path = '/api/merits/referral';
            const auth = await LBW_Nostr.nip98Auth(path, 'POST', { action: 'referral', referrer: refBy });
            const res = await fetch(path, { method: 'POST', headers: { 'Authorization': auth } });
            const data = await res.json().catch(() => ({}));
            // Respuesta definitiva (registrado o rechazado): no reintentar.
            // Error de red / 5xx: se conserva para el próximo inicio.
            if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401)) forget();
            if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        } catch (e) {
            console.warn('[C2P Referidos]', e.message);
        }
    }

    // Contar cuántos usuarios has referido
    async function getReferralCount() {
        const pb = _getPB();
        const pubkey = _myPubkey();
        if (!pb || !pubkey) return 0;
        try {
            const list = await pb.collection('referrals').getList(1, 1, {
                filter: `referrer_pubkey_short = "${pubkey}"`,
            });
            return list.totalItems;
        } catch (_) { return 0; }
    }

    // Generar enlace de referido para el usuario actual
    function getReferralLink() {
        const pubkey = _myPubkey();
        if (!pubkey) return '';
        return `https://colombiap2p.com/?ref=${pubkey}`;
    }

    // [C2P Fase 2] El mérito al referidor lo emite el servidor en el primer
    // check-in del referido (api/merits/checkin).

    // ── URL handler ───────────────────────────────────────────
    function handleRefFromURL() {
        try {
            const params = new URLSearchParams(window.location.search);
            const ref = params.get('ref');
            if (!ref) return;
            captureReferrer(ref);
            // Limpiar URL
            const clean = window.location.pathname + window.location.hash;
            window.history.replaceState({}, '', clean);
        } catch (_) {}
    }

    // ── Display ───────────────────────────────────────────────
    async function updateStreakDisplay() {
        const streak = await getStreak();
        // Refrescar "Días activo" después de que PB respondió con first_activity_date real
        const memberEl = document.getElementById('statMemberSince');
        if (memberEl) memberEl.textContent = getMemberDays();
        const refCount = await getReferralCount();

        // Racha
        const streakEl = document.getElementById('c2pStreakValue');
        const maxEl    = document.getElementById('c2pStreakMax');
        const flameEl  = document.getElementById('c2pStreakFlame');
        const refEl    = document.getElementById('c2pReferralCount');
        const refLinkEl= document.getElementById('c2pReferralLink');

        if (streakEl) streakEl.textContent = streak.current + ' día' + (streak.current !== 1 ? 's' : '');
        if (maxEl) {
            // Méritos por racha (tope de por vida, incluidos los migrados)
            let streakInfo = '';
            try {
                const cap = (typeof LBW_Merits !== 'undefined' && LBW_Merits.ORIGIN_CAPS) ? LBW_Merits.ORIGIN_CAPS.racha : null;
                const data = (typeof LBW_Merits !== 'undefined' && LBW_Merits.getUserMerits) ? LBW_Merits.getUserMerits(_myPubkey()) : null;
                if (cap && data) {
                    const got = (data.records || []).filter(r => r.origin === 'racha').reduce((sum, r) => sum + (r.amount || 0), 0);
                    streakInfo = got >= cap
                        ? ` · Méritos por racha: ${cap}/${cap} ✔️ (sigue sumando con asistencia, misiones o aportes)`
                        : ` · Méritos por racha: ${got}/${cap}`;
                }
            } catch (_) {}
            maxEl.textContent = 'Máx: ' + streak.max + streakInfo;
        }
        if (flameEl) {
            if (streak.current >= 30)     flameEl.textContent = '🌋';
            else if (streak.current >= 14) flameEl.textContent = '🔥';
            else if (streak.current >= 7)  flameEl.textContent = '⚡';
            else if (streak.current >= 3)  flameEl.textContent = '✨';
            else                           flameEl.textContent = '💧';
        }

        if (refEl)    refEl.textContent    = refCount + ' persona' + (refCount !== 1 ? 's' : '');
        if (refLinkEl) refLinkEl.value     = getReferralLink();
    }

    // ── Init ──────────────────────────────────────────────────
    async function init() {
        handleRefFromURL();
        await recordActivity();
        await updateStreakDisplay();
        // Registrar referencia si hay pendiente
        registerReferral().catch(() => {});
    }

    function _copyReferralLink() {
        const link = getReferralLink();
        if (!link) { showNotification('Inicia sesión primero.', 'error'); return; }
        navigator.clipboard.writeText(link)
            .then(() => showNotification('¡Enlace copiado! Compártelo con tus amigos.', 'success'))
            .catch(() => {
                const el = document.getElementById('c2pReferralLink');
                if (el) { el.select(); document.execCommand('copy'); }
                showNotification('Enlace copiado.', 'success');
            });
    }

    return {
        init,
        recordActivity,
        getMemberDays,
        getStreak,
        getReferralLink,
        getReferralCount,
        registerReferral,
        handleRefFromURL,
        updateStreakDisplay,
        captureReferrer,
        _copyReferralLink,
    };

})();

window.C2P_Rachas = C2P_Rachas;

document.addEventListener('DOMContentLoaded', () => {
    // Capturar ?ref= inmediatamente, antes del login
    C2P_Rachas.handleRefFromURL();
});
