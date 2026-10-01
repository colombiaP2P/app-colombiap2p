// ColombiaP2P — Módulo Tesorería (FASE 11)
// El historial de méritos del usuario está disponible en la sección Perfil.
//
// Historial de méritos: los méritos Nostr válidos del usuario (kind:31002 del
// Emisor ColombiaP2P o de Génesis), fuente única desde la Fase 3 (el XP
// histórico de PocketBase se migró a méritos del Emisor con su fecha original).
// La suma de la lista es exactamente el total del Pasaporte.

const C2P_Treasury = (function () {

    // Méritos Nostr, por origen (prefijo del ref con el que los emite el servidor)
    const ORIGIN_LABEL = {
        'gov-vote':    { icon: '🗳️', label: 'Gobernanza · voto' },
        'gov-author':  { icon: '🏛️', label: 'Gobernanza · propuesta' },
        'gov-exec':    { icon: '🏆', label: 'Gobernanza · ejecución' },
        zap:           { icon: '⚡', label: 'Aportación económica' },
        evento:        { icon: '📅', label: 'Evento' },
        mision:        { icon: '🎯', label: 'Misión' },
        racha:         { icon: '🔥', label: 'Rachas diarias' },
        referido:      { icon: '👥', label: 'Referido' },
        fundacional:   { icon: '👑', label: 'Fundacional' },
        contrib:       { icon: '✅', label: 'Aportación verificada' },
    };
    const CATEGORY_LABEL = {
        productiva: 'Productiva', economica: 'Económica', responsabilidad: 'Responsabilidad',
        financiada: 'Financiada', fundacional: 'Fundacional'
    };

    function _myPubkey() {
        return (typeof LBW_Nostr !== 'undefined' && LBW_Nostr.isLoggedIn())
            ? LBW_Nostr.getPubkey()
            : (typeof currentUser !== 'undefined' && currentUser?.pubkey) ? currentUser.pubkey : '';
    }

    function _formatDate(ms) {
        if (!ms) return '';
        const d = new Date(ms);
        return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
    }

    // Origen de un mérito Nostr: tag origin, o el prefijo del d (merit:<origen>:…)
    function _originOf(rec) {
        if (rec.origin) return rec.origin;
        const m = /^merit:([a-z-]+):/.exec(rec.dTag || '');
        if (m) return m[1];
        return rec.category === 'fundacional' ? 'fundacional' : '';
    }

    // Normaliza un mérito a { icon, title, detail, amount, ts }
    function _fromNostr(rec) {
        const origin = _originOf(rec);
        const meta = ORIGIN_LABEL[origin] || { icon: '🏅', label: 'Mérito' };
        const cat = CATEGORY_LABEL[rec.category] || rec.category || '';
        return {
            icon: meta.icon,
            title: rec.reason || meta.label,
            detail: `${meta.label}${cat && cat !== meta.label ? ' · ' + cat : ''}`,
            amount: rec.amount || 0,
            ts: (rec.occurred_at || rec.created_at || 0) * 1000,
            kind: 'nostr'
        };
    }

    function _renderRow(it) {
        return `
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.7rem 0.9rem;background:var(--color-bg-card);border-radius:10px;border:1px solid var(--color-border);">
            <div style="font-size:1.4rem;width:2rem;text-align:center;flex-shrink:0;">${it.icon}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:0.85rem;font-weight:600;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${LBW.escapeHtml(it.title)}</div>
                <div style="font-size:0.72rem;color:var(--color-text-secondary);">${LBW.escapeHtml(it.detail)} · ${_formatDate(it.ts)}</div>
            </div>
            <div style="font-size:1rem;font-weight:700;color:var(--color-bitcoin);white-space:nowrap;">+${(it.amount || 0).toLocaleString('es-CO')}</div>
        </div>`;
    }

    const XP_PAGE_SIZE = 10;
    let _cache = null;          // { pubkey, items, at }
    let _lastContainer = null;
    let _lastPage = 1;
    let _meritHookInstalled = false;
    let _rerenderTimer = null;

    async function _loadItems(pubkey, force) {
        if (!force && _cache && _cache.pubkey === pubkey && Date.now() - _cache.at < 30000) return _cache.items;

        const items = [];
        // Méritos Nostr válidos (ya validados y deduplicados por LBW_Merits)
        if (typeof LBW_Merits !== 'undefined' && LBW_Merits.getUserMerits) {
            const data = LBW_Merits.getUserMerits(pubkey);
            (data?.records || []).filter(r => (r.amount || 0) > 0).forEach(r => items.push(_fromNostr(r)));
        }

        items.sort((a, b) => b.ts - a.ts);
        _cache = { pubkey, items, at: Date.now() };
        return items;
    }

    // Re-renderizar cuando lleguen méritos nuevos del relay
    function _installMeritHook() {
        if (_meritHookInstalled || typeof LBW_Merits === 'undefined' || !LBW_Merits.subscribeMerits) return;
        _meritHookInstalled = true;
        LBW_Merits.subscribeMerits(() => {
            if (!_lastContainer || !document.getElementById(_lastContainer)) return;
            clearTimeout(_rerenderTimer);
            _rerenderTimer = setTimeout(() => renderXpInto(_lastContainer, _lastPage, true), 800);
        });
    }

    // Renderiza el historial unificado del usuario en un contenedor dado, con paginación
    async function renderXpInto(containerId, page, force) {
        page = Math.max(1, parseInt(page) || 1);
        const container = document.getElementById(containerId);
        if (!container) return;
        _lastContainer = containerId;
        _lastPage = page;
        _installMeritHook();

        const pubkey = _myPubkey();
        if (!pubkey) {
            container.innerHTML = `<div class="c2p-empty-state" style="padding:2rem;">Inicia sesión para ver tu historial de méritos</div>`;
            return;
        }

        if (!_cache || _cache.pubkey !== pubkey) {
            container.innerHTML = `<p class="c2p-empty-state" style="padding:1.5rem;text-align:center;">Cargando...</p>`;
        }

        try {
            const items = await _loadItems(pubkey, !!force);
            const totalItems = items.length;

            if (totalItems === 0) {
                container.innerHTML = `<div class="c2p-empty-state" style="padding:2rem;">Aún no tienes méritos · Asiste a eventos, completa misiones, vota en gobernanza y mantén tu racha diaria</div>`;
                return;
            }

            const totalPages = Math.max(1, Math.ceil(totalItems / XP_PAGE_SIZE));
            const currentPage = Math.min(page, totalPages);
            const pageItems = items.slice((currentPage - 1) * XP_PAGE_SIZE, currentPage * XP_PAGE_SIZE);
            const totalMerits = items.reduce((s, it) => s + (it.amount || 0), 0);

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
                    <div style="font-size:0.8rem;color:var(--color-text-secondary);">${totalItems.toLocaleString('es-CO')} movimientos · <strong style="color:var(--color-bitcoin);">${totalMerits.toLocaleString('es-CO')} méritos</strong></div>
                    <div style="font-size:0.8rem;color:var(--color-text-secondary);">Página ${currentPage} de ${totalPages}</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:0.45rem;margin-bottom:0.75rem;">
                    ${pageItems.map(_renderRow).join('')}
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
