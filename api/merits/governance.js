// [C2P] Méritos de gobernanza — emitidos por el Emisor ColombiaP2P
//
// POST /api/merits/governance
// Body: { dTag: "proposal-<pk8>-<ts>" }
//
// Cualquiera puede llamarlo (la app lo hace al recibir un resultado o una
// verificación de ejecución): el endpoint NO confía en el cliente. Lee del
// relay la propuesta, el resultado oficial, los votos y la verificación, los
// valida y emite los méritos que falten. Es idempotente: cada mérito tiene un
// d fijo (gov-vote / gov-author / gov-exec) y lo ya emitido se omite.
//
// Reglas (mismas cantidades que MERIT_CONFIG de js/nostr-governance.js):
//   - Votar (voto temático antes del resultado): 3 productiva; 5 responsabilidad
//     si el votante está en Ciudadanía/Gobernanza (≥800) y tiene ≥1000 méritos
//     fuera de responsabilidad.
//   - Autor: 50 productiva si se aprobó, 10 si se rechazó; nada sin quórum.
//   - Ejecución verificada (31012 firmado por Génesis/admin distinto del autor):
//     50 productiva al autor.
//
// Env: C2P_ISSUER_NSEC (clave del emisor). Opcional: C2P_RELAY_URL.

import {
    withRelay, query, loadLedger, isGenesis, issueMerits, isHex64, GOV_ADMIN_PUBKEYS
} from '../_lib/c2p-issuer.js';

const MERIT = {
    VOTE_SENIOR:     { amount: 5,  category: 'responsabilidad' },
    VOTE_COMMUNITY:  { amount: 3,  category: 'productiva' },
    AUTHOR_APPROVED: { amount: 50, category: 'productiva' },
    AUTHOR_REJECTED: { amount: 10, category: 'productiva' },
    EXEC_VERIFIED:   { amount: 50, category: 'productiva' },
};
const SENIOR_MIN_TOTAL = 800;          // bloque Ciudadanía
const RESPONSABILIDAD_MIN_OTHER = 1000; // requiresMinMerits de responsabilidad

const DTAG_RE = /^proposal-([0-9a-f]{8})-\d{9,11}$/;
const tag = (ev, name) => (ev.tags.find(t => t[0] === name) || [])[1] || '';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const dTag = (req.body && req.body.dTag) || '';
    const m = DTAG_RE.exec(dTag);
    if (!m) return res.status(400).json({ error: 'dTag inválido' });
    const authorPrefix = m[1];

    try {
        const out = await withRelay(async relay => {
            // 1. Propuesta: el autor debe coincidir con el prefijo del d (anti-suplantación)
            const proposals = (await query(relay, { kinds: [31000], '#d': [dTag], '#t': ['c2p-proposal'], limit: 10 }))
                .filter(ev => ev.pubkey.startsWith(authorPrefix))
                .sort((a, b) => b.created_at - a.created_at);
            const proposal = proposals[0];
            if (!proposal) return { status: 404, body: { error: 'Propuesta no encontrada' } };
            const author = proposal.pubkey;
            const title = tag(proposal, 'title') || dTag;

            // 2. ¿Eliminada? (kind:5 del autor o de un admin)
            const deletions = await query(relay, { kinds: [5], '#k': ['31000'], limit: 500 });
            const deleted = deletions.some(ev =>
                (ev.pubkey === author || GOV_ADMIN_PUBKEYS.includes(ev.pubkey)) &&
                ev.tags.some(t => t[0] === 'a' && t[1] === `31000:${author}:${dTag}`));
            if (deleted) return { status: 409, body: { error: 'La propuesta fue eliminada' } };

            const ledger = await loadLedger(relay);
            const isAuthority = pk => GOV_ADMIN_PUBKEYS.includes(pk) || isGenesis(ledger, pk);

            // 3. Resultado oficial: el primero firmado por Génesis/admin
            const results = (await query(relay, { kinds: [31010], '#d': [dTag], limit: 20 }))
                .filter(ev => isAuthority(ev.pubkey))
                .sort((a, b) => a.created_at - b.created_at);
            const result = results[0];
            if (!result) return { status: 200, body: { dTag, pending: 'Aún no hay resultado oficial', issued: [], skipped: [] } };

            let outcome = {};
            try { outcome = JSON.parse(result.content); } catch (e) {}
            const quorumMet = outcome.quorum_met !== false;
            const approved = !!outcome.approved;

            const awards = [];

            // 4. Votantes: último voto temático de cada uno, emitido antes del resultado
            const votes = await query(relay, { kinds: [31001], '#e': [proposal.id], limit: 2000 });
            const lastVote = new Map();
            votes.forEach(ev => {
                if (tag(ev, 'vote_type') === 'admission') return;
                if (!ev.tags.some(t => t[0] === 't' && t[1] === 'c2p-vote')) return;
                if (ev.created_at > result.created_at) return;
                const prev = lastVote.get(ev.pubkey);
                if (!prev || ev.created_at > prev.created_at) lastVote.set(ev.pubkey, ev);
            });
            lastVote.forEach((_, voter) => {
                if (!isHex64(voter)) return;
                const u = ledger.get(voter) || { total: 0, byCategory: {} };
                const other = u.total - (u.byCategory.responsabilidad || 0);
                const cfg = (u.total >= SENIOR_MIN_TOTAL && other >= RESPONSABILIDAD_MIN_OTHER)
                    ? MERIT.VOTE_SENIOR : MERIT.VOTE_COMMUNITY;
                awards.push({
                    recipient: voter, ...cfg, ref: `gov-vote:${dTag}`,
                    reason: `Participación en votación de gobernanza: "${title}"`
                });
            });

            // 5. Autor
            if (quorumMet) {
                const cfg = approved ? MERIT.AUTHOR_APPROVED : MERIT.AUTHOR_REJECTED;
                awards.push({
                    recipient: author, ...cfg, ref: `gov-author:${dTag}`,
                    reason: `Propuesta de gobernanza ${approved ? 'aprobada' : 'rechazada'}: "${title}"`
                });
            }

            // 6. Ejecución verificada por una autoridad distinta del autor
            if (approved) {
                const verifications = await query(relay, { kinds: [31012], '#d': [dTag], limit: 20 });
                if (verifications.some(ev => isAuthority(ev.pubkey) && ev.pubkey !== author)) {
                    awards.push({
                        recipient: author, ...MERIT.EXEC_VERIFIED, ref: `gov-exec:${dTag}`,
                        reason: `Ejecución verificada de propuesta: "${title}"`
                    });
                }
            }

            const { issued, skipped } = await issueMerits(relay, awards);
            return { status: 200, body: { dTag, result: { approved, quorumMet }, issued, skipped } };
        });

        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[merits/governance]', err);
        return res.status(500).json({ error: 'Error emitiendo méritos: ' + err.message });
    }
}
