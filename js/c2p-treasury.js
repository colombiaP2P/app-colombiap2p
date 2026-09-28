// ColombiaP2P — Módulo Tesorería (FASE 11)
// El historial XP del usuario está disponible en la sección Perfil.

const C2P_Treasury = (function () {

    const SOURCE_LABEL = {
        evento:   { icon: '📅', label: 'Evento' },
        mision:   { icon: '🎯', label: 'Misión' },
        racha:    { icon: '🔥', label: 'Racha' },
        referido: { icon: '👥', label: 'Referido' },
        manual:   { icon: '⚙️', label: 'Manual' },
        economica:{ icon: '💰', label: 'Aportación económica' },
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
        return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
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
            <div style="font-size:1rem;font-weight:700;color:var(--color-bitcoin);white-space:nowrap;">+${(r.amount||0).toLocaleString('es-CO')} Méritos</div>
        </div>`;
    }

    const XP_PAGE_SIZE = 10;

    // Renderiza el historial XP del usuario en un contenedor dado, con paginación
    async function renderXpInto(containerId, page) {
        page = Math.max(1, parseInt(page) || 1);
        const container = document.getElementById(containerId);
        if (!container) return;

        const pb = _getPB();
        const pubkey = _myPubkey();

        if (!pb) {
            container.innerHTML = `<div class="c2p-empty-state" style="padding:2rem;">PocketBase no disponible</div>`;
            return;
        }
        if (!pubkey) {
            container.innerHTML = `<div class="c2p-empty-state" style="padding:2rem;">Inicia sesión para ver tu historial de méritos</div>`;
            return;
        }

        container.innerHTML = `<p class="c2p-empty-state" style="padding:1.5rem;text-align:center;">Cargando...</p>`;

        try {
            const result = await pb.collection('xp_transactions').getList(page, XP_PAGE_SIZE, {
                filter: `user_pubkey = "${pubkey}"`,
                sort: '-created',
                requestKey: null,
            });

            const { items, totalItems, totalPages } = result;
            const currentPage = result.page;

            if (totalItems === 0) {
                container.innerHTML = `<div class="c2p-empty-state" style="padding:2rem;">Aún no tienes méritos de participación · Asiste a eventos y mantén tu racha diaria</div>`;
                return;
            }

            const btnStyle = (enabled) => `
                display:inline-flex;align-items:center;gap:0.3rem;
                padding:0.45rem 0.9rem;border-radius:8px;font-size:0.82rem;font-weight:700;cursor:${enabled ? 'pointer' : 'default'};
                background:${enabled ? 'rgba(229,185,92,0.12)' : 'rgba(255,255,255,0.04)'};
                border:1px solid ${enabled ? 'rgba(229,185,92,0.4)' : 'rgba(255,255,255,0.08)'};
                color:${enabled ? 'var(--color-gold)' : 'var(--color-text-secondary)'};
                opacity:${enabled ? '1' : '0.4'};pointer-events:${enabled ? 'auto' : 'none'};
            `;

            const prevBtn = currentPage > 1
                ? `<button onclick="C2P_Treasury.renderXpInto('${containerId}',${currentPage - 1})" style="${btnStyle(true)}">← Anterior</button>`
                : `<button style="${btnStyle(false)}" disabled>← Anterior</button>`;

            const nextBtn = currentPage < totalPages
                ? `<button onclick="C2P_Treasury.renderXpInto('${containerId}',${currentPage + 1})" style="${btnStyle(true)}">Siguiente →</button>`
                : `<button style="${btnStyle(false)}" disabled>Siguiente →</button>`;

            container.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem;">
                    <div style="font-size:0.8rem;color:var(--color-text-secondary);">${totalItems.toLocaleString('es-CO')} transacciones</div>
                    <div style="font-size:0.8rem;color:var(--color-text-secondary);">Página ${currentPage} de ${totalPages}</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:0.45rem;margin-bottom:0.75rem;">
                    ${items.map(r => _renderXpRow(r)).join('')}
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding-top:0.5rem;border-top:1px solid var(--color-border);">
                    ${prevBtn}
                    <span style="font-size:0.78rem;color:var(--color-text-secondary);">${currentPage} / ${totalPages}</span>
                    ${nextBtn}
                </div>
            `;
        } catch (e) {
            container.innerHTML = `<div class="c2p-empty-state" style="padding:2rem;">No se pudo cargar el historial: ${LBW.escapeHtml(e.message)}</div>`;
        }
    }

    return { renderXpInto };

})();

window.C2P_Treasury = C2P_Treasury;
