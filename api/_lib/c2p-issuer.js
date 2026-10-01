// [C2P] Emisor de méritos — utilidades compartidas por api/merits/*
//
// - Consulta y publica en relay.colombiap2p.com (nostr-tools + ws)
// - Reconstruye el libro de méritos con la MISMA regla de confianza que
//   js/nostr-merits.js: un kind:31002 vale si lo firma un emisor de
//   TRUSTED_ISSUERS (dentro de su ventana) o un Génesis (≥3000 válidos);
//   fundacional solo lo emite un emisor; revocación NIP-09 por emisor o firmante.
// - Firma con la clave del Emisor ColombiaP2P (env C2P_ISSUER_NSEC)
//
// Los archivos de api/ que empiezan por "_" no se publican como rutas.

// Todo desde la entrada principal de nostr-tools: el empaquetado de Vercel no
// incluye subrutas como 'nostr-tools/relay' (Cannot find module .../lib/cjs/relay.js).
import { finalizeEvent, getPublicKey, nip19, Relay } from 'nostr-tools';
import WebSocket from 'ws';

// AbstractRelay usa el WebSocket global si no se le inyecta uno (Node < 22 no lo tiene)
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket;

export const RELAY_URL = process.env.C2P_RELAY_URL || 'wss://relay.colombiap2p.com';

// Debe coincidir con TRUSTED_ISSUERS de js/nostr-merits.js
export const TRUSTED_ISSUERS = [
    { pubkey: '3bc79e0e001e8f48a9df3b50169b9571740f0ff5aeb352582875e642cfb04126', from: 1790726400, until: null }
];

// Debe coincidir con GOV_ADMIN_PUBKEYS de js/nostr-governance.js
export const GOV_ADMIN_PUBKEYS = [
    '2479ef8e78d635cb40054f1e1a3895b13d67b36b2326b2a1d68df7b989b4cac0',
    '51cfd8f59cd6c8e7699e5b8e3cfed94967c780939877f78e16da995107f432b9',
];

const GENESIS_MIN = 3000;
const CATEGORY_CAPS = { economica: 500 };   // maxMerits de js/nostr-merits.js

export const isHex64 = s => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

export function isTrustedIssuer(pubkey, createdAt) {
    return TRUSTED_ISSUERS.some(i =>
        i.pubkey === pubkey && createdAt >= i.from && (i.until == null || createdAt < i.until));
}

// ── Clave del emisor ─────────────────────────────────────────
let _sk = null;
export function issuerKey() {
    if (_sk) return { sk: _sk, pk: getPublicKey(_sk) };
    const nsec = (process.env.C2P_ISSUER_NSEC || '').trim();
    if (!nsec) throw new Error('C2P_ISSUER_NSEC no configurada');
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') throw new Error('C2P_ISSUER_NSEC no es un nsec válido');
    _sk = decoded.data;
    const pk = getPublicKey(_sk);
    if (!TRUSTED_ISSUERS.some(i => i.pubkey === pk)) throw new Error('La clave configurada no corresponde a un emisor de confianza');
    return { sk: _sk, pk };
}

// ── Relay ────────────────────────────────────────────────────
export async function withRelay(fn) {
    const relay = await Relay.connect(RELAY_URL);
    try { return await fn(relay); }
    finally { try { relay.close(); } catch (e) {} }
}

// Consulta puntual: resuelve al EOSE (o timeout) y cierra la sub.
export function query(relay, filters, timeoutMs = 7000) {
    return new Promise(resolve => {
        const events = [];
        let done = false;
        let sub = null;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { sub && sub.close(); } catch (e) {}
            resolve(events);
        };
        const timer = setTimeout(finish, timeoutMs);
        sub = relay.subscribe(Array.isArray(filters) ? filters : [filters], {
            onevent: ev => events.push(ev),
            oneose: finish
        });
    });
}

const tag = (ev, name) => (ev.tags.find(t => t[0] === name) || [])[1] || '';

// ── Libro de méritos ─────────────────────────────────────────
// Devuelve Map(pubkey → { total, byCategory }) con la regla de confianza de la app.
export async function loadLedger(relay) {
    const [merits, revocations] = await Promise.all([
        query(relay, { kinds: [31002], '#t': ['c2p-merits'], limit: 5000 }),
        query(relay, { kinds: [5], '#k': ['31002'], limit: 2000 })
    ]);

    const revoked = new Set();
    revocations.forEach(ev => ev.tags.forEach(t => {
        if (t[0] !== 'a' || typeof t[1] !== 'string') return;
        const [kind, signer, ...rest] = t[1].split(':');
        const d = rest.join(':');
        if (kind === '31002' && signer && d && (isTrustedIssuer(ev.pubkey, ev.created_at) || ev.pubkey === signer)) {
            revoked.add(`${signer}:${d}`);
        }
    }));

    const parsed = merits.map(ev => ({
        ev,
        recipient: tag(ev, 'p') || ev.pubkey,
        amount: parseFloat(tag(ev, 'amount')) || 0,
        category: tag(ev, 'category') || 'productiva',
        d: tag(ev, 'd')
    })).filter(m => !revoked.has(`${m.ev.pubkey}:${m.d}`));

    // Punto fijo: un firmante Génesis puede validar méritos que a su vez
    // conviertan en Génesis a otro firmante.
    let accepted = new Map();   // recipient|d → merit (el más reciente por d, como la app)
    let changed = true;
    while (changed) {
        changed = false;
        const totals = _totals(accepted);
        for (const m of parsed) {
            const key = `${m.recipient}|${m.d}`;
            const cur = accepted.get(key);
            if (cur && cur.ev.created_at >= m.ev.created_at) continue;
            const signer = m.ev.pubkey;
            const byIssuer = isTrustedIssuer(signer, m.ev.created_at);
            if (m.category === 'fundacional' && !byIssuer) continue;
            if (byIssuer || (totals.get(signer)?.total || 0) >= GENESIS_MIN) {
                accepted.set(key, m);
                changed = true;
            }
        }
    }
    return _totals(accepted);
}

function _totals(accepted) {
    const out = new Map();
    for (const m of accepted.values()) {
        if (!out.has(m.recipient)) out.set(m.recipient, { total: 0, byCategory: {} });
        const u = out.get(m.recipient);
        const cap = CATEGORY_CAPS[m.category];
        const current = u.byCategory[m.category] || 0;
        const eff = cap != null ? Math.max(0, Math.min(m.amount, cap - current)) : m.amount;
        u.total += eff;
        u.byCategory[m.category] = current + eff;
    }
    return out;
}

export function isGenesis(ledger, pubkey) {
    return (ledger.get(pubkey)?.total || 0) >= GENESIS_MIN;
}

// ── Emisión ──────────────────────────────────────────────────
// Mismo formato de d que js/nostr-merits.js → _makeDTag('merit', recipient, ref)
export const meritDTag = (recipient, ref) => `merit:${ref}:${recipient.substring(0, 16)}`;

export function buildMerit({ recipient, amount, category, reason, ref }, issuerPk) {
    const now = Math.floor(Date.now() / 1000);
    return {
        kind: 31002,
        created_at: now,
        content: JSON.stringify({ reason, amount, awardedBy: issuerPk, timestamp: now }),
        tags: [
            ['d', meritDTag(recipient, ref)],
            ['p', recipient],
            ['amount', String(amount)],
            ['category', category],
            ['reason', reason],
            ['awarded-by', issuerPk],
            ['origin', ref.split(':')[0]],
            ['ref', ref],
            ['t', 'c2p-merits'],
            ['t', 'c2p-merit-award'],
            ['client', 'ColombiaP2P']
        ]
    };
}

// Emite los méritos que el emisor aún no haya emitido (idempotente por d).
// awards: [{ recipient, amount, category, reason, ref }]
export async function issueMerits(relay, awards) {
    const { sk, pk } = issuerKey();
    if (awards.length === 0) return { issued: [], skipped: [] };

    const ds = awards.map(a => meritDTag(a.recipient, a.ref));
    const existing = await query(relay, { kinds: [31002], authors: [pk], '#d': ds, limit: ds.length });
    const have = new Set(existing.map(ev => tag(ev, 'd')));

    const issued = [];
    const skipped = [];
    for (const a of awards) {
        const d = meritDTag(a.recipient, a.ref);
        if (have.has(d)) { skipped.push({ ref: a.ref, recipient: a.recipient, reason: 'ya emitido' }); continue; }
        const ev = finalizeEvent(buildMerit(a, pk), sk);
        // C2P_DRY_RUN=1: calcular y firmar sin publicar (pruebas)
        if (process.env.C2P_DRY_RUN !== '1') await relay.publish(ev);
        issued.push({ ref: a.ref, recipient: a.recipient, amount: a.amount, category: a.category, id: ev.id });
    }
    return { issued, skipped };
}
