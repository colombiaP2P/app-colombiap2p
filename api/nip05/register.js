// [C2P] NIP-05 — Registro de identidad usuario@colombiap2p.com
//
// POST /api/nip05/register
// Body: { pubkey: "<64 hex>", username: "<slug>" }
//
// Valida formato, unicidad y crea el registro en PocketBase usando credenciales admin.
//
// Variables de entorno Vercel:
//   PB_URL            = https://api.colombiap2p.com  (opcional, tiene default)
//   PB_ADMIN_EMAIL    = admin@colombiap2p.com
//   PB_ADMIN_PASSWORD = <contraseña admin PocketBase>

const PB_URL = process.env.PB_URL || 'https://api.colombiap2p.com';

// Caché del token admin en memoria (survives Lambda warm invocations)
let _adminToken = null;
let _adminTokenAt = 0;
const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 min (PB tokens duran 1h)

async function _getAdminToken() {
    if (_adminToken && Date.now() - _adminTokenAt < TOKEN_TTL_MS) return _adminToken;

    const email    = process.env.PB_ADMIN_EMAIL;
    const password = process.env.PB_ADMIN_PASSWORD;
    if (!email || !password) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD no configurados');

    // PocketBase v0.20+ usa _superusers; versiones anteriores usan /api/admins
    const res = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: email, password }),
        signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error('Auth PocketBase admin falló: ' + res.status + ' ' + body);
    }

    const data = await res.json();
    _adminToken  = data.token;
    _adminTokenAt = Date.now();
    return _adminToken;
}

async function _pbFetch(path, opts = {}) {
    const token = await _getAdminToken();
    const res = await fetch(`${PB_URL}${path}`, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
            ...(opts.headers || {}),
        },
        signal: AbortSignal.timeout(8000),
    });
    const body = await res.json();
    if (!res.ok) throw Object.assign(new Error(body.message || 'PocketBase error'), { status: res.status, data: body });
    return body;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://colombiap2p.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const { pubkey, username } = req.body || {};

    // Validar pubkey
    if (!pubkey || !/^[0-9a-f]{64}$/.test(pubkey)) {
        return res.status(400).json({ error: 'pubkey inválida (debe ser hex de 64 chars)' });
    }

    // Validar username
    const slug = (username || '').toLowerCase().trim();
    if (!slug || !/^[a-z0-9_-]{3,30}$/.test(slug)) {
        return res.status(400).json({
            error: 'Username inválido. Solo letras minúsculas, números, guión y guión bajo. Entre 3 y 30 caracteres.',
        });
    }

    // Nombres reservados
    const RESERVED = ['admin', 'root', 'colombiap2p', 'satoshi', 'bitcoin', 'soporte', 'sistema', '_'];
    if (RESERVED.includes(slug)) {
        return res.status(400).json({ error: 'Username reservado, elige otro' });
    }

    try {
        // Verificar que el username no esté tomado
        const byName = await _pbFetch(
            `/api/collections/nip05_identities/records?filter=${encodeURIComponent(`username="${slug}"`)}&limit=1`
        );
        if (byName.totalItems > 0) {
            return res.status(409).json({ error: 'Ese username ya está registrado. Elige otro.' });
        }

        // Verificar que la pubkey no tenga ya un NIP-05
        const byPubkey = await _pbFetch(
            `/api/collections/nip05_identities/records?filter=${encodeURIComponent(`pubkey="${pubkey}"`)}&limit=1`
        );
        if (byPubkey.totalItems > 0) {
            const existing = byPubkey.items[0];
            return res.status(409).json({
                error: 'Ya tienes una identidad NIP-05 registrada',
                existing: existing.username + '@colombiap2p.com',
            });
        }

        // Crear el registro
        const record = await _pbFetch('/api/collections/nip05_identities/records', {
            method: 'POST',
            body: JSON.stringify({ username: slug, pubkey, active: true }),
        });

        return res.status(200).json({
            ok: true,
            identity: slug + '@colombiap2p.com',
            id: record.id,
        });

    } catch (e) {
        console.error('[NIP-05 register]', e.message, e.data);
        if (e.status === 409) return res.status(409).json({ error: e.message });
        return res.status(502).json({ error: 'Error interno: ' + e.message });
    }
}
