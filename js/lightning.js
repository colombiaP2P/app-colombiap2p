// ========== LIGHTNING APORTACIÓN ECONÓMICA ==========
// LN_ADDRESS already declared in chat.js
//
// Dos flujos:
//   A) Genérico — abre `lightning:<LN_ADDRESS>` en la wallet del usuario.
//      Funciona para todo el mundo, sin atribución de donante salvo lo
//      que escriba en el memo de su wallet.
//   B) Zap NIP-57 (si el usuario está logueado en LBW) — firma una
//      kind:9734 con su nsec, llama al callback LNURLP con &nostr=...,
//      coinos publica el zap receipt (kind:9735) que vincula
//      criptográficamente el pago con el donante. Aparece con badge
//      "⚡ zap" en la cadena de transparencia.

// [C2P FASE 9] Endpoint LNURLP de la tesorería ColombiaP2P (colombiap2p@colsats.com).
// El well-known en Vercel proxea a colsats.com y sobreescribe el callback por CORS.
// La pubkey Nostr del receptor se lee dinámicamente de meta.nostrPubkey (NIP-57).
const LNURLP_C2P_ENDPOINT = 'https://colombiap2p.com/.well-known/lnurlp/aportaciones';

function copyLnAddress() {
    navigator.clipboard.writeText(LN_ADDRESS).then(() => {
        showNotification('⚡ Dirección Lightning copiada');
    }).catch(() => {
        const el = document.createElement('textarea');
        el.value = LN_ADDRESS;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        showNotification('⚡ Dirección Lightning copiada');
    });
}

function selectSatsAmount(amount) {
    document.getElementById('customSatsAmount').value = amount;
    _updateZapButtonVisibility();
}

// Abre el `lightning:` URI con la LN address y la cantidad. Sin atribución.
function openLightningPayment() {
    const amount = document.getElementById('customSatsAmount').value || '';
    const lnurl = `lightning:${LN_ADDRESS}${amount ? '?amount=' + amount : ''}`;
    window.open(lnurl, '_blank');
    showNotification('⚡ Abriendo wallet Lightning...', 'info');
}

// Generate QR for the LN address (used in the section header)
let lnQrCodeInstance = null;
function generateLnQR() {
    const container = document.getElementById('lnQrCode');
    if (!container) return;
    container.innerHTML = '';
    const lnurlPay = `lightning:${LN_ADDRESS}`;
    try {
        lnQrCodeInstance = new QRCode(container, {
            text: lnurlPay,
            width: 180,
            height: 180,
            colorDark: '#1a1a2e',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
    } catch (err) {
        console.error('Error generando QR:', err);
        container.innerHTML = `<div style="padding: 2rem; text-align: center; color: #1a1a2e; font-size: 0.8rem;">${LN_ADDRESS}</div>`;
    }
}

// ── Zap NIP-57 flow ──────────────────────────────────────────
//
// 1. GET /.well-known/lnurlp/aportaciones (público, ya redirige a coinos)
//    Devuelve { callback, allowsNostr, minSendable, maxSendable }.
// 2. Si user logueado y allowsNostr: construir kind:9734 zap request,
//    firmar con LBW_Nostr.signEvent (ext / nsec / bunker).
// 3. GET callback?amount=<msats>&nostr=<event-json>&comment=<msg>
//    Devuelve { pr: "lnbc..." } — invoice BOLT11.
// 4. Mostrar invoice + QR. Suscribir kind:9735 para auto-detectar pago.
async function payAportacionWithZap() {
    const amountSats = parseInt(document.getElementById('customSatsAmount').value, 10);
    const message = (document.getElementById('aportacionMessage') || {}).value || '';

    if (!amountSats || amountSats < 1) {
        showNotification('Introduce una cantidad de sats válida', 'error');
        return;
    }
    if (typeof LBW_Nostr === 'undefined' || !LBW_Nostr.isLoggedIn()) {
        showNotification('Necesitas estar logueado en LBW para firmar el zap', 'error');
        return;
    }

    const amountMsats = amountSats * 1000;
    const btn = document.getElementById('payAportacionZapBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Firmando…'; }

    try {
        // 1. Metadata LNURLP
        const metaRes = await fetch(LNURLP_C2P_ENDPOINT);
        if (!metaRes.ok) throw new Error('LNURLP no disponible (' + metaRes.status + ')');
        const meta = await metaRes.json();

        if (amountMsats < (meta.minSendable || 1000)) {
            throw new Error('Importe mínimo: ' + Math.floor((meta.minSendable || 1000) / 1000) + ' sats');
        }
        if (meta.maxSendable && amountMsats > meta.maxSendable) {
            throw new Error('Importe máximo: ' + Math.floor(meta.maxSendable / 1000) + ' sats');
        }
        // 2. Intentar zap NIP-57 si el proveedor lo soporta; si no, invoice normal
        let callbackUrl = meta.callback + '?amount=' + amountMsats;
        let senderPubkey = LBW_Nostr.getPubkey ? LBW_Nostr.getPubkey() : '';
        let zapRequestId = null;
        let zapRelays = [];

        if (meta.allowsNostr) {
            try { zapRelays = (LBW_Nostr.getReadRelays && LBW_Nostr.getReadRelays()) || []; } catch (_) {}
            if (zapRelays.length === 0) zapRelays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.colombiap2p.com'];
            zapRelays = zapRelays.slice(0, 8);

            const zapReqTemplate = {
                kind: 9734,
                created_at: Math.floor(Date.now() / 1000),
                content: (message || '').substring(0, 280),
                tags: [
                    ['relays', ...zapRelays],
                    ['amount', String(amountMsats)],
                    ['p', meta.nostrPubkey || '']
                ]
            };
            const signed = await LBW_Nostr.signEvent(zapReqTemplate);
            senderPubkey = signed.pubkey;
            zapRequestId = signed.id;
            callbackUrl += '&nostr=' + encodeURIComponent(JSON.stringify(signed));
        }

        if (message) callbackUrl += '&comment=' + encodeURIComponent(message.substring(0, 144));

        // 3. Pedir invoice al callback
        const cbRes = await fetch(callbackUrl);
        if (!cbRes.ok) throw new Error('Callback LNURLP error ' + cbRes.status);
        const cbData = await cbRes.json();
        if (cbData.status === 'ERROR') throw new Error(cbData.reason || 'Error LNURLP');
        if (!cbData.pr) throw new Error('Callback no devolvió invoice (pr)');

        // 4. Render invoice + iniciar escucha de zap receipt
        const isZap = !!meta.allowsNostr;
        _showAportacionInvoice({ invoice: cbData.pr, amountSats, message, senderPubkey, isZap });
        if (isZap && zapRequestId) {
            _listenForZapReceipt({
                zapRequestId,
                zapRelays,
                invoice: cbData.pr,
                nostrPubkey: meta.nostrPubkey || '',
                amountSats,
                senderPubkey
            });
        }

    } catch (err) {
        console.warn('[Lightning] zap aportación falló:', err);
        showNotification('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '⚡ Firmar y pagar como zap (auto-atribución)'; }
    }
}

// Suscribe a kind:9735 para detectar el zap receipt automáticamente.
// Cuando llega, muestra el estado de éxito sin que el usuario haga nada.
function _listenForZapReceipt({ zapRequestId, zapRelays, invoice, nostrPubkey, amountSats, senderPubkey }) {
    if (typeof LBW_Nostr === 'undefined' || !LBW_Nostr.subscribe) return;

    // Cancelar escucha anterior si existe
    if (window._c2pZapReceiptSub) {
        try { LBW_Nostr.unsubscribe(window._c2pZapReceiptSub); } catch (_) {}
    }
    if (window._c2pZapReceiptTimeout) clearTimeout(window._c2pZapReceiptTimeout);

    const since = Math.floor(Date.now() / 1000) - 30;
    const sub = LBW_Nostr.subscribe(
        [{ kinds: [9735], '#p': [nostrPubkey], since }],
        (event) => {
            const bolt11Tag = event.tags.find(t => t[0] === 'bolt11');
            const eTag = event.tags.find(t => t[0] === 'e');
            const matches = (bolt11Tag && bolt11Tag[1] === invoice) ||
                            (eTag && eTag[1] === zapRequestId);
            if (!matches) return;
            clearTimeout(window._c2pZapReceiptTimeout);
            try { LBW_Nostr.unsubscribe(sub); } catch (_) {}
            window._c2pZapReceiptSub = null;
            _showAportacionSuccess({ amountSats, senderPubkey, isAutoDetected: true });
        },
        null,
        zapRelays
    );
    window._c2pZapReceiptSub = sub;
    // Auto-cancelar tras 5 minutos
    window._c2pZapReceiptTimeout = setTimeout(() => {
        try { LBW_Nostr.unsubscribe(sub); } catch (_) {}
        window._c2pZapReceiptSub = null;
    }, 300000);
}

// Muestra el estado de éxito tras la confirmación del pago.
function _showAportacionSuccess({ amountSats, senderPubkey, isAutoDetected }) {
    const box = document.getElementById('aportacionInvoiceBox');
    if (!box) return;
    const npubShort = senderPubkey
        ? (senderPubkey.substring(0, 8) + '…' + senderPubkey.substring(senderPubkey.length - 4))
        : '';
    const detectionNote = isAutoDetected
        ? '✅ Zap receipt (kind:9735) recibido desde los relays.'
        : '✅ Pago confirmado por el usuario.';
    box.innerHTML = `
        <div style="background:linear-gradient(135deg,rgba(76,175,80,0.12),rgba(255,152,0,0.06));border:2px solid rgba(76,175,80,0.5);border-radius:14px;padding:1.5rem;margin-top:1rem;text-align:center;">
            <div style="font-size:2.5rem;margin-bottom:0.5rem;">🧡</div>
            <div style="font-size:1.4rem;font-weight:800;color:#81C784;margin-bottom:0.25rem;">¡Aportación recibida!</div>
            <div style="font-size:1.1rem;font-weight:700;color:#FFB74D;margin-bottom:1rem;">${amountSats.toLocaleString('es-ES')} sats</div>
            ${npubShort ? `<div style="font-size:0.78rem;color:var(--color-text-secondary);margin-bottom:0.75rem;">desde <strong style="color:#CE93D8;font-family:var(--font-mono);">${npubShort}</strong></div>` : ''}
            <div style="font-size:0.72rem;color:var(--color-text-secondary);margin-bottom:1.25rem;">${detectionNote}</div>

            <div style="background:rgba(255,152,0,0.08);border:1px solid rgba(255,152,0,0.25);border-radius:10px;padding:1rem;margin-bottom:1.25rem;text-align:left;">
                <div style="font-size:0.82rem;font-weight:700;color:#FFB74D;margin-bottom:0.5rem;">¿Cuándo recibo mis Méritos?</div>
                <div style="font-size:0.8rem;color:var(--color-text-secondary);line-height:1.6;">
                    El equipo ColombiaP2P verifica los zaps recibidos y emite los <strong style="color:var(--color-text-primary);">Méritos con peso 1.0×</strong> a tu npub en un plazo de <strong style="color:var(--color-text-primary);">24 horas</strong>.<br>
                    Podrás verlos en tu sección <strong>Méritos</strong> y en <strong>Transparencia → Wallet</strong> con el badge ⚡ zap.
                </div>
            </div>

            <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
                <button onclick="openApp('transparencia')" style="padding:0.75rem 1.25rem;background:linear-gradient(135deg,#FF9800,#F57C00);border:none;border-radius:10px;color:white;font-weight:700;cursor:pointer;font-size:0.9rem;">Ver Transparencia →</button>
                <button onclick="document.getElementById('aportacionInvoiceBox').style.display='none'" style="padding:0.75rem 1.25rem;background:transparent;border:1px solid var(--color-border);border-radius:10px;color:var(--color-text-secondary);font-weight:600;cursor:pointer;font-size:0.85rem;">Cerrar</button>
            </div>
        </div>
    `;
    if (isAutoDetected) showNotification('¡Zap confirmado! Gracias por tu aportación 🧡', 'success');
}

// Muestra el invoice resultante + QR + acciones (copiar, abrir wallet).
function _showAportacionInvoice({ invoice, amountSats, message, senderPubkey, isZap }) {
    const box = document.getElementById('aportacionInvoiceBox');
    if (!box) return;
    box.style.display = 'block';
    const npubShort = senderPubkey
        ? (senderPubkey.substring(0, 8) + '…' + senderPubkey.substring(senderPubkey.length - 4))
        : '—';
    const escapedMsg = message ? message.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c])) : '';
    const headerBadge = isZap
        ? `<span style="font-size:0.7rem;background:rgba(206,147,216,0.2);color:#CE93D8;padding:0.25rem 0.6rem;border-radius:10px;border:1px solid rgba(206,147,216,0.4);font-weight:700;">⚡ ZAP NIP-57 FIRMADO</span>
           <span style="font-size:0.78rem;color:var(--color-text-secondary);">como <strong style="color:#CE93D8;font-family:var(--font-mono);">${npubShort}</strong></span>`
        : `<span style="font-size:0.7rem;background:rgba(255,152,0,0.15);color:#FFB74D;padding:0.25rem 0.6rem;border-radius:10px;border:1px solid rgba(255,152,0,0.4);font-weight:700;">⚡ INVOICE LIGHTNING</span>
           <span style="font-size:0.78rem;color:var(--color-text-secondary);">sin atribución NIP-57</span>`;
    const footerNote = isZap
        ? `Cuando pagues este invoice, el nodo Lightning publicará un evento Nostr (kind:9735) firmado vinculando tu npub al pago.
           Aparecerá automáticamente en <strong>Transparencia → Wallet</strong> con el badge <span style="color:#CE93D8;">⚡ zap</span>.`
        : `Este invoice fue generado sin soporte NIP-57 (el proveedor no publicará un zap receipt). El pago llega igualmente a la tesorería.`;
    const senderPubkeyAttr = JSON.stringify(senderPubkey || '').replace(/"/g, '&quot;');
    box.innerHTML = `
        <div style="background:linear-gradient(135deg,rgba(206,147,216,0.1),rgba(255,152,0,0.06));border:1px solid rgba(206,147,216,0.35);border-radius:14px;padding:1.25rem;margin-top:1rem;">
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap;">
                ${headerBadge}
            </div>
            <div style="font-size:1.6rem;font-weight:800;color:#FFB74D;margin-bottom:0.5rem;">${amountSats.toLocaleString('es-ES')} sats</div>
            ${escapedMsg ? `<div style="font-size:0.85rem;color:var(--color-text-secondary);font-style:italic;margin-bottom:0.75rem;">"${escapedMsg}"</div>` : ''}

            <div id="aportacionInvoiceQr" style="background:white;padding:0.75rem;border-radius:10px;display:inline-block;margin:0.5rem 0;"></div>

            <div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
                <button onclick="window.open('lightning:${invoice}','_blank'); showNotification('Abriendo wallet…','info');" style="padding:0.7rem 1rem;background:linear-gradient(135deg,#FF9800,#F57C00);border:none;border-radius:10px;color:white;font-weight:700;cursor:pointer;font-size:0.9rem;">⚡ Abrir wallet</button>
                <button onclick="navigator.clipboard.writeText('${invoice}').then(()=>showNotification('Invoice copiado','success'))" style="padding:0.7rem 1rem;background:transparent;border:1px solid var(--color-border);border-radius:10px;color:var(--color-text-primary);font-weight:600;cursor:pointer;font-size:0.85rem;">📋 Copiar invoice</button>
            </div>

            <div id="aportacionPayStatus" style="margin-top:1rem;padding:0.75rem 1rem;background:rgba(255,152,0,0.06);border:1px solid rgba(255,152,0,0.2);border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">
                <span style="font-size:0.8rem;color:var(--color-text-secondary);">
                    <span id="aportacionPayStatusDot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#FF9800;margin-right:0.4rem;vertical-align:middle;"></span>
                    <span id="aportacionPayStatusText">Esperando confirmación del pago…</span>
                </span>
                <button onclick="_showAportacionSuccess({amountSats:${amountSats},senderPubkey:${senderPubkeyAttr},isAutoDetected:false})" style="padding:0.5rem 1rem;background:linear-gradient(135deg,#4CAF50,#388E3C);border:none;border-radius:8px;color:white;font-weight:700;cursor:pointer;font-size:0.82rem;white-space:nowrap;">✓ Ya pagué</button>
            </div>

            <div style="margin-top:0.75rem;font-size:0.72rem;color:var(--color-text-secondary);line-height:1.5;">
                ${footerNote}
            </div>
        </div>
    `;
    // Render QR
    try {
        if (typeof QRCode !== 'undefined') {
            new QRCode(document.getElementById('aportacionInvoiceQr'), {
                text: 'lightning:' + invoice,
                width: 180,
                height: 180,
                colorDark: '#1a1a2e',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
        }
    } catch (_) {}
    // Scroll into view
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Oculta el botón de zap si no hay sesión, o si LBW_Nostr aún no cargó
function _updateZapButtonVisibility() {
    const btn = document.getElementById('payAportacionZapBtn');
    if (!btn) return;
    const loggedIn = typeof LBW_Nostr !== 'undefined' && LBW_Nostr.isLoggedIn && LBW_Nostr.isLoggedIn();
    btn.style.display = loggedIn ? 'flex' : 'none';
    const tipEl = document.getElementById('payAportacionZapTip');
    if (tipEl) tipEl.style.display = loggedIn ? 'none' : 'block';
}

// Hook: refresh visibility cuando se abre la sección o cuando cambia el login
window.addEventListener('DOMContentLoaded', () => {
    _updateZapButtonVisibility();
    // Re-check tras 2s para esperar inicialización tardía de LBW_Nostr/login
    setTimeout(_updateZapButtonVisibility, 2000);
});

// ═══════════════════════════════════════════════════════════════════
// SEC-11/12: Event delegation for lightning chat actions.
// ═══════════════════════════════════════════════════════════════════
(function installLightningEventDelegation() {
    if (window.__lbwLightningListenerInstalled) return;
    window.__lbwLightningListenerInstalled = true;

    document.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-lbw-action]') : null;
        if (!el) return;
        var action = el.dataset.lbwAction;
        try {
            if (action === 'openChatWith' && typeof openChatWith === 'function') {
                openChatWith(el.dataset.userId, el.dataset.userName);
            }
        } catch (err) {
            console.error('[Lightning delegation] Error dispatching', action, err);
        }
    });
})();
