// [C2P FASE 10] NIP-05 — /.well-known/nostr.json
// Resuelve identidades tipo user@colombiap2p.com consultando PocketBase.
//
// Uso:
//   GET /.well-known/nostr.json?name=usuario
//   GET /.well-known/nostr.json?name=_           ← identidad raíz del dominio
//
// Colección PocketBase: nip05_identities
//   Fields: username (text, unique), pubkey (text 64 hex), active (bool)
//
// Respuesta NIP-05:
//   { "names": { "username": "hex_pubkey" },
//     "relays": { "hex_pubkey": ["wss://relay.colombiap2p.com"] } }

const PB_URL     = 'https://api.colombiap2p.com';
const C2P_RELAYS = ['wss://relay.colombiap2p.com'];

export default async function handler(req, res) {
    // CORS — requerido por NIP-05 (clientes Nostr hacen fetch desde cualquier origen)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache

    if (req.method === 'OPTIONS') return res.status(200).end();

    const name = (req.query.name || '').toLowerCase().trim();

    if (!name || !/^[a-z0-9._\-]{1,64}$/.test(name.replace(/^_$/, '_'))) {
        return res.status(400).json({ error: 'Parámetro name inválido o faltante' });
    }

    try {
        // Consultar PocketBase
        const filter = encodeURIComponent(`username = "${name}" && active = true`);
        const pbRes  = await fetch(
            `${PB_URL}/api/collections/nip05_identities/records?filter=${filter}&limit=1`,
            {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(5000),
            }
        );

        if (!pbRes.ok) {
            throw new Error('PocketBase error ' + pbRes.status);
        }

        const data = await pbRes.json();

        if (!data.items || data.items.length === 0) {
            return res.status(404).json({ error: 'Nombre no encontrado' });
        }

        const record = data.items[0];
        const pubkey = record.pubkey;

        // Validar que sea hex de 64 chars
        if (!/^[0-9a-f]{64}$/.test(pubkey)) {
            return res.status(500).json({ error: 'Pubkey inválida en base de datos' });
        }

        return res.status(200).json({
            names:  { [name]: pubkey },
            relays: { [pubkey]: C2P_RELAYS },
        });

    } catch (e) {
        console.error('[NIP-05]', e.message);
        return res.status(502).json({ error: 'No se pudo resolver la identidad' });
    }
}
