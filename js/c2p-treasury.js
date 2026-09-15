// ColombiaP2P — Módulo Tesorería (FASE 11)
// Maneja el tab XP en Transparencia y helpers de tesorería.

const C2P_Treasury = (function () {

    const SOURCE_LABEL = {
        evento:  { icon: '📅', label: 'Evento' },
        mision:  { icon: '🎯', label: 'Misión' },
        racha:   { icon: '🔥', label: 'Racha' },
        referido:{ icon: '👥', label: 'Referido' },
        manual:  { icon: '⚙️', label: 'Manual' },
    };

    function _getPB() {
        return (typeof C2P_PB !== 'undefined') ? C2P_PB.getClient() : null;
    }

    function _myPubkey() {
        return (typeof LBW_Nostr !== 'undefined' && LBW_Nostr.isLoggedIn())
            ? LBW_Nostr.getPubkey()
            : (typeof currentUser !== 'undefined' && currentUser?.pubkey) ? currentUser.pubkey : '';
    }

    function _formatDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    // ── Tab XP — historial de transacciones ──────────────────
    async function showXP() {
        // Manejar tabs activos
        document.querySelectorAll('[data-tx-tab]').forEach(btn => {
            const isXP = btn.dataset.txTab === 'xp';
            btn.style.background    = isXP ? 'rgba(247,147,26,0.15)' : 'transparent';
            btn.style.color         = isXP ? 'var(--color-bitcoin)' : 'var(--color-text-secondary)';
            btn.style.borderColor   = isXP ? 'var(--color-bitcoin)' : 'var(--color-border)';
            btn.style.fontWeight    = isXP ? '700' : '400';
        });
        document.getElementById('transparencyMeritsPanel').style.display = 'none';
        document.getElementById('transparencyWalletPanel').style.display = 'none';
        document.getElementById('transparencyXpPanel').style.display    = 'block';

        const container = document.getElementById('c2pXpTransactions');
        const pb = _getPB();
        const pubkey = _myPubkey();

        if (!pb) {
            container.innerHTML = `<div class="c2p-empty-state" style="padding:2rem;">PocketBase no disponible</div>`;
            return;
        }
        if (!pubkey) {
            container.innerHTML = `<div class="c2p-empty-state" style="padding:2rem;">Inicia sesión para ver tu historial XP</div>`;
            return;
        }

        container.innerHTML = `<p class="c2p-empty-state" style="padding:2rem;">Cargando...</p>`;

        try {
            const records = await pb.collection('xp_transactions').getFullList({
                filter: `user_pubkey = "${pubkey}"`,
                sort: '-created',
            });

            if (records.length === 0) {
                container.innerHTML = `<div class="c2p-empty-state" style="padding:2rem;">Aún no tienes transacciones XP · Participa en eventos y misiones para ganar XP</div>`;
                return;
            }

            const total = records.reduce((s, r) => s + (r.amount || 0), 0);

            container.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
                    <div style="font-size:0.85rem;color:var(--color-text-secondary);">${records.length} transacciones</div>
                    <div style="font-size:1rem;font-weight:700;color:var(--color-bitcoin);">Total: ${total.toLocaleString('es-CO')} XP</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:0.5rem;">
                    ${records.map(r => _renderXpRow(r)).join('')}
                </div>
            `;
        } catch (e) {
            container.innerHTML = `<div class="c2p-empty-state" style="padding:2rem;">No se pudo cargar el historial: ${LBW.escapeHtml(e.message)}</div>`;
        }
    }

    function _renderXpRow(r) {
        const meta = SOURCE_LABEL[r.source] || { icon: '⚡', label: r.source };
        return `
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.7rem 0.9rem;background:var(--color-bg-card);border-radius:10px;border:1px solid var(--color-border);">
            <div style="font-size:1.4rem;width:2rem;text-align:center;flex-shrink:0;">${meta.icon}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:0.85rem;font-weight:600;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${LBW.escapeHtml(r.reason || meta.label)}</div>
                <div style="font-size:0.72rem;color:var(--color-text-secondary);">${meta.label} · ${_formatDate(r.created)}</div>
            </div>
            <div style="font-size:1rem;font-weight:700;color:var(--color-bitcoin);white-space:nowrap;">+${(r.amount||0).toLocaleString('es-CO')} XP</div>
        </div>`;
    }

    // ── Wallet panel — helpers públicos ───────────────────────
    // Llamado desde el tab "Tesorería" para activar el panel existente de LBW_Transparency
    function showWallet() {
        if (typeof LBW_Transparency !== 'undefined') {
            LBW_Transparency.switchTab('wallet');
        }
    }

    return { showXP, showWallet };

})();

window.C2P_Treasury = C2P_Treasury;
