// [C2P] Check-in a eventos + méritos — emitidos por el Emisor ColombiaP2P
//
// POST /api/merits/checkin
// Body: { eventId, token, userName? }
// Header: Authorization: Nostr <evento NIP-98 firmado por el asistente>
//         con tag ['event', eventId] (ata la firma a este evento)
//
// Antes la app creaba el check-in y el XP directamente en PocketBase y NO
// comprobaba el token del QR. Ahora el servidor:
//   1. Identifica al asistente por su firma NIP-98 (nadie hace check-in por otro)
//   2. Valida evento abierto, ventana de check-in y token del QR
//   3. Crea event_checkins, user_stamps y user_badges con credenciales admin
//   4. Emite el mérito del evento (xp_reward, productiva): d merit:evento:<id>:<pk16>
//   5. Si es su primer check-in y fue referido, emite 50 al referidor:
//      d merit:referido:<referido>:<referidor16>
// Idempotente: repetir la petición no duplica registros ni méritos.
//
// Acción 'qr' (organizadores): Body { action: 'qr', eventId }, NIP-98 con tags
// ['event', eventId] y ['action', 'qr'] firmado por un admin/Génesis. Devuelve
// el enlace del QR de check-in. El checkin_token debe estar como campo Hidden
// en PocketBase: solo el servidor (credenciales admin) puede leerlo.
//
// Env: C2P_ISSUER_NSEC, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD.

import {
    withRelay, issueMerits, isHex64, verifyNip98, pbFetch, loadLedger, isGenesis, GOV_ADMIN_PUBKEYS
} from '../_lib/c2p-issuer.js';

const ENDPOINT_PATH = '/api/merits/checkin';
const REFERRAL_REWARD = 50;   // XP_REFERRAL_REWARD de js/c2p-rachas.js
const ID_RE = /^[a-z0-9]{15}$/;   // ids de registros PocketBase

const q = s => encodeURIComponent(s);
const PUBLIC_ORIGIN = 'https://colombiap2p.com';

// QR de check-in para organizadores (admin/Génesis)
async function handleQr(req, res, eventId) {
    let pubkey;
    try {
        pubkey = verifyNip98(req, { path: ENDPOINT_PATH, bind: { event: eventId, action: 'qr' } });
    } catch (e) {
        return res.status(401).json({ error: e.message });
    }
    if (!GOV_ADMIN_PUBKEYS.includes(pubkey)) {
        const ledger = await withRelay(relay => loadLedger(relay));
        if (!isGenesis(ledger, pubkey)) return res.status(403).json({ error: 'Solo admins o Génesis pueden mostrar el QR del evento' });
    }
    let ev;
    try { ev = await pbFetch(`/api/collections/events/records/${eventId}`); }
    catch (e) { return res.status(404).json({ error: 'Evento no encontrado' }); }
    if (!ev.checkin_token) return res.status(409).json({ error: 'El evento no tiene código de check-in configurado' });
    return res.status(200).json({
        eventId, title: ev.title || '',
        url: `${PUBLIC_ORIGIN}/?c2pcheckin=${eventId}:${encodeURIComponent(ev.checkin_token)}`
    });
}

function checkinOpen(ev) {
    const now = Date.now();
    if (ev.status !== 'open') return 'El check-in de este evento no está abierto';
    if (ev.checkin_open_from && now < new Date(ev.checkin_open_from).getTime()) return 'El check-in aún no ha comenzado';
    if (ev.checkin_open_until && now > new Date(ev.checkin_open_until).getTime()) return 'El check-in ya cerró';
    return null;
}

async function firstOrNull(collection, filter) {
    const r = await pbFetch(`/api/collections/${collection}/records?perPage=1&filter=${q(filter)}`);
    return (r.items || [])[0] || null;
}

async function ensureRecord(collection, filter, data) {
    const existing = await firstOrNull(collection, filter);
    if (existing) return { record: existing, created: false };
    const record = await pbFetch(`/api/collections/${collection}/records`, { method: 'POST', body: JSON.stringify(data) });
    return { record, created: true };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const eventId = String(req.body?.eventId || '');
    const token = String(req.body?.token || '').trim();
    const userName = String(req.body?.userName || '').substring(0, 80);
    if (!ID_RE.test(eventId)) return res.status(400).json({ error: 'eventId inválido' });

    if (req.body?.action === 'qr') {
        try { return await handleQr(req, res, eventId); }
        catch (err) {
            console.error('[merits/checkin qr]', err);
            return res.status(500).json({ error: 'Error obteniendo el QR: ' + err.message });
        }
    }

    if (!token) return res.status(400).json({ error: 'Falta el código del evento' });

    let pubkey;
    try {
        pubkey = verifyNip98(req, { path: ENDPOINT_PATH, bind: { event: eventId } });
    } catch (e) {
        return res.status(401).json({ error: e.message });
    }

    try {
        // 1. Evento + token (el token solo es legible con credenciales admin)
        let ev;
        try { ev = await pbFetch(`/api/collections/events/records/${eventId}`); }
        catch (e) { return res.status(404).json({ error: 'Evento no encontrado' }); }
        if (!ev.checkin_token || token !== ev.checkin_token) return res.status(403).json({ error: 'Código del evento incorrecto' });

        // 2. Check-in (idempotente). La ventana solo se exige para registros nuevos.
        const existingCheckin = await firstOrNull('event_checkins', `event_id = "${eventId}" && user_pubkey = "${pubkey}"`);
        if (!existingCheckin) {
            const closed = checkinOpen(ev);
            if (closed) return res.status(409).json({ error: closed });
            await pbFetch('/api/collections/event_checkins/records', {
                method: 'POST',
                body: JSON.stringify({
                    event_id: eventId, user_pubkey: pubkey, user_name: userName,
                    checkin_token: token, check_method: 'qr', checked_in_at: new Date().toISOString()
                })
            });
        }

        // 3. Sello y badge del evento (sin duplicados)
        const nowIso = new Date().toISOString();
        if (ev.stamp_id) {
            await ensureRecord('user_stamps', `user_pubkey = "${pubkey}" && stamp_id = "${ev.stamp_id}"`,
                { user_pubkey: pubkey, stamp_id: ev.stamp_id, obtained_at: nowIso });
        }
        if (ev.badge_id) {
            await ensureRecord('user_badges', `user_pubkey = "${pubkey}" && badge_id = "${ev.badge_id}"`,
                { user_pubkey: pubkey, badge_id: ev.badge_id, obtained_at: nowIso });
        }

        // 4. Méritos
        const awards = [];
        // No duplicar con el flujo anterior (XP escrito por la app en PocketBase)
        const legacyXp = ev.xp_reward > 0
            ? await firstOrNull('xp_transactions', `user_pubkey = "${pubkey}" && source = "evento" && ref_id = "${eventId}"`)
            : null;
        if (ev.xp_reward > 0 && !legacyXp) {
            awards.push({
                recipient: pubkey, amount: ev.xp_reward, category: 'productiva',
                ref: `evento:${eventId}`, reason: `Check-in: ${ev.title || 'evento'}`
            });
        }

        // 5. Referido: mérito al referidor en el primer check-in del referido
        let referralRecord = null;
        const total = await pbFetch(`/api/collections/event_checkins/records?perPage=1&filter=${q(`user_pubkey = "${pubkey}"`)}`);
        if ((total.totalItems || 0) === 1) {
            referralRecord = await firstOrNull('referrals', `referred_pubkey = "${pubkey}"`);
            const referrer = referralRecord?.referrer_pubkey_short || '';
            // xp_granted ya en true = el flujo anterior dio XP en PocketBase (o ya lo emitimos)
            if (isHex64(referrer) && referrer !== pubkey && !referralRecord.xp_granted) {
                awards.push({
                    recipient: referrer, amount: REFERRAL_REWARD, category: 'productiva',
                    ref: `referido:${pubkey}`, reason: 'Referido asistió a su primer evento'
                });
            } else {
                referralRecord = null;
            }
        }

        const { issued, skipped } = await withRelay(relay => issueMerits(relay, awards));
        if (referralRecord && !referralRecord.xp_granted) {
            try {
                await pbFetch(`/api/collections/referrals/records/${referralRecord.id}`, { method: 'PATCH', body: JSON.stringify({ xp_granted: true }) });
            } catch (e) { console.warn('[merits/checkin] referral xp_granted:', e.message); }
        }

        return res.status(200).json({
            eventId, pubkey, alreadyCheckedIn: !!existingCheckin,
            stamp: !!ev.stamp_id, badge: !!ev.badge_id, issued, skipped
        });
    } catch (err) {
        console.error('[merits/checkin]', err);
        return res.status(500).json({ error: 'Error registrando el check-in: ' + err.message });
    }
}
