// ColombiaP2P — Módulo Rachas + Referidos (FASE 7)

const C2P_Rachas = (function () {

    const STORAGE_KEY_LAST = 'c2p_last_activity_date';
    const STORAGE_KEY_STREAK = 'c2p_current_streak';
    const STORAGE_KEY_MAX = 'c2p_max_streak';
    const STORAGE_KEY_REF_BY = 'c2p_referred_by';

    const XP_PER_STREAK_DAY = 5;
    const XP_REFERRAL_REWARD = 50;

    function _getPB() {
        const pb = (typeof C2P_PB !== 'undefined') ? C2P_PB.getClient() : null;
        return pb;
    }

    function _myPubkey() {
        return (typeof LBW_Nostr !== 'undefined' && LBW_Nostr.isLoggedIn())
            ? LBW_Nostr.getPubkey()
            : (typeof currentUser !== 'undefined' && currentUser?.pubkey) ? currentUser.pubkey : '';
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
            return {
                last:    localStorage.getItem(STORAGE_KEY_LAST)   || '',
                current: parseInt(localStorage.getItem(STORAGE_KEY_STREAK) || '0', 10),
                max:     parseInt(localStorage.getItem(STORAGE_KEY_MAX)    || '0', 10),
            };
        } catch (_) { return { last: '', current: 0, max: 0 }; }
    }

    function _writeLocal(last, current, max) {
        try {
            localStorage.setItem(STORAGE_KEY_LAST,   last);
            localStorage.setItem(STORAGE_KEY_STREAK, String(current));
            localStorage.setItem(STORAGE_KEY_MAX,    String(max));
        } catch (_) {}
    }

    // ── Registrar actividad ───────────────────────────────────
    async function recordActivity() {
        const today = _today();
        const data  = _readLocal();

        let { last, current, max } = data;

        if (last === today) return { current, max, xpEarned: 0 }; // ya registrado hoy

        let xpEarned = 0;

        if (last && _dayDiff(last, today) === 1) {
            // Día consecutivo
            current += 1;
        } else if (!last || _dayDiff(last, today) > 1) {
            // Racha rota o primer día
            current = 1;
        }

        if (current > max) max = current;
        _writeLocal(today, current, max);

        // XP por racha (cada 7 días extra)
        if (current % 7 === 0) {
            xpEarned = XP_PER_STREAK_DAY * 7;
            await _grantStreakXP(current, xpEarned);
        } else {
            xpEarned = XP_PER_STREAK_DAY;
            await _grantStreakXP(current, XP_PER_STREAK_DAY);
        }

        // Sincronizar con PocketBase si disponible
        _syncStreakToPB(current, max).catch(() => {});

        return { current, max, xpEarned };
    }

    async function _grantStreakXP(streakDays, amount) {
        const pb = _getPB();
        const pubkey = _myPubkey();
        if (!pb || !pubkey) return;
        try {
            await pb.collection('xp_transactions').create({
                user_pubkey: pubkey,
                amount,
                reason:  `Racha día ${streakDays}`,
                source:  'racha',
                ref_id:  String(streakDays),
            });
        } catch (_) {}
    }

    async function _syncStreakToPB(current, max) {
        const pb = _getPB();
        const pubkey = _myPubkey();
        if (!pb || !pubkey) return;
        try {
            const existing = await pb.collection('user_streaks')
                .getFirstListItem(`user_pubkey = "${pubkey}"`).catch(() => null);
            const payload = {
                user_pubkey:        pubkey,
                current_streak:     current,
                max_streak:         max,
                last_activity_date: _today(),
            };
            if (existing) {
                await pb.collection('user_streaks').update(existing.id, payload);
            } else {
                await pb.collection('user_streaks').create(payload);
            }
        } catch (_) {}
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
            // PB tiene la verdad; sincronizar local
            _writeLocal(rec.last_activity_date?.slice(0, 10) || local.last,
                        rec.current_streak, rec.max_streak);
            return { last: rec.last_activity_date?.slice(0, 10), current: rec.current_streak, max: rec.max_streak };
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

    // Registrar la referencia en PocketBase cuando el usuario inicia sesión por primera vez
    async function registerReferral() {
        const pb = _getPB();
        const pubkey = _myPubkey();
        if (!pb || !pubkey) return;

        let refBy = '';
        try { refBy = localStorage.getItem(STORAGE_KEY_REF_BY) || ''; } catch (_) {}
        if (!refBy) return;

        try {
            // Evitar duplicados
            const exists = await pb.collection('referrals')
                .getFirstListItem(`referred_pubkey = "${pubkey}"`).catch(() => null);
            if (exists) { localStorage.removeItem(STORAGE_KEY_REF_BY); return; }

            await pb.collection('referrals').create({
                referrer_pubkey_short: refBy,
                referred_pubkey:       pubkey,
                xp_granted:            false,
            });

            // XP al referidor (server hook lo hará en el futuro; por ahora nota en consola)
            console.info('[C2P Referidos] Referencia registrada, referidor:', refBy);
            localStorage.removeItem(STORAGE_KEY_REF_BY);
        } catch (e) {
            console.warn('[C2P Referidos]', e.message);
        }
    }

    // Contar cuántos usuarios has referido
    async function getReferralCount() {
        const pb = _getPB();
        const pubkey = _myPubkey();
        if (!pb || !pubkey) return 0;
        const shortPubkey = pubkey.slice(0, 16);
        try {
            const list = await pb.collection('referrals').getList(1, 1, {
                filter: `referrer_pubkey_short = "${shortPubkey}"`,
            });
            return list.totalItems;
        } catch (_) { return 0; }
    }

    // Generar enlace de referido para el usuario actual
    function getReferralLink() {
        const pubkey = _myPubkey();
        if (!pubkey) return '';
        const short = pubkey.slice(0, 16);
        return `https://colombiap2p.com/?ref=${short}`;
    }

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
        const refCount = await getReferralCount();

        // Racha
        const streakEl = document.getElementById('c2pStreakValue');
        const maxEl    = document.getElementById('c2pStreakMax');
        const flameEl  = document.getElementById('c2pStreakFlame');
        const refEl    = document.getElementById('c2pReferralCount');
        const refLinkEl= document.getElementById('c2pReferralLink');

        if (streakEl) streakEl.textContent = streak.current + ' día' + (streak.current !== 1 ? 's' : '');
        if (maxEl)    maxEl.textContent    = 'Máx: ' + streak.max;
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
