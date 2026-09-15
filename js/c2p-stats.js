// ColombiaP2P — Módulo Estadísticas Comunitarias (FASE 12)
// Panel público de métricas de la comunidad consultando PocketBase.

const C2P_Stats = (function () {

    const CACHE_MS = 5 * 60 * 1000; // 5 min
    let _cache = null;
    let _cacheAt = 0;

    function _getPB() {
        return (typeof C2P_PB !== 'undefined') ? C2P_PB.getClient() : null;
    }

    // ── Carga de datos ─────────────────────────────────────────
    async function _fetchStats(pb) {
        const [
            eventsRes,
            checkinsRes,
            xpRes,
            streaksRes,
            referralsRes,
            nip05Res,
        ] = await Promise.allSettled([
            pb.collection('events').getList(1, 1, {}),
            pb.collection('event_checkins').getList(1, 1, {}),
            pb.collection('xp_transactions').getList(1, 1, {}),
            pb.collection('user_streaks').getList(1, 200, { sort: '-max_streak' }),
            pb.collection('referrals').getList(1, 1, {}),
            pb.collection('nip05_identities').getList(1, 1, { filter: 'active = true' }),
        ]);

        const count = (res) => res.status === 'fulfilled' ? res.value.totalItems : 0;
        const items = (res) => res.status === 'fulfilled' ? res.value.items : [];

        const streakItems = items(streaksRes);
        const maxStreak   = streakItems.reduce((m, r) => Math.max(m, r.max_streak || 0), 0);
        const topStreaks  = streakItems.slice(0, 5);

        // XP total: suma amount de todas las transacciones (hasta 500)
        let xpTotal = 0;
        try {
            const allXp = await pb.collection('xp_transactions').getFullList({ fields: 'amount' });
            xpTotal = allXp.reduce((s, r) => s + (r.amount || 0), 0);
        } catch (_) { xpTotal = 0; }

        // Eventos próximos
        const now = new Date().toISOString();
        let upcomingCount = 0;
        try {
            const upcoming = await pb.collection('events').getList(1, 1, {
                filter: `date >= "${now}"`,
            });
            upcomingCount = upcoming.totalItems;
        } catch (_) { upcomingCount = 0; }

        return {
            totalEvents:     count(eventsRes),
            upcomingEvents:  upcomingCount,
            totalCheckins:   count(checkinsRes),
            totalXpTx:       count(xpRes),
            totalXp:         xpTotal,
            maxStreak:       maxStreak,
            topStreaks:       topStreaks,
            totalReferrals:  count(referralsRes),
            totalNip05:      count(nip05Res),
        };
    }

    // ── Renderizado ────────────────────────────────────────────
    function _card(icon, value, label, sub) {
        return `
        <div style="background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:14px;padding:1.1rem 1rem;display:flex;flex-direction:column;align-items:center;text-align:center;gap:0.3rem;">
            <div style="font-size:1.8rem;">${icon}</div>
            <div style="font-size:1.5rem;font-weight:800;color:var(--color-bitcoin);font-variant-numeric:tabular-nums;">${value}</div>
            <div style="font-size:0.75rem;font-weight:600;color:var(--color-text-primary);">${label}</div>
            ${sub ? `<div style="font-size:0.65rem;color:var(--color-text-secondary);">${sub}</div>` : ''}
        </div>`;
    }

    function _renderStreakRow(r, i) {
        const pubkeyShort = (r.user_pubkey || '').slice(0, 8) + '…';
        const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
        return `
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.9rem;background:var(--color-bg-card);border-radius:10px;border:1px solid var(--color-border);">
            <div style="font-size:1.2rem;width:1.8rem;text-align:center;flex-shrink:0;">${medals[i] || '·'}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:0.82rem;font-weight:600;color:var(--color-text-primary);font-family:var(--font-mono);">${pubkeyShort}</div>
                <div style="font-size:0.68rem;color:var(--color-text-secondary);">Racha actual: ${r.current_streak || 0} días</div>
            </div>
            <div style="font-size:0.95rem;font-weight:700;color:var(--color-bitcoin);white-space:nowrap;">🔥 ${r.max_streak || 0} máx</div>
        </div>`;
    }

    function _render(data) {
        const el = document.getElementById('c2pStatsContent');
        if (!el) return;

        const xpFmt   = data.totalXp > 0 ? data.totalXp.toLocaleString('es-CO') : '—';
        const updatedAt = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

        el.innerHTML = `
        <!-- KPI grid -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.75rem;margin-bottom:1.25rem;">
            ${_card('📅', data.totalEvents.toLocaleString('es-CO'), 'Eventos totales',
                data.upcomingEvents > 0 ? `${data.upcomingEvents} próximos` : 'sin próximos')}
            ${_card('✅', data.totalCheckins.toLocaleString('es-CO'), 'Check-ins', 'asistencias presenciales')}
            ${_card('🎮', xpFmt, 'XP entregado', `${data.totalXpTx.toLocaleString('es-CO')} transacciones`)}
            ${_card('🔥', data.maxStreak.toLocaleString('es-CO'), 'Racha récord', 'días consecutivos')}
            ${_card('👥', data.totalReferrals.toLocaleString('es-CO'), 'Referidos', 'nuevos miembros')}
            ${_card('🆔', data.totalNip05.toLocaleString('es-CO'), 'NIP-05 activos', 'user@colombiap2p.com')}
        </div>

        <!-- Top rachas -->
        <div style="margin-bottom:1.25rem;">
            <h3 style="font-size:0.85rem;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.65rem;">
                🔥 Top Rachas
            </h3>
            ${data.topStreaks.length === 0
                ? `<p style="font-size:0.82rem;color:var(--color-text-secondary);padding:0.75rem 0;">Sin datos de rachas aún</p>`
                : `<div style="display:flex;flex-direction:column;gap:0.4rem;">${data.topStreaks.map((r,i) => _renderStreakRow(r, i)).join('')}</div>`
            }
        </div>

        <!-- Footer actualización -->
        <div style="text-align:center;font-size:0.65rem;color:var(--color-text-secondary);margin-top:0.5rem;">
            Actualizado a las ${updatedAt} · Fuente: api.colombiap2p.com
        </div>
        `;
    }

    function _renderError(msg) {
        const el = document.getElementById('c2pStatsContent');
        if (el) el.innerHTML = `<div class="c2p-empty-state" style="padding:2rem;">${msg}</div>`;
    }

    function _renderSkeleton() {
        const el = document.getElementById('c2pStatsContent');
        if (!el) return;
        el.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.75rem;margin-bottom:1.25rem;">
            ${Array(6).fill(0).map(() => `
            <div style="background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:14px;padding:1.1rem;display:flex;flex-direction:column;align-items:center;gap:0.5rem;animation:pulse 1.4s infinite;">
                <div style="width:2rem;height:2rem;background:var(--color-border);border-radius:50%;"></div>
                <div style="width:60%;height:1.2rem;background:var(--color-border);border-radius:4px;"></div>
                <div style="width:80%;height:0.7rem;background:var(--color-border);border-radius:4px;"></div>
            </div>`).join('')}
        </div>
        <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>`;
    }

    // ── API pública ────────────────────────────────────────────
    async function load() {
        const pb = _getPB();
        if (!pb) { _renderError('PocketBase no disponible'); return; }

        // Cache válida
        if (_cache && Date.now() - _cacheAt < CACHE_MS) { _render(_cache); return; }

        _renderSkeleton();
        try {
            const data = await _fetchStats(pb);
            _cache   = data;
            _cacheAt = Date.now();
            _render(data);
        } catch (e) {
            if (_cache) { _render(_cache); return; }
            _renderError(`No se pudieron cargar las estadísticas: ${LBW.escapeHtml(e.message)}`);
        }
    }

    return { load };

})();

window.C2P_Stats = C2P_Stats;
