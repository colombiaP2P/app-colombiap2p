// [C2P] Misiones — todo el ciclo en el servidor + méritos del Emisor ColombiaP2P
//
// POST /api/merits/mission
// Body: { action, missionId?, ...datos }
// Header: Authorization: Nostr <NIP-98> con tags ['mission', missionId|'new'] y
//         ['action', action] (la firma solo vale para esa misión y esa acción)
//
// Acciones:
//   create  — cualquiera; nace 'open' si quien crea es Génesis/admin, si no
//             'pending_approval'
//   claim   — misión 'open', no propia, con el nivel de ciudadanía exigido
//   deliver — solo quien la reclamó; pasa a 'pending_review'
//   approve — Génesis/admin. pending_approval → open. pending_review →
//             completed + mérito al ejecutor (d merit:mision:<id>:<pk16>).
//             Quien entregó nunca aprueba su propia entrega; un Génesis no
//             admin tampoco aprueba la entrega de una misión que creó.
//   cancel  — Génesis/admin
//
// Antes todo esto lo escribía la app en PocketBase (regla de Update abierta,
// estado inicial decidido por el cliente). Con este endpoint la colección
// missions puede quedar con Create/Update solo para admins.
//
// Env: C2P_ISSUER_NSEC, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD.

import {
    withRelay, loadLedger, isGenesis, issueMerits, verifyNip98, pbFetch, GOV_ADMIN_PUBKEYS
} from '../_lib/c2p-issuer.js';

const ENDPOINT_PATH = '/api/merits/mission';
const ID_RE = /^[a-z0-9]{15}$/;
const CATEGORIES = ['productiva', 'economica', 'responsabilidad', 'financiada'];
const CITIZENSHIP_MIN = {
    'Fiatelo': 0, 'Plebeyo': 100, 'Hodler': 200, 'Noder': 400,
    'Bitcoiner': 800, 'Maximalista': 1600, 'Satoshi': 2100, 'Génesis': 3000
};
const MAX_MISSION_MERITS = 3000;

const q = s => encodeURIComponent(s);
const nowIso = () => new Date().toISOString();
const clip = (v, n) => String(v || '').trim().substring(0, n);

// Méritos del usuario como los ve el Pasaporte: libro Nostr + XP de PocketBase
async function pasaporteTotal(ledger, pubkey) {
    let pb = 0;
    try {
        let page = 1;
        for (;;) {
            const r = await pbFetch(`/api/collections/xp_transactions/records?perPage=500&page=${page}&fields=amount&filter=${q(`user_pubkey = "${pubkey}"`)}`);
            (r.items || []).forEach(x => { pb += x.amount || 0; });
            if (page >= (r.totalPages || 1)) break;
            page++;
        }
    } catch (e) {}
    return (ledger.get(pubkey)?.total || 0) + pb;
}

const update = (id, data) => pbFetch(`/api/collections/missions/records/${id}`, { method: 'PATCH', body: JSON.stringify({ ...data, updated_at: nowIso() }) });

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const action = String(req.body?.action || '');
    const missionId = action === 'create' ? 'new' : String(req.body?.missionId || '');
    if (!['create', 'claim', 'deliver', 'approve', 'cancel'].includes(action)) return res.status(400).json({ error: 'Acción inválida' });
    if (action !== 'create' && !ID_RE.test(missionId)) return res.status(400).json({ error: 'missionId inválido' });

    let pubkey;
    try {
        pubkey = verifyNip98(req, { path: ENDPOINT_PATH, bind: { mission: missionId, action } });
    } catch (e) {
        return res.status(401).json({ error: e.message });
    }

    try {
        return await withRelay(async relay => {
            const ledger = await loadLedger(relay);
            const isAdmin = GOV_ADMIN_PUBKEYS.includes(pubkey);
            const isAuthority = isAdmin || isGenesis(ledger, pubkey);
            const name = clip(req.body?.userName, 80) || pubkey.substring(0, 12);

            // ── create ──
            if (action === 'create') {
                const b = req.body || {};
                const title = clip(b.title, 140);
                const description = clip(b.description, 4000);
                const amount = parseInt(b.merit_amount, 10);
                if (!title || !description) return res.status(400).json({ error: 'Título y descripción requeridos' });
                if (!CATEGORIES.includes(b.merit_category)) return res.status(400).json({ error: 'Categoría inválida' });
                if (!(amount > 0 && amount <= MAX_MISSION_MERITS)) return res.status(400).json({ error: `Méritos entre 1 y ${MAX_MISSION_MERITS}` });
                const minCit = CITIZENSHIP_MIN[b.min_citizenship] != null ? b.min_citizenship : 'Fiatelo';
                const mission = await pbFetch('/api/collections/missions/records', {
                    method: 'POST',
                    body: JSON.stringify({
                        title, description, merit_category: b.merit_category, merit_amount: amount,
                        min_citizenship: minCit, deadline: b.deadline || null,
                        delivery_instructions: clip(b.delivery_instructions, 2000),
                        status: isAuthority ? 'open' : 'pending_approval',
                        creator_pubkey: pubkey, creator_name: name,
                        claimed_by_pubkey: null, claimed_at: null, delivery_url: null,
                        created_at: nowIso(), updated_at: nowIso()
                    })
                });
                return res.status(200).json({ mission });
            }

            let mission;
            try { mission = await pbFetch(`/api/collections/missions/records/${missionId}`); }
            catch (e) { return res.status(404).json({ error: 'Misión no encontrada' }); }

            // ── claim ──
            if (action === 'claim') {
                if (mission.status !== 'open') return res.status(409).json({ error: 'Esta misión ya no está disponible.' });
                if (mission.creator_pubkey === pubkey) return res.status(403).json({ error: 'No puedes reclamar tu propia misión.' });
                const min = CITIZENSHIP_MIN[mission.min_citizenship] || 0;
                if (min > 0 && await pasaporteTotal(ledger, pubkey) < min) {
                    return res.status(403).json({ error: `Necesitas ser ${mission.min_citizenship} (${min}+ méritos) para reclamar esta misión.` });
                }
                const updated = await update(missionId, {
                    status: 'claimed', claimed_by_pubkey: pubkey, claimed_by_name: name, claimed_at: nowIso()
                });
                return res.status(200).json({ mission: updated });
            }

            // ── deliver ──
            if (action === 'deliver') {
                if (mission.claimed_by_pubkey !== pubkey) return res.status(403).json({ error: 'No eres quien reclamó esta misión.' });
                if (!['claimed', 'pending_review'].includes(mission.status)) return res.status(409).json({ error: 'La misión no admite entregas en su estado actual.' });
                const updated = await update(missionId, {
                    delivery_note: clip(req.body?.delivery_note, 4000),
                    delivery_url: clip(req.body?.delivery_url, 500),
                    status: 'pending_review'
                });
                return res.status(200).json({ mission: updated });
            }

            // ── cancel ──
            if (action === 'cancel') {
                if (!isAuthority) return res.status(403).json({ error: 'Solo los Génesis pueden cancelar misiones.' });
                if (mission.status === 'completed') return res.status(409).json({ error: 'Una misión completada no se puede cancelar.' });
                const updated = await update(missionId, { status: 'cancelled' });
                return res.status(200).json({ mission: updated });
            }

            // ── approve ──
            if (!isAuthority) return res.status(403).json({ error: 'Solo los Génesis pueden aprobar misiones.' });

            if (mission.status === 'pending_approval') {
                const updated = await update(missionId, { status: 'open' });
                return res.status(200).json({ mission: updated });
            }

            if (mission.status !== 'pending_review' && mission.status !== 'completed') {
                return res.status(409).json({ error: 'Esta misión no se puede aprobar en su estado actual.' });
            }
            if (mission.claimed_by_pubkey === pubkey) {
                return res.status(403).json({ error: 'No puedes aprobar tu propia entrega: debe hacerlo otro Génesis o admin.' });
            }
            if (mission.creator_pubkey === pubkey && !isAdmin) {
                return res.status(403).json({ error: 'Un Génesis no puede aprobar sus propias misiones.' });
            }

            // Mérito al ejecutor (idempotente). Si el flujo anterior ya escribió
            // XP en PocketBase para esta misión, no se duplica.
            let issued = [], skipped = [];
            const recipient = mission.claimed_by_pubkey;
            if (recipient && mission.merit_amount > 0 && CATEGORIES.includes(mission.merit_category)) {
                const legacy = await pbFetch(`/api/collections/xp_transactions/records?perPage=1&filter=${q(`source = "mision" && ref_id = "${missionId}"`)}`);
                if ((legacy.totalItems || 0) > 0) {
                    skipped.push({ ref: `mision:${missionId}`, reason: 'ya emitido (registro XP previo en PocketBase)' });
                } else {
                    ({ issued, skipped } = await issueMerits(relay, [{
                        recipient, amount: mission.merit_amount, category: mission.merit_category,
                        ref: `mision:${missionId}`, reason: `✅ Misión completada: ${mission.title}`
                    }]));
                }
            }

            let updated = mission;
            if (mission.status !== 'completed') {
                updated = await update(missionId, { status: 'completed', approved_by_pubkey: pubkey, completed_at: nowIso() });
                // Registro de auditoría (como antes)
                try {
                    await pbFetch('/api/collections/merit_contributions/records', {
                        method: 'POST',
                        body: JSON.stringify({
                            pubkey: recipient, value: mission.merit_amount, category: mission.merit_category,
                            description: `✅ Misión completada: ${mission.title}`, payment_method: 'mission',
                            status: 'approved', approved_by: pubkey, approved_at: nowIso(),
                            evidence_url: mission.delivery_url || '', created_at: nowIso()
                        })
                    });
                } catch (e) { console.warn('[merits/mission] merit_contributions:', e.message); }
            }
            return res.status(200).json({ mission: updated, issued, skipped });
        });
    } catch (err) {
        console.error('[merits/mission]', err);
        return res.status(500).json({ error: 'Error en la misión: ' + err.message });
    }
}
