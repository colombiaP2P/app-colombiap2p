// [C2P FASE 9] Proxy callback LNURLP → colsats.com
// Recibe la petición del navegador y la reenvía al callback real de colsats.com.
// El callback original viene de _upstream_callback en la respuesta del well-known.

const C2P_LN_CALLBACK = 'https://colsats.com/lnurlp/colombiap2p/callback';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const queryString = new URLSearchParams(req.query).toString();
    const upstreamUrl = `${C2P_LN_CALLBACK}?${queryString}`;

    const response = await fetch(upstreamUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
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
