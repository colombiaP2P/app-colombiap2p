// ============================================================
// ColombiaP2P — Fase 3: migrar el XP de PocketBase a méritos Nostr
//
// Lee xp_transactions (lectura pública) y publica cada registro como un
// kind:31002 firmado por el Emisor ColombiaP2P, con el MISMO d que usarían
// los endpoints api/merits/* para ese hecho, de modo que nada se duplica:
//   evento   → merit:evento:<eventId>:<pk16>        (productiva)
//   mision   → merit:mision:<missionId>:<pk16>      (categoría de la misión)
//   referido → merit:referido:<referido>:<pk16>     (productiva)
//   racha    → merit:racha:historico:<pk16>         (suma de todos los días)
//   economica con ref_id = payment_hash → merit:zap:<hash>  (mismo d que api/merits/economic)
//   resto    → merit:pb:<recordId>:<pk16>           (economica o productiva)
// La fecha original va en el tag ['occurred_at', unix] (el created_at es el de
// la migración: el emisor solo es válido desde su fecha de alta).
// Idempotente: los d que el emisor ya publicó se omiten.
//
// Uso (desde scripts/merits-issuer):
//   node migrate-xp.mjs --dry-run     # muestra el plan, no publica
//   node migrate-xp.mjs               # publica
// Clave: env C2P_ISSUER_NSEC o ~/.config/colombiap2p/issuer-key.json
// ============================================================

import { finalizeEvent, getPublicKey, nip19, Relay } from 'nostr-tools';
import WebSocket from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';

if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket;

const RELAY_URL = process.env.C2P_RELAY_URL || 'wss://relay.colombiap2p.com';
const PB_URL = process.env.PB_URL || 'https://api.colombiap2p.com';
const dryRun = process.argv.includes('--dry-run');
const CATEGORIES = ['productiva', 'economica', 'responsabilidad', 'financiada'];

function loadSecretKey() {
    let nsec = process.env.C2P_ISSUER_NSEC;
    if (!nsec) {
        const f = path.join(os.homedir(), '.config', 'colombiap2p', 'issuer-key.json');
        nsec = JSON.parse(fs.readFileSync(f, 'utf8')).nsec;
    }
    const decoded = nip19.decode(nsec.trim());
    if (decoded.type !== 'nsec') throw new Error('Clave del emisor inválida');
    return decoded.data;
}

async function pbList(collection, extra = '') {
    const out = [];
    for (let page = 1; ; page++) {
        const r = await fetch(`${PB_URL}/api/collections/${collection}/records?perPage=500&page=${page}${extra}`);
        if (!r.ok) throw new Error(`PocketBase ${collection}: HTTP ${r.status}`);
        const d = await r.json();
        out.push(...(d.items || []));
        if (page >= (d.totalPages || 1)) break;
    }
    return out;
}

const isHex64 = s => /^[0-9a-f]{64}$/.test(s || '');
const unix = iso => Math.floor(new Date(String(iso).replace(' ', 'T')).getTime() / 1000);
const dOf = (ref, pk) => `merit:${ref}:${pk.substring(0, 16)}`;

// user_pubkey puede venir como hex o como npub (registros antiguos)
function toHex(pk) {
    const s = String(pk || '').trim().toLowerCase();
    if (isHex64(s)) return s;
    if (s.startsWith('npub1')) { try { const d = nip19.decode(s); if (d.type === 'npub') return d.data; } catch (e) {} }
    return '';
}

function query(relay, filter) {
    return new Promise(resolve => {
        const events = [];
        const timer = setTimeout(() => { sub.close(); resolve(events); }, 10000);
        const sub = relay.subscribe([filter], {
            onevent: ev => events.push(ev),
            oneose: () => { clearTimeout(timer); sub.close(); resolve(events); }
        });
    });
}

async function main() {
    const sk = loadSecretKey();
    const issuer = getPublicKey(sk);

    const [xp, missions] = await Promise.all([
        pbList('xp_transactions', '&sort=created'),
        pbList('missions', '&fields=id,merit_category').catch(() => [])
    ]);
    const missionCat = new Map(missions.map(m => [m.id, m.merit_category]));

    // ── Construir el plan ──
    const plan = [];
    const rachas = new Map();   // pubkey → { amount, first, last, count }
    let skippedBadUser = 0;
    for (const r of xp) {
        const pk = toHex(r.user_pubkey);
        if (!isHex64(pk) || !(r.amount > 0)) { skippedBadUser++; continue; }
        const when = unix(r.created);
        if (r.source === 'racha') {
            const a = rachas.get(pk) || { amount: 0, first: when, last: when, count: 0 };
            a.amount += r.amount; a.count++; a.first = Math.min(a.first, when); a.last = Math.max(a.last, when);
            rachas.set(pk, a);
            continue;
        }
        let ref, category = 'productiva', d = null;
        if (r.source === 'evento' && r.ref_id) ref = `evento:${r.ref_id}`;
        else if (r.source === 'mision' && r.ref_id) {
            ref = `mision:${r.ref_id}`;
            if (CATEGORIES.includes(missionCat.get(r.ref_id))) category = missionCat.get(r.ref_id);
        }
        else if (r.source === 'referido' && isHex64(r.ref_id)) ref = `referido:${r.ref_id}`;
        else if (r.source === 'economica' && isHex64(r.ref_id)) {
            // ref_id es el payment_hash: mismo d que emite api/merits/economic
            ref = `zap:${r.ref_id}`; category = 'economica'; d = `merit:zap:${r.ref_id}`;
        }
        else {
            ref = `pb:${r.id}`;
            if (r.source === 'economica') category = 'economica';
        }
        plan.push({ recipient: pk, amount: r.amount, category, ref, d: d || dOf(ref, pk), occurredAt: when,
                    reason: r.reason || r.source, origin: ref.split(':')[0] === 'pb' ? (r.source || 'pb') : ref.split(':')[0] });
    }
    for (const [pk, a] of rachas) {
        plan.push({ recipient: pk, amount: a.amount, category: 'productiva', ref: 'racha:historico', d: dOf('racha:historico', pk),
                    occurredAt: a.last, reason: `🔥 Rachas diarias (historial anterior, ${a.count} días)`, origin: 'racha' });
    }

    const relay = await Relay.connect(RELAY_URL);
    try {
        // ── Omitir lo que el emisor ya publicó (idempotencia) ──
        const existing = new Set();
        const ds = plan.map(p => p.d);
        for (let i = 0; i < ds.length; i += 200) {
            const evs = await query(relay, { kinds: [31002], authors: [issuer], '#d': ds.slice(i, i + 200), limit: 500 });
            evs.forEach(ev => existing.add((ev.tags.find(t => t[0] === 'd') || [])[1]));
        }
        // Sin duplicados dentro del plan (p.ej. dos check-ins del mismo evento) ni con lo ya emitido
        const seenD = new Set();
        const dupInPlan = [];
        const todo = plan.filter(p => {
            if (existing.has(p.d)) return false;
            if (seenD.has(p.d)) { dupInPlan.push(p); return false; }
            seenD.add(p.d); return true;
        });

        const total = todo.reduce((s, p) => s + p.amount, 0);
        console.log(`Emisor ${issuer.substring(0, 8)} → ${RELAY_URL}${dryRun ? '  [DRY RUN]' : ''}`);
        console.log(`XP en PocketBase: ${xp.length} registros (${skippedBadUser} omitidos por pubkey/importe inválido)`);
        console.log(`Méritos a emitir: ${todo.length} · ya emitidos antes: ${plan.filter(p => existing.has(p.d)).length} · duplicados en PocketBase: ${dupInPlan.length} · total ${total} méritos`);
        dupInPlan.forEach(p => console.log(`  (duplicado omitido) ${p.recipient.substring(0, 8)} ${p.amount} ${p.d}`));
        plan.filter(p => existing.has(p.d)).forEach(p => console.log(`  (ya emitido)        ${p.recipient.substring(0, 8)} ${p.amount} ${p.d}`));
        const byUser = new Map();
        todo.forEach(p => byUser.set(p.recipient, (byUser.get(p.recipient) || 0) + p.amount));
        [...byUser].sort((a, b) => b[1] - a[1]).forEach(([pk, a]) => console.log(`  ${pk.substring(0, 8)}  +${a}`));
        console.log('Detalle:');
        todo.forEach(p => console.log(`  ${p.recipient.substring(0, 8)} ${String(p.amount).padStart(4)} ${p.category.padEnd(10)} ${p.d}  (${new Date(p.occurredAt * 1000).toISOString().slice(0, 10)})`));

        if (dryRun) return;

        const now = Math.floor(Date.now() / 1000);
        let ok = 0;
        for (const p of todo) {
            const ev = finalizeEvent({
                kind: 31002,
                created_at: now,
                content: JSON.stringify({ reason: p.reason, amount: p.amount, awardedBy: issuer, migratedFrom: 'pocketbase', timestamp: now }),
                tags: [
                    ['d', p.d], ['p', p.recipient], ['amount', String(p.amount)], ['category', p.category],
                    ['reason', p.reason], ['awarded-by', issuer], ['origin', p.origin], ['ref', p.ref],
                    ['occurred_at', String(p.occurredAt)], ['migrated', 'pocketbase'],
                    ['t', 'c2p-merits'], ['t', 'c2p-merit-award'], ['client', 'ColombiaP2P']
                ]
            }, sk);
            await relay.publish(ev);
            ok++;
        }
        console.log(`✅ Publicados ${ok} méritos`);
    } finally {
        relay.close();
    }
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
