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
import { finalizeEvent, getPublicKey, nip19, Relay, verifyEvent } from 'nostr-tools';
import WebSocket from 'ws';
import { createHmac } from 'crypto';
import '../../js/c2p-admins.js';   // define globalThis.C2P_ADMIN_PUBKEYS

// AbstractRelay usa el WebSocket global si no se le inyecta uno (Node < 22 no lo tiene)
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket;

export const RELAY_URL = process.env.C2P_RELAY_URL || 'wss://relay.colombiap2p.com';

// Debe coincidir con TRUSTED_ISSUERS de js/nostr-merits.js
export const TRUSTED_ISSUERS = [
    { pubkey: '3bc79e0e001e8f48a9df3b50169b9571740f0ff5aeb352582875e642cfb04126', from: 1790726400, until: null }
];

// Lista única de admins, compartida con la app (js/c2p-admins.js)
export const GOV_ADMIN_PUBKEYS = globalThis.C2P_ADMIN_PUBKEYS;

const GENESIS_MIN = 3000;
const CATEGORY_CAPS = { economica: 500 };   // maxMerits de js/nostr-merits.js
// Topes por ORIGEN del mérito (tag 'origin' o prefijo del d). Deben coincidir
// con ORIGIN_CAPS de js/nostr-merits.js. racha: 21 de por vida (incluye los
// migrados de PocketBase) — la racha da los primeros méritos, no se "farmea".
export const ORIGIN_CAPS = { racha: 21 };

function originOf(ev) {
    const o = (ev.tags.find(t => t[0] === 'origin') || [])[1];
    if (o) return o;
    const m = /^merit:([a-z-]+):/.exec((ev.tags.find(t => t[0] === 'd') || [])[1] || '');
    return m ? m[1] : '';
}

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

// ── Código de check-in de un evento ──────────────────────────
// Derivado (HMAC) de la clave del emisor + id del evento: no se guarda en
// ningún sitio, así que no se puede filtrar desde PocketBase. Solo el servidor
// puede calcularlo. Cambiar 'v1' invalida todos los códigos.
export function checkinCode(eventId) {
    const { sk } = issuerKey();
    return createHmac('sha256', Buffer.from(sk))
        .update('c2p-checkin-v1:' + eventId)
        .digest('base64url')
        .replace(/[^A-Za-z0-9]/g, '')
        .substring(0, 12);
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

// Consulta puntual en varios relays (los que fallen o tarden se ignoran).
export async function queryRelays(urls, filters, timeoutMs = 6000) {
    const results = await Promise.allSettled(urls.map(async url => {
        const relay = await Promise.race([
            Relay.connect(url),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
        ]);
        try { return await query(relay, filters, timeoutMs); }
        finally { try { relay.close(); } catch (e) {} }
    }));
    const byId = new Map();
    results.forEach(r => { if (r.status === 'fulfilled') r.value.forEach(ev => byId.set(ev.id, ev)); });
    return [...byId.values()];
}

// ── NIP-98: autenticación HTTP con un evento Nostr firmado ───
// Header: Authorization: Nostr <base64(evento kind:27235)>
// Comprueba firma, kind, antigüedad (±60 s), ruta, método y, opcionalmente,
// tags extra que atan la autorización al contenido de la petición.
export function verifyNip98(req, { path, method = 'POST', bind = {} }) {
    const header = req.headers?.authorization || req.headers?.Authorization || '';
    if (!header.startsWith('Nostr ')) throw new Error('Falta autenticación Nostr (NIP-98)');
    let ev;
    try { ev = JSON.parse(Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')); }
    catch (e) { throw new Error('Autenticación NIP-98 ilegible'); }
    if (!ev || ev.kind !== 27235 || !verifyEvent(ev)) throw new Error('Autenticación NIP-98 inválida');
    if (Math.abs(Math.floor(Date.now() / 1000) - ev.created_at) > 60) throw new Error('Autenticación NIP-98 caducada');
    let u;
    try { u = new URL(tag(ev, 'u')); } catch (e) { throw new Error('NIP-98: URL inválida'); }
    if (u.pathname !== path) throw new Error('NIP-98: la URL no corresponde a este endpoint');
    if (tag(ev, 'method').toUpperCase() !== method) throw new Error('NIP-98: método no corresponde');
    for (const [k, v] of Object.entries(bind)) {
        if (tag(ev, k) !== String(v)) throw new Error(`NIP-98: '${k}' no coincide con la petición`);
    }
    return ev.pubkey;
}

// ── LNbits (solo lectura) ────────────────────────────────────
// Devuelve { paymentHash, bolt11, sats, incoming, paid, timeMs, memo } o null.
export async function getLnbitsPayment(paymentHash) {
    const url = (process.env.LNBITS_URL || '').replace(/\/+$/, '');
    const key = process.env.LNBITS_READ_KEY || '';
    if (!url || !key) throw new Error('LNBITS_URL / LNBITS_READ_KEY no configurados');
    const headers = { 'X-Api-Key': key, 'Accept': 'application/json' };

    // Lista reciente filtrada por hash (formato estable entre versiones de LNbits)
    const res = await fetch(`${url}/api/v1/payments?limit=500`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('LNbits respondió HTTP ' + res.status);
    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
    const p = list.find(x => x.payment_hash === paymentHash || x.checking_id === paymentHash);
    if (!p) return null;
    // p.time puede ser ISO string o segundos Unix según la versión
    const timeMs = p.time
        ? (typeof p.time === 'string' ? new Date(p.time).getTime() : p.time * 1000)
        : (p.created_at ? new Date(p.created_at).getTime() : 0);
    return {
        paymentHash: p.payment_hash || paymentHash,
        bolt11: p.bolt11 || '',
        sats: Math.floor(Math.abs(p.amount || 0) / 1000),
        incoming: (p.amount || 0) > 0,
        paid: p.pending === false || p.status === 'success' || p.paid === true,
        timeMs,
        memo: p.memo || ''
    };
}

// ── PocketBase (admin) ───────────────────────────────────────
const PB_URL = process.env.PB_URL || 'https://api.colombiap2p.com';
let _pbToken = null;
let _pbTokenAt = 0;
export async function pbFetch(path, opts = {}) {
    if (!_pbToken || Date.now() - _pbTokenAt > 50 * 60 * 1000) {
        const email = process.env.PB_ADMIN_EMAIL;
        const password = process.env.PB_ADMIN_PASSWORD;
        if (!email || !password) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD no configurados');
        const r = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identity: email, password }), signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) throw new Error('Auth PocketBase admin falló: HTTP ' + r.status);
        _pbToken = (await r.json()).token;
        _pbTokenAt = Date.now();
    }
    const res = await fetch(`${PB_URL}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', 'Authorization': _pbToken, ...(opts.headers || {}) },
        signal: AbortSignal.timeout(8000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.message || 'PocketBase error'), { status: res.status });
    return body;
}

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
        origin: originOf(ev),
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
    // Orden cronológico: los topes los consumen primero los méritos más antiguos
    const list = [...accepted.values()].sort((a, b) => a.ev.created_at - b.ev.created_at);
    for (const m of list) {
        if (!out.has(m.recipient)) out.set(m.recipient, { total: 0, byCategory: {}, byOrigin: {} });
        const u = out.get(m.recipient);
        let eff = m.amount;
        const catCap = CATEGORY_CAPS[m.category];
        if (catCap != null) eff = Math.min(eff, catCap - (u.byCategory[m.category] || 0));
        const oriCap = ORIGIN_CAPS[m.origin];
        if (oriCap != null) eff = Math.min(eff, oriCap - (u.byOrigin[m.origin] || 0));
        eff = Math.max(0, eff);
        u.total += eff;
        u.byCategory[m.category] = (u.byCategory[m.category] || 0) + eff;
        if (m.origin) u.byOrigin[m.origin] = (u.byOrigin[m.origin] || 0) + eff;
    }
    return out;
}

export function isGenesis(ledger, pubkey) {
    return (ledger.get(pubkey)?.total || 0) >= GENESIS_MIN;
}

// ── Emisión ──────────────────────────────────────────────────
// Mismo formato de d que js/nostr-merits.js → _makeDTag('merit', recipient, ref)
export const meritDTag = (recipient, ref) => `merit:${ref}:${recipient.substring(0, 16)}`;

// d: opcional, identificador fijo (p.ej. por pago) en vez de ref+destinatario
export function buildMerit({ recipient, amount, category, reason, ref, d }, issuerPk) {
    const now = Math.floor(Date.now() / 1000);
    return {
        kind: 31002,
        created_at: now,
        content: JSON.stringify({ reason, amount, awardedBy: issuerPk, timestamp: now }),
        tags: [
            ['d', d || meritDTag(recipient, ref)],
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

// Lee el mérito vigente del emisor con ese d (o null). Para méritos acumulados.
export async function getIssuerMerit(relay, d) {
    const { pk } = issuerKey();
    const evs = await query(relay, { kinds: [31002], authors: [pk], '#d': [d], limit: 5 });
    return evs.sort((a, b) => b.created_at - a.created_at)[0] || null;
}

// Publica (o REEMPLAZA, mismo d) un mérito del emisor. Para acumulados como la
// racha: un solo evento por usuario con el total, en vez de uno por día.
export async function publishMerit(relay, award) {
    const { sk, pk } = issuerKey();
    const ev = finalizeEvent(buildMerit(award, pk), sk);
    if (process.env.C2P_DRY_RUN !== '1') await relay.publish(ev);
    return { id: ev.id, d: award.d || meritDTag(award.recipient, award.ref), amount: award.amount };
}

// Emite los méritos que el emisor aún no haya emitido (idempotente por d).
// awards: [{ recipient, amount, category, reason, ref, d? }]
export async function issueMerits(relay, awards) {
    const { sk, pk } = issuerKey();
    if (awards.length === 0) return { issued: [], skipped: [] };

    const dOf = a => a.d || meritDTag(a.recipient, a.ref);
    const ds = awards.map(dOf);
    const existing = await query(relay, { kinds: [31002], authors: [pk], '#d': ds, limit: ds.length });
    const have = new Set(existing.map(ev => tag(ev, 'd')));

    const issued = [];
    const skipped = [];
    for (const a of awards) {
        const d = dOf(a);
        if (have.has(d)) { skipped.push({ ref: a.ref, recipient: a.recipient, reason: 'ya emitido' }); continue; }
        const ev = finalizeEvent(buildMerit(a, pk), sk);
        // C2P_DRY_RUN=1: calcular y firmar sin publicar (pruebas)
        if (process.env.C2P_DRY_RUN !== '1') await relay.publish(ev);
        issued.push({ ref: a.ref, recipient: a.recipient, amount: a.amount, category: a.category, id: ev.id });
    }
    return { issued, skipped };
}
