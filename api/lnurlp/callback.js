// [C2P FASE 9] Proxy callback LNURLP → colsats.com
// Obtiene el callback real desde el well-known de Colsats (evita URL hardcodeada).

const C2P_LN_WELLKNOWN = 'https://colsats.com/.well-known/lnurlp/colombiap2p';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Obtener el callback real desde el well-known
    const metaRes = await fetch(C2P_LN_WELLKNOWN, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!metaRes.ok) {
      return res.status(502).json({ error: 'No se pudo leer well-known de Colsats (' + metaRes.status + ')' });
    }
    const meta = await metaRes.json();
    if (!meta.callback) {
      return res.status(502).json({ error: 'Colsats no devolvió callback en well-known' });
    }

    // Reenviar todos los query params al callback real
    const queryString = new URLSearchParams(req.query).toString();
    const upstreamUrl = `${meta.callback}?${queryString}`;

    const response = await fetch(upstreamUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'upstream callback error ' + response.status });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('[C2P callback] Error:', error.message);
    return res.status(500).json({ error: error.message || 'Error generando invoice' });
  }
}
