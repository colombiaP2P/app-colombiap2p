// [C2P] Méritos económicos — emitidos por el Emisor ColombiaP2P
//
// POST /api/merits/economic
// Body: { paymentHash: "<64 hex>", recipient?: "<64 hex>" }
//
// Verifica el pago en LNbits (entrante y liquidado) y determina el donante:
//   - Zap (NIP-57): recibo kind:9735 firmado por el nostrPubkey del LNURL de
//     la tesorería, con el MISMO bolt11 que el pago, que contiene la zap
//     request (kind:9734) firmada por el donante → donante = su firmante.
//     No requiere autenticación: todo se comprueba criptográficamente.
//   - Sin zap: un admin/Génesis indica el donante en `recipient` y firma la
//     petición con NIP-98 (tags 'payment' y 'recipient' atados al body).
//
// Méritos = round(sats × 0.01), categoría economica (tope 500 por persona,
// que aplica el libro). Un mérito por pago: d = merit:zap:<paymentHash>.
// Se omite si el pago ya recibió méritos por el flujo anterior (PocketBase
// xp_transactions o 31002 emitido por un admin desde Tesorería).
//
// Env: C2P_ISSUER_NSEC, LNBITS_URL, LNBITS_READ_KEY, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD.

import { verifyEvent } from 'nostr-tools';
import {
    withRelay, query, queryRelays, loadLedger, isGenesis, issueMerits, isHex64,
    verifyNip98, getLnbitsPayment, pbFetch, meritDTag, RELAY_URL, GOV_ADMIN_PUBKEYS
} from '../_lib/c2p-issuer.js';

const TREASURY_LNURL = 'https://colsats.com/.well-known/lnurlp/colombiap2p';
const ZAP_RELAYS = [RELAY_URL, 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
const ECON_WEIGHT = 0.01;
const ENDPOINT_PATH = '/api/merits/economic';

const tag = (ev, name) => (ev.tags.find(t => t[0] === name) || [])[1] || '';

async function treasuryZapSigner() {
    const r = await fetch(TREASURY_LNURL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('No se pudo leer el LNURL de la tesorería');
    const data = await r.json();
    if (!data.allowsNostr || !isHex64(data.nostrPubkey)) throw new Error('El LNURL de la tesorería no admite zaps');
    return data.nostrPubkey;
}

// Devuelve la pubkey del donante si existe un recibo de zap válido para este bolt11
async function findZapSender(bolt11, timeMs) {
    const signer = await treasuryZapSigner();
    const since = Math.floor(timeMs / 1000) - 3600;
    const receipts = await queryRelays(ZAP_RELAYS, { kinds: [9735], '#p': [signer], since, limit: 500 });
    for (const rc of receipts) {
        if (rc.pubkey !== signer || tag(rc, 'bolt11') !== bolt11) continue;
        let zapReq;
        try { zapReq = JSON.parse(tag(rc, 'description')); } catch (e) { continue; }
        if (zapReq && zapReq.kind === 9734 && isHex64(zapReq.pubkey) && verifyEvent(zapReq)) {
            return zapReq.pubkey;
        }
    }
    return null;
}

// ¿Ya recibió méritos por el flujo anterior de Tesorería?
async function alreadyAwardedLegacy(relay, pay, recipient) {
    const zapKey = `${recipient.substring(0, 16)}_${pay.sats}_${pay.timeMs}`;
    const manualKey = `manual_${pay.paymentHash}`;
    // 31002 emitidos desde Tesorería por un admin (ref zap:<clave>)
    const ds = [meritDTag(recipient, `zap:${zapKey}`), meritDTag(recipient, `zap:${manualKey}`)];
    const prior = await query(relay, { kinds: [31002], '#d': ds, limit: 10 });
    if (prior.length > 0) return 'mérito Nostr previo';
    // Registros XP de PocketBase del flujo anterior
    try {
        const f = encodeURIComponent(`source="economica" && (ref_id="${zapKey}" || ref_id="${manualKey}")`);
        const r = await pbFetch(`/api/collections/xp_transactions/records?perPage=1&filter=${f}`);
        if ((r.totalItems || 0) > 0) return 'registro XP previo en PocketBase';
    } catch (e) {
        throw new Error('No se pudo comprobar el historial en PocketBase: ' + e.message);
    }
    return null;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const paymentHash = String(req.body?.paymentHash || '').toLowerCase();
    const manualRecipient = req.body?.recipient ? String(req.body.recipient).toLowerCase() : null;
    if (!isHex64(paymentHash)) return res.status(400).json({ error: 'paymentHash inválido' });
    if (manualRecipient && !isHex64(manualRecipient)) return res.status(400).json({ error: 'recipient inválido (hex de 64)' });

    try {
        // 1. Pago real, entrante y liquidado
        const pay = await getLnbitsPayment(paymentHash);
        if (!pay) return res.status(404).json({ error: 'Pago no encontrado en la tesorería' });
        if (!pay.incoming) return res.status(400).json({ error: 'El pago no es una entrada a la tesorería' });
        if (!pay.paid) return res.status(409).json({ error: 'El pago aún no está liquidado' });

        const merits = Math.round(pay.sats * ECON_WEIGHT);
        if (merits < 1) return res.status(200).json({ paymentHash, sats: pay.sats, merits: 0, issued: [], skipped: [{ reason: 'menos de 50 sats: no genera méritos' }] });

        const out = await withRelay(async relay => {
            // 2. Donante: zap verificable o indicación de un admin (NIP-98)
            let recipient = pay.bolt11 ? await findZapSender(pay.bolt11, pay.timeMs) : null;
            let via = 'zap';
            if (!recipient) {
                if (!manualRecipient) {
                    return { status: 422, body: { error: 'El pago no tiene zap verificable: un admin debe indicar el donante', needsRecipient: true } };
                }
                const admin = verifyNip98(req, { path: ENDPOINT_PATH, bind: { payment: paymentHash, recipient: manualRecipient } });
                const ledger = await loadLedger(relay);
                if (!GOV_ADMIN_PUBKEYS.includes(admin) && !isGenesis(ledger, admin)) {
                    return { status: 403, body: { error: 'Solo un admin o Génesis puede atribuir pagos sin zap' } };
                }
                recipient = manualRecipient;
                via = 'admin';
            } else if (manualRecipient && manualRecipient !== recipient) {
                return { status: 409, body: { error: 'El zap identifica a otro donante; no se puede reasignar' } };
            }

            // 3. No duplicar con el flujo anterior
            const legacy = await alreadyAwardedLegacy(relay, pay, recipient);
            if (legacy) return { status: 200, body: { paymentHash, recipient, via, merits, issued: [], skipped: [{ reason: 'ya emitido (' + legacy + ')' }] } };

            // 4. Emitir (idempotente por pago)
            const { issued, skipped } = await issueMerits(relay, [{
                recipient, amount: merits, category: 'economica',
                ref: `zap:${paymentHash}`, d: `merit:zap:${paymentHash}`,
                reason: via === 'zap' ? `⚡ Aportación por zap: ${pay.sats} sats` : `⚡ Aportación Lightning verificada: ${pay.sats} sats`
            }]);
            return { status: 200, body: { paymentHash, recipient, via, sats: pay.sats, merits, issued, skipped } };
        });

        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[merits/economic]', err);
        const status = /NIP-98/.test(err.message) ? 401 : 500;
        return res.status(status).json({ error: err.message });
    }
}

// Solo para pruebas locales
export const _internals = { findZapSender };
