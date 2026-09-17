// ColombiaP2P — Módulo Eventos (FASE 6)
// Eventos presenciales con check-in via QR firmado por token PocketBase.

const C2P_Eventos = (function () {

    let _events   = [];
    let _isLoaded = false;
    let _filter   = 'proximos';

    const _esc = LBW.escapeHtml;

    function _getPB() {
        const pb = (typeof C2P_PB !== 'undefined') ? C2P_PB.getClient() : null;
        if (!pb) throw new Error('PocketBase no disponible.');
        return pb;
    }

    function _myPubkey() {
        return LBW_Nostr?.isLoggedIn() ? LBW_Nostr.getPubkey() : (currentUser?.pubkey || '');
    }

    function _myName() {
        return currentUser?.name || _myPubkey().substring(0, 12);
    }

    // ── Fecha legible ──────────────────────────────────────────
    function _formatDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
    }

    function _isPast(iso) {
        return iso && new Date(iso) < new Date();
    }

    function _isCheckinOpen(ev) {
        const now  = new Date();
        const from  = ev.checkin_open_from  ? new Date(ev.checkin_open_from)  : null;
        const until = ev.checkin_open_until ? new Date(ev.checkin_open_until) : null;
        if (ev.status !== 'open') return false;
        if (from  && now < from)  return false;
        if (until && now > until) return false;
        return true;
    }

    // ── PocketBase CRUD ────────────────────────────────────────
    async function loadEvents() {
        try {
            _events = await _getPB().collection('events')
                .getFullList({ sort: 'event_date', filter: 'status != "draft"' });
            _isLoaded = true;
        } catch (e) {
            console.warn('[C2P Eventos] No se pudo conectar a PocketBase:', e.message);
            _events   = [];
            _isLoaded = true;
        }
        return _events;
    }

    async function submitCheckin(eventId, token) {
        const pubkey = _myPubkey();
        if (!pubkey) throw new Error('Debes iniciar sesión primero.');

        // Verificar si ya hizo check-in
        const existing = await _getPB().collection('event_checkins').getList(1, 1, {
            filter: `event_id = "${eventId}" && user_pubkey = "${pubkey}"`,
        });
        if (existing.totalItems > 0) throw new Error('Ya estás registrado en este evento.');

        await _getPB().collection('event_checkins').create({
            event_id:      eventId,
            user_pubkey:   pubkey,
            user_name:     _myName(),
            checkin_token: token,
            check_method:  'qr',
            checked_in_at: new Date().toISOString(),
        });

        // Registrar XP si el evento tiene recompensa
        const ev = _events.find(e => e.id === eventId);
        if (ev && ev.xp_reward > 0) {
            try {
                await _getPB().collection('xp_transactions').create({
                    user_pubkey: pubkey,
                    amount:      ev.xp_reward,
                    reason:      `Check-in: ${ev.title}`,
                    source:      'evento',
                    ref_id:      eventId,
                });
            } catch (xpErr) {
                console.warn('[C2P Eventos] XP no registrado:', xpErr.message);
            }
        }
    }

    // ── Renderizado ────────────────────────────────────────────
    function renderEventsSection() {
        const container = document.getElementById('eventosContent');
        if (!container) return;

        if (!_isLoaded) {
            container.innerHTML = '<p class="c2p-empty-state" style="padding:2rem;">Cargando eventos...</p>';
            return;
        }

        const now = new Date();
        let visible = _events;
        if (_filter === 'proximos') visible = _events.filter(e => !_isPast(e.event_date));
        if (_filter === 'pasados')  visible = _events.filter(e =>  _isPast(e.event_date));

        if (visible.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:3rem 1rem;">
                <div style="font-size:3rem;margin-bottom:1rem;">📅</div>
                <p style="color:var(--color-text-secondary);font-size:0.9rem;">
                    ${_filter === 'proximos' ? 'No hay eventos próximos por ahora.' : 'No hay eventos pasados.'}
                </p>
            </div>`;
            return;
        }

        container.innerHTML = visible.map(ev => _eventCard(ev)).join('');
    }

    function _eventCard(ev) {
        const past   = _isPast(ev.event_end || ev.event_date);
        const open   = _isCheckinOpen(ev);
        const xpBadge = ev.xp_reward ? `<span style="font-size:0.7rem;background:rgba(247,147,26,0.15);color:var(--color-bitcoin);padding:0.2rem 0.6rem;border-radius:10px;font-weight:700;border:1px solid rgba(247,147,26,0.3);">+${ev.xp_reward} XP</span>` : '';
        const statusBadge = past
            ? `<span style="font-size:0.7rem;color:var(--color-text-secondary);">✔ Finalizado</span>`
            : open
            ? `<span style="font-size:0.7rem;color:#4CAF50;font-weight:700;">🟢 Check-in abierto</span>`
            : `<span style="font-size:0.7rem;color:#F7931A;font-weight:700;">📅 Próximamente</span>`;

        return `
        <div style="border:1.5px solid var(--color-border);border-radius:14px;padding:1.1rem 1.2rem;margin-bottom:0.9rem;background:var(--color-bg-card);transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--color-bitcoin)'" onmouseout="this.style.borderColor='var(--color-border)'">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;flex-wrap:wrap;">
                <div style="flex:1;min-width:200px;">
                    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem;flex-wrap:wrap;">
                        ${statusBadge}
                        ${xpBadge}
                    </div>
                    <h4 style="font-size:1rem;font-weight:700;color:var(--color-text-primary);margin:0 0 0.3rem;">${_esc(ev.title)}</h4>
                    <div style="font-size:0.78rem;color:var(--color-text-secondary);">
                        📅 ${_formatDate(ev.event_date)}
                        ${ev.location ? ` &nbsp;·&nbsp; 📍 ${_esc(ev.location)}` : ''}
                        ${ev.max_attendees ? ` &nbsp;·&nbsp; 👥 máx. ${ev.max_attendees}` : ''}
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:0.4rem;align-items:flex-end;">
                    ${open ? `<button onclick="C2P_Eventos.showCheckinModal('${_esc(ev.id)}')" style="font-size:0.8rem;padding:0.4rem 0.9rem;background:var(--color-bitcoin);color:#0e0e0d;border:none;border-radius:8px;cursor:pointer;font-weight:700;">📲 Check-in</button>` : ''}
                    <button onclick="C2P_Eventos.showEventDetail('${_esc(ev.id)}')" style="font-size:0.75rem;padding:0.35rem 0.75rem;background:transparent;color:var(--color-text-secondary);border:1px solid var(--color-border);border-radius:8px;cursor:pointer;">Ver más</button>
                </div>
            </div>
        </div>`;
    }

    // ── Detail modal ──────────────────────────────────────────
    function showEventDetail(eventId) {
        const ev = _events.find(e => e.id === eventId);
        if (!ev) return;

        const open = _isCheckinOpen(ev);
        const pb = (typeof C2P_PB !== 'undefined') ? C2P_PB.getClient() : null;
        const imgUrl = ev.image_url
            ? (pb ? pb.files.getUrl(ev, ev.image_url, { thumb: '800x0' }) : ev.image_url)
            : '';

        // Verificar si ya hizo check-in
        const pubkey = _myPubkey();
        let alreadyCheckedIn = false;
        if (pb && pubkey) {
            try {
                const existing = await pb.collection('event_checkins').getList(1, 1, {
                    filter: `event_id = "${ev.id}" && user_pubkey = "${pubkey}"`,
                });
                alreadyCheckedIn = existing.totalItems > 0;
            } catch (_) {}
        }
        const modal = _getOrCreateModal('c2pEventDetailModal');
        modal.innerHTML = `
            <div class="modal-content" style="max-width:580px;padding:2rem;position:relative;">
                <button class="modal-close" onclick="document.getElementById('c2pEventDetailModal').remove()">✕</button>
                ${imgUrl ? `<img src="${imgUrl}" alt="Imagen del evento" style="width:100%;border-radius:10px;margin-bottom:1rem;max-height:260px;object-fit:cover;">` : ''}
                <h2 style="color:var(--color-bitcoin);font-size:1.2rem;margin-bottom:0.3rem;">📅 ${_esc(ev.title)}</h2>
                <p style="font-size:0.8rem;color:var(--color-text-secondary);margin-bottom:1rem;">
                    ${_formatDate(ev.event_date)}
                    ${ev.event_end ? ` → ${_formatDate(ev.event_end)}` : ''}
                    ${ev.location ? `<br>📍 ${_esc(ev.location)}` : ''}
                </p>
                ${ev.description ? `<p style="font-size:0.88rem;color:var(--color-text-primary);line-height:1.7;margin-bottom:1.25rem;">${_esc(ev.description)}</p>` : ''}
                <div style="display:flex;gap:0.6rem;flex-wrap:wrap;margin-bottom:1.25rem;">
                    ${ev.xp_reward ? `<span style="font-size:0.78rem;background:rgba(247,147,26,0.12);color:var(--color-bitcoin);padding:0.3rem 0.75rem;border-radius:12px;font-weight:700;">+${ev.xp_reward} XP por asistir</span>` : ''}
                    ${ev.stamp_id ? `<span style="font-size:0.78rem;background:rgba(255,255,255,0.06);color:var(--color-text-secondary);padding:0.3rem 0.75rem;border-radius:12px;">🏅 Sello especial</span>` : ''}
                    ${ev.max_attendees ? `<span style="font-size:0.78rem;background:rgba(255,255,255,0.06);color:var(--color-text-secondary);padding:0.3rem 0.75rem;border-radius:12px;">👥 máx. ${ev.max_attendees}</span>` : ''}
                </div>
                <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
                    ${alreadyCheckedIn
                        ? `<div style="flex:1;padding:0.65rem;background:rgba(76,175,80,0.15);color:#4CAF50;border:1px solid #4CAF50;border-radius:10px;text-align:center;font-weight:700;font-size:0.9rem;">✅ Ya estás registrado</div>`
                        : open ? `<button onclick="document.getElementById('c2pEventDetailModal').remove(); C2P_Eventos.showCheckinModal('${_esc(ev.id)}')" style="flex:1;padding:0.65rem;background:var(--color-bitcoin);color:#0e0e0d;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:0.9rem;">📲 Hacer Check-in</button>` : ''}
                    <button onclick="document.getElementById('c2pEventDetailModal').remove()" class="btn btn-secondary" style="flex:1;">Cerrar</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    // ── Check-in modal ────────────────────────────────────────
    function showCheckinModal(eventId, prefillToken) {
        const ev = _events.find(e => e.id === eventId);
        if (!ev) { showNotification('Evento no encontrado.', 'error'); return; }
        if (!LBW_Nostr?.isLoggedIn()) { showNotification('Debes iniciar sesión para hacer check-in.', 'error'); return; }

        const modal = _getOrCreateModal('c2pCheckinModal');
        modal.innerHTML = `
            <div class="modal-content" style="max-width:460px;padding:2rem;position:relative;text-align:center;">
                <button class="modal-close" onclick="document.getElementById('c2pCheckinModal').remove()">✕</button>
                <div style="font-size:3rem;margin-bottom:0.75rem;">📲</div>
                <h2 style="color:var(--color-bitcoin);margin-bottom:0.4rem;">Check-in</h2>
                <p style="color:var(--color-text-secondary);font-size:0.85rem;margin-bottom:1.25rem;">${_esc(ev.title)}</p>
                <div class="form-group" style="margin-bottom:1rem;text-align:left;">
                    <label style="display:block;margin-bottom:0.4rem;color:var(--color-text-secondary);font-size:0.82rem;">Código del evento</label>
                    <input type="text" id="c2pCheckinTokenInput" value="${prefillToken ? _esc(prefillToken) : ''}"
                        placeholder="Escanea el QR o pégalo aquí"
                        style="width:100%;padding:0.7rem;background:var(--color-bg-dark);border:1px solid var(--color-border);border-radius:8px;color:var(--color-text-primary);font-family:var(--font-mono);font-size:0.85rem;">
                </div>
                <div id="c2pCheckinStatus" style="min-height:1.5rem;font-size:0.82rem;margin-bottom:0.75rem;"></div>
                <button id="c2pCheckinBtn" onclick="C2P_Eventos._doCheckin('${_esc(eventId)}')"
                    style="width:100%;padding:0.75rem;background:var(--color-bitcoin);color:#0e0e0d;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:0.95rem;">
                    ✅ Confirmar Asistencia
                </button>
            </div>`;
        document.body.appendChild(modal);

        // Auto-submit si tenemos token del URL
        if (prefillToken) {
            setTimeout(() => _doCheckin(eventId), 300);
        }
    }

    async function _doCheckin(eventId) {
        const tokenInput = document.getElementById('c2pCheckinTokenInput');
        const statusEl   = document.getElementById('c2pCheckinStatus');
        const btn        = document.getElementById('c2pCheckinBtn');
        const token = tokenInput?.value.trim();

        if (!token) { if (statusEl) statusEl.innerHTML = '<span style="color:#FF5252;">Introduce el código del evento.</span>'; return; }
        if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }

        try {
            await submitCheckin(eventId, token);
            if (statusEl) statusEl.innerHTML = '<span style="color:#4CAF50;font-weight:700;">✅ ¡Check-in registrado!</span>';
            if (btn) { btn.textContent = '✅ ¡Listo!'; btn.style.background = '#4CAF50'; }
            showNotification('✅ Check-in completado. ¡Bienvenido al evento!', 'success');
            setTimeout(() => document.getElementById('c2pCheckinModal')?.remove(), 2000);
        } catch (e) {
            if (statusEl) statusEl.innerHTML = `<span style="color:#FF5252;">❌ ${_esc(e.message)}</span>`;
            if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar Asistencia'; }
        }
    }

    // ── QR para organizadores ─────────────────────────────────
    async function showQRModal(eventId) {
        const ev = _events.find(e => e.id === eventId);
        if (!ev) return;

        // Fetched event record with checkin_token (requires admin auth in PocketBase)
        let token = '';
        try {
            const full = await _getPB().collection('events').getOne(eventId);
            token = full.checkin_token || '';
        } catch (e) {
            showNotification('Sin acceso al token del evento. ¿Eres administrador?', 'error');
            return;
        }

        const qrContent = `https://colombiap2p.com/?c2pcheckin=${eventId}:${token}`;

        const modal = _getOrCreateModal('c2pQRModal');
        modal.innerHTML = `
            <div class="modal-content" style="max-width:400px;padding:2rem;position:relative;text-align:center;">
                <button class="modal-close" onclick="document.getElementById('c2pQRModal').remove()">✕</button>
                <h2 style="color:var(--color-bitcoin);margin-bottom:0.3rem;">📲 QR Check-in</h2>
                <p style="color:var(--color-text-secondary);font-size:0.82rem;margin-bottom:1rem;">${_esc(ev.title)}</p>
                <div id="c2pQrCanvas" style="display:inline-block;padding:1rem;background:#fff;border-radius:12px;margin-bottom:1rem;"></div>
                <p style="font-size:0.72rem;color:var(--color-text-secondary);font-family:var(--font-mono);word-break:break-all;margin-bottom:1rem;">${_esc(qrContent)}</p>
                <button onclick="navigator.clipboard.writeText('${_esc(qrContent)}').then(()=>showNotification('URL copiada','success'))"
                    class="btn btn-secondary" style="width:100%;">📋 Copiar URL</button>
            </div>`;
        document.body.appendChild(modal);

        // Render QR
        if (typeof QRCode !== 'undefined') {
            new QRCode(document.getElementById('c2pQrCanvas'), {
                text:         qrContent,
                width:        220,
                height:       220,
                colorDark:    '#0e0e0d',
                colorLight:   '#ffffff',
                correctLevel: QRCode.CorrectLevel.M,
            });
        }
    }

    // ── URL param handler ─────────────────────────────────────
    // Llamar desde DOMContentLoaded después de login
    function handleCheckinFromURL() {
        const params = new URLSearchParams(window.location.search);
        const raw    = params.get('c2pcheckin');
        if (!raw) return;

        const [eventId, token] = raw.split(':');
        if (!eventId || !token) return;

        // Limpiar URL
        const clean = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', clean);

        // Espera a que el usuario esté logeado y los eventos cargados
        const _attempt = async (retries) => {
            if (!LBW_Nostr?.isLoggedIn()) {
                if (retries > 0) return setTimeout(() => _attempt(retries - 1), 1500);
                showNotification('Inicia sesión para hacer check-in.', 'info');
                return;
            }
            if (!_isLoaded) {
                await loadEvents();
                renderEventsSection();
            }
            const ev = _events.find(e => e.id === eventId);
            if (!ev) { showNotification('Evento no encontrado.', 'error'); return; }
            showCheckinModal(eventId, token);
        };
        _attempt(8);
    }

    // ── Init ──────────────────────────────────────────────────
    async function init() {
        await loadEvents();
        renderEventsSection();
        _updateFilterPills();
    }

    function setFilter(f) {
        _filter = f;
        renderEventsSection();
        _updateFilterPills();
    }

    function _updateFilterPills() {
        document.querySelectorAll('[data-c2p-eventos-filter]').forEach(btn => {
            const active = btn.dataset.c2pEventosFilter === _filter;
            btn.style.background = active ? 'rgba(247,147,26,0.2)' : 'var(--color-bg-dark)';
            btn.style.color      = active ? 'var(--color-bitcoin)' : 'var(--color-text-secondary)';
            btn.style.borderColor= active ? 'var(--color-bitcoin)' : 'var(--color-border)';
        });
    }

    function _getOrCreateModal(id) {
        document.getElementById(id)?.remove();
        const m = document.createElement('div');
        m.id = id;
        m.className = 'modal active';
        return m;
    }

    return {
        init,
        loadEvents,
        setFilter,
        renderEventsSection,
        showEventDetail,
        showCheckinModal,
        showQRModal,
        handleCheckinFromURL,
        _doCheckin,
    };
})();

window.C2P_Eventos = C2P_Eventos;

// Detectar URL de check-in al cargar
document.addEventListener('DOMContentLoaded', () => {
    C2P_Eventos.handleCheckinFromURL();
});
