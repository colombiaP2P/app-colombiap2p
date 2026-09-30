// ============================================================
// ColombiaP2P — Emisor de méritos (Fase 1, opción B1)
//
// Firma con la clave del "Emisor ColombiaP2P" (emisor de confianza
// listado en js/nostr-merits.js → TRUSTED_ISSUERS) y publica en el
// relay propio.
//
// Uso:
//   node issuer.mjs bootstrap <pubkeyHex> [<pubkeyHex> ...] [--dry-run]
//       3000 méritos fundacionales a cada pubkey (los convierte en Génesis).
//       d estable → repetirlo reemplaza, no duplica.
//   node issuer.mjs revoke <firmanteHex> <d> [--dry-run]
//       Revoca (NIP-09 kind:5) el mérito 31002 identificado por firmante + d.
//
// Clave (en este orden):
//   env C2P_ISSUER_NSEC        — nsec1... (así lo usarán los endpoints de Vercel)
//   --key-file <ruta>          — JSON con campo "nsec"
//   ~/.config/colombiap2p/issuer-key.json (por defecto)
//
// La clave privada NUNCA debe subirse al repo.
// ============================================================

import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';

useWebSocketImplementation(WebSocket);

const RELAY_URL = process.env.C2P_RELAY_URL || 'wss://relay.colombiap2p.com';
const FOUNDATIONAL_AMOUNT = 3000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keyFileIdx = args.indexOf('--key-file');
const keyFile = keyFileIdx >= 0 ? args[keyFileIdx + 1]
    : path.join(os.homedir(), '.config', 'colombiap2p', 'issuer-key.json');
const positional = args.filter((a, i) => !a.startsWith('--') && (keyFileIdx < 0 || i !== keyFileIdx + 1));
const [command, ...params] = positional;

function loadSecretKey() {
    let nsec = process.env.C2P_ISSUER_NSEC;
    if (!nsec) {
        if (!fs.existsSync(keyFile)) throw new Error(`No hay C2P_ISSUER_NSEC ni archivo de clave en ${keyFile}`);
        nsec = JSON.parse(fs.readFileSync(keyFile, 'utf8')).nsec;
    }
    const decoded = nip19.decode(nsec.trim());
    if (decoded.type !== 'nsec') throw new Error('La clave no es un nsec válido');
    return decoded.data;
}

const isHex64 = s => /^[0-9a-f]{64}$/.test(s);

// Mismo formato de d que js/nostr-merits.js → _makeDTag('merit', recipient, ref)
const meritDTag = (recipient, ref) => `merit:${ref}:${recipient.substring(0, 16)}`;

function buildBootstrap(recipient, issuerPk) {
    const ref = 'fundacional:bootstrap';
    const now = Math.floor(Date.now() / 1000);
    const reason = 'Méritos fundacionales — administración ColombiaP2P';
    return {
        kind: 31002,
        created_at: now,
        content: JSON.stringify({ reason, amount: FOUNDATIONAL_AMOUNT, awardedBy: issuerPk, isBootstrap: true, timestamp: now }),
        tags: [
            ['d', meritDTag(recipient, ref)],
            ['p', recipient],
            ['amount', String(FOUNDATIONAL_AMOUNT)],
            ['category', 'fundacional'],
            ['reason', reason],
            ['awarded-by', issuerPk],
            ['origin', 'fundacional'],
            ['ref', ref],
            ['t', 'c2p-merits'],
            ['t', 'c2p-merit-award'],
            ['t', 'c2p-bootstrap'],
            ['client', 'ColombiaP2P']
        ]
    };
}

function buildRevocation(signer, dTag) {
    return {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        content: 'Mérito revocado por el Emisor ColombiaP2P',
        tags: [
            ['a', `31002:${signer}:${dTag}`],
            ['k', '31002'],
            ['client', 'ColombiaP2P']
        ]
    };
}

async function publishAll(events) {
    const relay = await Relay.connect(RELAY_URL);
    try {
        for (const ev of events) {
            await relay.publish(ev);
            console.log(`✅ Publicado kind:${ev.kind} id=${ev.id.substring(0, 12)} d=${(ev.tags.find(t => t[0] === 'd') || [])[1] || '-'}`);
        }
    } finally {
        relay.close();
    }
}

async function main() {
    const sk = loadSecretKey();
    const issuerPk = getPublicKey(sk);
    console.log(`Emisor: ${issuerPk}  (${RELAY_URL})${dryRun ? '  [DRY RUN]' : ''}`);

    let templates;
    if (command === 'bootstrap') {
        if (params.length === 0 || !params.every(isHex64)) throw new Error('bootstrap requiere una o más pubkeys hex de 64 caracteres');
        templates = params.map(pk => buildBootstrap(pk, issuerPk));
    } else if (command === 'revoke') {
        const [signer, dTag] = params;
        if (!isHex64(signer || '') || !dTag) throw new Error('revoke requiere <firmanteHex> <d>');
        templates = [buildRevocation(signer, dTag)];
    } else {
        throw new Error('Comando desconocido. Usa: bootstrap | revoke');
    }

    const events = templates.map(t => finalizeEvent(t, sk));
    if (dryRun) {
        events.forEach(e => console.log(JSON.stringify({ kind: e.kind, pubkey: e.pubkey, tags: e.tags }, null, 2)));
        return;
    }
    await publishAll(events);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
