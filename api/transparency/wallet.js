// [C2P FASE 11] Tesorería ColombiaP2P — proxy transparencia
//
// Fuentes de datos (en orden de prioridad):
//   1. LNbits API (balance + pagos) — requiere LNBITS_READ_KEY en Vercel env
//   2. LNURL público de colsats.com — siempre disponible
//
// Variables de entorno Vercel:
//   LNBITS_URL       = https://colsats.com  (o la URL de tu instancia LNbits)
//   LNBITS_READ_KEY  = <invoice/read key de LNbits>
//   LNBITS_WALLET_ID = <wallet_id> (opcional, para filtrar pagos)

const C2P_LN_ADDRESS   = 'colombiap2p@colsats.com';
const C2P_LNURL_PUBLIC = 'https://colsats.com/.well-known/lnurlp/colombiap2p';
const C2P_PUBLIC_URL   = 'https://colsats.com';

const TTL_MS = 30_000; // 30 s cache
let _cache = null;
let _cacheAt = 0;

async function _fetchLNbitsData(lnbitsUrl, readKey) {
    const headers = { 'X-Api-Key': readKey, 'Accept': 'application/json' };
    const opts    = { headers, signal: AbortSignal.timeout(8000) };

    const [walletRes, paymentsRes] = await Promise.allSettled([
        fetch(`${lnbitsUrl}/api/v1/wallet`, opts),
        fetch(`${lnbitsUrl}/api/v1/payments?limit=50`, opts),
    ]);

    let balance = null, movements = [];
    let _debug = {};

    if (walletRes.status === 'fulfilled' && walletRes.value.ok) {
        const w = await walletRes.value.json();
        balance = Math.floor((w.balance || 0) / 1000); // msats → sats
    } else {
        _debug.walletErr = walletRes.status === 'fulfilled'
            ? 'HTTP ' + walletRes.value.status
            : walletRes.reason?.message;
    }

    if (paymentsRes.status === 'fulfilled' && paymentsRes.value.ok) {
        const raw = await paymentsRes.value.json();
        const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
        _debug.paymentsRaw = list.length;
        _debug.pendingValues = list.slice(0, 5).map(p => p.pending);
        _debug.firstPaymentKeys = list.length > 0 ? Object.keys(list[0]) : [];
        _debug.firstPayment = list.length > 0 ? list[0] : null;
        movements = list
            .filter(p => !p.pending)
            .map(p => {
                const tsMs = p.time
                    ? (typeof p.time === 'string' ? new Date(p.time).getTime() : p.time * 1000)
                    : (p.created_at ? new Date(p.created_at).getTime() : Date.now());
                return {
                    type:   p.amount > 0 ? 'in' : 'out',
                    amount: Math.abs(Math.floor(p.amount / 1000)),
                    memo:   p.memo || p.description || '',
                    time:   tsMs,
                    ts:     tsMs,
                    payment_hash: p.payment_hash || '',
                    bolt11: p.bolt11 || '',
                    extra:  p.extra || {},
                };
            });
    } else {
        _debug.paymentsErr = paymentsRes.status === 'fulfilled'
            ? 'HTTP ' + paymentsRes.value.status
            : paymentsRes.reason?.message;
    }

    const totalIn  = movements.filter(m => m.type === 'in').reduce((s, m) => s + m.amount, 0);
    const totalOut = movements.filter(m => m.type === 'out').reduce((s, m) => s + m.amount, 0);
    return { balance, movements, totalIn, totalOut, txCount: movements.length, authNotSupported: balance === null, _debug };
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    const forceRefresh = req.query.nocache === '1';
    if (!forceRefresh && _cache && Date.now() - _cacheAt < TTL_MS) {
        return res.status(200).json({ ..._cache, cached: true });
    }

    const lnbitsUrl = process.env.LNBITS_URL   || '';
    const readKey   = process.env.LNBITS_READ_KEY || '';

    try {
        // Siempre obtener datos LNURL públicos
        const lnurlRes  = await fetch(C2P_LNURL_PUBLIC, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(6000),
        });
        const lnurlData = lnurlRes.ok ? await lnurlRes.json() : null;

        const result = {
            username:   'colombiap2p',
            display:    'ColombiaP2P',
            about:      'Comunidad Bitcoin colombiana · Lightning · Nostr · P2P · Privacidad',
            lightning:  C2P_LN_ADDRESS,
            publicUrl:  C2P_PUBLIC_URL,
            lnurlp: lnurlData ? {
                minSendable:    lnurlData.minSendable,
                maxSendable:    lnurlData.maxSendable,
                commentAllowed: lnurlData.commentAllowed,
                allowsNostr:    lnurlData.allowsNostr,
                nostrPubkey:    lnurlData.nostrPubkey || '',
            } : null,
            balance:         null,
            movements:       [],
            authNotSupported: true,
            fetchedAt:        Date.now(),
            configured:       true,
        };

        // Intentar LNbits API si hay credenciales
        if (lnbitsUrl && readKey) {
            try {
                const lnbits = await _fetchLNbitsData(lnbitsUrl, readKey);
                result.balance          = lnbits.balance;
                result.movements        = lnbits.movements;
                result.totalIn          = lnbits.totalIn;
                result.totalOut         = lnbits.totalOut;
                result.txCount          = lnbits.txCount;
                result.authNotSupported = lnbits.authNotSupported;
                result._debug           = lnbits._debug;
                // Siempre exponer el nostrPubkey para que el cliente pueda buscar zap receipts (NIP-57)
                result.pubkey = result.lnurlp?.nostrPubkey || lnurlData?.nostrPubkey || '';
            } catch (e) {
                console.warn('[C2P Treasury] LNbits API falló:', e.message);
            }
        }

        _cache   = result;
        _cacheAt = Date.now();
        return res.status(200).json(result);

    } catch (e) {
        if (_cache) return res.status(200).json({ ..._cache, cached: true, stale: true });
        return res.status(502).json({ error: 'fallo al consultar la tesorería', detail: e.message, configured: true });
    }
}
