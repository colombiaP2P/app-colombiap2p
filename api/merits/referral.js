// [C2P] Registro de referidos — lo escribe el servidor, no la app
//
// POST /api/merits/referral
// Header: Authorization: Nostr <NIP-98 del REFERIDO> con tags
//         ['action', 'referral'] y ['referrer', <pubkey hex del referidor>]
//
// Antes la app creaba la fila en PocketBase directamente y la colección
// aceptaba escrituras anónimas: cualquiera podía declararse referidor de una
// pubkey ajena antes que el referidor real y cobrar los 50 méritos.
// Ahora firma el propio referido y el servidor comprueba:
//   - referidor = pubkey hex válida, distinta del referido y usuario real de la
//     app (tiene fila en user_streaks)
//   - el referido no tiene referidor ya (uno solo, para siempre)
//   - la cuenta es nueva (primer día de actividad hace <= NEW_ACCOUNT_DAYS),
//     para que un usuario antiguo no pueda "regalar" 50 méritos a un amigo
// El mérito (50) no se emite aquí: lo emite api/merits/checkin.js en el primer
// check-in presencial del referido.
//
// Env: PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD.

import { verifyNip98, pbFetch } from '../_lib/c2p-issuer.js';

const ENDPOINT_PATH = '/api/merits/referral';
const NEW_ACCOUNT_DAYS = 7;

const q = s => encodeURIComponent(s);
const isHex64 = s => /^[0-9a-f]{64}$/.test(s || '');
const authTag = (req, name) => {
    try {
        const ev = JSON.parse(Buffer.from((req.headers.authorization || '').slice(6).trim(), 'base64').toString('utf8'));
        return ((ev.tags || []).find(t => t[0] === name) || [])[1] || '';
    } catch (_) { return ''; }
};

async function firstOrNull(collection, filter) {
    const list = await pbFetch(`/api/collections/${collection}/records?perPage=1&filter=${q(filter)}`);
    return (list.items || [])[0] || null;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const referrer = authTag(req, 'referrer').toLowerCase();
    let pubkey;
    try {
        pubkey = verifyNip98(req, { path: ENDPOINT_PATH, bind: { action: 'referral', referrer } });
    } catch (e) {
        return res.status(401).json({ error: e.message });
    }

    if (!isHex64(referrer)) return res.status(400).json({ error: 'Referidor inválido' });
    if (referrer === pubkey) return res.status(400).json({ error: 'No puedes referirte a ti mismo' });

    try {
        if (await firstOrNull('referrals', `referred_pubkey = "${pubkey}"`)) {
            return res.status(409).json({ error: 'Ya tienes un referidor registrado' });
        }

        // Cuenta nueva: sin racha todavía, o primer día de actividad reciente
        const streak = await firstOrNull('user_streaks', `user_pubkey = "${pubkey}"`);
        const first = streak ? (streak.first_activity_date || streak.created || '') : '';
        if (first) {
            const ageDays = (Date.now() - Date.parse(first.slice(0, 10) + 'T00:00:00Z')) / 86400000;
            if (ageDays > NEW_ACCOUNT_DAYS) {
                return res.status(403).json({ error: 'El enlace de referido solo vale para cuentas nuevas' });
            }
        }

        if (!(await firstOrNull('user_streaks', `user_pubkey = "${referrer}"`))) {
            return res.status(404).json({ error: 'El referidor no es un usuario de ColombiaP2P' });
        }

        const saved = await pbFetch('/api/collections/referrals/records', {
            method: 'POST',
            body: JSON.stringify({ referrer_pubkey_short: referrer, referred_pubkey: pubkey, xp_granted: false })
        });
        return res.status(200).json({ ok: true, id: saved.id, referrer });
    } catch (err) {
        console.error('[merits/referral]', err);
        return res.status(500).json({ error: 'Error registrando el referido: ' + err.message });
    }
}
